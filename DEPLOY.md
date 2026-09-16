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

Copy your API URL (e.g. `https://airsense-api.onrender.com`), then:

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
| 🟢 **Baseline · RMSE 84.89** | Correct. Real data from 68 CPCB stations. |
| 🔴 **Demo / Synthetic** | `VITE_API_BASE` is wrong/missing, or the API is asleep. |

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

Render free instances **sleep after ~15 minutes idle** and take **30–60 seconds
to wake**. A judge opening a cold link sees synthetic data until the API
answers, then it swaps.

**Open the API URL yourself 2–3 minutes before presenting.** If the budget
allows, Render's $7/month removes this entirely and is worth it for the final
week.

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
| Badge red on first open | free instance asleep | open `/health`, wait 60 s, reload |
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
        value: https://airsense-api.onrender.com
    routes:
      - type: rewrite
        source: /*
        destination: /index.html
```

It works. It just puts two services on one free account, and the CDN is weaker.
