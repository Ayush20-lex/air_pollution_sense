"""
Live History - Air Pollution Sense
SIH26082 - MoES / NCMRWF

Keeps the live mesh instead of throwing it away.

Why this exists
---------------
The archive publishes about 42 hours behind - that is CPCB's lag, not the
fetcher's - so the station chart on the terminal has a 24-hour window for every
archived station and nothing at all for the live ones. WAQI's feed is a single
snapshot: it reports what a station reads now and carries no history behind it,
so there is no request that can fill that window in.

The backend already builds the live mesh every five minutes and discards it.
This appends each build to a small table, and after a day the live stations have
a window of their own - measured, contiguous, and ending at the current hour
rather than 42 hours back.

Nothing here can be backfilled. A day not recorded is a day that does not exist,
which is why the recorder is wired into the service's own lifespan rather than
left to a script someone has to remember to run.

What the series actually is
---------------------------
Not the same quantity as the archive's `hourly`, and the difference matters
enough to carry in the payload rather than leave to a reader to infer.

The archive stores instantaneous hourly readings. The live feed publishes an
EPA sub-index, and `waqi_live.from_epa` inverts it to the concentration that
index was computed from - which for PM2.5 and PM10 is already a **24-hour
mean**. Sampling that hourly gives a rolling 24-hour mean, not a sequence of
hourly readings: it is smoother than the real signal and it lags, because each
point still has the previous day inside it.

That is a perfectly good trend line and a misleading one to label "hourly". So
`history()` reports `kind` alongside the values and the chart says which it is
holding.

Size
----
Three pollutants across about 24 live stations is roughly 1,700 rows a day,
some 100 KB, and `prune` keeps 30 days. The whole table is a few megabytes -
small enough that the cost of keeping it is not worth a decision.
"""
from __future__ import annotations

import logging
import os
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger("live_history")

#: Beside the module by default. Overridable so the tests never touch the real
#: file - losing recorded history to a test run is unrecoverable.
DB_PATH = Path(os.getenv("LIVE_HISTORY_DB") or Path(__file__).resolve().parent / "live_history.db")

#: The window the station chart draws, in hours.
WINDOW_HOURS = 24

#: How long a reading is kept. Well past anything the page draws; the table is
#: a few MB at this retention and pruning harder would save nothing worth
#: measuring.
RETENTION_DAYS = 30

#: WAQI's sub-index labels to the keys the archive already uses for `hourly`,
#: so a live series and an archived one are interchangeable to the frontend.
#: Only the three the live mesh is allowed to index appear here - see
#: waqi_live.EXCLUDED for why NO2, SO2 and CO do not.
LABEL_TO_KEY = {"PM2.5": "pm25", "PM10": "pm10", "O3": "o3"}

#: What a recorded series is, carried into the payload. See the module note.
KIND = "rolling_24h_mean"

