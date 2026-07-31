# Development Guide

## Stack

| Layer | Technology |
|---|---|
| Backend | Go 1.22+, chi router, pgx v5, PostgreSQL 15+ |
| Frontend | React 19, Vite, Tailwind CSS, shadcn/ui (Radix UI), react-router-dom v7 |
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
│   ├── cmd/tests/         HTTP smoke/pentest suites, incl. cmd/tests/rls
│   ├── migrations/        4 numbered .sql files (see Migrations below)
│   └── internal/
│       ├── auth/          email/password JWT + rotating refresh
│       ├── staffauth/     POS username + PIN login
│       ├── apiauth/       API-key auth for /api/v1/*
│       ├── db/            pgx pool + per-request RLS scope (Scoped, Scope)
│       ├── handlers/      ~65 REST endpoint packages (data, pos, kds, …)
│       ├── sync/          ownership registry, op emission, sync engines (unwired)
│       ├── oplog/         hand-rolled HLC/LWW/merge algebra (unwired)
│       ├── nodeid/        Ed25519 node identity (unwired)
│       ├── channel/       ordering-channel interface + WhatsApp adapter
│       └── integrations/  WhatsApp, Mapbox
├── src/
│   ├── lib/api-client.js  Fetch wrapper — edit this, not a Supabase SDK
│   ├── routes.jsx         Route table (lazy-loaded pages)
│   ├── services/          Domain helpers (pos.js, customers.js, …)
│   ├── i18n/               9-locale translation setup
│   ├── offline/           Idempotency/queue/ULID helpers — mostly unwired, see below
│   └── pages/              Route-level components
├── scripts/                 Shell/Node tooling — see Scripts reference
└── docs/
```

## Architecture overview

A request from the bundled frontend takes one of two shapes, and it matters which:

```
React component
  → src/services/*.js           (domain helper, thin)
    → src/lib/api-client.js     (fetch wrapper, Supabase-shaped)
      → HTTP, Authorization: Bearer <jwt>
        → chi router (backend/cmd/server/main.go)
          → middleware: RequireOrgScope → db.Scope{OrgID, UserID, Capabilities, ...} in ctx
            → handler (either the generic data layer, or a hand-written package)
              → db.Scoped(ctx, pool, scope, fn)
                → BEGIN; SET LOCAL app.current_org_id = '...'; ... (per-tx session vars)
                → the handler's SQL, filtered by Postgres row-level security
                → COMMIT
```

Two code paths reach Postgres, and the balance between them is lopsided on purpose:

1. **The generic REST chokepoint** — `backend/internal/handlers/data`. One package, four
   HTTP verbs (`GET`/`POST`/`PATCH`/`DELETE /data/{table}`, plus `POST /rpc/{fn}`), and a
   fixed allowlist (`allowlist.go`) of **98 tables/views**. It builds SQL generically from
   query parameters (`select=`, `eq=`, `order=`, …) — see [api.md](api.md) for the full
   query grammar, since this is the same layer `/api/v1/*` exposes to API keys.
2. **Hand-written handler packages** — the other ~64 packages under `backend/internal/handlers`,
   each with its own `store.go` full of purpose-built `tx.Query`/`tx.Exec` calls. `ROADMAP.md`
   (Now-5) puts this at **343 hand-written statements across 78 files** as of when the ownership
   registry was written; a direct grep of today's tree finds more (438 call sites across the 52
   `store.go` files alone, 702 across all of `backend/internal` outside `handlers/data` and
   `sync`) — the codebase has grown since, but the shape of the imbalance hasn't: a handful of
   generic routes cover about a hundred tables, and everything else is bespoke SQL.

Both paths funnel through the same `db.Scoped`/RLS mechanism — the generic layer isn't
special-cased for security, only for how much boilerplate it saves. See
[Adding a backend endpoint](#adding-a-backend-endpoint) for the hand-written path, and
[api.md](api.md) for the generic layer's HTTP contract.

## Row-level security

Every tenant-scoped table is protected by Postgres row-level security, not by `WHERE
organization_id = ...` clauses sprinkled through handler code. The generic data layer's own
`SELECT`/`UPDATE`/`DELETE` builders do **not** append an org filter — they rely entirely on RLS.

**How scoping reaches Postgres.** `backend/internal/db/scoped.go` defines `Scope` (`UserID`,
`OrgID`, `Capabilities`, `ActorID`, `IsServiceRole`, `IsMarketplace`) and `db.Scoped(ctx, pool,
scope, fn)`, which opens a transaction, always writes all six `app.*` session variables via
`SELECT set_config($1, $2, true)` (`SET LOCAL`, so they don't leak past the transaction) — even
the empty ones, on purpose, so "not set" and "set empty" can't be confused — then runs `fn`.
Postgres-side helper functions defined in `backend/migrations/001_baseline.sql`
(`public.current_org_id()`, `public.is_service_role()`, etc.) read those variables via
`current_setting(..., true)`; an unset org id resolves to `NULL`, which makes every
`organization_id = current_org_id()` policy predicate evaluate false. **Fail closed is the
default**, not a special case.

`ServiceRoleScope()` and `MarketplaceScope()` are the two scopes that bypass or partially bypass
tenant filtering — used for background jobs, the migration runner, admin scripts, and public
marketplace reads, respectively. `WithTxServiceRole` temporarily elevates an already-open
tenant-scoped transaction (used e.g. for `audit_log` inserts, which policy restricts to the
service role even from an org-scoped request).

**The policy pattern**, applied per table in the migrations (139 `ENABLE ROW LEVEL SECURITY` +
139 `FORCE ROW LEVEL SECURITY` + 554 `CREATE POLICY` statements in `001_baseline.sql` alone):

```sql
ALTER TABLE public.<table> ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.<table> FORCE ROW LEVEL SECURITY;   -- applies even to the table owner

CREATE POLICY <table>_select ON public.<table> FOR SELECT
  USING (organization_id = public.current_org_id() OR public.is_service_role());

CREATE POLICY <table>_insert ON public.<table> FOR INSERT
  WITH CHECK (organization_id = public.current_org_id() OR public.is_service_role());

CREATE POLICY <table>_update ON public.<table> FOR UPDATE
  USING (...) WITH CHECK (...);

CREATE POLICY <table>_delete ON public.<table> FOR DELETE
  USING (public.is_service_role());   -- e.g. ledger tables: tenants never delete
```

Tables one join away from `organization_id` (`order_items`, `purchase_orders`, …) use a
subselect against the owning table instead of a direct column comparison.

> [!WARNING]
> `FORCE ROW LEVEL SECURITY` still does nothing if the connecting Postgres role has `SUPERUSER`
> or `BYPASSRLS` — Postgres skips RLS entirely for such roles regardless of `FORCE`.
> `db.WarnIfRLSBypassed` checks `pg_roles` at server startup and logs loudly if the app's role
> has either. CI provisions and runs the server as a dedicated non-superuser role
> (`go run ./cmd/setupapprole`) specifically so this class of bug can't hide.

### Two separate fail-closed gates

These check different things and are easy to conflate:

1. **`cmd/tests/rls` → `docs/pentest/rls-foundation.md`.** A standalone Go program that spins up
   a scratch database, applies every migration, seeds two orgs plus service/marketplace scopes,
   and runs 50 probes (`SELECT`/`INSERT`/`UPDATE`/`DELETE`, across `anon`/`orgA`/`svc`/`mkt`
   sessions) against ~15 representative tables using the real `db.Scoped` contract. It writes its
   pass/fail table into `docs/pentest/rls-foundation.md` — currently 50/50. This is a behavioral
   check: does RLS actually deny what it should, against a live database.
2. **`TestRegistryCoversTheSchema`** (`backend/internal/sync/ownership/schema_test.go`) — an
   unrelated, schema-coverage check for the *sync ownership* registry (see below), not RLS
   visibility. It fails if any base table in `public` (except `schema_migrations`) has no entry in
   `internal/sync/ownership/tables.go`, or if a registry entry names a table that no longer
   exists. It's a good forcing function — a new table can't be silently forgotten — but it does
   not test RLS policies at all.

There is **no single schema-wide "every table has RLS" automated gate**; the only narrow check is
a single-table `pg_class.relrowsecurity` assertion in
`backend/internal/handlers/tippools/store_integration_test.go`. Coverage is otherwise a standing
discipline (`ROADMAP.md`, "Now-8 — Hold the security bar that already exists": *"every new
tenant-scoped table is RLS-enabled at creation, never after"*).

### Adding a table without breaking RLS

1. Write the `CREATE TABLE`, then immediately the `ENABLE`/`FORCE ROW LEVEL SECURITY` +
   `CREATE POLICY` block above, in the same migration file — don't ship the table and the
   policies as separate migrations.
2. Add an entry to `backend/internal/sync/ownership/tables.go` (see below) — the package panics
   at process boot if the registry fails validation, and `TestRegistryCoversTheSchema` fails CI if
   the schema and registry disagree.
3. If the table is reachable through the generic REST layer, add it to `allTables` in
   `backend/internal/handlers/data/allowlist.go` (and `tablesWithOrgID` if it needs
   auto-injected `organization_id` on insert).
4. Run `go test ./internal/db/... ./cmd/tests/rls/...` (or the full `cmd/tests --all` smoke
   suite) locally before pushing — CI runs the same RLS probes as a hard gate.

## The ownership model and op emission

`backend/internal/sync/ownership` classifies every one of the schema's **149 tables** into
exactly one of four classes (`ownership.go`):

| Class | Meaning | Count |
|---|---|---|
| `Group` | Centrally edited, replicated down (menu, pricing, staff, config) — last-writer-wins register | 55 |
| `Branch` | Exactly one writer, the owning branch/location (orders, cash drawer, shifts, table state) — LWW register | 37 |
| `Ledger` | Append-only fact (stock movements, cash movements, audit log, GPS pings) — add-only set, `SUM(qty)` at read time, never a stored counter | 17 |
| `Local` | Never leaves the node (auth tokens, API keys, webhook queue, sync bookkeeping itself) — emits nothing | 40 |

A `Table` entry carries `Name`, `Class`, `Key` (default `"id"`), `Owner` (branch column, for
`Branch`), `Group`/`Qty` (for `Ledger`), `Derived` (a column that caches a ledger sum — never
emitted itself), `Secret` (columns like `password_hash` that are classified but never replicated),
and a required `Why` justification (enforced ≥40 chars by a test). Deletes are modeled as an
ordinary LWW write to a reserved `_deleted` field, not a separate tombstone kind — a dedicated
test fails if any replicated table ever grows a real column with that name.

**How a row write becomes an op**, all inside the same Postgres transaction as the write:

1. A caller uses `Emitter.Scoped(ctx, pool, scope, fn)` instead of `db.Scoped` directly; `fn`
   receives both the `pgx.Tx` and a `*emit.Recorder`.
2. After doing the actual `INSERT`/`UPDATE`/`DELETE`, the caller calls
   `rec.Record(emit.Change{Table, Kind, Row})`.
3. Still inside the transaction, `emit.Plan` looks up the table's ownership class: `Local`
   produces no ops; `Branch` refuses an op on a row owned by a different branch
   (`ErrWrongBranch`); `Ledger` produces one add-only op per insert; `Branch`/`Group` produce one
   LWW op **per changed column**, sorted for deterministic ordering.
4. The planned ops are handed to a `Sink` (interface, `emitter.go`) for `Prepare` — minting,
   content-addressing, signing — writing them into the `sync_ops` table via the **same
   transaction** as the row write. If minting or the insert fails, the whole transaction
   (including the original row write) rolls back together.
5. Only after commit does `Settle` admit the minted ops into this node's in-memory replica —
   split into two phases because a replica can't "un-admit" an op whose transaction later rolled
   back.

> [!IMPORTANT]
> **This is local logging only. Nothing replicates.** The `emit` package's own doc comment is
> explicit: *"It does not push, pull, or apply."* No socket opens, no HTTP call happens, anywhere
> in `emit`, `opsink`, `opstore`, or `substrate`. And today it doesn't even log: `Emitter` is an
> interface-shaped seam — `backend/internal/handlers/data.NewHandler(pool)` constructs its
> `*emit.Emitter` field at the zero value (`nil`), the only way to attach one is
> `Handler.WithEmitter(e)`, and `backend/cmd/server/main.go` never calls it. A nil `*Emitter` is
> valid and inert by design (`Scoped` just runs the transaction and skips steps 2–5 above), so as
> currently wired, the one real write chokepoint emits **zero** `sync_ops` rows in the running
> server. The seam is real and exercised by tests; the running product does not use it.

## The sync libraries

Below `internal/sync/emit` sits a stack of packages implementing real distributed-systems
primitives — and, as of this writing, none of them are reachable from any live request path.
Verified by grepping every non-test import in `backend/`: only `emit` (and, transitively,
`ownership`) is imported from outside the `sync` tree at all, and that seam is inert per above.

| Package | What it implements | Reachable from `cmd/server`? |
|---|---|---|
| `internal/oplog` | BeepBite's own hybrid logical clock (`Timestamp`, drift-bounded `Clock.Update`), an LWW register and add-only set (`State`/`merge.go`), and version vectors derived from the log (`vv.go`). Explicitly documented as **not** to be called "DMTAP-sync." | No |
| `internal/nodeid` | Ed25519 node identity (`NodeID` = a public key), atomic keypair generation/persistence (`Identity.LoadOrCreate`), domain-separated signing. Package doc: *"Nothing in the running server uses this package yet."* | No |
| `internal/sync/substrate` | Links the external `github.com/vul-os/kotva` **DMTAP-SYNC** engine (WASM, run via wazero) as a second, separate sync engine (`EngineName = "dmtap-sync-v0"`). Adds ~4.3 MiB to a binary that actually imports it — `cmd/server` does not. | No |
| `internal/sync/opstore` | Persists ops to the `sync_ops` table (append-only, `INSERT ... ON CONFLICT (id) DO NOTHING`, RLS-scoped). | Only via `opsink`, which nothing constructs at runtime |
| `internal/sync/protocol` | Wire types + pure functions for a push/pull round between two BeepBite branches: envelope canonicalization, Ed25519 signature + freshness + replay-cache verification (`Authenticate`). No transport, no socket. | Nowhere, not even elsewhere in the sync tree |
| `internal/sync/peers` | A pinned-key peer registry (TOFU enrollment, `ErrKeyChanged` on re-enrollment with a different key, soft revoke) over `sync_peers`, plus a durable replay-nonce cache over `sync_nonces`. | Nowhere at all — zero importers, in or out of the sync tree |
| `internal/sync/opsink` | The concrete `emit.Sink` — the only place the write path and the substrate engine would meet. Nothing constructs one. | No |

`internal/sync/substrate/vectors_test.go` drives **24 frozen conformance vectors** from the
external KOTVA repo's `SYNC.md` §10 through the linked engine (`TestFrozenSyncVectors`), gated on
`BEEPBITE_REQUIRE_SYNC_VECTORS=1` so CI's `sync-vectors` job can't silently skip it.
`internal/sync/emit/wiring_test.go` runs the enforcement in the other direction —
`TestServerBinaryDoesNotLinkTheSyncEngine` fails if `cmd/server`'s dependency graph ever reaches
`internal/sync/substrate`, `internal/sync/opsink`, or the external `kotva`/`wazero` packages.

> [!NOTE]
> **Two BeepBite instances do not sync with each other, today, at all.** There is no push/pull
> round wired to anything, no peer enrollment UI, no apply path for a peer's incoming operations.
> The ownership classification and the emit seam exist so that *when* that work lands, it has a
> correct map of the schema to work from — not because any of it runs yet. If you are evaluating
> BeepBite for multi-branch use, do not rely on sync; treat each deployment as an island.

## The channel adapter seam

`backend/internal/channel` defines the interface an "ordering channel" (a place a customer's
message enters or a reply leaves) implements:

```go
type Channel interface {
    Name() string
    Caps() Capability
    Send(ctx context.Context, m Message) (SendResult, error)
    MarkRead(ctx context.Context, messageID string) error
    React(ctx context.Context, to, messageID, emoji string) error
}

type Inbound interface {
    Parse(body []byte) ([]InboundMessage, error)
}
```

`Capability` is a bitmask (`CapText`, `CapButtons`, `CapList`, `CapImage`, `CapDocument`,
`CapTemplate`, `CapReadReceipt`, `CapReaction`) used only for cosmetic choices — every
implementation is expected to degrade unsupported richness itself (via `channel.RenderText`),
never to refuse a call because a capability bit is unset. `ErrUnsupported` is reserved for the one
case that can't degrade: a `Template` message on a rail with no template concept.

**`internal/channel/whatsapp.Adapter`** wraps `internal/integrations/whatsapp.Client` (the raw
Meta Cloud API client) and implements both `Channel` and `Inbound`: it maps `Message` kinds onto
`SendInteractiveList`/`SendInteractiveButtons`/`SendImage`/`SendDocument`/`SendTemplate`/
`SendText` calls, degrading to numbered text when Meta's own limits are exceeded (>10 list rows,
>3 buttons), and parses inbound WhatsApp webhook JSON into `channel.InboundMessage`, resolving a
customer's typed numeric reply back onto the button/row it degraded from.

This one **is** wired at runtime: `backend/cmd/server/main.go` builds
`waChannel := channelwhatsapp.New(wa)` and hands it to `chatbot.NewWithMapbox(pool, waChannel,
mbClient)`; `chatbot.Service` holds it as a `channel.Channel` and sends every reply through
`s.ch.Send(...)`, not through the raw Meta client directly. `internal/channel/fake.Channel` is a
test double (records instead of delivering) that currently has zero importers anywhere in the
repo, including tests — it exists for a test that hasn't been written yet.

**To add another channel** (e.g. SMS, Telegram, a hosted DMTAP gateway per `ROADMAP.md`'s Stage
3): implement `Channel` (and `Inbound` if the rail can receive), construct it in `main.go`
alongside the WhatsApp client, and hand it to whatever service needs to send through it — the
service-layer code (`chatbot.Service`) is already written against the interface, not against
WhatsApp specifically.

## Migrations

`backend/migrations/` holds exactly four files, numbered `NNN_name.sql`:

| File | Lines | What it is |
|---|---|---|
| `001_baseline.sql` | ~7000 | A **folded** replacement for a 55-file pre-consolidation history — reproduces that history's schema (146 tables) byte-for-byte. Don't hand-edit it; it's the historical record. |
| `002_sync.sql` | ~190 | `sync_ops`, `sync_peers`, `sync_nonces` and their RLS policies. |
| `003_webhook_secret_misnomer.sql` | ~50 | Pure `COMMENT ON COLUMN` — no schema change — documenting that `webhook_endpoints.signing_secret_ciphertext` held plaintext until encryption was added (see [api.md](api.md#webhooks--registered-delivered-never-triggered)). |
| `004_sync_ops_content_address.sql` | ~160 | Content-addressed IDs for `sync_ops`. |

**The runner** (`backend/cmd/migrate`): files are matched by `^(\d{3,})_([a-z0-9_]+)\.sql$`;
subdirectories (e.g. a `legacy/` archive of the pre-fold history) are skipped entirely and must
never be re-applied. Applied migrations are tracked in a `schema_migrations` table (`version`
primary key, `applied_at`). `--up` runs every unapplied file, each inside its own transaction
(SQL + ledger insert together, so a partial failure leaves no ledger row). `--down` is fully
destructive (`DROP SCHEMA public CASCADE`, no re-apply). `--reset` is `--down` then `--up`.

```bash
cd backend && go run ./cmd/migrate --env=local --up
```

**`scripts/migrate.sh`** wraps the same runner with friendlier subcommands: `up` (default),
`reset`, `down`, `status` (queries `schema_migrations` directly via `psql` — not a runner flag).
`reset`/`down` require typing the environment name back at a confirmation prompt before running.

**`scripts/verify-fold.sh`** proves `001_baseline.sql` is schema-identical to the 55-file chain it
replaced — not a general migration-idempotency check. It recovers the pre-fold files from git
history (`PREFOLD_REF`, default `c737e0f^`), applies the old chain and the new baseline to two
throwaway `postgres:16` Docker containers, `pg_dump --schema-only` both, and diffs. Requires
Docker; run it after touching `001_baseline.sql` (which should be never).

**Adding a migration:**

```bash
ls backend/migrations/                    # find the next number
touch backend/migrations/005_my_feature.sql
# write SQL: CREATE TABLE ... then immediately ENABLE/FORCE ROW LEVEL SECURITY + CREATE POLICY
cd backend && go run ./cmd/migrate --env=local --up
```

Then add the new table to `internal/sync/ownership/tables.go` and, if it should be reachable via
the generic REST layer, to `internal/handlers/data/allowlist.go` — see
[Row-level security](#row-level-security) above.

## Adding a backend endpoint

Concrete pattern, from `backend/internal/handlers/favorites` (2 files):

`store.go` — the data layer:

```go
type Store struct{ pool *pgxpool.Pool }

func NewStore(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

func (s *Store) List(ctx context.Context, customerID string) ([]Favorite, error) {
    var out []Favorite
    err := db.Scoped(ctx, s.pool, db.ScopeFromContext(ctx), func(tx pgx.Tx) error {
        rows, err := tx.Query(ctx, `SELECT ... FROM favorites WHERE customer_id = $1`, customerID)
        // ...
        return err
    })
    return out, err
}
```

`handler.go` — HTTP:

```go
type Handler struct{ store *Store }

func NewHandler(pool *pgxpool.Pool) *Handler { return &Handler{store: NewStore(pool)} }

func (h *Handler) Mount(r chi.Router) {
    // full paths, not r.Route(...), to avoid chi Mount collisions with sibling handlers
    r.Get("/customers/{customer_id}/favorites", h.list)
    r.Post("/customers/{customer_id}/favorites", h.add)
    r.Delete("/customers/{customer_id}/favorites/{item_id}", h.remove)
}
```

Wire it in `backend/cmd/server/main.go`:

```go
favoritesH := favorites.NewHandler(database.Pool)
// ...
favoritesH.Mount(r)   // inside the RequireOrgScope group
```

Every method: parse chi URL params → call the store → map sentinel errors (e.g.
`ErrCustomerNotFound`) to HTTP status codes → write JSON. Every store method wraps its query in
`db.Scoped` — this is what makes RLS apply; a raw `pool.Query` outside `db.Scoped` bypasses
tenant scoping entirely and should be treated as a bug. If the endpoint writes to a table that
needs idempotent retry (like `orders`), see `idempotency.Middleware` in
`backend/internal/idempotency` — applied via `r.With(idempotency.Middleware(pool, "scope-name"))`
on the specific route.

## Adding a frontend page

1. Create the component under `src/pages/...`.
2. Add a lazy import near the relevant section of `src/routes.jsx`:
   ```js
   const MyPage = lazyImport(() => import('./pages/my-page'));
   ```
3. Add a `<Route>` inside the correct layout group — `BlankLayout` (chrome-less: POS, KDS, public
   storefront) or `MainLayout` (chrome'd: dashboard, settings, reports). Wrap in `<Protected>` if
   it needs an authenticated session.
4. Optionally extend `getLoadingMessage(pathname)` for a route-specific loading string.
5. If it calls the backend, add a function to the relevant file in `src/services/` — the
   established pattern is a thin export that calls `api.request(method, path, opts)` from
   `src/lib/api-client.js` and returns its `{ data, error }` shape directly, e.g.:
   ```js
   // src/services/customers.js
   export async function searchCustomers(q, limit = 20) {
     const params = new URLSearchParams({ q, limit });
     return api.request('GET', `/customers/search?${params}`);
   }
   ```
   Pass `{ auth: false }` for public/token-scoped endpoints (see `src/services/tracking.js`,
   which calls the public `/track/:token` route).
6. Add any new UI copy to `src/i18n/locales/en.json` first, following the existing
   `<namespace>.<section>.<key>` convention (e.g. `nav.topBar.home`), then mirror the key into the
   other 8 locale files under `src/i18n/locales/` (`af`, `zu`, `xh`, `pt`, `fr`, `es`, `ar`, `hi`).
   There is no automated key-sync check today — a missing key in a non-`en` locale falls back to
   `en` at runtime, silently. Call it via `useTranslation()`: `const { t } = useTranslation(); t('nav.topBar.home')`.
7. Style with Tailwind utilities against the design tokens already defined, rather than inventing
   new colors:
   - `tailwind.config.js` maps shadcn-style semantic tokens (`background`, `foreground`, `card`,
     `primary`, `secondary`, `muted`, `accent`, `destructive`, `warning`, `success`, `border`,
     `chart.1`–`chart.5`) to `hsl(var(--...))`, plus a project-specific `beepbite.*` color group
     (`orange`, `orange-soft`, `text-primary/secondary/tertiary`, `background-light`,
     `background-cream`, …) and font families (`Archivo Variable` for `sans`/`display`,
     `JetBrains Mono Variable` for `mono`).
   - `src/index.css` defines the actual HSL values under `:root` (light) and `.dark` (dark theme —
     also the KDS palette), plus utility classes for mobile layout (`.mobile-*`), destructive
     actions (`.hazard-stripe`, `.ticket-perforation`), and offline/sync status
     (`.sync-pill-offline/syncing/ok/error`, used by `src/components/ui/sync-status.jsx`).

**A note on `src/offline/`.** It holds four small modules: `idempotency.js`, `queue.js`,
`sse-cursor.js`, `ulid.js`. Only `queue.js` is live — it's imported by
`src/components/ui/sync-status.jsx`, which is mounted in the nav bar (`top-bar.jsx`) and as an
offline banner on the POS workspace, Quick POS, driver, and kitchen-work pages. `idempotency.js`
and `ulid.js` are exercised only by their own unit tests, not by any app code. `sse-cursor.js` has
no importers anywhere, including tests — it's dead code. Don't assume anything in this directory
is wired in just because a sibling file is.

## Build tags

**`patala`** gates BeepBite's online-payment-gateway integration (Stripe, Paystack, Yoco, PayFast,
and others, via a Rust-backed cgo binding). It is **off by default**: `backend/internal/payments/
gateway_default.go` (`//go:build !patala`) is what a normal build links, and its provider
constructor always returns nil — no online gateway, checkout stays on-delivery-only. The
patala-tagged implementation (`gateway_patala.go`, `patala_gateway.go`, both `//go:build patala`)
requires `CGO_ENABLED=1` and a sibling `patala` checkout; build it with
`make build-patala` (`backend/Makefile`), never as part of the default `make build`. See
[ONLINE-PAYMENTS.md](ONLINE-PAYMENTS.md) — its integration tests currently fail against a
pre-existing "store not found" issue unrelated to gateway logic, so treat the whole path as
unproven until both are green, per that document's own warning banner.

**`CGO_ENABLED=0`** is the default everywhere that matters: `backend/Dockerfile` builds the
shipped image with it (final stage is `distroless/static`, which has no libc to link against
anyway), and `.github/workflows/release.yml` sets it explicitly for release builds. This produces
a single static binary with no C toolchain dependency. Only `make build-patala`/`test-patala`
flip `CGO_ENABLED=1`, and only because linking the Rust-backed patala library requires cgo.

## Testing

```bash
# Frontend unit tests (Vitest, jsdom, src/__tests__/**/*.test.{js,jsx})
npm run test:unit

