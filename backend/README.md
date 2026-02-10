# Backend deployment notes

## Railway environment setup

- `DATABASE_URL` is required by the backend and must point to a reachable PostgreSQL connection string.
- On Railway, prefer setting `DATABASE_URL` to the Postgres TCP proxy value (`DATABASE_PUBLIC_URL`) or a Railway reference variable that resolves to it.
- Using the public URL helps avoid internal hostname `ENOTFOUND` issues in mis-wired deployments: https://station.railway.com/questions/error-connecting-to-postgre-sql-getaddri-5c52974d?utm_source=chatgpt.com

## Healthcheck behavior

- The backend binds to `0.0.0.0` and Railway `PORT`.
- `GET /health` always responds immediately, even while Postgres is still initializing.
- Health response includes:
  - `ok`
  - `port`
  - `dbReady`
  - `dbError`
  - `storage`

## DB startup resilience

- HTTP server starts first for reliable Railway health checks.
- Postgres initialization runs in the background with retries (2s, 5s, 10s, 20s, then every 30s).
- Run creation endpoints return `503` while DB is not ready.
- Scheduled cron runs log and skip until DB initialization succeeds.
