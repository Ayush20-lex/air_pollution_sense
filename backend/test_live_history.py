"""
Tests for live_history.

Run: python test_live_history.py

Every test runs against a throwaway database. The real file is never opened:
recorded history cannot be backfilled, so a test that wrote to it would destroy
something no amount of re-running could restore.
"""
from __future__ import annotations

import os
import tempfile
from pathlib import Path

_tmp = Path(tempfile.mkdtemp(prefix="livehist-")) / "test.db"
os.environ["LIVE_HISTORY_DB"] = str(_tmp)

import live_history  # noqa: E402 - must follow the env var above

live_history.DB_PATH = _tmp

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


def reset() -> None:
    with live_history._connect() as conn:
        conn.execute("DELETE FROM reading")


def mesh(hour: str, stations: list[dict]) -> dict:
    return {"as_of": hour, "stations": stations}


def station(sid: int, pm25: float, *, valid: bool = True, hour: str | None = None) -> dict:
    s = {
        "id": sid,
        "valid": valid,
        "sub_indices": {"PM2.5": {"concentration": pm25, "sub_index": 100}},
    }
    if hour:
        s["as_of"] = hour
    return s


H = "2026-09-19T12:00:00+00:00"


# ── recording ───────────────────────────────────────────────────────────────
reset()
n = live_history.record(mesh(H, [station(1, 55.0), station(2, 42.0)]))
check("record writes one row per station-pollutant", n == 2)

# The property the whole polling design rests on.
live_history.record(mesh(H, [station(1, 55.0), station(2, 42.0)]))
with live_history._connect() as c:
    total = c.execute("SELECT COUNT(*) FROM reading").fetchone()[0]
check("recording the same hour twice does not duplicate", total == 2)

live_history.record(mesh(H, [station(1, 61.0)]))
with live_history._connect() as c:
    v = c.execute("SELECT value FROM reading WHERE station_id=1").fetchone()[0]
check("a later poll in the same hour updates the value", v == 61.0)

reset()
live_history.record(mesh(H, [station(9, 30.0, valid=False)]))
with live_history._connect() as c:
    total = c.execute("SELECT COUNT(*) FROM reading").fetchone()[0]
check("an unindexable station is not recorded", total == 0)

reset()
live_history.record(mesh(H, [station(3, 20.0, hour="2026-09-19T11:40:00+00:00")]))
with live_history._connect() as c:
    h = c.execute("SELECT hour_utc FROM reading").fetchone()[0]
check("a station is filed under its own hour, floored", h.startswith("2026-09-19T11:00"))

reset()
check("an empty mesh records nothing", live_history.record({}) == 0)
check("a mesh with no stations records nothing", live_history.record({"stations": []}) == 0)

# Only the three pollutants the live mesh may index.
reset()
s = station(4, 50.0)
s["sub_indices"]["NO2"] = {"concentration": 30.0}
s["sub_indices"]["PM10"] = {"concentration": 90.0}
live_history.record(mesh(H, [s]))
with live_history._connect() as c:
    keys = {r[0] for r in c.execute("SELECT DISTINCT pollutant FROM reading")}
check("NO2 is not recorded; PM2.5 and PM10 are", keys == {"pm25", "pm10"})


# ── reading back ────────────────────────────────────────────────────────────
reset()
for i, hr in enumerate(["09", "10", "11", "12"]):
    live_history.record(mesh(f"2026-09-19T{hr}:00:00+00:00", [station(1, 50.0 + i)]))

got = live_history.history([1], H, hours=24)
series = got[1]["pm25"]
check("the window is exactly as long as asked", len(series) == 24)
check("the newest reading lands on the last slot", series[-1] == 53.0)
check("the readings are oldest-first", series[-4:] == [50.0, 51.0, 52.0, 53.0])
check("hours before recording began are gaps, not zeros", all(v is None for v in series[:-4]))

got = live_history.history([1], H, hours=2)
check("a shorter window keeps only its own hours", got[1]["pm25"] == [52.0, 53.0])

check("an unknown station returns nothing", live_history.history([999], H) == {})
check("no station ids returns nothing", live_history.history([], H) == {})
check("an unparseable end hour returns nothing", live_history.history([1], "not-a-date") == {})

# A reading outside the window must not be dragged into it.
reset()
live_history.record(mesh("2026-09-17T12:00:00+00:00", [station(1, 99.0)]))
live_history.record(mesh(H, [station(1, 44.0)]))
series = live_history.history([1], H, hours=24)[1]["pm25"]
check("a reading older than the window is excluded", 99.0 not in series)
check("the in-window reading is kept", series[-1] == 44.0)


# ── pruning ─────────────────────────────────────────────────────────────────
reset()
from datetime import datetime, timedelta, timezone  # noqa: E402

old = (datetime.now(timezone.utc) - timedelta(days=45)).isoformat()
new = datetime.now(timezone.utc).isoformat()
live_history.record(mesh(old, [station(1, 10.0)]))
live_history.record(mesh(new, [station(2, 20.0)]))
removed = live_history.prune(days=30)
check("prune removes what is past retention", removed == 1)
with live_history._connect() as c:
    left = {r[0] for r in c.execute("SELECT station_id FROM reading")}
check("prune keeps what is inside retention", left == {2})


# ── status ──────────────────────────────────────────────────────────────────
d = live_history.describe()
check("describe reports it is recording", d["recording"] is True)
check("describe names what the series is", d["kind"] == "rolling_24h_mean")
check("describe counts the readings", d["readings"] == 1)

print("=" * 68)
print(f"{passed}/{passed + failed} passed")
raise SystemExit(1 if failed else 0)
