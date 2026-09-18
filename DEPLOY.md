# Deploying AirSense NCR

SIH26082 · **API on Render, dashboard on Vercel.**
Budget 45–60 minutes. Do the API first — the dashboard needs its URL.

Verified from a clean boot on 16 September 2026: the API starts with no
external calls and serves the validated blend baseline.

---

## Why this split

| | where | why |
|---|---|---|
| **API** (FastAPI) | Render | needs a persistent process and ~1 GB of dependencies |
| **Dashboard** (Vite) | Vercel | static files; Vercel's CDN and Vite pipeline are the best fit |

**The API cannot go on Vercel.** Vercel runs Python as serverless functions
capped at **250 MB unzipped**, and the torch CPU wheel alone unzips to roughly
800 MB before geopandas, scipy and pyproj. Serverless also can't hold the
`/ws/live` WebSocket open, and would repeat the ~1.6 s archive load on every
cold start instead of once at boot.

Putting the dashboard on Vercel also keeps Render's single free instance
dedicated to the API — which matters, because that's the one that sleeps.

---

## Before you start

- GitHub repo pushed and up to date
- A Render account and a Vercel account (both free, GitHub sign-in)
- Nothing else. No API keys, no database, no secrets.

The deployed API **makes no outbound network calls.** It serves the blend
baseline in `archive_replay` mode, replaying the scored December 2025 record,
and the 5.3 MB it reads is committed to the repo:

```
ml_pipeline/data/raw/stations/catalog.json            232 KB
ml_pipeline/data/raw/forecast/forecast_2025.parquet   2.3 MB
ml_pipeline/data/raw/observations/season=2025/pm25_*  2.9 MB   68 sensors
ml_pipeline/data/processed/baseline_corrections.json    4 KB
ml_pipeline/data/raw/gfs/gfs_ncr_forecast.parquet      21 KB   NOAA GFS
ml_pipeline/data/raw/gfs/gfs_ncr.parquet               17 KB   fallback
```

That is deliberate. A demo that needs OpenAQ to be up on presentation day is a
demo that can fail on presentation day.

---

# Step 1 · API on Render

### 1.1 Create the service

