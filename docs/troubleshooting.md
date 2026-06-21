# Troubleshooting

## Quick checks

```bash
node --version    # 18+
go version        # 1.22+
psql beepbite -c "SELECT 1"   # DB reachable
curl http://localhost:8080/healthz   # backend alive
curl http://localhost:5174           # frontend alive
```

## Backend won't start

**`DATABASE_URL` missing or wrong**

```
Error: missing DATABASE_URL
```

Copy `.env.example` to `.env` and fill in `DATABASE_URL`. The format is:

```
DATABASE_URL=postgres://localhost/beepbite?sslmode=disable
```

**Migrations not applied**

If you see `relation "X" does not exist` errors, run:

```bash
cd backend && go run ./cmd/migrate --env=local --up
```

**Port 8080 already in use**

```bash
lsof -i :8080   # find the PID
kill <PID>
```

**JWT_SECRET missing**

The server will refuse to start. Set any 32+ character string in `.env`:

```
JWT_SECRET=change-me-to-something-random-in-dev
```

## Frontend won't start / blank page

**`VITE_API_URL` not set**

The frontend falls back to `http://localhost:8080`. If your backend runs elsewhere, set:

```env
VITE_API_URL=http://localhost:8080
```

Restart `npm run dev` after changing `.env`.

**Stale Vite cache**

```bash
rm -rf node_modules/.vite
npm run dev
```

**Port 5174 in use**

BeepBite's dev port is `5174` (fixed via `strictPort`). Kill whatever is using it:

```bash
lsof -i :5174
kill <PID>
```

## Auth / login problems

**"invalid email or password" after seed**

Seed creates accounts with password `Demo1234!`. Double-check caps.

**Tokens not persisting across reloads**

Auth tokens live in `localStorage` under the key `bb.auth`. If `localStorage` is disabled (private browsing with strict settings) auth won't persist. Use a normal browser window.

**"refresh failed" / kicked out on every load**

The refresh token has a 30-day expiry. If the DB was reset (`--reset`) old tokens are invalid. Clear `bb.auth` from localStorage:

```js
// browser console
localStorage.removeItem('bb.auth')
```

**Password reset emails not arriving**

The backend sends reset emails via the configured Resend provider. In local dev, `RESEND_API_KEY` is typically absent, so no email is sent. The backend still returns 200 (it never reveals whether the address exists). To test the reset flow locally, watch backend stdout for the reset URL:

```
email send password_reset to <email> FAILED: no provider configured
```

Copy the token from the log and POST it directly:

```bash
curl -X POST http://localhost:8080/auth/password/reset \
  -H 'Content-Type: application/json' \
  -d '{"token":"<raw_token>","new_password":"NewPass1234!"}'
```

## API requests failing (CORS / 401 / 404)

**CORS blocked**

The backend sets `CORS_ORIGINS` from env. In local dev, add `http://localhost:5174` to that list (or set `CORS_ORIGINS=*` for convenience).

**401 on every request**

Your `bb.auth` token may be expired or from a different JWT secret. Clear it:

```js
localStorage.removeItem('bb.auth')
```

Then sign in again.

**404 on a data table endpoint**

The data REST layer has an allowlist (`backend/internal/handlers/data/allowlist.go`). Unknown tables return 404 by design — add the table to the allowlist if it's intentionally new.

## Database issues

**Re-run all migrations from scratch (local only)**

```bash
cd backend && go run ./cmd/migrate --env=local --reset
```

This drops the `public` schema and re-applies everything. All data is lost.

**Slow queries / high CPU**

Run `EXPLAIN ANALYZE` in `psql` on the slow query. Most tables have indexes on `organization_id` and `location_id`. Check that filters always include those columns.

## Build failures

**Out of memory during `npm run build`**

```bash
export NODE_OPTIONS="--max-old-space-size=4096"
npm run build
```

**ESLint errors blocking CI**

Run locally first and fix reported errors:

```bash
npm run lint
```

Pre-existing warnings are noise — only fix errors (exit code non-zero).

## Still stuck?

1. Check backend logs — most errors surface there with full context.
2. Open the browser Network tab and look at the raw response for the failing request.
3. File an issue with: steps to reproduce, backend log excerpt, and browser console errors.