# Frontend E2E (Playwright, tests-e2e/**/*.spec.js) — disabled in CI today (see below),
# runs locally against `npm run dev`
npm run test:e2e

# Go tests (all packages)
cd backend && go test ./...

# One representative merge-under-partition suite, by name
cd backend && go test ./internal/sync/opsink/ -run 'TestConcurrent|TestTwoSales|TestOrderNumbers|TestHealed|TestConverged' -v

# The RLS behavioral probe suite (writes docs/pentest/rls-foundation.md)
cd backend && go run ./cmd/tests/rls

# The wider HTTP smoke suite against a running server
cd backend && go run ./cmd/tests --all
```

**`scripts/verify.sh`** is a standalone, dependency-free (`curl` + `sha256sum`/`shasum` only)
release-artifact verifier — the template end users copy to check a downloaded binary against a
`SHA256SUMS` manifest before executing it. No `--skip-verify` escape hatch. `--selftest` runs a
failure-matrix mode used by CI's `verify-script` job.

**`scripts/smoke.mjs`** is a headless Playwright harness against the *built* React app: it signs
in by injecting a signin response into `localStorage`, then visits a curated list of routes
(landing, home, reports, menu, staff, floor, cash, …), recording console errors, page errors,
failed network calls, and a screenshot per route into a JSON report. Run it with
`node scripts/smoke.mjs` (configurable via `BASE`/`AUTH`/`OUT` env vars) — it isn't wrapped by an
npm script.

### CI gates (`.github/workflows/test.yml`)

| Job | What it does |
|---|---|
| `go-build` | `go build ./...`, `gofmt -l` (fails on unformatted files), `go vet ./...`, `go test ./...`, the named merge-suite run above, `TestRegistryCoversTheSchema`, then migrates a real Postgres 16 service container, provisions a non-superuser app role (`cmd/setupapprole`), starts the server under that role, and runs `go run ./cmd/tests --all` against it. |
| `sync-vectors` | Checks out the pinned `vul-os/kotva` version, runs `TestFrozenSyncVectors` with `BEEPBITE_REQUIRE_SYNC_VECTORS=1`, and asserts the log shows all 24 vectors drove clean. |
| `frontend` | `npm ci` → **`npm run docs:check`** (see below — hard gate) → `npm run lint` (advisory, `continue-on-error: true`) → `npm run build` → `npm run test:unit`. |
| `verify-script` | Lints `scripts/verify.sh` (`bash -n`, ShellCheck) and runs its `--selftest` failure matrix. |
| `e2e` | Commented out entirely — Playwright's bundled Chromium doesn't run on the `ubuntu-latest` image GitHub currently ships. Run `npm run test:e2e` locally instead. |

> [!IMPORTANT]
> `npm run docs:check` (`node scripts/sync-docs.mjs --check`) is a **hard, non-optional** gate in
> the `frontend` job — unlike ESLint, it has no `continue-on-error`. It fails if `docs/*.md` was
> edited without re-running `npm run docs:sync` to update the `site/docs/` mirror, or if a
> published doc isn't linked from `site/docs.html`'s `DOCS` array. **Never hand-edit `site/docs/`**
> — it's generated. After changing anything under `docs/`, run `npm run docs:sync` before
> committing.

## Scripts reference

| Script | What it does |
|---|---|
| `scripts/gen-notices.sh` | Regenerates `THIRD-PARTY-NOTICES.txt` from the real Go module graph and npm dependency tree (plus vendored assets), copying the result to `site/licenses.txt`. Output is committed, not hand-maintained. |
| `scripts/migrate.sh` | Wrapper around `backend/cmd/migrate` (`up`/`reset`/`down`/`status`); destructive actions require confirming the environment name interactively. |
| `scripts/seed-tables.sh` | Idempotently seeds a "Main Floor" section and dine-in tables for a given `location_id`, so the POS table picker isn't empty on a fresh location. |
| `scripts/screenshots.mjs` | Playwright screenshot generator for docs/README: stands up a throwaway Postgres container, migrates, seeds "The Copper Table" demo tenant (`cmd/seedcopper`), starts the real server and Vite dev server, signs in through the real `/signin` form, and captures light/dark screenshots into `docs/screenshots/` (mirrored to `public/docs/` and `site/screenshots/`). Requires Docker. |
| `scripts/smoke.mjs` | Headless route-by-route smoke test against the running frontend; see Testing above. |
| `scripts/status.sh` | Project health dashboard (`--build` for a fuller check) — schema/migration state and other signals, colored PASS/FAIL/WARN output. |
| `scripts/sync-docs.mjs` | Copies `docs/*.md` (+ `CHANGELOG.md`, `ROADMAP.md`, `CONTRIBUTING.md`, `SECURITY.md`) into `site/docs/`, removing stale copies and cross-checking `site/docs.html`'s link list. `--check` is what CI's `docs:check` runs; `--quiet` suppresses per-file logging. |
| `scripts/verify-fold.sh` | Proves `001_baseline.sql` is schema-identical to the pre-fold 55-file migration chain it replaced (see Migrations above). |
| `scripts/verify-sync-rls.sh` | Proves `sync_ops`' RLS properties against a real non-superuser tenant role: append-only, no cross-org read, no cross-org write — run as a throwaway Docker Postgres. |
| `scripts/verify.sh` | Standalone release-artifact verifier template for end users; see Testing above. |

## Code conventions

- Functional React components with hooks only.
- Tailwind utility classes against the design tokens above; no custom CSS unless necessary.
- Absolute imports via `@/` alias (e.g. `import { Button } from '@/components/ui/button'`).
- Money is stored as integer cents (`bigint`). Format with `Intl.NumberFormat`.
- Go: every query that touches a tenant-scoped table goes through `db.Scoped` (or
  `Emitter.Scoped`, which wraps it) — never a bare `pool.Query`/`pool.Exec` on request-path code.
- SQL identifiers (table/column names) that come from user input are always validated against a
  strict `^[a-z_][a-z0-9_]*$` pattern and quoted, never string-interpolated; values are always
  positional `$N` parameters. This is the pattern the generic data layer uses and any new
  generic-shaped endpoint should match it.
- A new tenant-scoped table gets its RLS policies in the same migration it's created in, and an
  `internal/sync/ownership` registry entry in the same PR — see Row-level security above.

## Linting

```bash
npm run lint          # ESLint check (advisory in CI — see CI gates above)
npm run lint:fix      # auto-fix
```

Do not suppress pre-existing lint warnings with `// eslint-disable` unless you understand them —
many are load-bearing. Go code is checked with `gofmt -l` and `go vet` in CI, both blocking.

## Branch strategy

- `main` — production-ready
- `hardening/*` — active hardening/feature branches
- `feature/*` — new features

PRs target `main`. CI runs the jobs listed under [CI gates](#ci-gates-githubworkflowstestyml) on
every push.

## Further reading

- [Setup guide](setup.md) — first-run walkthrough
- [API](api.md) — the HTTP surface, including the generic data layer's full query grammar
- [Troubleshooting](troubleshooting.md) — common local dev issues
- [ROADMAP.md](../ROADMAP.md) — what's built vs what's pending, including the full DMTAP staged
  adoption plan referenced above
