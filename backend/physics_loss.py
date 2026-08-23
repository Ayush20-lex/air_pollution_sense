"""
Module 4 — Physics-Informed Custom Loss Function (PyTorch)
SIH26082 · MoES / NCMRWF
"""
from __future__ import annotations

import torch
import torch.nn as nn
import torch.nn.functional as F
from torch import Tensor


# ── Channel indices (mirror coupled_model.py) ─────────────────────────────────
CH_PM25  = 0
CH_UWIND = 4
CH_VWIND = 5
CH_TEMP  = 6
CH_SOLAR = 8
CH_PBL   = 9

# Physics thresholds
STAGNANT_WIND_MS  = 2.0    # m/s — below this convective mixing is negligible
INVERSION_PBL_M   = 400.0  # m   — below this counts as strong inversion
MIN_VERT_FLUX_KGS = 1e-3   # kg/m²/s — minimum vertical mass flux to allow decrease


class AtmosphericInversionLoss(nn.Module):
    """
    Physics-informed loss for coupled air-pollution forecasting.

    L_total = λ_mse · L_mse
            + λ_mae · L_mae
            + λ_phys · L_conservation
            + λ_inv  · L_inversion_severity

    Parameters
    ----------
    lambda_mse : float
        Weight for standard MSE term (default 1.0).
    lambda_mae : float
        Weight for L1 term — improves robustness to peak events (default 0.5).
    lambda_phys : float
        Weight for mass conservation penalty (default 2.0 — strongly enforced).
    lambda_inv : float
        Weight for inversion severity underestimation penalty (default 1.5).
    pm25_norm : float
        Normalisation factor for PM2.5 channel (default 500 µg/m³).
    pbl_norm : float
        Normalisation factor for PBL channel (default 2000 m).
    """

    def __init__(
        self,
        lambda_mse:  float = 1.0,
        lambda_mae:  float = 0.5,
        lambda_phys: float = 2.0,
        lambda_inv:  float = 1.5,
        pm25_norm:   float = 500.0,
        pbl_norm:    float = 2000.0,
    ) -> None:
        super().__init__()
        self.lambda_mse  = lambda_mse
        self.lambda_mae  = lambda_mae
        self.lambda_phys = lambda_phys
        self.lambda_inv  = lambda_inv
        self.pm25_norm   = pm25_norm
        self.pbl_norm    = pbl_norm

    # ── Component losses ──────────────────────────────────────────────────────

    @staticmethod
    def _mse(pred: Tensor, target: Tensor) -> Tensor:
        return F.mse_loss(pred, target)

    @staticmethod
    def _mae(pred: Tensor, target: Tensor) -> Tensor:
        return F.l1_loss(pred, target)

    def _conservation_penalty(
        self,
        pred_seq: Tensor,    # (B, T, C, H, W)
        target_seq: Tensor,  # (B, T, C, H, W)
    ) -> Tensor:
        """
        Conservation of Mass Penalty.

        Fires when ALL of the following hold simultaneously:
            (a) Wind speed < STAGNANT_WIND_MS → no horizontal advection
            (b) PBL height < INVERSION_PBL_M  → no vertical mixing escape
            (c) Model predicts PM2.5 decrease  → spurious mass sink

        Penalty magnitude = |ΔAPM2.5| · stagnation_mask · inversion_mask
        This encourages the model to predict PM2.5 staying elevated (or
        increasing) when transport and mixing are physically blocked.
        """
        # Extract channels (B, T, H, W)
        pm25_pred   = pred_seq[:, :, CH_PM25]
        pm25_target = target_seq[:, :, CH_PM25]
        u_pred      = pred_seq[:, :, CH_UWIND]
        v_pred      = pred_seq[:, :, CH_VWIND]
        pbl_pred    = pred_seq[:, :, CH_PBL]   * self.pbl_norm

        # (a) Stagnation mask: binary, 1 where wind speed < threshold
        wind_speed    = torch.hypot(u_pred, v_pred)               # (B, T, H, W)
        stagnant_mask = (wind_speed < STAGNANT_WIND_MS / 20.0).float()  # normalised

        # (b) Inversion mask: 1 where PBL is compressed
        inversion_mask = (pbl_pred < INVERSION_PBL_M).float()

        # (c) Spurious decrease mask: model predicts PM2.5 drop but physics forbids it
        delta_pm25_pred = pm25_pred[:, 1:] - pm25_pred[:, :-1]   # (B, T-1, H, W)
        spurious_decrease = F.relu(-delta_pm25_pred)               # only penalise drops

        # Combine all three conditions (element-wise product = logical AND)
        combined_mask = stagnant_mask[:, :-1] * inversion_mask[:, :-1]
        penalty = (spurious_decrease * combined_mask).mean()

        return penalty

    def _inversion_severity_penalty(
        self,
        pred_seq: Tensor,    # (B, T, C, H, W)
        target_seq: Tensor,  # (B, T, C, H, W)
    ) -> Tensor:
        """
        Inversion Severity Underestimation Penalty.

        During inversion events (GT PBL < 400m AND GT PM2.5 > 300 µg/m³),
        asymmetrically penalise underprediction of PM2.5 more than overprediction.
        This is critical for early-warning accuracy — false negatives are
        far more dangerous than false positives in public health terms.
        """
        pm25_pred   = pred_seq[:, :, CH_PM25]   * self.pm25_norm
        pm25_target = target_seq[:, :, CH_PM25] * self.pm25_norm
        pbl_target  = target_seq[:, :, CH_PBL]  * self.pbl_norm

        # Identify severe inversion events in ground truth
        severe_mask = (
            (pbl_target < INVERSION_PBL_M) &
            (pm25_target > 300.0)
        ).float()

        # Huber-like asymmetric penalty: 2× weight on underprediction
        residual = pm25_target - pm25_pred      # positive = underprediction
        asym_penalty = torch.where(
            residual > 0,
            2.0 * residual ** 2,                # underprediction: 2× MSE
            0.5 * residual ** 2,                # overprediction: 0.5× MSE
        )
        masked_penalty = (asym_penalty * severe_mask).sum() / (severe_mask.sum() + 1e-6)
        return masked_penalty / (self.pm25_norm ** 2)   # re-normalise to [0, ~1]

    # ── Forward ───────────────────────────────────────────────────────────────

    def forward(
        self,
        pred_seq: Tensor,     # (B, T, C, H, W) — model output (normalised)
        target_seq: Tensor,   # (B, T, C, H, W) — ground truth (normalised)
    ) -> tuple[Tensor, dict[str, float]]:
        """
        Parameters
        ----------
        pred_seq : Model predictions, normalised to [0, 1] approximately.
        target_seq : Ground truth, same normalisation.

        Returns
        -------
        (total_loss, component_dict) where component_dict contains individual
        loss terms for logging/TensorBoard.
        """
        l_mse  = self._mse(pred_seq, target_seq)
        l_mae  = self._mae(pred_seq, target_seq)
        l_cons = self._conservation_penalty(pred_seq, target_seq)
        l_inv  = self._inversion_severity_penalty(pred_seq, target_seq)

        total = (
            self.lambda_mse  * l_mse
            + self.lambda_mae  * l_mae
            + self.lambda_phys * l_cons
            + self.lambda_inv  * l_inv
        )

        components = {
            "loss/mse":          l_mse.item(),
            "loss/mae":          l_mae.item(),
            "loss/conservation": l_cons.item(),
            "loss/inversion":    l_inv.item(),
            "loss/total":        total.item(),
        }
        return total, components


# ── Inversion Severity Index (ISI) ────────────────────────────────────────────

def compute_isi(
    pm25_grid: Tensor,    # (H, W) — µg/m³
    pbl_grid: Tensor,     # (H, W) — m
    wind_speed: Tensor,   # (H, W) — m/s
) -> Tensor:
    """
    Inversion Severity Index ∈ [0, 1].

    ISI = σ(α·PM25_norm + β·PBL_inv_norm + γ·Stagnation_norm)

    Thresholds derived from CPCB Severe+ AQI criteria and NCMRWF WRF output.
    ISI > 0.75 triggers EMERGENCY alert tier in the API.
    """
    pm25_norm    = (pm25_grid / 500.0).clamp(0, 1)
    pbl_inv_norm = (1.0 - pbl_grid / 2000.0).clamp(0, 1)
    stag_norm    = (1.0 - wind_speed / 10.0).clamp(0, 1)

    isi_raw = 0.45 * pm25_norm + 0.35 * pbl_inv_norm + 0.20 * stag_norm
    return torch.sigmoid((isi_raw - 0.5) * 8.0)     # sharp sigmoid centred at 0.5
