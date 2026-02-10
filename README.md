# GIANT FM AC/DC Decoder (Railway + GitHub Pages)

Production-ready repo with:

- **Backend** in `/backend` (Node.js 20 + TypeScript + Express) for Railway
- **Frontend** in `/frontend` (static HTML/CSS/JS) for GitHub Pages

## Features

- `POST /run` queues a new run (requires `X-API-KEY`)
- Backend records GIANT FM stream audio for **exactly 240 seconds** with required headers and cookie persistence
- Transcribes with **faster-whisper small** in Railway container
- Sends transcript to OpenAI for AC/DC decoding JSON
- Stores runs in SQLite (`/data/db.sqlite`) or Postgres (`DATABASE_URL`)
- Scheduled runs at **08:00, 12:00, 14:00 America/Toronto**
- Frontend has one **RUN** button + runs table + polling + transcript expand/collapse

---

## Backend API

### `POST /run`
Headers:

- `X-API-KEY: <BACKEND_API_KEY>`

Response:

```json
{ "id": "<run_id>", "status": "queued" }
```

### `GET /runs`
Returns latest 100 runs.

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

- `BACKEND_API_KEY=<your-secret-api-key>`
- `CORS_ORIGIN=https://<your-gh-username>.github.io`
- `OPENAI_API_KEY=<your-openai-key>`

Optional / defaults:

- `PORT=3000`
- `STREAM_URL=https://mybroadcasting.streamb.live/SB00329?_=252731`
- `DURATION_SECONDS=240`
- `DATA_DIR=/data`
- `AUDIO_DIR=/data/audio`
- `SQLITE_PATH=/data/db.sqlite`
- `COOKIE_PATH=/data/cookies.txt`
- `OPENAI_MODEL=gpt-4o-mini`
- `PYTHON_BIN=python3`

Database selection:

- If `DATABASE_URL` is set, backend uses Postgres.
- Otherwise it uses SQLite at `/data/db.sqlite`.

6. Deploy service; note the Railway URL (for `API_BASE`).

---

## GitHub Pages setup for `/frontend`

1. In GitHub repo: **Settings → Pages**.
2. Under **Build and deployment**, select **Deploy from a branch**.
3. Branch: `main`, folder: `/frontend`.
4. Save.

Then edit `frontend/app.js`:

```js
const API_BASE = 'https://<your-railway-service>.up.railway.app';
const API_KEY = '<same-value-as-BACKEND_API_KEY>';
```

Commit and push changes; Pages will publish automatically.

---

## CORS policy

- `GET` endpoints are open from any origin.
- `POST /run` is only accepted cross-origin from `CORS_ORIGIN` and still requires `X-API-KEY`.

---

## Scheduler

Cron configured in backend:

- `0 8,12,14 * * *` timezone `America/Toronto`

This enqueues jobs just like manual `POST /run`.

---

## Repository layout

- `backend/` – API, queue, recorder, transcription, decoding, DB, scheduler, Dockerfile
- `frontend/` – GitHub Pages static UI
