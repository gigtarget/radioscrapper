# Backend deployment notes

## Railway Variables

- Prefer Railway-injected `DATABASE_URL` for internal service-to-service access.
- Use `DATABASE_PUBLIC_URL` only when a public/TCP URL is required.
- Fallback DB URL lookup order is: `DATABASE_URL`, `DATABASE_PUBLIC_URL`, then `POSTGRES_URL`.
- Railway supports variable references such as `${{Service.VAR}}`, but if logs show an unresolved literal string at runtime, fix the variable source so Railway resolves it before app start.
- Set `REQUIRE_API_KEY=true` to protect `POST /run` with `X-API-KEY`.
- `RECORD_SECONDS` is supported (preferred over `DURATION_SECONDS`).
- `COOKIE_JAR_PATH` is supported (falls back to `COOKIE_PATH`).
- `DECODE_MODEL` is supported (falls back to `OPENAI_MODEL`).

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

To change recording duration or run schedule, edit `backend/src/recording_settings.ts` or set `RECORD_SECONDS` (or legacy `RECOD_SECONDS`), `DURATION_SECONDS`, and/or `TZ` env vars.
