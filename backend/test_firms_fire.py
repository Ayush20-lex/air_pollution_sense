"""
Tests for firms_fire.

Run: python test_firms_fire.py

The plume tests use synthetic fire frames rather than the network, so they
assert on the physics and not on what Punjab happened to be doing. The two
network tests are skipped when no key is configured.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

import firms_fire as ff

passed = 0
failed = 0
skipped = 0


def check(label: str, cond: bool) -> None:
    global passed, failed
    if cond:
        passed += 1
        print(f"[PASS] {label}")
    else:
        failed += 1
        print(f"[FAIL] {label}")


def skip(label: str) -> None:
    global skipped
    skipped += 1
    print(f"[SKIP] {label}")


def fires_at(points: list[tuple[float, float, float]]) -> pd.DataFrame:
    return pd.DataFrame(
        [{"latitude": la, "longitude": lo, "frp": f, "acq_date": "2025-11-05"}
         for la, lo, f in points],
        columns=ff.COLUMNS,
    )


# NCR sits at about 28.2-28.9 N, 76.8-77.6 E. Punjab burns to the northwest:
# higher latitude, lower longitude. A wind carrying smoke from there to Delhi
# blows east and south, so u > 0 and v < 0.
PUNJAB = fires_at([(30.2, 75.8, 50.0), (30.3, 75.9, 50.0)])
TOWARD = (1.4, -1.4)
AWAY = (-1.4, 1.4)


# ── the bug that motivated the module ───────────────────────────────────────
one = fires_at([(30.2, 75.8, 50.0)])
ten = fires_at([(30.2 + i * 0.01, 75.8, 50.0) for i in range(10)])
s1 = ff.plume_field(one, *TOWARD)[1].max()
s10 = ff.plume_field(ten, *TOWARD)[1].max()
check("ten fires make a bigger plume than one (the averaging bug)", s10 > 5 * s1)

weak = fires_at([(30.2, 75.8, 10.0)])
strong = fires_at([(30.2, 75.8, 100.0)])
check("the plume scales with radiative power",
      abs(ff.plume_field(strong, *TOWARD)[1].max()
          / max(ff.plume_field(weak, *TOWARD)[1].max(), 1e-9) - 10.0) < 0.01)


# ── wind ────────────────────────────────────────────────────────────────────
toward = ff.plume_field(PUNJAB, *TOWARD)[1]
away = ff.plume_field(PUNJAB, *AWAY)[1]
check("smoke arrives when the wind blows from the corridor", toward.max() > 1.0)
check("nothing arrives when the wind reverses", away.max() == 0.0)

fast = ff.plume_field(PUNJAB, 2.8, -2.8)[1].max()
slow = ff.plume_field(PUNJAB, 1.4, -1.4)[1].max()
check("a faster wind delivers a thinner plume (1/U)", abs(slow / max(fast, 1e-9) - 2.0) < 0.05)


# ── transit time ────────────────────────────────────────────────────────────
# Punjab is roughly 250 km upwind. At 0.5 m/s that is over 130 hours, so the
# smoke has not arrived inside a 72-hour forecast.
crawl = ff.plume_field(PUNJAB, 0.36, -0.36)[1]
check("smoke that cannot arrive within the horizon does not appear", crawl.max() == 0.0)

near = fires_at([(29.1, 76.6, 50.0)])   # ~100 km out, arrives even when slow
check("a nearer fire still arrives at the same slow wind",
      ff.plume_field(near, 0.36, -0.36)[1].max() > 0.0)


# ── degenerate input ────────────────────────────────────────────────────────
empty = ff.plume_field(pd.DataFrame(columns=ff.COLUMNS), *TOWARD)
check("no fires gives a zero field, not a crash",
      empty[0].shape == (70, 80) and empty[0].max() == 0.0 and empty[1].max() == 0.0)
check("None gives a zero field", ff.plume_field(None, *TOWARD)[1].max() == 0.0)

calm = ff.plume_field(PUNJAB, 0.0, 0.0)
check("dead calm is finite and symmetric, not a divide by zero",
      np.isfinite(calm[1]).all())

grids = ff.plume_field(PUNJAB, *TOWARD)
check("both grids come back at the requested shape",
      grids[0].shape == (70, 80) and grids[1].shape == (70, 80))
check("the fields are float32", grids[0].dtype == np.float32 and grids[1].dtype == np.float32)

# What is burning does not depend on the wind; what arrives does.
frp_a = ff.plume_field(PUNJAB, *TOWARD)[0]
frp_b = ff.plume_field(PUNJAB, *AWAY)[0]
check("the FRP field is the same whichever way the wind blows",
      np.allclose(frp_a, frp_b))


# ── season hint ─────────────────────────────────────────────────────────────
check("November is inside the burning season", ff.season_hint("2025-11-05") == "burning season")
check("September is outside it", ff.season_hint("2026-09-20") == "outside the burning season")
check("mid-October is inside it", ff.season_hint("2025-10-20") == "burning season")
check("early October is outside it", ff.season_hint("2025-10-02") == "outside the burning season")


# ── network ─────────────────────────────────────────────────────────────────
if not ff.available():
    skip("live fetch (no NASA_FIRMS_KEY configured)")
    skip("describe reports a real window")
else:
    df = ff.fetch("2025-11-05")
    check("the burning peak returns fire pixels",
          not df.empty and set(ff.COLUMNS) <= set(df.columns))
    d = ff.describe("2025-11-05")
    check("describe reports the window it fetched",
          d["available"] is True and d["fires"] == len(df))

print("=" * 68)
print(f"{passed}/{passed + failed} passed" + (f", {skipped} skipped" if skipped else ""))
raise SystemExit(1 if failed else 0)
