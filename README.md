# GIANT FM AC/DC Decoder (Railway + GitHub Pages)

Production-ready repo with:

- **Backend** in `/backend` (Node.js 20 + TypeScript + Express) for Railway
- **Frontend** in `/frontend` (static HTML/CSS/JS) for GitHub Pages

## Features


- `POST /run` queues a new run (public by default; key optional via `REQUIRE_API_KEY=true`)
- `POST /run/secure` queues a new run (always requires `X-API-KEY`)
- Backend records GIANT FM stream audio for **exactly 120 seconds** with required headers and cookie persistence
- Transcribes with **faster-whisper small** in Railway container
- Sends transcript to OpenAI for AC/DC decoding JSON
- Stores runs in Postgres (`DATABASE_URL`)
- Scheduled runs at **07:59, 10:59, 15:59 America/Toronto**
- Frontend has one **RUN** button + runs table + polling + transcript expand/collapse

---

## Backend API

### `POST /run`
Queues a new run. If `REQUIRE_API_KEY=true`, include header:

- `X-API-KEY: <BACKEND_API_KEY>`

Response:

```json
{ "id": "<run_id>", "status": "queued" }
```

### `POST /run/secure`
Always requires `X-API-KEY`.

### `GET /public-config`
Returns frontend-safe config:

```json
{ "stream_url": "<radio_stream>", "duration_seconds": 120, "require_api_key": false }
```

### `GET /runs`
Returns latest 100 runs.

### `GET /storage-info`
Returns the active persistence mode and storage path hints so you can verify if history should survive redeploys.

### `GET /runs/:id`
Returns:

- `id`
- `created_at_utc`
- `created_at_toronto`
- `status`
- `duration_seconds`
- `transcript`
- `decoded_summary`
- `likely_acdc_reference`
- `confidence`
- `error`

---

## Deploy to Railway (from GitHub)

1. Push this repo to GitHub `main`.
2. In Railway: **New Project → Deploy from GitHub Repo**.
3. Set Root Directory to repo root (default), Railway uses `backend/Dockerfile`.
4. Add a **Volume** mounted at:
   - `/data`
5. Add env vars in Railway service:

Required:

- `CORS_ORIGIN=https://<your-gh-username>.github.io`
- `OPENAI_API_KEY=<your-openai-key>`

Required when `REQUIRE_API_KEY=true`:

- `BACKEND_API_KEY=<your-secret-api-key>`

Optional security mode toggle:
- `REQUIRE_API_KEY=true`

Optional / defaults:

- `PORT=3000`
- `STREAM_URL=https://mybroadcasting.streamb.live/SB00329?_=252731`
- `DURATION_SECONDS=120`
- `AUDIO_DIR=/data/audio`
- `COOKIE_PATH=/data/cookies.txt`
- `OPENAI_MODEL=gpt-4o-mini`
- `PYTHON_BIN=python3`
- `REQUIRE_API_KEY=false`

Database configuration:

- `DATABASE_URL` is required. Backend uses Postgres only.

6. Deploy service; note the Railway URL (for `API_BASE`).

---

## GitHub Pages setup for `/frontend`


### Frontend Railway API URL format (important)

The **Railway API URL must be a full absolute URL including protocol**:

- ✅ `https://radioscrapper-production.up.railway.app`
- ❌ `radioscrapper-production.up.railway.app`
- ❌ `/radioscrapper-production.up.railway.app`

If you omit `https://`, GitHub Pages treats it like a relative path and you can get an HTML 404 page when loading runs.

1. In GitHub repo: **Settings → Pages**.
2. Under **Build and deployment**, select **Deploy from a branch**.
3. Branch: `main`, folder: `/frontend` (recommended) **or** `/ (root)` (works because root `index.html` redirects to `/frontend/`).
4. Save.

Open the published page and set these values in **Connection Settings**:
- Railway API URL (`https://<your-service>.up.railway.app`)
- API key (`BACKEND_API_KEY`)

Click **Save settings** once; values are kept in browser local storage.

Commit and push changes; Pages will publish automatically.

---


## Data persistence on Railway

Run history is persisted in Postgres. Add a Railway Postgres service and set `DATABASE_URL` on the backend service.

---

## CORS policy

- `GET` endpoints are open from any origin.
- `POST /run` is only accepted cross-origin from `CORS_ORIGIN` and requires `X-API-KEY` **only** when `REQUIRE_API_KEY=true`.
- `POST /run/secure` always requires `X-API-KEY`.

---

## Scheduler

Cron configured in backend:

- `0 8,12,14 * * *` timezone `America/Toronto`

This enqueues jobs just like manual `POST /run`.

---

## Repository layout

- `backend/` – API, queue, recorder, transcription, decoding, DB, scheduler, Dockerfile
- `frontend/` – GitHub Pages static UI
