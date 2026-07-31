# Troubleshooting

This is a developer/operator runbook — commands, log messages, and code paths
for whoever is running `npm run dev`, deploying the Go binary, or debugging a
failing CI job. If you're an owner or staff member trying to figure out why
the till looks wrong or how a feature works, this is the wrong document — see
the [FAQ](faq.md) and the [User Guide](user-guide.md) instead.

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

The backend sends reset emails via the configured email provider (SMTP by default). In local dev no provider is usually configured, so no email is sent. The backend still returns 200 (it never reveals whether the address exists). To test the reset flow locally, watch backend stdout for the reset URL:

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

## WhatsApp webhook not receiving

**Webhook verification (`GET /webhooks/whatsapp`) fails**

Meta's setup flow does a `GET` handshake first: `hub.mode=subscribe` +
`hub.verify_token=<your token>` must match `WHATSAPP_VERIFY_TOKEN` exactly, or
the handler returns `403 Forbidden` and logs `Webhook verification failed`
(`backend/internal/handlers/whatsappwebhook/handler.go`). Double-check the
token in your Meta App dashboard matches `.env` byte-for-byte — a trailing
space or a stale value from a previous attempt is the usual cause.

**Meta can't reach the webhook at all**

Meta delivers by webhook only — it never polls. The URL you register with
Meta must be a public HTTPS endpoint that reaches your backend; `localhost`
is not reachable from Meta's servers. In local dev, tunnel it first (`ngrok
http 8080` or similar) and register the tunnel URL, not `http://localhost:8080`.

**Messages arrive but nothing happens, or signature errors in the log**

