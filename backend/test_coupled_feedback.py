"""
Tests for coupled_feedback.

Run: python test_coupled_feedback.py

These assert the direction and the boundedness of the loop, not a particular
number. The constants are SAFAR's and this module is not the place to relitigate
them; what it must guarantee is that the physics points the right way, settles,
and cannot run away.
"""
from __future__ import annotations

import numpy as np

import coupled_feedback as cf

passed = 0
failed = 0


def check(label: str, cond: bool) -> None:
    global passed, failed
    if cond:
        passed += 1
        print(f"[PASS] {label}")
    else:
        failed += 1
        print(f"[FAIL] {label}")


CLEAN = np.array([5.0])
MODERATE = np.array([90.0])
SEVERE = np.array([400.0])
SOLAR = np.array([600.0])
PBL = np.array([800.0])
TEMP = np.array([22.0])


# ── direction ───────────────────────────────────────────────────────────────
c = cf.couple(SEVERE, SOLAR, PBL, TEMP)
check("heavy aerosol removes shortwave", c.delta_solar[0] < 0)
check("less shortwave lowers the boundary layer", c.delta_pbl[0] < 0)
check("less shortwave cools the surface", c.delta_temp[0] < 0)
check("the coupled solar is below the input", c.solar[0] < SOLAR[0])
check("the coupled PBL is below the input", c.pbl[0] < PBL[0])

clean = cf.couple(CLEAN, SOLAR, PBL, TEMP)
check("clean air attenuates almost nothing", abs(clean.delta_solar[0]) < 3.0)
check("clean air barely moves the boundary layer", abs(clean.delta_pbl[0]) < 2.0)

mod = cf.couple(MODERATE, SOLAR, PBL, TEMP)
check("the effect grows with aerosol load",
      abs(c.delta_solar[0]) > abs(mod.delta_solar[0]) > abs(clean.delta_solar[0]))


# ── magnitudes stay physical ────────────────────────────────────────────────
check("attenuation stays within the calibrated ceiling", abs(c.delta_solar[0]) <= abs(cf.SOLAR_BETA) / 2 + 1e-9)
check("AOD is clamped at the documented maximum", c.aod[0] <= cf.AOD_MAX + 1e-9)
check("severe smog gives a plausible AOD", 1.0 < c.aod[0] <= cf.AOD_MAX)
check("the surface never receives negative sunlight",
      cf.couple(SEVERE, np.array([10.0]), PBL, TEMP).solar[0] >= 0.0)
check("the boundary layer never falls through its floor",
      cf.couple(SEVERE, SOLAR, np.array([55.0]), TEMP).pbl[0] >= cf.PBL_FLOOR_M)


# ── the return leg ──────────────────────────────────────────────────────────
off = cf.couple(SEVERE, SOLAR, PBL, TEMP, amplify=False)
check("with amplify off the concentration is untouched", off.pm25[0] == SEVERE[0])
check("with amplify off the amplification reads exactly one", off.amplification[0] == 1.0)

on = cf.couple(SEVERE, SOLAR, PBL, TEMP, amplify=True)
check("with amplify on the concentration rises", on.pm25[0] > SEVERE[0])
check("the radiative half is unchanged by amplify",
      abs(on.delta_solar[0] - off.delta_solar[0]) < 25.0)
check("amplification respects its ceiling",
      on.amplification[0] <= cf.MAX_AMPLIFICATION + 1e-9)

# The loop is a positive feedback; it must settle rather than ratchet.
a = cf.couple(SEVERE, SOLAR, PBL, TEMP, amplify=True, iterations=3)
b = cf.couple(SEVERE, SOLAR, PBL, TEMP, amplify=True, iterations=30)
check("the loop reaches a fixed point rather than running away",
      abs(a.pm25[0] - b.pm25[0]) / b.pm25[0] < 0.05)
check("thirty iterations stay bounded", np.isfinite(b.pm25[0]) and b.pm25[0] < 5 * SEVERE[0])

# A shallow layer amplifies more than a deep one, for the same aerosol.
shallow = cf.couple(SEVERE, SOLAR, np.array([150.0]), TEMP, amplify=True)
deep = cf.couple(SEVERE, SOLAR, np.array([2000.0]), TEMP, amplify=True)
check("a shallow layer traps more than a deep one",
      shallow.amplification[0] > deep.amplification[0])


# ── shapes and degenerate input ─────────────────────────────────────────────
grid = cf.couple(np.full((72, 70, 80), 150.0), np.full((72, 70, 80), 500.0),
                 np.full((72, 70, 80), 700.0))
check("a 72-hour grid stack comes back at the same shape", grid.pm25.shape == (72, 70, 80))
check("every cell of the grid is finite", np.isfinite(grid.delta_pbl).all())

zero = cf.couple(np.array([0.0]), SOLAR, PBL, TEMP, amplify=True)
check("zero aerosol is finite and inert",
      np.isfinite(zero.pm25[0]) and abs(zero.delta_solar[0]) < 1e-6)

nan = cf.couple(np.array([np.nan]), SOLAR, PBL, TEMP)
check("a NaN concentration does not propagate into the boundary layer",
      np.isfinite(nan.delta_pbl[0]))

check("temperature is optional", np.isfinite(cf.couple(SEVERE, SOLAR, PBL).temp[0]))


# ── reporting ───────────────────────────────────────────────────────────────
s = c.summary()
check("the summary reports a negative attenuation", s["solar_attenuation_wm2_mean"] < 0)
check("the summary reports a negative PBL change", s["pbl_reduction_m_mean"] < 0)
check("the summary is JSON-safe", all(isinstance(v, float) for v in s.values()))

d = cf.describe()
check("describe names the loop", "PM2.5" in d["loop"] and "PBL" in d["loop"])
check("describe states it does not amplify by default", d["amplifies_pm25"] is False)
check("describe carries the calibration source", "SAFAR" in d["source"])

# The constants must be the network's, not a second copy that can drift.
try:
    from coupled_model import FeedbackCouplingModule as F
    check("constants match the network's exactly",
          cf.AOD_PER_PM25 == float(F.AOD_PER_PM25) and cf.SOLAR_BETA == float(F.SOLAR_BETA))
except Exception:
    check("constants match the network's exactly (torch absent - fallbacks used)",
          cf.AOD_PER_PM25 == 0.007 and cf.SOLAR_BETA == -180.0)

print("=" * 68)
print(f"{passed}/{passed + failed} passed")
raise SystemExit(1 if failed else 0)
