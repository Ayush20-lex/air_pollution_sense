"""
Aerosol-Radiation-PBL Feedback - Air Pollution Sense
SIH26082 - MoES / NCMRWF

The two-way loop the problem statement is built around, as a diagnostic over a
forecast grid rather than as a layer inside an untrained network.

The loop
--------
The statement describes it directly: "dense concentrations of aerosols (PM2.5)
block sunlight, altering local temperatures, wind patterns, and planetary
boundary layer (PBL) heights", and inversion layers in turn "trap particulate
matter close to the ground". That is a closed loop, and it closes in four steps:

    PM2.5 -> aerosol optical depth        (mass extinction, SAFAR calibration)
    AOD   -> less shortwave at the ground (Beer-Lambert attenuation)
    less shortwave -> shallower PBL       (less surface heating, less growth)
    shallower PBL  -> higher PM2.5        (the same emission in a smaller box)

and the fourth step feeds the first, which is what makes it two-way rather than
a one-directional correction. Iterating to a fixed point is what distinguishes
this from applying the four steps once.

Where the constants come from
-----------------------------
All four are `coupled_model.FeedbackCouplingModule`'s own, unchanged and
imported rather than copied, so the diagnostic and the network cannot drift
apart. They carry an NCR calibration (SAFAR) that this module is in no position
to improve on.

The one honest difficulty
-------------------------
The blend baseline is built from *observations*, and those observations already
happened under the real feedback - a shallow December inversion is in the
measured PM2.5 because it happened, not because a model inferred it. Applying
the full PBL response on top of that would count the same physics twice, and
the forecast would run hot exactly on the days that matter most.

So `amplify` is off by default. The radiative half of the loop - what the
aerosol does to sunlight, to the boundary layer and to temperature - is always
computed and reported, because none of it is double-counted: the archived
meteorology carries CAMS/ERA5 fields that do not see today's forecast aerosol.
Turning the PM2.5 response on is a scoring question, not a taste one, and
`ml_pipeline/scripts/20_score_coupling.py` answers it against the same held-out
window and the same 3.9 million comparisons that produced RMSE 62.23.

A diagnostic that reports the feedback honestly is worth more than a correction
that improves nothing and inflates the number the page is judged on.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

import numpy as np

logger = logging.getLogger("coupled_feedback")

# The network's own constants. Imported so one calibration serves both paths.
try:
    from coupled_model import FeedbackCouplingModule as _F

    AOD_PER_PM25 = float(_F.AOD_PER_PM25)   # AOD550 per ug/m3   (SAFAR)
    SOLAR_BETA = float(_F.SOLAR_BETA)       # W/m2 per unit AOD  (negative)
    PBL_ALPHA = float(_F.PBL_ALPHA)         # m per W/m2
    TEMP_GAMMA = float(_F.TEMP_GAMMA)       # degC per W/m2
except Exception:  # noqa: BLE001 - torch absent; the physics does not need it
    AOD_PER_PM25, SOLAR_BETA, PBL_ALPHA, TEMP_GAMMA = 0.007, -180.0, -0.42, -0.018

#: AOD is clamped here, as in the network. Delhi's worst measured AOD550 sits
#: near 2; 3.5 is past anything observed and stops a spurious PM2.5 spike from
#: driving the radiative term somewhere physically meaningless.
AOD_MAX = 3.5

#: The PBL cannot collapse below this, in metres. Same floor the forecaster
#: applies to the archived PBL field: a depth of a few metres is a measurement
#: artefact, and dividing by it sends surface concentration to infinity.
PBL_FLOOR_M = 50.0

#: Iterations of the loop. The fixed point is reached in two or three because
#: the radiative term saturates through a sigmoid; more buys nothing and costs
#: a grid pass each.
ITERATIONS = 3

#: How much of each step to take, in [0, 1]. Under-relaxation: the loop is a
#: positive feedback, and taking the full step lets a cell that starts high
#: ratchet upward across iterations before the saturation catches it.
DAMPING = 0.5

#: Ceiling on the PM2.5 amplification, as a multiple. A well-mixed box gives
#: concentration proportional to 1/PBL, which is unbounded as the layer thins.
#: Real nights do not do that - turbulence never fully stops and the emission
#: itself falls - so the response is capped at the strongest amplification the
#: archive supports.
MAX_AMPLIFICATION = 1.6


@dataclass
class Coupling:
    """The coupled state, in physical units, plus what the loop did."""

    pm25: np.ndarray        # ug/m3
    solar: np.ndarray       # W/m2
    pbl: np.ndarray         # m
    temp: np.ndarray        # degC
    aod: np.ndarray         # AOD550, dimensionless
    delta_solar: np.ndarray  # W/m2, negative
    delta_pbl: np.ndarray   # m, negative
    delta_temp: np.ndarray  # degC, negative
    amplification: np.ndarray  # pm25_out / pm25_in

    def summary(self) -> dict[str, Any]:
        """Scalar digest for an API payload. Means over finite cells only."""

        def m(a: np.ndarray, f=np.nanmean) -> float:
            with np.errstate(invalid="ignore"):
                v = f(a)
            return float(v) if np.isfinite(v) else 0.0

        return {
            "aod_mean": round(m(self.aod), 3),
            "aod_max": round(m(self.aod, np.nanmax), 3),
            "solar_attenuation_wm2_mean": round(m(self.delta_solar), 1),
            "solar_attenuation_wm2_max": round(m(self.delta_solar, np.nanmin), 1),
            "pbl_reduction_m_mean": round(m(self.delta_pbl), 1),
            "pbl_reduction_m_max": round(m(self.delta_pbl, np.nanmin), 1),
            "temp_change_c_mean": round(m(self.delta_temp), 3),
            "pm25_amplification_mean": round(m(self.amplification), 4),
            "pm25_amplification_max": round(m(self.amplification, np.nanmax), 4),
        }


def _sigmoid(x: np.ndarray) -> np.ndarray:
    return 1.0 / (1.0 + np.exp(-np.clip(x, -60.0, 60.0)))


def couple(
    pm25: np.ndarray,
    solar: np.ndarray,
    pbl: np.ndarray,
    temp: np.ndarray | None = None,
    *,
    amplify: bool = False,
    iterations: int = ITERATIONS,
    damping: float = DAMPING,
) -> Coupling:
    """Run the aerosol-radiation-PBL loop to a fixed point.

    Every argument is in physical units and any broadcastable shape - a grid, a
    stack of grids over a horizon, or a vector of stations. The physics is
    elementwise, so one implementation serves the map, the forecast and the
    scorer, and none of them can disagree about what the feedback does.

    With `amplify=False` the PM2.5 that comes back is the PM2.5 that went in:
    the loop still reports what the aerosol does to sunlight, to the boundary
    layer and to temperature, but does not feed that back into concentration.
    See the module note on double counting.
    """
    pm0 = np.asarray(pm25, dtype=np.float64)
    solar0 = np.asarray(solar, dtype=np.float64)
    pbl0 = np.maximum(np.asarray(pbl, dtype=np.float64), PBL_FLOOR_M)
    temp0 = np.asarray(temp, dtype=np.float64) if temp is not None else np.zeros_like(pm0)

    pm = pm0.copy()
    aod = np.zeros_like(pm0)
    d_solar = np.zeros_like(pm0)
    d_pbl = np.zeros_like(pm0)
    d_temp = np.zeros_like(pm0)

    for _ in range(max(1, iterations)):
        # 1. aerosol load -> optical depth
        aod = np.clip(np.nan_to_num(pm) * AOD_PER_PM25, 0.0, AOD_MAX)

        # 2. optical depth -> shortwave at the ground. Centred on the sigmoid's
        #    midpoint so clean air attenuates nothing: at AOD 0 the bracket is
        #    zero, not a half-strength offset.
        d_solar = SOLAR_BETA * (_sigmoid(aod) - 0.5)

        # 3. less shortwave -> less surface heating -> a shallower layer, and a
        #    cooler surface. Both scale on the attenuation, so both follow the
        #    aerosol rather than the clock.
        d_pbl = PBL_ALPHA * (-d_solar)
        d_temp = TEMP_GAMMA * (-d_solar)

        if not amplify:
            break

        # 4. the return leg: the same emission in a shallower box. This is the
        #    step that closes the loop and the one that can double count.
        pbl_new = np.maximum(pbl0 + d_pbl, PBL_FLOOR_M)
        ratio = np.clip(pbl0 / np.maximum(pbl_new, 1e-6), 1.0, MAX_AMPLIFICATION)
        target = pm0 * ratio
        pm = pm + damping * (target - pm)

    solar_out = np.maximum(solar0 + d_solar, 0.0)
    pbl_out = np.maximum(pbl0 + d_pbl, PBL_FLOOR_M)
    temp_out = temp0 + d_temp
    with np.errstate(invalid="ignore", divide="ignore"):
        amp = np.where(pm0 > 0, pm / np.maximum(pm0, 1e-9), 1.0)

    return Coupling(
        pm25=pm, solar=solar_out, pbl=pbl_out, temp=temp_out,
        aod=aod, delta_solar=d_solar, delta_pbl=d_pbl, delta_temp=d_temp,
        amplification=amp,
    )


def describe() -> dict[str, Any]:
    """Constants and posture, for /api/v1/status."""
    return {
        "loop": "PM2.5 -> AOD -> shortwave -> PBL -> PM2.5",
        "constants": {
            "aod_per_pm25": AOD_PER_PM25,
            "solar_beta_wm2_per_aod": SOLAR_BETA,
            "pbl_alpha_m_per_wm2": PBL_ALPHA,
            "temp_gamma_c_per_wm2": TEMP_GAMMA,
        },
        "source": "coupled_model.FeedbackCouplingModule (SAFAR calibration)",
        "iterations": ITERATIONS,
        "amplifies_pm25": False,
        "why": (
            "the blend baseline is built from observations that already "
            "happened under the real feedback, so feeding the PBL response "
            "back into PM2.5 would count the same physics twice"
        ),
    }