Inbound `POST` requests are verified against `X-Hub-Signature-256`, an
HMAC-SHA256 over the raw body keyed by `WHATSAPP_APP_SECRET`. If that env var
is unset, verification is **skipped** with a one-time startup warning
(`WARNING: WHATSAPP_APP_SECRET is not set — X-Hub-Signature-256 verification
is DISABLED`) — fine for a scratch local setup, never acceptable in
production, since anyone could then POST forged messages to your webhook. If
it's set and messages still don't process, check that `chatSvc` (built with
the WhatsApp `channel.Channel` adapter in `backend/cmd/server/main.go`) has a
non-nil client — a missing `WHATSAPP_ACCESS_TOKEN`/`WHATSAPP_PHONE_NUMBER_ID`
degrades the outbound side even if inbound parsing works. See
[development.md](development.md#the-channel-adapter-seam) for how the adapter
fits together.

## Database issues

**Re-run all migrations from scratch (local only)**

```bash
cd backend && go run ./cmd/migrate --env=local --reset
```

This drops the `public` schema and re-applies everything. All data is lost.

**A migration failed partway through**

Each migration file runs inside its own transaction together with its
`schema_migrations` ledger insert (`backend/cmd/migrate`), so a failing
statement rolls back the whole file — you should never see a migration marked
applied whose SQL only partly ran. If a `--up` run stops with an error,
`SELECT * FROM schema_migrations ORDER BY applied_at` to see exactly what
*did* land, fix the SQL in the failing file, and re-run `--up` — it skips
everything already in the ledger. In local dev, `--reset` is usually faster
than debugging drift by hand.

**Schema looks different from what a fresh migration should produce**

If you suspect `backend/migrations/001_baseline.sql` (the folded replacement
for a 55-file pre-consolidation history) has drifted from what that history
would have produced, run `scripts/verify-fold.sh` — it applies both the
recovered pre-fold chain and the current baseline to two throwaway Postgres
containers and diffs the resulting schemas. Requires Docker. `001_baseline.sql`
should never be hand-edited; if it needs to change, a new numbered migration
is the right tool.

**Slow queries / high CPU**

Run `EXPLAIN ANALYZE` in `psql` on the slow query. Most tables have indexes on `organization_id` and `location_id`. Check that filters always include those columns.

## Row-level security denying a query you expect to work

See [development.md](development.md#row-level-security) for the full
mechanism; this is the fast path for "I know this row exists and my query
still returns nothing" or "I got a 403/empty result I didn't expect."

**Check the session variables actually got set.** Every RLS policy reads
`current_setting('app.current_org_id', true)` (and friends), which
`internal/db.Scoped` sets via `SET LOCAL` at the start of the transaction. If
a code path calls `pool.Query`/`pool.Exec` directly instead of going through
`db.Scoped(ctx, pool, scope, fn)` (or `Emitter.Scoped`, which wraps it), those
variables are never set, `current_org_id()` reads `NULL`, and every
tenant-scoped policy predicate evaluates false — a silent empty result, not
an error. Grep the handler for a bare `pool.` call outside a `db.Scoped`
closure; that's almost always the bug.

**Check the scope actually has the org/capability you think it does.**
`db.ScopeFromContext(ctx)` comes from `auth.RequireOrgScope` middleware,
which resolves org membership from the DB per request — a stale JWT, a user
removed from an org, or a route that doesn't run behind `RequireOrgScope` at
all (some routes only require `auth.Middleware`, with no org resolved) will
all produce an empty/default `Scope`.

**Your local Postgres role might be a superuser.** `FORCE ROW LEVEL SECURITY`
does not apply to a role with `SUPERUSER` or `BYPASSRLS` — Postgres skips RLS
for such roles entirely, which means a query that's silently over-broad in
local dev (because your dev Postgres user is a superuser) can behave
correctly in dev and still be wrong once deployed with a restricted role. CI
provisions and runs the server under a dedicated non-superuser role
(`go run ./cmd/setupapprole`) specifically to catch this; running your local
server the same way gives you a truer picture than the default `postgres`
superuser role most local setups start with. `db.WarnIfRLSBypassed` logs a
loud warning at server startup if it detects this.

**Verify against the real probe suite**, rather than guessing:

```bash
cd backend && go run ./cmd/tests/rls
```

This regenerates `docs/pentest/rls-foundation.md` from a fresh scratch
database and will tell you plainly whether a given table/scope/operation
combination passes or fails, independent of whatever your application code
is doing.

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

## Screenshots script failures

`npm run screenshots` (`scripts/screenshots.mjs`) drives a **real** running
app — a real Postgres, a real `go run ./cmd/server`, a real `npm run dev`,
signed in through the actual `/signin` form. There is no mocked/offline mode,
so most failures are one of a short list:

**`docker: command not found` / Docker daemon not running**

The script stands up a throwaway `postgres:16-alpine` container
(`beepbite-screenshots-pg`, port `55432` — never your real Postgres) by
default. Start Docker Desktop (or your Docker daemon) first, or supply a
trusted database yourself via `BEEPBITE_SCREENSHOT_DATABASE_URL` and skip the
container entirely.

**Port `55432` already in use**

Almost always a leftover container from a previous interrupted run:

```bash
docker rm -f beepbite-screenshots-pg
```

**Playwright browser not found**

```bash
npx playwright install chromium
```

This is a one-time setup step, not part of `npm install`.

**Script hangs waiting for the server/frontend**

It waits on the real Go server and Vite dev server to come up before signing
in. Check `backend/migrations` applied cleanly against the throwaway DB (the
script runs `go run ./cmd/migrate` itself — a migration error surfaces here)
and that `go run ./cmd/seedcopper --env=dev --clean` (which seeds "The Copper
Table" demo tenant) didn't fail; both log to the same terminal the script runs
in.

**Screenshots look empty / show a login screen**

The seed step failed or seeded a different tenant than the script signs in
as. Re-run with a clean container (`docker rm -f beepbite-screenshots-pg`)
rather than reusing a partially-seeded one.

## Still stuck?

1. Check backend logs — most errors surface there with full context.
2. Open the browser Network tab and look at the raw response for the failing request.
3. File an issue with: steps to reproduce, backend log excerpt, and browser console errors.
