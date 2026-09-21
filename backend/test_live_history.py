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


# ── units: CPCB publishes sub-indices, WAQI publishes concentrations ────────
reset()


def sub_only(sid: int, index: float) -> dict:
    """A CPCB-style station: a sub-index and no concentration at all."""
    return {
        "id": sid,
        "valid": True,
        "sub_indices": {"PM2.5": {"sub_index": index, "concentration": None}},
    }


live_history.record(mesh(H, [sub_only(7, 143.0)]))
with live_history._connect() as c:
    rows = c.execute("SELECT value, unit FROM reading").fetchall()
check("a station with no concentration records its sub-index",
      rows == [(143.0, live_history.SUBINDEX)])

got = live_history.history([7], H, unit=live_history.SUBINDEX)
check("the sub-index series reads back under its own unit", got[7]["pm25"][-1] == 143.0)
check("asking for ug/m3 does not return sub-indices",
      live_history.history([7], H, unit=live_history.UGM3) == {})

# Both units for one station-hour must coexist without overwriting.
live_history.record(mesh(H, [station(7, 55.0)]))
check("a concentration and a sub-index can share a station-hour",
      live_history.history([7], H, unit=live_history.UGM3)[7]["pm25"][-1] == 55.0
      and live_history.history([7], H, unit=live_history.SUBINDEX)[7]["pm25"][-1] == 143.0)


# ── migration from the pre-unit schema ──────────────────────────────────────
import sqlite3  # noqa: E402

legacy = _tmp.parent / "legacy.db"
con = sqlite3.connect(legacy)
con.execute(
    "CREATE TABLE reading (station_id INTEGER NOT NULL, pollutant TEXT NOT NULL, "
    "hour_utc TEXT NOT NULL, value REAL NOT NULL, "
    "PRIMARY KEY (station_id, pollutant, hour_utc)) WITHOUT ROWID"
)
con.execute("INSERT INTO reading VALUES (1, 'pm25', ?, 61.0)", (H,))
con.commit()
con.close()

_saved = live_history.DB_PATH
live_history.DB_PATH = legacy
with live_history._connect() as c:
    cols = {r[1] for r in c.execute("PRAGMA table_info(reading)")}
    kept = c.execute("SELECT value, unit FROM reading").fetchall()
check("the old schema gains a unit column", "unit" in cols)
check("rows written before the column are preserved as ug/m3", kept == [(61.0, live_history.UGM3)])
with live_history._connect() as c:
    _legacy = list(c.execute("SELECT name FROM sqlite_master WHERE name='reading_legacy'"))
check("the legacy table is cleaned up after the move", not _legacy)
live_history.DB_PATH = _saved
reset()
live_history.record(mesh(new, [station(2, 20.0)]))


# ── connections are closed ──────────────────────────────────────────────────
#
# The regression this file did not have. `_connect` used to return the handle
# bare and every caller wrote `with _connect() as conn:`, which commits the
# transaction and leaves the connection open. Nothing here noticed, because
# every test asserts on rows and none of them counted handles.
#
# In production it took twenty-seven hours to bring the service down: the
# recorder polls every five minutes, each /api/v1/stations read opens another,
# and at 1024 descriptors the process was holding 503 copies of the database
# and 503 of its WAL. It could no longer open a socket, so every CPCB and WAQI
# fetch failed with "[Errno 24] Too many open files", while systemd still
# called the unit active because the process was alive and listening.

def _open_db_handles() -> int | None:
    """How many descriptors this process holds on the history database.

    Linux only - there is no /proc on Windows, where this file is also run.
    Returns None there so the check can say it was skipped rather than pass
    without having tested anything.
    """
    fd_dir = Path("/proc/self/fd")
    if not fd_dir.is_dir():
        return None
    n = 0
    for fd in fd_dir.iterdir():
        try:
            target = os.readlink(fd)
        except OSError:
            continue
        if str(_tmp) in target:
            n += 1
    return n


_before = _open_db_handles()
if _before is None:
    print("[SKIP] connections are closed after use (needs /proc; not on this platform)")
else:
    for _ in range(40):
        live_history.history([1], "2026-09-20T10:00:00+00:00", hours=24)
    _after = _open_db_handles()
    check(
        f"forty reads leak no handles ({_before} -> {_after})",
        _after <= _before,
    )


# ── status ──────────────────────────────────────────────────────────────────
d = live_history.describe()
check("describe reports it is recording", d["recording"] is True)
check("describe names what the series is", d["kind"] == "rolling_24h_mean")
check("describe counts the readings", d["readings"] == 1)

print("=" * 68)
print(f"{passed}/{passed + failed} passed")
raise SystemExit(1 if failed else 0)
