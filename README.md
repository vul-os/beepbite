# BeepBite

Restaurant point-of-sale with a WhatsApp-first ordering channel. Built for the South African market.

Competitive bar: Toast, Square for Restaurants, Lightspeed, TouchBistro, Lavu. See [ROADMAP.md](ROADMAP.md) for the current gap analysis and status.

## Architecture

Monorepo with three independently deployable pieces:

```
beepbite-mono/
├── backend/              Go HTTP API (replaces Supabase)
│   ├── cmd/server/       chi router, entrypoint
│   ├── cmd/migrate/      migrations CLI
│   ├── migrations/       numbered .sql files, applied in order
│   └── internal/
│       ├── auth/         email JWT + rotating refresh + Google OAuth
│       ├── staffauth/    POS username/password + PIN login
│       ├── chatbot/      WhatsApp webhook state machine
│       ├── handlers/     data (REST), aimenu, cashdrawer, promotions,
│       │                 paymentwebhooks, whatsappsend, whatsappwebhook
│       ├── integrations/ paystack, stripe, whatsapp, mapbox, resend
│       ├── db/           pgx pool
│       └── config/       env loader
├── src/                  React 19 + Vite + Tailwind + shadcn/ui
│   ├── lib/api-client.js Thin supabase-js-shaped client on fetch
│   ├── pages/            Dashboard, menu, orders, staff, auth…
│   └── services/         Domain helpers
├── docs/                 Public docs
└── ROADMAP.md            Competitive-gap roadmap (source of truth)
```

The frontend used to call Supabase directly; it now hits the Go backend through
`src/lib/api-client.js`, which exposes the same `.from()` / `.rpc()` / `.auth.*`
surface so callsites didn't need to change.

## Tech stack

- **Backend**: Go 1.25, chi router, pgx v5, Postgres 15+
- **Frontend**: React 19, Vite, Tailwind CSS, Radix UI / shadcn/ui
- **Integrations**: WhatsApp Cloud API, Paystack, Stripe, Mapbox, Resend, OpenAI (menu creator)
- **Auth**: JWT HS256 access tokens (15 min) + opaque sha-256-hashed rotating refresh tokens (30 days)

## Quick start

```bash
# 1. Postgres
createdb beepbite

# 2. Env vars — copy and fill in DATABASE_URL, JWT_SECRET,
#    Google OAuth creds, WhatsApp tokens, payment keys, etc.
cp .env.example .env

# 3. Run migrations
cd backend
go run ./cmd/migrate --env=local --up
#   --reset drops and re-applies; --down just drops.

# 4. Backend
go run ./cmd/server --env=local

# 5. Frontend
cd ..
npm install
npm run dev        # http://localhost:5173
# npm run build -- --mode=dev    # dev bundle
# npm run build -- --mode=main   # prod bundle
```

## What's built vs what's pending

See [ROADMAP.md](ROADMAP.md) for the live list. Today the schema and Go handlers
cover: staff auth (password + PIN), tables / dine-in, KDS, cash drawer, voids /
comps with manager approval, promotions + coupon engine, suppliers &
purchasing, gift cards / store credit / house accounts, menu scheduling / 86
list, audit log, idempotency keys, and reporting views.

Notable gaps still open: tip pooling, staff pay rates, delivery zones,
frontend POS login screen, analytics dashboard rewire, and finishing the
WhatsApp webhook chatbot port.

## Key design notes

- **RLS is off.** The backend trusts JWT identity; the frontend is responsible
  for including `organization_id` / `location_id` in filter predicates. This is
  a conscious simplification — revisit when tighter enforcement is needed.
- **Data REST layer** is allowlisted (`backend/internal/handlers/data/allowlist.go`).
  Unknown tables / RPCs return 404.
- **Embedded joins** resolve one level deep (what the app uses). Deeper nesting
  would require a PostgREST-equivalent.
- **Money is cents (bigint).** Everything new uses int64 cents. A few legacy
  tables still use `decimal(10,2)` — conversion helpers live alongside the
  engines that need them.
- **Staff vs member auth** share a JWT secret, disambiguated by audience claim.
  Splitting into a dedicated `STAFF_JWT_SECRET` is blocked on key-rotation
  tooling.

## Documentation

- [Setup](docs/setup.md)
- [User guide](docs/user-guide.md)
- [Features](docs/features.md)
- [API](docs/api.md)
- [Development](docs/development.md)
- [Troubleshooting](docs/troubleshooting.md)

## License

MIT — see [LICENSE](LICENSE).
