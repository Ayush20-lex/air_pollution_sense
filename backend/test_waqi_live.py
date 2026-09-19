"""Checks on the WAQI live feed's unit handling. Run: python test_waqi_live.py"""
import sys

import aqi_cpcb
import waqi_live as w

passed = failed = 0


def check(name, cond, detail=""):
    global passed, failed
    if cond:
        passed += 1
        print(f"[PASS] {name}")
    else:
        failed += 1
        print(f"[FAIL] {name}  {detail}")


def epa_index(pol, c):
    _, table = w.EPA[pol]
    for c_lo, c_hi, i_lo, i_hi in table:
        if c_lo <= c <= c_hi:
            return round(i_lo + (c - c_lo) * (i_hi - i_lo) / (c_hi - c_lo))
    return None


# ── the round trip is the whole risk, so it is the bulk of the test ──────────
for pol, samples in [("pm25", [5, 12, 25, 41, 90, 180, 300, 420]),
                     ("pm10", [10, 54, 100, 200, 300, 400, 550]),
                     ("o3", [5, 20, 60, 80, 95, 150])]:
    for c in samples:
        back = w.from_epa(pol, epa_index(pol, c))
        # Tolerance is one index step's worth of concentration, which is what
        # WAQI's integer rounding costs and no more.
        tol = max(2.0, c * 0.05)
        check(f"{pol} {c} survives the round trip", abs(back - c) <= tol,
              f"came back {back}")

check("an index above the EPA table does not extrapolate",
      w.from_epa("pm25", 900) == 500.4)
check("an unknown pollutant returns nothing", w.from_epa("nox", 50) is None)
check("a missing index returns nothing", w.from_epa("pm25", None) is None)

# ── only window-compatible pollutants may be inverted ───────────────────────
check("NO2 is not invertible", "no2" not in w.EPA)
check("SO2 is not invertible", "so2" not in w.EPA)
check("CO is not invertible", "co" not in w.EPA)
check("every omission carries a reason",
      set(w.EXCLUDED) == {"no2", "so2", "co"})
check("exactly CPCB's three-pollutant minimum is available", len(w.EPA) == 3)

# ── the inverted value has to be usable by the CPCB indexer ─────────────────
c = w.from_epa("pm25", 89)
check("an inverted PM2.5 indexes under CPCB", aqi_cpcb.sub_index("pm25", c) == 52,
      f"{c} ug/m3 gave {aqi_cpcb.sub_index('pm25', c)}")
check("ozone is handed over in ppb, as EPA tabulates it", w.EPA["o3"][0] == "ppb")
check("ppb ozone converts for CPCB",
      round(aqi_cpcb.to_cpcb_units("o3", 60.0, "ppb"), 0) == 118)
check("particulates are already in CPCB's unit",
      w.EPA["pm25"][0] == "ugm3" and w.EPA["pm10"][0] == "ugm3")

# ── absence is an ordinary state ────────────────────────────────────────────
check("describe() says why it is off when there is no token",
      ("reason" in w.describe()) if not w.available() else w.describe()["available"])

print("=" * 68)
print(f"{passed}/{passed + failed} passed")
sys.exit(1 if failed else 0)
