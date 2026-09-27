# Node backup — 140.238.241.77

Taken before a reset, over the public HTTP API only: the node's shell was not
reachable at the time.

## What is here

| file | what it is |
|---|---|
| `recorded-readings.csv` | the recorded station hours, flattened — 7,584 readings, 69 stations, pm25/pm10/o3/no2 |
| `stations.json` | the mesh as served, including each station's `hourly` window |
| `history-city-{7,30,90,365}d.json` | daily city AQI from the archive — 349 days to 2026-09-17 |
| `forecast-frames.json`, `forecast-grid.json` | the 72-hour run and its field |
| `alerts-inversion.json`, `policy-grap.json`, `fires.json`, `met-gfs.json` | derived layers as served |
| `status.json`, `health.json`, `assistant-status.json` | node state at capture, incl. the recorder's own counters |
| `MANIFEST.json` | sha256 per file, and the gap below in machine-readable form |

## What this backup does NOT contain

**The node's recorder is larger than anything the API will serve.** At capture
`/api/v1/status` reported `live_history` holding **31,541 readings across 103
stations spanning 151 hours** (2026-09-20T10:00Z → 2026-09-26T16:00Z).

`/api/v1/stations` exposes only the last **72 hours**, and takes no query
parameter — `LIVE_HISTORY_HOURS = 72` is fixed in `api_server.py`, and no
other route reads the `reading` table. So this backup holds roughly the most
recent half of the window and 69 of the 103 stations.

**Approximately 79 hours and 34 stations of recorded readings exist only in
`backend/live_history.db` on the node.** `live_history.py` calls that box "the
one place the data cannot be regenerated", and a reset destroys it.

## To capture the rest, if any access is recovered

Any one of these is enough, and none needs the app to be running:

```bash
# 1. copy the file off
scp <user>@140.238.241.77:/path/to/backend/live_history.db ./live_history.db

# 2. or dump it in place, if only a console is available
sqlite3 /path/to/backend/live_history.db .dump > live_history.sql

# 3. or, with no shell at all: take a boot-volume snapshot in the cloud
#    console before resetting. That preserves the whole disk, and the .db
#    can be recovered from it afterwards.
```

The table is `reading(station_id, pollutant, hour_utc, value, unit)`.
