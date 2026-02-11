# Backend deployment notes

## Railway Variables

- Set `DATABASE_URL` to the Railway Postgres TCP proxy value (`DATABASE_PUBLIC_URL`).
- Do **not** use unresolved placeholders like `${{Postgres.DATABASE_URL}}` in Railway variables.
- `RECORD_SECONDS` is supported (preferred over `DURATION_SECONDS`).
- `COOKIE_JAR_PATH` is supported (falls back to `COOKIE_PATH`).
- `DECODE_MODEL` is supported (falls back to `OPENAI_MODEL`).
- Optional: set `REQUIRE_API_KEY=true` to require `X-API-KEY` for `POST /run`.

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