#: What a stored value is. CPCB's bulletin publishes sub-indices and leaves
#: concentration null on every pollutant, while WAQI and the archive give
#: ug/m3, so the table has to hold both - and must never average one into the
#: other. Every read names the unit it wants and gets only that.
UGM3 = "ugm3"
SUBINDEX = "subindex"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS reading (
    station_id INTEGER NOT NULL,
    pollutant  TEXT    NOT NULL,
    hour_utc   TEXT    NOT NULL,
    value      REAL    NOT NULL,
    unit       TEXT    NOT NULL DEFAULT 'ugm3',
    PRIMARY KEY (station_id, pollutant, hour_utc, unit)
) WITHOUT ROWID;
"""


def _migrate(conn: sqlite3.Connection) -> None:
    """Bring a pre-`unit` table forward without losing what it holds.

    The first version keyed on (station_id, pollutant, hour_utc) and stored only
    concentrations. `CREATE TABLE IF NOT EXISTS` leaves such a table alone, so
    the new five-column insert would fail against it on every poll - and it
    would fail on the deployed box, which is the only one with recorded hours in
    it and the one place the data cannot be regenerated.

    ALTER TABLE cannot widen a primary key, so the table is rebuilt and the
    existing rows carried over as ug/m3, which is what they are: nothing but
    concentrations could be written before this column existed.
    """
    cols = {r[1] for r in conn.execute("PRAGMA table_info(reading)")}
    if not cols or "unit" in cols:
        return
    logger.info("migrating live history to the unit-aware schema")
    conn.execute("ALTER TABLE reading RENAME TO reading_legacy")
    conn.execute(_SCHEMA)
    conn.execute(
        "INSERT OR IGNORE INTO reading (station_id, pollutant, hour_utc, value, unit) "
        f"SELECT station_id, pollutant, hour_utc, value, '{UGM3}' FROM reading_legacy"
    )
    moved = conn.execute("SELECT COUNT(*) FROM reading").fetchone()[0]
    conn.execute("DROP TABLE reading_legacy")
    logger.info("live history migrated: %d reading(s) preserved", moved)


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, timeout=5.0)
    # WAL so a read for a page request is never blocked by the recorder's
    # write. Both happen in the same process but on different threads, and the
    # default journal would serialise them.
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    _migrate(conn)
    conn.execute(_SCHEMA)
    return conn


def _floor_hour(iso: str) -> str | None:
    """An ISO timestamp floored to its hour, in UTC.

    The hour is the key, so two polls inside the same hour write the same row
    rather than two. That is what makes polling safe at any cadence: WAQI
    updates hourly, and a poll that finds nothing new overwrites a row with its
    own value.
    """
    try:
        t = datetime.fromisoformat(iso)
    except (TypeError, ValueError):
        return None
    if t.tzinfo is None:
        t = t.replace(tzinfo=timezone.utc)
    return t.astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0).isoformat()


def record(mesh: dict[str, Any]) -> int:
    """Append one live mesh build. Returns the number of readings written.

    Only stations the mesh could index are kept: an invalid station has no
    concentration to record, and storing a placeholder would put a hole in the
    series that looks like a reported zero.
    """
    if not mesh or not mesh.get("stations"):
        return 0

    rows: list[tuple[int, str, str, float]] = []
    for s in mesh["stations"]:
        if not s.get("valid"):
            continue
        # Each station's own hour, not the mesh's: the feed is assembled from
        # 24 separate requests and the stations do not all report on the same
        # minute, so pinning them to one timestamp would file a reading under
        # an hour it does not belong to.
        hour = _floor_hour(s.get("as_of") or mesh.get("as_of") or "")
        if hour is None:
            continue
        for label, sub in (s.get("sub_indices") or {}).items():
            key = LABEL_TO_KEY.get(label)
            if key is None or not sub:
                continue
            # Concentration when the feed gives one, the sub-index when it does
            # not. Recording only concentrations meant CPCB's bulletin - which
            # publishes neither - was skipped entirely, so the recorder filled
            # with nothing while the page showed 74 live stations.
            value, unit = sub.get("concentration"), UGM3
            if value is None:
                value, unit = sub.get("sub_index"), SUBINDEX
            if value is None:
                continue
            rows.append((int(s["id"]), key, hour, float(value), unit))

    if not rows:
        return 0

    with _connect() as conn:
        conn.executemany(
            "INSERT INTO reading (station_id, pollutant, hour_utc, value, unit) "
            "VALUES (?, ?, ?, ?, ?) "
            "ON CONFLICT (station_id, pollutant, hour_utc, unit) "
            "DO UPDATE SET value = excluded.value",
            rows,
        )
    logger.info("recorded %d live reading(s) across %d station(s)",
                len(rows), len({r[0] for r in rows}))
    return len(rows)


def history(
    station_ids: list[int],
    ends_at: str,
    hours: int = WINDOW_HOURS,
    unit: str = UGM3,
) -> dict[int, dict[str, list[float | None]]]:
    """The recorded window for each station, oldest first.

    Every series is exactly `hours` long and padded with None, so a station
    recorded two hours ago draws two points and twenty-two gaps rather than a
    two-point line stretched across the full axis. The gaps are honest: they are
    hours before the recorder existed, and the chart already draws a missing
    hour as a break rather than interpolating over it.
    """
    end = _floor_hour(ends_at)
    if not station_ids or end is None or hours <= 0:
        return {}

    end_dt = datetime.fromisoformat(end)
    start_dt = end_dt - timedelta(hours=hours - 1)
    # The exact hour strings the window covers, so a value can be placed by
    # lookup rather than by arithmetic on a parsed timestamp.
    slots = [(start_dt + timedelta(hours=i)).isoformat() for i in range(hours)]
    slot_of = {h: i for i, h in enumerate(slots)}

    placeholders = ",".join("?" * len(station_ids))
    with _connect() as conn:
        cur = conn.execute(
            f"SELECT station_id, pollutant, hour_utc, value FROM reading "  # noqa: S608 - ids are ints
            f"WHERE station_id IN ({placeholders}) AND hour_utc >= ? AND hour_utc <= ? "
            f"AND unit = ?",
            [*station_ids, slots[0], slots[-1], unit],
        )
        found = cur.fetchall()

    out: dict[int, dict[str, list[float | None]]] = {}
    for station_id, pollutant, hour_utc, value in found:
        i = slot_of.get(hour_utc)
        if i is None:
            continue
        series = out.setdefault(station_id, {}).setdefault(pollutant, [None] * hours)
        series[i] = value
    return out


def prune(days: int = RETENTION_DAYS) -> int:
    """Drop readings older than `days`. Returns the number removed."""
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).replace(
        minute=0, second=0, microsecond=0
    ).isoformat()
    with _connect() as conn:
        cur = conn.execute("DELETE FROM reading WHERE hour_utc < ?", (cutoff,))
        n = cur.rowcount or 0
    if n:
        logger.info("pruned %d reading(s) older than %d days", n, days)
    return n


def describe() -> dict[str, Any]:
    """Short status for /api/v1/status, and for answering 'is it recording?'."""
    try:
        with _connect() as conn:
            rows, stations, first, last = conn.execute(
                "SELECT COUNT(*), COUNT(DISTINCT station_id), MIN(hour_utc), MAX(hour_utc) "
                "FROM reading"
            ).fetchone()
    except sqlite3.Error as exc:  # noqa: BLE001 - status must never fail
        return {"recording": False, "reason": str(exc)}

    hours = 0
    if first and last:
        hours = int((datetime.fromisoformat(last) - datetime.fromisoformat(first))
                    .total_seconds() // 3600) + 1
    return {
        "recording": True,
        "kind": KIND,
        "readings": rows or 0,
        "stations": stations or 0,
        "hours_span": hours,
        "oldest": first,
        "newest": last,
        "retention_days": RETENTION_DAYS,
    }
