# Refresh the GFS export — handoff for the Data-Pipeline partner

**Repo:** `yadavarpit9833-cpu/Data-Pipeline`
**File to produce:** `exports/gfs_ncr_forecast.parquet`

The committed extract has expired. Its cycle initialised **2026-09-16 00:00 UTC**
and its whole 72-hour window is now in the past:

```
cycle_init        2026-09-16T00:00Z
cycle_age         84.1 h
hours_remaining   -12.1
status            expired
```

Nothing is broken — GFS is a read-only side channel and feeds no forecast, so the
scored RMSE of 62.23 is unaffected. But `/api/v1/status` reports `"expired"`, and
that is the first thing a judge opening the status page will see.

---

## Paste this into Claude Code

> Re-run our GFS fetcher and export a fresh cycle to `exports/gfs_ncr_forecast.parquet`.
>
> Use the newest available NCEP cycle (00/06/12/18z). Keep the output schema byte-identical to the
> current file — the consumer parses it strictly and a renamed column is read as a missing field,
> not as an error. Then commit and push.
>
> Before pushing, verify: 225 rows, `cycle` matching the new run, and `valid_time.max()` at least
> 48 hours in the future.

That is the whole job if the fetcher still runs. The contract below is only needed
if it has to be rebuilt.

---

## The contract

**Shape:** 225 rows = 25 forecast steps × 9 grid cells.

**Grid** — 0.25° cells inside the NCR domain (28.20–28.90 N, 76.80–77.60 E):

```
lat   28.25, 28.50, 28.75
lon   77.00, 77.25, 77.50
```

**Steps:** f000 to f072 at 3-hourly spacing — `fhr` ∈ {0, 3, 6, …, 72}.

**Columns** (exact names — units are part of the name on purpose):

| column | type | meaning |
|---|---|---|
| `valid_time` | ISO8601 UTC string | the hour the row describes |
| `cycle` | string | run id, format `YYYYMMDD_HHz`, e.g. `20260920_12z` |
| `fhr` | int | forecast hour, 0–72 |
| `lat`, `lon` | float | cell centre |
| `temperature_c` | float | °C |
| `u_wind_ms`, `v_wind_ms` | float | m/s |
| `precipitation_mm_3h` | float | mm accumulated over the **3 hours ending at `valid_time`** |
| `<field>_qc_flag` | string | `ok`, or a reason |
| `<field>_imputed` | bool | true if filled rather than measured |
| `source`, `is_synthetic`, `fetched_at` | | provenance |

**Two traps that have already bitten this file:**

1. **Units live in the column name.** An earlier export carried `no2_ppb` holding
   µg/m³. Read at face value that inflated the pollutant by 88% and nothing
   downstream raised. If a unit changes, the column name changes with it.

2. **`precipitation_mm_3h` is a 3-hour bucket, not a rate and not a run total.**
   Read as an hourly rate it is wrong by 3×, silently. At `fhr=0` there is no
   window behind it, so the correct value is null with
   `precipitation_mm_3h_qc_flag = "no_accumulation_window"` — that flag is treated
   as *structurally absent*, not as a quality failure. Do not fill it; filling it
   invents rain.

---

## Verifying it (Ayush, after pulling)

Copy the parquet to `ml_pipeline/data/raw/gfs/gfs_ncr_forecast.parquet`, then:

```bash
python -c "import sys; sys.path.insert(0,'backend'); import gfs_reader, json; print(json.dumps(gfs_reader.describe()['freshness'], indent=2))"
```

Good output looks like:

```json
{
  "status": "fresh",
  "cycle_age_hours": 2.4,
  "hours_remaining": 69.6,
  "expired": false
}
```

`status` moves `fresh → aging` after 6 hours and `→ stale` after 24, because NCEP
issues a new cycle every 6. Any of those is fine to demo; `expired` is not.

Then restart the backend so it drops its cached parse:

```bash
ssh -i ~/ssh-key-2026-09-18.key ubuntu@140.238.241.77 "sudo systemctl restart airsense"
```