1. [dashboard.render.com](https://dashboard.render.com) → **New** → **Blueprint**
2. Connect the GitHub repo
3. Render reads `render.yaml` and proposes **airsense-api**
4. **Apply**

Or configure manually — **New → Web Service**:

| Field | Value |
|---|---|
| Root Directory | `backend` |
| Runtime | Python 3 |
| Build Command | `pip install -r requirements-deploy.txt --extra-index-url https://download.pytorch.org/whl/cpu` |
| Start Command | `uvicorn api_server:app --host 0.0.0.0 --port $PORT` |
| Health Check Path | `/health` |
| Instance Type | Free |
| Environment variable | `PYTHON_VERSION` = `3.11` |

### 1.2 Two things that break the build if changed

**Use `requirements-deploy.txt`, not `requirements.txt`.** The dev manifest
lists `psycopg2-binary`, `asyncpg`, `redis`, `msgpack`, `orjson`, `httpx` and
`python-multipart` — none imported anywhere in `backend/`. The two database
drivers are the usual reason a free-tier build dies.

**Keep `--extra-index-url`.** Without it, `pip install torch` on Linux pulls the
CUDA build: ~2.5 GB, over the image limit. The CPU wheel is ~200 MB and is all
an inference-only service needs.

First build takes **5–10 minutes** — torch is large.

### 1.3 Verify before moving on

Copy your API URL from the Render dashboard — **the one Render gave you**,
not the one in this document.

> ### Check the URL is actually yours
>
> Render subdomains are global and first-come. `airsense-api.onrender.com` is
> already taken by an unrelated project — an "AirSense Cameroon API v2.0" — so
> Render appends a suffix when the name is gone. Ours is
> `airsense-api-cieo.onrender.com`.
>
> This has already caught us once, and it is nasty because the wrong URL does
> **not** 404. It answers 200 with a stranger's JSON, which parses fine and has
> no `frames` array, so the dashboard discards it exactly as it would a dead
> backend — red badge, no error, nothing in the console to explain it.
>
> Open the URL yourself and confirm the response says
> `"data_mode":"archive_replay"` before you paste it anywhere.

Then:

```bash
curl -s https://YOUR-API.onrender.com/health
```

Expected:

```json
{"status":"ok","model_loaded":true,"weights_loaded":false,"data_mode":"archive_replay"}
```

> **`data_mode` must read `archive_replay`.**
> If it says `synthetic`, the archive wasn't readable — check that the parquets
> under `ml_pipeline/data/raw/observations/season=2025/` are in the deployed
> commit and not gitignored.

Then the forecast itself:

```bash
curl -s --compressed https://YOUR-API.onrender.com/api/v1/forecast/frames | head -c 400
```

Expect `"engine": "blend_baseline"`, `"is_synthetic": false`,
`"validated_rmse_ugm3": 84.89`, `"stations": 68`.

**Do not continue until both return what's above.**

---

# Step 2 · Dashboard on Vercel

### 2.1 Create the project

1. [vercel.com/new](https://vercel.com/new) → import the same repo
2. **Root Directory: `sih-dashboard`** ← the one setting people miss
3. Framework preset: **Vite** (auto-detected)
4. Build and output settings come from `sih-dashboard/vercel.json` — leave them

### 2.2 Set the API URL — do this *before* the first deploy

**Environment Variables** → add:

| Name | Value |
|---|---|
| `VITE_API_BASE` | `https://YOUR-API.onrender.com` |

No trailing slash. Apply to Production, Preview and Development.

> `VITE_*` variables are **compiled in at build time**, not read at runtime.
> Changing this later requires a **redeploy**, not a restart.

### 2.3 Deploy

**Deploy**, then wait ~1 minute.

---

# Step 3 · The check that actually matters

Open the Vercel URL and look at the **badge in the header**.

| Badge | Meaning |
|---|---|
| 🟢 **Baseline · RMSE 84.89** | Correct. Real data from 68 CPCB stations, confirmed with the backend within the last 5 minutes. |
| 🟡 **Baseline · backend down** | The figures on screen are real and came from the backend, but it has stopped answering. Usually Render asleep. |
| 🟡 **Baseline · 12m old** | Real backend figures, not re-confirmed recently — normally a tab left open in the background. |
| 🔴 **Demo / Synthetic** | The backend has never answered. `VITE_API_BASE` is wrong/missing, or the API was asleep at load. |

**Amber is not a failure.** It means the numbers are genuine but their
currency is no longer vouched for, which is a different and weaker claim
than green. It is safe to present from; say "served from the last backend
response" if anyone asks. Only red means the numbers are synthetic.

The dashboard re-checks the backend every 2 minutes while the tab is
visible, so a red badge caused by a sleeping instance **turns green on its
own** once Render wakes. You no longer have to reload to recover it.

### The failure that looks like success

If `VITE_API_BASE` is missing, **the dashboard does not error.** It falls back
to its built-in synthetic generator and renders perfectly — every panel, every
chart, every animation. The only visible difference is that badge, plus a toast
saying "Backend unreachable".

This is the single most likely way to demo a mockup by accident. **Check the
badge.**

If it's red:
1. Confirm `VITE_API_BASE` in Vercel → Settings → Environment Variables
2. **Redeploy** (build-time, remember)
3. Wake the API by opening `/health` directly, then reload

### Note on the terminal page

`/terminal` shows a badge reading **DEMO** and labels its own values
"Demo values" / "Synthetic sample". That is correct and intentional — that
route renders static content and does not read the backend. Only the main
console is wired to live data.

---

# Step 4 · Final checks before demo day

1. Open the dashboard in a **private window** — badge reads Baseline
2. Scrub the 72-hour timeline — values change
3. Open it on a **phone**
4. Open it on someone else's laptop, on a different network
5. **Record a 60-second screen capture** as a demo-day fallback

---

## Free-tier caveat — know this before the room

Render free instances **sleep after ~15 minutes idle**. Waking one was timed
at **92 seconds** on 18 September 2026 — Render's own figure of 30–60 s is
optimistic, so plan for a minute and a half.

The dashboard's fetch gives up after 8 seconds, so a cold link **will** show the
red synthetic badge at first. It then re-checks every 2 minutes and swaps itself
to green once the API answers, with no reload needed. Left alone, a cold open
corrects itself inside about two minutes.

**Do not rely on that in the room.** Open the API URL yourself and wait for
`/health` to answer **before** you open the dashboard — three minutes ahead, not
one. If the budget allows, Render's $7/month removes the sleep entirely and is
worth it for the final week.

---

## The GFS side channel

`/api/v1/met/gfs` serves a NOAA GFS extract from the partner ingestion
pipeline — 9 grid cells, f000 to f072 at 3-hourly steps, and precipitation,
which none of the twelve forecast channels carries.

It feeds nothing. The blend baseline is validated at 84.89 µg/m³ and adding an
input would invalidate that number, so `baseline_forecaster.py` does not read
it. Breaking this endpoint cannot break the forecast; the reverse is also true.

**Absence is a normal state.** The file comes from a separate repository on
someone else's schedule. If it is missing the endpoint answers **204** and
`/api/v1/status` reports `noaa_gfs.available: false`. Nothing else changes.

**Presence is not freshness.** The extract is committed, so it only refreshes
when someone re-runs the partner fetcher and pushes. Check
`freshness.status` — `fresh` / `aging` / `stale` / `expired`:

```bash
curl -s https://YOUR-API.onrender.com/api/v1/met/gfs | python -c "import sys,json; print(json.load(sys.stdin)['freshness'])"
```

The cycle committed on 16 September (`20260916_00z`) covers up to **19
September 2026, 00:00 UTC**. As of 18 September it reads `stale` with ~12 hours
left; after that it reads `expired` and says so in a `note` field. Expired is
honest rather than broken — the endpoint keeps serving and keeps admitting the
window has passed — but get a fresh cycle before demo day if you intend to show
this layer. Drop it at the same path; no code changes.

---

## What is deliberately not deployed

`backend/weights/` is gitignored, so **no model weights ship**. That is correct
as of today: no training run has beaten the blend baseline's 84.89 µg/m³, and
the API is configured to serve the baseline until one does.

If weights are ever placed at `backend/weights/forecaster_v1.pt`, the API loads
them automatically and the badge changes to "Coupled model". **Do not put a
checkpoint there until it has beaten 84.89 on the held-out December window** —
that badge is a claim made to judges, and it should be true.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Render build fails on `psycopg2` | used `requirements.txt` | switch to `requirements-deploy.txt` |
| Render build exceeds image limit | torch CUDA build | add `--extra-index-url .../whl/cpu` |
| `/health` says `synthetic` | archive parquets missing | check they're committed, not gitignored |
| Badge red, API healthy | `VITE_API_BASE` unset/wrong | fix it, then **redeploy** |
| Badge red on first open | free instance asleep | open `/health`, wait ~90 s — the badge recovers itself, no reload needed |
| Badge red, `/health` fine in a browser | wrong Render subdomain — you have a stranger's service | confirm the response says `archive_replay`, fix `VITE_API_BASE`, redeploy |
| Badge amber | backend unconfirmed; figures are still real | fine to present; check the API is awake if it persists |
| Refresh 404s on a sub-path | SPA rewrite missing | confirm `sih-dashboard/vercel.json` is deployed |
| Vercel builds the wrong thing | Root Directory not set | set it to `sih-dashboard` |

---

## Alternative: everything on Render

If you'd rather not use Vercel, add this back to `render.yaml`:

```yaml
  - type: web
    name: airsense-dashboard
    runtime: static
    plan: free
    rootDir: sih-dashboard
    buildCommand: npm ci && npm run build
    staticPublishPath: dist
    envVars:
      - key: VITE_API_BASE
        value: https://YOUR-API.onrender.com   # yours, not this placeholder
    routes:
      - type: rewrite
        source: /*
        destination: /index.html
```

It works. It just puts two services on one free account, and the CDN is weaker.
