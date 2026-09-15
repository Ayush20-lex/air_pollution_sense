# Deploying AirSense NCR

SIH26082 · two services from this repository: a FastAPI backend and a static
dashboard. Verified end to end on 15 September 2026 — the API boots from a
clean checkout and serves the validated blend baseline with no external calls.

Budget about an hour. Do the backend first; the dashboard needs its URL.

---

## Why this deploys at all

The forecast the API serves is the **blend baseline**, running in
`archive_replay` mode: it replays the scored December 2025 archive rather than
polling a live feed. So the data it needs — 5.3 MB — is committed to the
repository, and the deployed service calls nothing on the internet.

That is deliberate. A demo that depends on OpenAQ being up on presentation day
is a demo that can fail on presentation day.

```
ml_pipeline/data/raw/stations/catalog.json              232 KB
ml_pipeline/data/raw/forecast/forecast_2025.parquet     2.3 MB
ml_pipeline/data/raw/observations/season=2025/pm25_*     2.9 MB   68 sensors
ml_pipeline/data/processed/baseline_corrections.json      4 KB
```

---

## 1 · Backend

**Render → New → Blueprint → point at this repo.** `render.yaml` describes both
services. Or configure manually:

| Setting | Value |
|---|---|
| Root directory | `backend` |
| Build | `pip install -r requirements-deploy.txt --extra-index-url https://download.pytorch.org/whl/cpu` |
| Start | `uvicorn api_server:app --host 0.0.0.0 --port $PORT` |
| Health check | `/health` |
| Python | 3.11 |

### Two things that will break the build if changed

**Use `requirements-deploy.txt`, not `requirements.txt`.** The development
manifest lists `psycopg2-binary`, `asyncpg`, `redis`, `msgpack`, `orjson`,
`httpx` and `python-multipart` — none of which are imported anywhere in
`backend/`. The two database drivers are the usual cause of a free-tier build
failing outright.

**Keep the `--extra-index-url`.** Without it, `pip install torch` on Linux
pulls the CUDA build: roughly 2.5 GB, over the image limit on every free tier.
The CPU wheel is ~200 MB and is all the API needs — there is no GPU on the host
and the baseline does not run the network anyway.

### Verify before moving on

```bash
curl -s https://YOUR-API.onrender.com/health
```

```json
{"status":"ok","model_loaded":true,"weights_loaded":false,"data_mode":"archive_replay"}
```

`data_mode` must read **`archive_replay`**. If it says `synthetic`, the archive
was not readable — check that the parquets under
`ml_pipeline/data/raw/observations/season=2025/` are present in the deployed
commit, not gitignored.

Then confirm the forecast itself:

```bash
curl -s --compressed https://YOUR-API.onrender.com/api/v1/forecast/frames | head -c 400
```

Expect `"engine": "blend_baseline"`, `"is_synthetic": false`,
`"validated_rmse_ugm3": 84.89`, `"stations": 68`.

---

## 2 · Dashboard

| Setting | Value |
|---|---|
| Root directory | `sih-dashboard` |
| Build | `npm ci && npm run build` |
| Publish directory | `dist` |
| Environment | `VITE_API_BASE` = the API URL from step 1, no trailing slash |
| Rewrite | `/*` → `/index.html` |

The rewrite is not optional — without it the app loads at `/` and 404s on
refresh anywhere else.

### The failure that looks like success

If `VITE_API_BASE` is missing or wrong, the console **does not error**. It
falls back to its built-in synthetic generator and renders perfectly. The only
visible difference is the provenance badge reading **"Demo / Synthetic"**
instead of **"Baseline · RMSE 84.89"**.

Check that badge on the deployed site before you call it done. It is the
difference between showing judges a working system and showing them a mockup.

`VITE_*` variables are compiled in at build time, so changing it requires a
redeploy, not a restart.

---

## 3 · Final check

1. Open the dashboard URL in a private window.
2. The badge reads **Baseline · RMSE 84.89**.
3. Scrub the timeline — values change across the 72 hours.
4. Open it on a phone.
5. Record a 60-second screen capture as a fallback for demo day.

---

## Free-tier caveat, worth knowing before the room

Render's free instances sleep after ~15 minutes idle and take **30–60 seconds**
to wake. If a judge opens a cold link, the dashboard shows synthetic data until
the API answers, then swaps.

Hit the URL yourself a few minutes before presenting. If the budget allows,
$7/month removes this entirely and is worth it for the final week.

---

## What is deliberately not deployed

`backend/weights/` is gitignored, so no model weights ship. That is correct as
of today: no training run has beaten the blend baseline's 84.89 µg/m³, and the
API is configured to serve the baseline until one does.

If weights are ever added at `backend/weights/forecaster_v1.pt`, the API loads
them automatically and the badge changes to "Coupled model". **Do not put a
checkpoint there until it has beaten 84.89 on the held-out December window** —
the badge makes a claim to judges, and it should be true.
