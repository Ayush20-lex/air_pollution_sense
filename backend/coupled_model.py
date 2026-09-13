"""
Module 3 — Coupled Spatiotemporal Model Architecture (PyTorch)
SIH26082 · MoES / NCMRWF

Tensor convention: (Batch, Time, Channels, Height, Width)
Grid: H=70, W=80, Channels=12
"""
from __future__ import annotations

import math
import torch
import torch.nn as nn
import torch.nn.functional as F
from torch import Tensor


# ── Constants ─────────────────────────────────────────────────────────────────
N_CHANNELS  = 12
GRID_H      = 70
GRID_W      = 80
N_STEPS     = 72    # forecast horizon (hours)

#: Largest change the residual head may make to a channel in one hour, in
#: normalised units. 0.5 is 500 ug/m3 on the PM2.5 scale - far beyond any
#: real hourly change (~22), so it never binds in practice; it exists to keep
#: a 72-step rollout from running away.
MAX_STEP_DELTA = 0.5

# Channel indices
CH_PM25     = 0
CH_PM10     = 1
CH_O3       = 2
CH_NOX      = 3
CH_UWIND    = 4
CH_VWIND    = 5
CH_TEMP     = 6
CH_RH       = 7
CH_SOLAR    = 8
CH_PBL      = 9
CH_FRP      = 10
CH_SMOKE    = 11


# ── ConvLSTM Cell ─────────────────────────────────────────────────────────────

class CoupledConvLSTMCell(nn.Module):
    """
    ConvLSTM cell with peephole connections and layer normalisation.

    Parameters
    ----------
    in_channels : Number of input feature channels.
    hidden_dim : Number of hidden state channels.
    kernel_size : Spatial convolution kernel (int or tuple).
    """

    def __init__(
        self,
        in_channels: int,
        hidden_dim: int = 64,
        kernel_size: int | tuple[int, int] = 3,
    ) -> None:
        super().__init__()
        self.hidden_dim = hidden_dim
        pad = kernel_size // 2 if isinstance(kernel_size, int) else tuple(k // 2 for k in kernel_size)

        # Gates: input, forget, cell, output — fused into one conv for efficiency
        self.conv_gates = nn.Conv2d(
            in_channels + hidden_dim, 4 * hidden_dim,
            kernel_size=kernel_size, padding=pad, bias=True,
        )
        # Peephole: diagonal state-to-gate connections
        self.W_ci = nn.Parameter(torch.zeros(1, hidden_dim, 1, 1))
        self.W_cf = nn.Parameter(torch.zeros(1, hidden_dim, 1, 1))
        self.W_co = nn.Parameter(torch.zeros(1, hidden_dim, 1, 1))

        self.ln_h = nn.GroupNorm(num_groups=8, num_channels=hidden_dim)
        self.ln_c = nn.GroupNorm(num_groups=8, num_channels=hidden_dim)

        self._init_weights()

    def _init_weights(self) -> None:
        nn.init.orthogonal_(self.conv_gates.weight)
        nn.init.zeros_(self.conv_gates.bias)

    def forward(
        self,
        x: Tensor,                        # (B, C_in, H, W)
        h_prev: Tensor,                   # (B, D, H, W)
        c_prev: Tensor,                   # (B, D, H, W)
    ) -> tuple[Tensor, Tensor]:
        """Returns (h_new, c_new)."""
        combined = torch.cat([x, h_prev], dim=1)
        gates = self.conv_gates(combined)
        i_g, f_g, g_g, o_g = gates.chunk(4, dim=1)

        i = torch.sigmoid(i_g + self.W_ci * c_prev)
        f = torch.sigmoid(f_g + self.W_cf * c_prev)
        c = f * c_prev + i * torch.tanh(g_g)
        o = torch.sigmoid(o_g + self.W_co * c)
        h = o * torch.tanh(self.ln_c(c))
        return self.ln_h(h), c

    def init_state(self, batch: int, h: int, w: int, device: torch.device) -> tuple[Tensor, Tensor]:
        z = torch.zeros(batch, self.hidden_dim, h, w, device=device)
        return z.clone(), z.clone()


# ── Spatial Attention ─────────────────────────────────────────────────────────

