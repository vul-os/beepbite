# Development Guide

## Stack

| Layer | Technology |
|---|---|
| Backend | Go 1.22+, chi router, pgx v5, PostgreSQL 15+ |
| Frontend | React 19, Vite, Tailwind CSS, shadcn/ui (Radix UI) |
| Auth | JWT HS256 (15 min) + opaque rotating refresh tokens (30 days) |
| API client | `src/lib/api-client.js` — thin fetch wrapper with a Supabase-shaped surface |

The frontend never calls Supabase directly. All data goes through the Go backend at `VITE_API_URL`.

## Local setup

See [setup.md](setup.md) for the full first-run walkthrough (createdb → migrate → backend → frontend).

Short version:

```bash
createdb beepbite
cp .env.example .env        # fill in DATABASE_URL, JWT_SECRET, VITE_API_URL
cd backend && go run ./cmd/migrate --env=local --up
go run ./cmd/server --env=local &
cd .. && npm install && npm run dev
```

## Project layout

```
beepbite-mono/
├── backend/
│   ├── cmd/server/        chi router entrypoint
│   ├── cmd/migrate/       migration runner
│   ├── migrations/        numbered .sql files
│   └── internal/
│       ├── auth/          email/password JWT + Google OAuth
│       ├── staffauth/     POS username + PIN login
│       ├── handlers/      REST endpoints (data, billing, staff, pos, …)
│       ├── integrations/  Paystack, Stripe, WhatsApp, Mapbox, Resend, OpenAI
│       └── db/            pgx pool
├── src/
│   ├── lib/api-client.js  Fetch wrapper — edit this, not a Supabase SDK
│   ├── context/           React contexts (auth, actor-token, …)
│   ├── pages/             Route-level components
│   └── services/          Domain helpers (pos.js, etc.)
└── docs/
```

## Working on the backend

Add a new migration:

```bash
# migrations are numbered files, e.g. 0042_my_feature.sql
ls backend/migrations/          # find the next number
touch backend/migrations/0043_my_feature.sql
# write SQL, then:
cd backend && go run ./cmd/migrate --env=local --up
```

The migration runner is idempotent — it only applies unapplied files, tracked in `schema_migrations`.

Add a new handler: implement in `backend/internal/handlers/`, mount it in `backend/cmd/server/main.go`.

## Working on the frontend

The API client (`src/lib/api-client.js`) wraps `fetch` and mimics the subset of the Supabase JS SDK the app uses (`.from().select()`, `.rpc()`, `.auth.*`). It auto-refreshes tokens on 401 and replays the request.

To add a new API call, use `api.request(method, path, { body })` directly or go through the `.from()` query builder for table reads.

```js
import { api } from '@/lib/api-client';

const { data, error } = await api.request('POST', '/orders', { body: { ... } });
```

## Code conventions

- Functional React components with hooks only.
- Tailwind utility classes; no custom CSS unless necessary.
- Absolute imports via `@/` alias (e.g. `import { Button } from '@/components/ui/button'`).
- Money is stored as integer cents (`bigint`). Format with `Intl.NumberFormat`.

## Linting

```bash
npm run lint          # ESLint check
npm run lint:fix      # auto-fix
```

Do not suppress pre-existing lint warnings with `// eslint-disable` unless you understand them — many are load-bearing.

## Testing

```bash
# Go backend integration tests (requires local DB)
cd backend && go test ./cmd/tests/... -v

# Frontend unit tests (Vitest)
npm test
```

## Branch strategy

- `main` — production-ready
- `hardening/*` — active hardening/feature branches
- `feature/*` — new features

PRs target `main`. CI runs Go tests and ESLint on every push.

## Further reading

- [Setup guide](setup.md) — first-run walkthrough
- [Troubleshooting](troubleshooting.md) — common local dev issues
- [ROADMAP.md](../ROADMAP.md) — what's built vs what's pending
