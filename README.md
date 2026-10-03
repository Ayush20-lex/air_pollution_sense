# AirLytics NCR

**A 72-hour air quality forecast for Delhi NCR that can show you where every number came from.**

Built for Smart India Hackathon 2026, problem statement **SIH26082** (Ministry of Earth Sciences / NCMRWF).

**[airlytics-ncr.vercel.app](https://airlytics-ncr.vercel.app/)** · API: [`/api/v1/status`](https://airlytics-ncr.vercel.app/api/v1/status)

![The landing view: the NCR mesh, with live station readings on the globe](docs/screenshots/hero.png)

---

## The problem with air quality dashboards

Most of them will tell you Delhi's AQI is 312. Almost none will tell you which station measured it, at what hour, from how many valid readings, or what the number would have been if the sensor it depends on had been offline.

That gap matters. CPCB's National AQI is not a measurement, it is an arithmetic result with rules: a 24-hour rolling average per pollutant, at least 16 valid hours in that window, at least three pollutants with one of them particulate, and the index is the **worst** sub-index rather than the average. A dashboard that silently fills gaps or averages across stations produces a number that looks authoritative and is not.

AirLytics is built the other way around. Every figure is traceable to a station and an hour, every gap is stated rather than filled, and where the system cannot know something it says so.

## What it does

| | |
|---|---|
| **Live station mesh** | 68 CPCB stations across Delhi NCR, each indexed independently under the CPCB National AQI (2014), 59 of them eligible under its rules. The live feed covers whichever are reporting this hour; the rest come from the archive, and each station says which it is. No interpolation between neighbours. |
| **72-hour forecast** | Validated blend baseline at **61.12 µg/m³ RMSE**, 27% better than raw CAMS, scored over 4,069,348 comparisons across a full annual cycle. |
| **Stubble fire corridor** | NASA VIIRS fire pixels clustered upwind, with transport alignment against the forecast wind field and an earliest-arrival estimate. |
| **GRAP policy engine** | Which stage the readings imply, and which restrictions follow from it. |
| **Inversion alerts** | Night-time boundary layer collapse, which is why the air gets worse after dark. |
| **Grounded AI assistant** | Answers questions about the air, but only from this system's own endpoints. Every answer prints the tool calls behind it. |

![Live telemetry: one station's CPCB index, the band it falls in, and who the air is hurting](docs/screenshots/overview.png)

*Live telemetry. The index names the pollutant that set it, the window coverage it was computed over, and the mesh low and high beside it, so a single number is never the whole claim.*

![Geospatial plume map: interpolated PM2.5 across the NCR mesh with wind flow and source attribution](docs/screenshots/geo-map.png)

*The plume map. Source attribution reports only the share it can measure from upwind fire transport, and names the rest as local emission that no feed here quantifies, rather than splitting it into invented percentages.*

![72-hour forecast track with CPCB category bands](docs/screenshots/forecast.png)

*The 72-hour track. The line is dashed for every hour with no measured day behind it, and the caption says why: those hours come from the CAMS model alone and are less accurate than an anchored hour.*

## What makes it different

**The index refuses to lie.** A station that cannot meet CPCB's rules reports `valid: false` and the reasons why, not a number. Carbon monoxide is excluded entirely, because the catalogue labels it `ppb` while the values are magnitudes that can only be mg/m³ or ppm. Read as ppb, CO's sub-index collapses to roughly zero and would silently contribute nothing. mg/m³ and ppm differ by 15% and the label cannot be trusted to choose between them, so CO is withheld rather than guessed at.

**The forecast refuses to run ahead of its data.** The origin is capped at the last *observed* hour. Bounding it by the forecast index instead let a run start ahead of the newest measurement, and since gaps are forward-filled it still produced output, seeded by a "current" state that was in places nineteen hours stale and silently repeated.

**The assistant cannot invent a figure.** It has eight read-only tools over this system's own API and a prompt that forbids stating any number a tool did not return. Ask it what share of Delhi's PM2.5 comes from vehicles and it declines, because there is no emissions inventory behind it. Every answer carries receipts: which endpoint, which hour, how long it took.

One real turn, streamed from `POST /api/v1/assistant`:

```
> Is it safe to run outside right now?

  tool  city_now     74ms  ok  /api/v1/stations     as_of 2026-09-27T16:00 IST
  tool  grap_stage   26ms  ok  /api/v1/policy/grap  as_of 2026-09-27T10:47Z

  "the city mean AQI is 105 (Moderate), and there are no active GRAP
   restrictions. However, conditions range from a very clean AQI of 22 (Good)
   at Major Dhyan Chand National Stadium to a heavily polluted 327 (Very Poor)
   at Vikas Sadan, Gurugram. [...] If you have any pre-existing health
   conditions, please consult your doctor before exercising outdoors."
```

Two tools for one question, the spread rather than a city average that would hide a 300-point difference across 30 km, and a referral to a clinician instead of an invented safety threshold.

**The accuracy claim is re-measured, not remembered.** `19_refresh_archive.py` re-scores the baselines whenever the archive moves and rewrites the published RMSE in source. A figure measured on a window the product no longer serves is a stale claim, and the script exists so that it cannot quietly become one.

## Validated accuracy

Scored by `ml_pipeline/scripts/14_baselines.py` over December 2025 to October 2026, all leads +1 to +72h. Re-scored on every archive refresh, so these move: the blend was 62.23 when the archive reached 17 September and 61.12 at 27 September. Part of the drop is a longer, cleaner window rather than a better method.

| Method | RMSE µg/m³ | MAE | Bias |
|---|---|---|---|
| **blend (diurnal + bias-corrected CAMS)** | **61.12** | 36.44 | +3.21 |
| diurnal persistence | 66.04 | 33.28 | +0.12 |
| climatology | 80.36 | 50.52 | −7.78 |
| persistence | 81.17 | 40.49 | −2.02 |
| bias-corrected CAMS | 81.75 | 53.68 | +6.85 |
| raw CAMS | 83.91 | 55.61 | +13.11 |

Error is flat across lead time (60.3 to 62.1 µg/m³ from +1h to +72h), which is the point of blending a diurnal parent with a corrected model field rather than trusting either alone.

## Quick start

Requires Python 3.10+ (running on 3.10.21 in production and 3.14.4 in development) and Node 20+ (Vite 8, React 19).

**Backend**

```bash
cd backend && pip install -r requirements.txt && python api_server.py
```

Serves on `http://localhost:8000`. The first request is slow, because it loads and parses the archive; later ones are cached.

**Frontend**

```bash
cd sih-dashboard && npm install && npm run dev
```

Serves on `http://localhost:5173`.

The dashboard runs with no API keys at all, replaying the bundled archive. Keys add live data on top of it.

## Configuration

### Keys

All optional. Without them the system serves the archive rather than pretending to be live. Live meteorology is not in this table because Open-Meteo needs no key.

| Variable | Gets you | Where |
|---|---|---|
| `WAQI_TOKEN` or `AQICN_TOKEN` | Live station readings | [aqicn.org/data-platform/token](https://aqicn.org/data-platform/token) |
| `CPCB_API_KEY` | CPCB's own bulletin, preferred over WAQI | [data.gov.in](https://data.gov.in) |
| `NASA_FIRMS_KEY` | Fire pixels for the corridor | [firms.modaps.eosdis.nasa.gov/api](https://firms.modaps.eosdis.nasa.gov/api/area) |
| `GEMINI_API_KEY` | The assistant, on Gemini | [aistudio.google.com](https://aistudio.google.com) |
| `GROQ_API_KEY` | The assistant, on Groq | [console.groq.com](https://console.groq.com/keys) |
| `OPENAQ_API_KEY` | Refreshing the archive | [openaq.org](https://openaq.org) |

`CPCB_API_KEY` is also read as `DATA_GOV_IN_KEY`, whichever is set, and it is worth the slower registration. WAQI republishes CPCB as US EPA sub-indices, so that path has to invert each index back to a concentration and drops NO2 and SO2 over a window mismatch. For the same hour, Wazirpur came out 163 "Moderate" through WAQI and 231 "Poor" from the bulletin, a whole band apart, on the pollutant setting the index.

### Settings

Not credentials, so there is nowhere to go and register. Every one of these has a working default and the system runs with none of them set.

| Variable | Default | What it changes |
|---|---|---|
| `ASSISTANT_PROVIDER` | `auto` | Pin the assistant to `gemini` or `groq`, which disables failover |
| `GEMINI_MODEL` | `gemini-3.8-flash` | The Gemini model |
| `GROQ_MODEL` | `openai/gpt-oss-120b` | The Groq model |
| `ASSISTANT_KILL_FILE` | `/etc/airsense.assistant.off` | Create that file and the assistant stops answering - no deploy, no restart |
| `ASSISTANT_SELF_BASE` | `http://127.0.0.1:8000` | Which API the assistant's tools read |
| `LIVE_HISTORY_DB` | `backend/live_history.db` | Where recorded live history is kept |
| `ARCHIVE_CACHE_DIR` | `.cache/archive` | Where the parsed archive is cached |

Set both LLM keys if you have them. With `ASSISTANT_PROVIDER` at its default the
assistant fails over on its own - a provider that refuses on quota is benched for
thirty minutes and the other takes the turn, and when the bench expires the
preferred one takes it back with no restart. Failover only happens before
anything has reached the reader, which is where a quota refusal arrives, because
switching mid-answer would stitch two voices into one reply. The per-IP rate
limit follows whichever provider is active, since the two free tiers differ by a
factor of three. `/api/v1/assistant/status` reports which one is serving.

Two of the settings above are worth knowing before a demo. `ASSISTANT_KILL_FILE`
is the only way to take the assistant down in a hurry, and it works by existing - `touch` it and the
next question gets a refusal instead of a turn.

`ASSISTANT_SELF_BASE` has to be right or the assistant answers with nothing
behind it. Its tools read this API over HTTP, so the default assumes something is
listening on loopback port 8000. On a host where uvicorn terminates TLS itself
and nothing binds 8000, every tool failed in about a millisecond with
`ok: false` and the assistant kept talking - a grounded assistant with no ground
under it, which looks exactly like a working one until you read the tool chips.
Set it to whatever URL actually serves the API.

## API

```
GET  /api/v1/stations              the mesh, one CPCB AQI per station
GET  /api/v1/forecast/grid         gridded 72-hour PM2.5
GET  /api/v1/forecast/frames       animation frames
GET  /api/v1/forecast/station/{id} one station's track
GET  /api/v1/fires                 fire clusters, corridor, transport
GET  /api/v1/policy/grap           stage and restrictions
GET  /api/v1/alerts/inversion      night-time inversion risk
GET  /api/v1/history/city          daily city PM2.5 and AQI
GET  /api/v1/met/live              live meteorology, NCEP GFS via Open-Meteo
GET  /api/v1/met/gfs               the committed GFS extract, and its age
GET  /api/v1/status                model, sources, provenance
GET  /api/v1/assistant/status      which provider is answering, and its rate limit
POST /api/v1/assistant             one grounded turn, streamed as SSE
GET  /health                       liveness, and whether weights are loaded
```

The two met endpoints return the same shape and both carry NCEP GFS. The
difference is currency: one is fetched per request, the other is a parquet
committed on a partner's schedule, and each reports its own `freshness.status`
so a consumer can tell which it is holding. The dashboard asks for the live one
first and falls back.

## Keeping the data current

The service replays a real window, so "how current is it" is a data question rather than a code one:

```bash
python ml_pipeline/scripts/19_refresh_archive.py
```

It fetches only the missing window, merges without losing anything held, re-scores the baselines, refits the CAMS correction, rewrites the published RMSE in source, regenerates the dashboard's offline snapshot, and retunes the synthetic fallback. Those last steps are the reason it is a script and not a note: each one is a frozen view of the old window, and forgetting any of them leaves the product claiming something about data it no longer serves.

It runs itself on a schedule, because nobody remembers to. `.github/workflows/refresh-archive.yml` fires at 02:00 UTC daily and opens a pull request with the result; `deploy/airsense-pull.{sh,service,timer}` fast-forwards the box to `main` overnight and restarts the API only if anything moved, so merging the PR is what ships it.

The refresh opens a PR rather than pushing to `main` on purpose. Step 6 rewrites
the published RMSE, and that figure is quoted here, in several backend
docstrings and in the deck - it was 62.23 before the archive reached
27 September. A scheduled job should not move a headline accuracy claim without
somebody seeing the diff. The workflow needs `OPENAQ_API_KEY` in the
repository's Actions secrets; without it the job fails loudly rather than
committing a no-op.

About 36 to 48 hours of lag remains and cannot be closed from here. That is CPCB's own publication delay through OpenAQ. Live readings cover the present.

## Tests

They are plain scripts rather than a pytest suite, so run them directly.

```bash
cd backend && python test_aqi_cpcb.py        # 49 cases against CPCB's published rules
python test_observation_qc.py                # 33 - peer tests and what they drop
python test_waqi_live.py                     # 34 - EPA sub-index inversion
python test_firms_fire.py                    # 19 - VIIRS parsing, the NRT type column
python test_live_history.py                  # 30 - rolling means, retention, pruning
python test_coupled_feedback.py              # 33 - the aerosol-PBL loop
python test_graph_topology.py                # 24 - the dynamic graph's edges
python test_normalization.py                 # channel scales and offsets
```

222 cases across the seven that report a count.

The assistant has its own harness. It spends real tokens, so it is a command you
run deliberately rather than a test hook:

```bash
python assistant_eval.py                     # 20 questions, asserting which tools fired
```

`test_aqi_cpcb.py` is the one that matters: it checks sub-index breakpoints, the minimum-valid-hours rule, the 8-hour window for CO and ozone, unit conversion before indexing, and that an ineligible station reports its reasons instead of a number.

## Known limits

Stated here rather than left to be discovered:

- **The ConvLSTM is not driving the published forecast.** `weights_loaded: false`. The architecture is implemented and its feedback coupling is tested, but the served numbers come from the validated blend baseline. `/api/v1/status` says so at runtime.
- **The aerosol-PBL feedback is a diagnostic, not a correction.** The blend is built from observations that already happened under the real feedback, so feeding the modelled PBL response back into PM2.5 would count the same physics twice.
- **Per-station meteorology is synthetic.** PBL height, wind and NOx per station are derived, not measured. `/api/v1/met/live` measures nine 0.25 degree cells, which covers the domain but is not 68 points.
- **Open-Meteo floors the boundary layer.** Its GFS reports 10 m overnight, where a real nocturnal mixing layer over Delhi is 100 to 300 m. Values at or below 50 m are withheld and counted in `rows_floored` rather than served, because 10 m would read as a catastrophic inversion. `gfs_global` is identical, `best_match` floors at 25 m, and ECMWF and ICON do not publish the field, so there is no model here to switch to. The same floor is already in the training archive, which is built from the same API.
- **The committed GFS extract expires.** It carries a 72-hour window from a fixed cycle and nothing refreshes it automatically, so it can be weeks old. `/api/v1/met/gfs` reports `freshness.status` for exactly this reason, and `/api/v1/met/live` exists because that status read "expired".
- **The archive lags.** See above.

## Repository layout

```
airlytics-ncr
│
├── backend/                        FastAPI service: indexing, forecast, assistant
│   │
│   │   ── the index ──
│   ├── aqi_cpcb.py                 the 2014 index itself: breakpoints and windows
│   ├── station_registry.py         the mesh, per-station AQI under CPCB rules
│   ├── observation_qc.py           peer tests that drop a sensor, not a station
│   │
│   │   ── live feeds, each one optional ──
│   ├── cpcb_live.py                the CPCB bulletin from data.gov.in, preferred
│   ├── waqi_live.py                WAQI fallback, EPA sub-indices re-indexed
│   ├── openmeteo_live.py           live meteorology, NCEP GFS via Open-Meteo
│   ├── gfs_reader.py               the partner pipeline's committed GFS parquet
│   ├── firms_fire.py               VIIRS fire pixels, cached per origin date
│   ├── live_history.py             rolling 24h means, so live stations get a chart
│   ├── archive_cache.py            the replayed window, parsed once
│   │
│   │   ── forecast and coupling ──
│   ├── baseline_forecaster.py      the validated blend and its published score
│   ├── channel_spec.py             the twelve channels, their units and scales
│   ├── coupled_model.py            ConvLSTM + attention + DynGNN, as implemented
│   ├── coupled_convlstm_engine.py  the cells themselves
│   ├── coupled_feedback.py         PM2.5 to AOD to shortwave to PBL, the loop
│   ├── physics_loss.py             the training constraint on that loop
│   ├── spatial_fusion.py           station-to-grid interpolation
│   │
│   │   ── policy, fires, assistant ──
│   ├── grap_policy.py              stage thresholds and the restrictions each implies
│   ├── fire_corridor.py            clustering, transport alignment, arrival times
│   ├── assistant.py                the assistant, its guardrails and provider failover
│   ├── assistant_tools.py          its eight read-only tools
│   ├── assistant_eval.py           twenty cases asserting which tools must fire
│   ├── log_safety.py               redacts keys out of the journal
│   │
│   ├── api_server.py               the fourteen endpoints
│   └── test_*.py                   222 cases: CPCB rules, QC, fires, coupling, history
│
├── sih-dashboard/                  React + Vite frontend
│   └── src/
│       ├── components/terminal/    the dashboard proper
│       ├── components/intro/       the entry sequence
│       ├── lib/terminal/           API clients and index maths
│       └── lib/useLiveNow.ts       what is measured now, kept apart from the forecast
│
├── ml_pipeline/
│   ├── scripts/                    fetch, build, train, score, refresh (01-20)
│   │   ├── 14_baselines.py         scores every method, sets the published RMSE
│   │   ├── 15_build_gridded_dataset.py  stations and met onto the 70x80 grid
│   │   ├── 16_train_coupled.py     ConvLSTM training harness
│   │   ├── 19_refresh_archive.py   one command to bring the archive current
│   │   └── 20_score_coupling.py    what the feedback is worth, measured
│   └── data/                       the served archive
│
├── external_data_pipeline/         partner ingestion service (Open-Meteo, medallion
│                                   layers). Present in the repo, not run in
│                                   production - the backend fetches its own feeds.
│
└── docs/screenshots/               the images in this file
```

Three top-level files are not part of the service and are kept for the
submission: `presentation.html` and `final_sih_presentation.md` (the deck), and
`AirQualityDashboard.jsx` (an early single-file prototype). `DEPLOY.md` and
`GFS_REFRESH.md` are the runbooks.

## Team

Built for SIH 2026, problem statement SIH26082, Ministry of Earth Sciences / NCMRWF.