class SpatialAttention(nn.Module):
    """Lightweight CBAM-style spatial attention gate."""

    def __init__(self, hidden_dim: int) -> None:
        super().__init__()
        self.conv = nn.Sequential(
            nn.Conv2d(2, 1, kernel_size=7, padding=3, bias=False),
            nn.Sigmoid(),
        )

    def forward(self, x: Tensor) -> Tensor:
        avg = x.mean(dim=1, keepdim=True)
        mx  = x.max(dim=1, keepdim=True).values
        attn = self.conv(torch.cat([avg, mx], dim=1))
        return x * attn


# ── Graph Neural Network ──────────────────────────────────────────────────────

class DynamicGraphConvolution(nn.Module):
    """
    Native PyTorch GNN layer. Treats the spatial grid as N nodes and dynamically
    computes graph edges based on feature similarity (e.g., routing pollutants
    along wind vectors or linking similar pollution hotspots).

    Two attention topologies, one set of weights
    -------------------------------------------
    ``window=None`` is the original all-pairs topology: every node scores every
    other node, so on the d03 grid N = 70*80 = 5600 and the score matrix holds
    5600**2 = 31.4M entries per sample per step. The rollout runs this 72 times
    and autograd keeps every one of those matrices alive for the backward pass.
    That single tensor is what puts training out of reach of a 6 GB card, and it
    is the largest term in step time.

    ``window=w`` replaces it with the topology the physics actually asks for:

      local   dense attention inside each w x w tile. Advection between
              neighbouring cells is a short-range effect; this resolves it
              exactly, at full grid resolution.
      global  dense attention on an average-pooled coarse grid, bilinearly
              upsampled back. Long-range transport - Punjab stubble smoke
              crossing the domain on a north-westerly - is a smooth, large-scale
              signal that survives pooling, so the layer keeps the global
              routing role it was built for.

    At w=10 that is 56 tiles of 100 nodes (560K scores) plus a 14x16 coarse grid
    (50K): ~51x fewer than 31.4M, with the long-range path intact.

    Both topologies use the *same* query/key/value/out_proj/norm weights. The
    flag picks a computation path, not a different network, so the two produce
    identical ``state_dict`` keys and shapes, and a checkpoint trained under one
    loads into the other without surgery.

    Parameters
    ----------
    window : tile edge in cells, or None for the original all-pairs path.
    coarse : downsampling stride for the global branch (H//coarse x W//coarse).
    """

    def __init__(
        self,
        in_channels: int,
        out_channels: int,
        k_neighbors: int = 16,
        window: int | None = None,
        coarse: int = 5,
    ) -> None:
        super().__init__()
        self.k_neighbors = k_neighbors
        self.window = window
        self.coarse = coarse
        self.query = nn.Conv2d(in_channels, in_channels // 2, kernel_size=1)
        self.key   = nn.Conv2d(in_channels, in_channels // 2, kernel_size=1)
        self.value = nn.Conv2d(in_channels, out_channels, kernel_size=1)

        self.out_proj = nn.Conv2d(out_channels, out_channels, kernel_size=1)
        self.norm = nn.GroupNorm(8, out_channels)

    # -- attention primitive --------------------------------------------------

    def _attend(
        self,
        Q: Tensor,                        # (b, d, N) queries
        K: Tensor,                        # (b, d, M) keys
        V: Tensor,                        # (b, c, M) values
        key_valid: Tensor | None = None,  # (b, M) bool; None = every key real
    ) -> Tensor:
        """
        Top-k sparsified attention, returning (b, c, N).

        This is the original layer's body unchanged; only the node sets handed
        to it differ between the two topologies.
        """
        scale = math.sqrt(Q.shape[1])
        attn = torch.bmm(Q.transpose(1, 2), K) / scale            # (b, N, M)

        if key_valid is not None:
            attn = attn.masked_fill(~key_valid.unsqueeze(1), float('-inf'))

        # Sparsify graph edges by keeping only top-k neighbors
        k = min(self.k_neighbors, attn.shape[-1])
        topk_vals, topk_idx = torch.topk(attn, k=k, dim=-1)
        mask = torch.full_like(attn, float('-inf'))
        mask.scatter_(-1, topk_idx, topk_vals)
        attn_weights = F.softmax(mask, dim=-1)

        # Message passing: V * A^T
        return torch.bmm(V, attn_weights.transpose(1, 2))         # (b, c, N)

    # -- windowed topology ----------------------------------------------------

    @staticmethod
    def _partition(t: Tensor, w: int) -> Tensor:
        """(B, C, H, W), H and W multiples of w  ->  (B*nh*nw, C, w*w)."""
        B, C, H, W = t.shape
        nh, nw = H // w, W // w
        t = t.view(B, C, nh, w, nw, w).permute(0, 2, 4, 1, 3, 5)
        return t.reshape(B * nh * nw, C, w * w)

    @staticmethod
    def _unpartition(t: Tensor, w: int, B: int, nh: int, nw: int) -> Tensor:
        """(B*nh*nw, C, w*w)  ->  (B, C, nh*w, nw*w)."""
        C = t.shape[1]
        t = t.view(B, nh, nw, C, w, w).permute(0, 3, 1, 4, 2, 5)
        return t.reshape(B, C, nh * w, nw * w)

    def _local_attention(self, Q: Tensor, K: Tensor, V: Tensor) -> Tensor:
        """Dense attention inside each tile, at full grid resolution."""
        w = self.window
        B, _, H, W = Q.shape
        ph, pw = (-H) % w, (-W) % w

        valid = None
        if ph or pw:
            # Padding invents cells outside the domain. They must not be
            # attended to, or an edge tile would route pollutant mass into grid
            # cells that do not exist. Every tile still holds at least one real
            # cell - the pad is always narrower than one tile - so no query is
            # left with an all -inf row.
            m = F.pad(Q.new_ones(1, 1, H, W), (0, pw, 0, ph))
            valid = self._partition(m, w).squeeze(1).bool().repeat(B, 1)

            Q = F.pad(Q, (0, pw, 0, ph))
            K = F.pad(K, (0, pw, 0, ph))
            V = F.pad(V, (0, pw, 0, ph))

        nh, nw = (H + ph) // w, (W + pw) // w

        out = self._attend(
            self._partition(Q, w),
            self._partition(K, w),
            self._partition(V, w),
            key_valid=valid,
        )
        out = self._unpartition(out, w, B, nh, nw)
        return out[:, :, :H, :W]

    def _global_attention(self, Q: Tensor, K: Tensor, V: Tensor) -> Tensor:
        """All-pairs attention on a pooled grid, upsampled back to full size."""
        B, _, H, W = Q.shape
        s = max(1, self.coarse)
        gh, gw = max(1, H // s), max(1, W // s)

        out = self._attend(
            F.adaptive_avg_pool2d(Q, (gh, gw)).flatten(2),
            F.adaptive_avg_pool2d(K, (gh, gw)).flatten(2),
            F.adaptive_avg_pool2d(V, (gh, gw)).flatten(2),
        ).view(B, -1, gh, gw)

        return F.interpolate(out, size=(H, W), mode='bilinear', align_corners=False)

    def forward(self, x: Tensor) -> Tensor:
        B, _, H, W = x.shape

        Q = self.query(x)
        K = self.key(x)
        V = self.value(x)

        if self.window is None:
            out = self._attend(Q.flatten(2), K.flatten(2), V.flatten(2)).view(B, -1, H, W)
        else:
            out = self._local_attention(Q, K, V) + self._global_attention(Q, K, V)

        # Output projection and residual
        out = self.out_proj(out)
        return F.gelu(self.norm(out + V))


# ── Physics Feedback Coupling Module ─────────────────────────────────────────

class FeedbackCouplingModule(nn.Module):
    """
    Two-way atmospheric physics coupling:
        PM2.5 / AOD (t) → ΔSolar Irradiance, ΔPBL Height (fed into t+1)

    Physical basis:
    - High aerosol optical depth (AOD) attenuates incoming solar radiation
      via Beer-Lambert: I = I₀ · exp(-AOD / cos(SZA))
    - Reduced solar heating → lower daytime PBL growth
    - Lower PBL → trapped pollutants → higher surface PM2.5

    Normalisation contract
    ─────────────────────
    All inputs and all outputs are in NORMALISED space (same scale used by
    the autoregressive state tensor x_t throughout the model).
    Physical-unit operations are performed internally; results are
    re-normalised before being returned to the caller.

    The caller must NOT pass physical-unit tensors to this module.
    """

    # Physical constants / empirical NCR calibration coefficients
    AOD_PER_PM25    = 0.007    # AOD₅₅₀ per µg/m³ PM2.5  (SAFAR calibration)
    SOLAR_BETA      = -180.0   # W/m² max attenuation per unit AOD
    PBL_ALPHA       = -0.42    # m per W/m² solar change
    TEMP_GAMMA      = -0.018   # °C per W/m² solar change

    # Normalisation constants — MUST match api_server.py `_CHANNEL_NORMS` array
    #   index: [0:pm25, 6:temp, 8:solar, 9:pbl]
    #   norms = [500, 700, 120, 250, 20, 20, 40, 100, 1200, 3000, 200, 300]
    PM25_NORM   = 500.0    # µg/m³
    SOLAR_NORM  = 1200.0   # W/m²
    PBL_NORM    = 3000.0   # m
    TEMP_NORM   = 40.0     # °C  (norms[6])

    def __init__(self, hidden_dim: int = 64) -> None:
        super().__init__()
        # Non-linear residual corrector (learned on top of physics baseline)
        self.corrector = nn.Sequential(
            nn.Conv2d(2, hidden_dim // 2, kernel_size=3, padding=1),
            nn.GELU(),
            nn.Conv2d(hidden_dim // 2, 2, kernel_size=1),
            nn.Tanh(),
        )
        # Scale factors — initialised to physical magnitude; learnable
        self.solar_scale = nn.Parameter(torch.tensor([self.SOLAR_BETA]))
        self.pbl_scale   = nn.Parameter(torch.tensor([self.PBL_ALPHA]))
        self.temp_scale  = nn.Parameter(torch.tensor([self.TEMP_GAMMA]))

    def forward(
        self,
        pm25_pred: Tensor,   # (B, H, W) — predicted PM2.5, NORMALISED ≈ [0, 1]
        solar_t: Tensor,     # (B, H, W) — current solar irradiance, NORMALISED ≈ [0, 1]
        pbl_t: Tensor,       # (B, H, W) — current PBL height, NORMALISED ≈ [0, 1]
    ) -> tuple[Tensor, Tensor, Tensor]:
        """
        All inputs must be in NORMALISED space (divide by the channel norm
        constants above).  All returned tensors are also NORMALISED.

        Internal computation is in physical units:
            PM2.5: µg/m³  |  Solar: W/m²  |  PBL: m  |  Temp: °C

        Returns
        -------
        (solar_next, pbl_next, delta_temp_norm) — all shape (B, H, W), NORMALISED.
        """
        # ── De-normalise PM2.5 → physical µg/m³ for AOD computation ───────────
        pm25_phys = pm25_pred * self.PM25_NORM              # µg/m³  ∈ [0, 500]
        aod = (pm25_phys * self.AOD_PER_PM25).clamp(0, 3.5) # AOD₅₅₀ ∈ [0, 3.5]

        # ── Physics baseline — quantities in physical units ────────────────────
        delta_solar_phys = self.solar_scale * torch.sigmoid(aod) - self.solar_scale * 0.5  # W/m²
        delta_pbl_phys   = self.pbl_scale   * (-delta_solar_phys)   # m
        delta_temp_phys  = self.temp_scale  * (-delta_solar_phys)   # °C

        # ── Learned residual (inputs already in [0,1], output ±10 phys units) ──
        feat = torch.stack([aod / 3.5, pm25_pred], dim=1)   # (B, 2, H, W)  ≈ [0,1]
        correction = self.corrector(feat) * 10.0              # ±10 W/m² / m

        # ── De-normalise state, apply deltas, clamp, re-normalise ─────────────
        solar_phys = solar_t * self.SOLAR_NORM
        pbl_phys   = pbl_t   * self.PBL_NORM

        solar_next = (solar_phys + delta_solar_phys + correction[:, 0]).clamp(0, self.SOLAR_NORM) / self.SOLAR_NORM
        pbl_next   = (pbl_phys   + delta_pbl_phys   + correction[:, 1]).clamp(50, self.PBL_NORM)  / self.PBL_NORM

        # Temperature delta returned in normalised units so it can be added
        # directly to the normalised temperature channel of x_t
        delta_temp_norm = delta_temp_phys / self.TEMP_NORM

        return solar_next, pbl_next, delta_temp_norm


# ── Full Forecaster ───────────────────────────────────────────────────────────

class AirPollutionCoupledForecaster(nn.Module):
    """
    72-step autoregressive spatiotemporal forecaster for Delhi NCR.

    Architecture
    ------------
    1. Input projection: 12 channels → hidden_dim (1×1 conv)
    2. Two stacked CoupledConvLSTMCells (encoder depth)
    3. Spatial attention gate (Local Features)
    4. DynamicGraphConvolution (Local tiles + coarse global routing)
    5. FeedbackCouplingModule: injects physics-corrected solar/PBL at each step
    6. Decoder: hidden_dim → N_CHANNELS (1×1 conv), applied as a residual

    Parameters
    ----------
    in_channels : 12 (default) feature channels per grid cell.
    hidden_dim : ConvLSTM hidden state depth (64 default, 128 for high-res).
    n_steps : Autoregressive rollout steps (72 = 72h forecast).
    teacher_force_ratio : During training, fraction of steps to use GT input.
    residual : Predict each frame as the previous frame plus a bounded delta
        (default). The absolute-output path is kept: pass False for the
        original sigmoid decoder. Both share one state_dict.
    graph_window : Tile edge for the graph layer's local attention, in grid
        cells. The default 10 tiles the 70x80 domain exactly (7x8 tiles) and
        is what makes the rollout trainable on a consumer card. Pass None to
        restore the original all-pairs attention - same weights, same output
        shape, ~51x the score matrix. See DynamicGraphConvolution.
    """

    def __init__(
        self,
        in_channels: int = N_CHANNELS,
        hidden_dim: int = 64,
        n_steps: int = N_STEPS,
        teacher_force_ratio: float = 0.5,
        graph_window: int | None = 10,
        residual: bool = True,
    ) -> None:
        super().__init__()
        self.n_steps = n_steps
        self.hidden_dim = hidden_dim
        self.teacher_force_ratio = teacher_force_ratio
        self.graph_window = graph_window
        self.residual = residual

        self.input_proj = nn.Sequential(
            nn.Conv2d(in_channels, hidden_dim, kernel_size=1, bias=False),
            nn.GroupNorm(8, hidden_dim),
            nn.GELU(),
        )
        self.cell1 = CoupledConvLSTMCell(hidden_dim, hidden_dim, kernel_size=3)
        self.cell2 = CoupledConvLSTMCell(hidden_dim, hidden_dim, kernel_size=5)

        self.spatial_attn = SpatialAttention(hidden_dim)
        self.gnn          = DynamicGraphConvolution(
            hidden_dim, hidden_dim, k_neighbors=16, window=graph_window,
        )
        self.feedback     = FeedbackCouplingModule(hidden_dim)

        # The head emits raw scores; forward() turns them into a frame. The
        # Sigmoid that used to sit here carried no parameters, so both modes
        # produce identical state_dict keys and shapes.
        self.decoder = nn.Sequential(
            nn.Conv2d(hidden_dim, hidden_dim // 2, kernel_size=3, padding=1),
            nn.GELU(),
            nn.Conv2d(hidden_dim // 2, in_channels, kernel_size=1),
        )

        self._init_weights()

    def _init_weights(self) -> None:
        """Initialise this module's own convolutions, and only those.

        A blanket self.modules() sweep reached into the ConvLSTM cells and
        overwrote the orthogonal initialisation they set for their fused gate
        convolution - kaiming-for-ReLU is the wrong distribution for weights
        feeding sigmoid and tanh gates, and pushes them toward saturation.
        The cells had it right; the parent was undoing it.
        """
        for block in (self.input_proj, self.decoder):
            for m in block.modules():
                if isinstance(m, nn.Conv2d):
                    nn.init.kaiming_normal_(m.weight, mode="fan_out", nonlinearity="relu")
                    if m.bias is not None:
                        nn.init.zeros_(m.bias)

        if self.residual:
            # Start every delta at exactly zero, so an untrained rollout
            # reproduces its own input: a persistence forecast. That is the
            # floor this model should improve on, not the place it starts
            # climbing towards.
            head = [m for m in self.decoder.modules() if isinstance(m, nn.Conv2d)][-1]
            nn.init.zeros_(head.weight)
            nn.init.zeros_(head.bias)

    def forward(
        self,
        x_seq: Tensor,              # (B, T_in, C, H, W) historical context
        target_seq: Tensor | None = None,  # (B, T_out, C, H, W) for teacher forcing
    ) -> Tensor:
        """
        Parameters
        ----------
        x_seq : Input historical sequence (B, T_in, C, H, W).
        target_seq : Ground truth for teacher forcing during training.

        Returns
        -------
        preds : (B, n_steps, C, H, W) forecast tensor.
        """
        B, T_in, C, H, W = x_seq.shape
        device = x_seq.device

        h1, c1 = self.cell1.init_state(B, H, W, device)
        h2, c2 = self.cell2.init_state(B, H, W, device)

        # ── Encode historical context ────────────────────────────────────────
        for t in range(T_in):
            xt = self.input_proj(x_seq[:, t])
            h1, c1 = self.cell1(xt, h1, c1)
            h2, c2 = self.cell2(h1, h2, c2)

        # ── Autoregressive forecast rollout ──────────────────────────────────
        preds: list[Tensor] = []
        x_t = x_seq[:, -1]    # last known frame as seed

        for step in range(self.n_steps):
            # Teacher forcing: randomly replace input with GT during training
            if self.training and target_seq is not None and step > 0:
                if torch.rand(1).item() < self.teacher_force_ratio:
                    x_t = target_seq[:, step - 1]

            feat = self.input_proj(x_t)
            h1, c1 = self.cell1(feat, h1, c1)
            h2, c2 = self.cell2(h1,   h2, c2)
            
            # Local spatial attention -> Global graph convolution
            h_attn = self.spatial_attn(h2)
            h_gnn  = self.gnn(h_attn)

            raw = self.decoder(h_gnn)          # (B, C, H, W)
            if self.residual:
                # Predict the change, not the field. At t+1 the atmosphere is
                # mostly what it was at t, so asking the decoder to repaint all
                # twelve channels from a hidden state every hour throws away
                # the strongest signal available and leaves the output with no
                # anchor for absolute level.
                pred_t = torch.clamp(x_t + MAX_STEP_DELTA * torch.tanh(raw), 0.0, 1.0)
            else:
                pred_t = torch.sigmoid(raw)

            # ── Two-way feedback coupling ────────────────────────────────────
            pm25_pred = pred_t[:, CH_PM25]
            solar_cur = x_t[:, CH_SOLAR]
            pbl_cur   = x_t[:, CH_PBL]

            solar_next, pbl_next, delta_temp = self.feedback(pm25_pred, solar_cur, pbl_cur)

            # Inject physics-corrected fields back as next-step input
            x_t = pred_t.clone()
            x_t[:, CH_SOLAR] = solar_next
            x_t[:, CH_PBL]   = pbl_next
            x_t[:, CH_TEMP]  = pred_t[:, CH_TEMP] + delta_temp

            preds.append(pred_t.unsqueeze(1))

        return torch.cat(preds, dim=1)   # (B, n_steps, C, H, W)

    @torch.inference_mode()
    def predict(self, x_seq: Tensor) -> Tensor:
        """Inference-only forward pass. No teacher forcing."""
        self.eval()
        return self.forward(x_seq, target_seq=None)


# ── Model Factory ─────────────────────────────────────────────────────────────

def build_model(device: str = "cpu", **kwargs) -> AirPollutionCoupledForecaster:
    model = AirPollutionCoupledForecaster(**kwargs).to(device)
    n_params = sum(p.numel() for p in model.parameters() if p.requires_grad)
    print(f"[model] AirPollutionCoupledForecaster | params={n_params:,} | device={device}")
    return model


def mock_inference(batch: int = 1, t_in: int = 24) -> Tensor:
    """
    Runs a mock forward pass without real data.
    Returns predictions tensor (B, 72, 12, 70, 80).
    """
    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = build_model(device=device)
    x = torch.randn(batch, t_in, N_CHANNELS, GRID_H, GRID_W, device=device)
    return model.predict(x)
