# API

There is no BeepBite API to call — there is only the one running on whatever
you deployed. This documents the HTTP surface of **your own instance**: what
you can reach with a browser session, what you can reach with an API key you
mint yourself, and — in README's tradition of saying what's actually true —
what the surface promises that the code doesn't yet keep.

> [!NOTE]
> This is the newest and least-exercised part of the backend (Wave 22). It has
> no dedicated Go test suite yet. Treat everything below as accurate-as-read,
> not load-tested.

## Base URL

Whatever you set it to. There is no `api.beepbite.com` — that would imply a
service BeepBite operates, and it doesn't. In development the Go server
listens on `http://localhost:8080` by default (`PORT` in `.env`); in
production it's wherever you point a reverse proxy at your own binary.

## Two different credentials, two different surfaces

BeepBite has one HTTP server with two ways to authenticate against it, and
they don't reach the same routes.

### 1. Session JWT — the app itself

`POST /auth/signin` (and `/auth/signup`, `/auth/refresh`, `/auth/signout`)
issue a short-lived access token + refresh token, the same credential the
bundled React frontend uses. Send it as `Authorization: Bearer <jwt>`. This is
what reaches almost everything: POS, KDS, inventory, staff, cash drawer, and
the rest of the routes mounted under the org-scoped group in
`backend/cmd/server/main.go`. It requires org membership
(`auth.RequireOrgScope`) and is not meant for third-party integrations — it's
how the product's own UI talks to its own backend, and it's large enough that
this document doesn't attempt to enumerate it route-by-route. Read
`backend/cmd/server/main.go` if you need the full list; every mount line is
commented with what it adds.

Staff PIN/username logins are a separate, parallel credential
(`POST /staff/login`, `/staff/pin-login`) sharing the same JWT signing secret,
disambiguated by an `aud` claim — see `backend/internal/staffauth`.

### 2. API keys — external integrations

This is the closest thing to a stable "public API," and it is intentionally
narrow: **one generic data endpoint and one RPC endpoint**, both scoped to
your own organization.

**Getting a key.** Log in to your own instance as an owner or manager, then:

```http
POST /api-keys
Authorization: Bearer <your JWT>
Content-Type: application/json

{"name": "till-export", "scopes": ["read:orders"], "environment": "live"}
```

Returns the key **once**, in plaintext:

```json
{
  "id": "...",
  "name": "till-export",
  "prefix_visible": "bb_live_aB3kQr7m",
  "environment": "live",
  "scopes": ["read:orders"],
  "key": "bb_live_aB3kQr7mPxN2vY9wTd4sUcFoZeHiLj1R"
}
```

Store it yourself — there is no dashboard hosted by anyone else, and BeepBite
never sees the plaintext again after this response. `GET /api-keys` lists your
org's keys (name, prefix, scopes, timestamps — never the secret).
`POST /api-keys/{id}/revoke` disables one. All three routes require a JWT
session with owner/manager role — an API key cannot manage other API keys.

Allowed scopes at creation time: `read:menu`, `write:menu`, `read:orders`,
`write:orders`, `read:reports`, `read:customers`, `write:webhooks`,
`write:items`, `read:staff`, `write:staff`, `read:inventory`,
`write:inventory`. Anything else is rejected with 400
(`backend/internal/handlers/apikeys/handler.go`).

**Using a key:**

```http
GET /api/v1/data/orders?eq=status,pending&limit=10
Authorization: Bearer bb_live_aB3kQr7mPxN2vY9wTd4sUcFoZeHiLj1R
```

A missing, malformed, revoked, or expired key gets a plain-text `401
unauthorized` (not a JSON body — `apiauth.RequireAPIKey` uses `http.Error`,
inconsistent with every other error path in this API, which returns
`{"error": "..."}`).

> [!IMPORTANT]
> **Scopes are not fully enforced yet.** The scope list above maps to
> capability flags (`backend/internal/apiauth/middleware.go`,
> `scopeCapabilities`), but the generic data endpoint below only checks a
> capability for the six reporting views (`can_view_reports`). Every other
> table's access control comes from row-level security — i.e. from which
> **organization** the key belongs to, not from which scopes you picked at
> creation time. In practice, today, any valid unrevoked key for your org can
> read and write any allowlisted table in that org, regardless of its declared
> scopes. Pick scopes for the audit trail and for future-proofing; don't rely
> on them as an access boundary yet.

### Rate limiting

Flat and identical for every key — there is no tier to buy your way out of it:
**1000 requests/minute, burst 3000**, a token bucket per key
(`backend/internal/ratelimit`). Response headers:

```http
X-RateLimit-Limit: 3000
X-RateLimit-Remaining: 2999
```

A 429 additionally carries `Retry-After: <seconds>` and a JSON body
`{"error": "rate limit exceeded"}`.

## The external data API

`/api/v1/*` is mounted once, in `backend/cmd/server/main.go`, wrapped only by
`apiauth.RequireAPIKey` and the rate limiter — it is the same generic
"PostgREST-like" layer the frontend itself uses internally
(`backend/internal/handlers/data`), not a set of bespoke `/orders`,
`/customers`, `/menu`, `/analytics`, `/reviews` or `/notifications` resources.
There are exactly two route shapes:

```http
GET    /api/v1/data/{table}
POST   /api/v1/data/{table}
PATCH  /api/v1/data/{table}
DELETE /api/v1/data/{table}
POST   /api/v1/rpc/{fn}
```

`{table}` and `{fn}` are checked against fixed allowlists
(`backend/internal/handlers/data/allowlist.go`); anything not on the list
returns `404 {"error": "table not exposed"}` (or `"insert not allowed"` /
`"update not allowed"` for an operation a listed table doesn't permit).
Relevant tables for integrations today include `orders`, `order_items`,
`order_payments`, `customers`, `items`, `categories`, `inventory_items`,
`suppliers`, `purchase_orders`, `gift_cards`, `reviews`, `staff`, and the six
read-only reporting views (`daily_sales_summary`, `hourly_sales_heatmap`,
`menu_engineering`, `labor_hours_daily`, `theoretical_vs_actual_cogs`,
`revenue_by_payment_method`). The allowlist file is the source of truth —
read it before assuming a table is reachable.

### Querying (`GET`)

Query parameters mirror the supabase-js shape the frontend was written
against:

| Param | Meaning |
|---|---|
| `select=col1,col2` | Columns to return. Default `*`. |
| `eq=col,val` / `neq=` / `gt=` / `gte=` / `lt=` / `lte=` / `like=` / `ilike=` | Repeat per filter. |
| `in=col,v1,v2,...` | `col IN (...)` |
| `is=col,null` \| `true` \| `false` | `IS` filter |
| `order=col.asc` \| `col.desc` | Repeat for multi-sort |
| `limit=N` | Row cap |
| `single=true` | Return one object, `404` if no rows, instead of an array |

A raw query string containing a semicolon is rejected outright (`400 invalid
query string`) — a deliberate guard against filter-injection payloads, not a
bug.

Responses are the bare row data — a JSON array (or, with `single=true`, one
object). There is no `{"success": true, "data": {...}}` envelope, no
`total_count`/`has_more` pagination metadata, and no `count=exact` header
support despite what an older draft of this document claimed.

### Writing (`POST` / `PATCH` / `DELETE`)

`POST` accepts one object or an array of objects and returns the inserted
row(s) with `201`. Tables with an `organization_id` column
(`allTables`/`tablesWithOrgID` in the allowlist file) get it auto-injected
from your key's organization if you omit it. `PATCH` and `DELETE` require at
least one `eq=`/filter query parameter — an unfiltered mass update or delete
is rejected with `400`, not silently scoped to "everything."

**Idempotency.** Send `Idempotency-Key: <uuid>` on `POST` to `orders` or
`order_payments` and a retried request with the same key returns the original
response instead of re-inserting — this is the one place idempotency is wired
into the API layer today. No other table gets this treatment.

### RPC

`POST /api/v1/rpc/{fn}` invokes one of a fixed set of Postgres functions —
nothing else, and there is no way to add one without a code change:

`check_invites`, `respond_invitation`, `send_invitation`, `cancel_invitation`,
`list_organization_invitations`, `calculate_recipe_cost`,
`update_recipe_metadata`, `lookup_customer_details`.

## Webhooks — registered, delivered, never triggered

`POST /webhook-endpoints` (JWT session only, owner/manager — **not** reachable
with an API key; there is no route for it under `/api/v1`) registers a URL and
a set of event types, and returns a signing secret in plaintext, every time
you `GET` it back:

```json
{"url": "https://example.com/hook", "events": ["order.created", "order.paid"]}
```

Known event types: `order.created`, `order.paid`, `order.refunded`,
`item.created`, `item.updated`, `staff.invited`.

There's a real delivery pipeline behind this: a background runner
(`backend/internal/webhookdelivery`) polls a `webhook_deliveries` table every
10 seconds, POSTs the payload with an `X-BeepBite-Signature` header —

```
X-BeepBite-Signature: t=<unix-seconds>,v1=<hex hmac-sha256 of "<t>.<body>">
```

— and retries up to 5 times with backoff on failure.

> [!WARNING]
> **Not built, despite the plumbing existing.** The only function that
> actually queues a delivery is `webhookdelivery.Emit(ctx, pool, orgID,
> eventType, payload)`. As of this writing, nothing in the codebase calls it —
> no order creation, no payment, no item change, no staff invite anywhere in
> `backend/internal/handlers` triggers an `Emit`. You can register an endpoint,
> the signing secret will be real, the delivery worker will run, and it will
> have nothing to deliver. This is a genuine gap, not a documented limitation
> someone chose — found while writing this doc, the same way README's `/track`
> bug was found while writing the screenshot tooling.

## Errors

```json
{"error": "human-readable message"}
```

That's it — no `{"success": false, "error": {"code": ..., "details": ...}}`
envelope, no catalog of machine-readable error codes. HTTP status carries the
meaning: `400` bad input, `401` bad/missing credential, `403` capability or
role denied, `404` unknown resource or table not on the allowlist, `429` rate
limited, `500` something broke server-side. The one exception is the 401 from
`apiauth.RequireAPIKey` itself, which is plain text (see above).

## What is not here

- No hosted dashboard, no signup flow, no `api.beepbite.com`, no staging
  environment, no sandbox with pre-loaded test data, no Postman collection.
- No official SDKs. There is no `@beepbite/api-client` on npm, no
  `beepbite-python` on PyPI, no `beepbite/php-sdk` on Packagist. If you want a
  client library, write one against the routes above, or generate one — there
  is no OpenAPI spec published yet either.
- No support channel, status page, or community forum operated by anyone,
  because there is no service behind this API to run one for.
- No "Starter / Professional / Enterprise" plans. One instance, one flat rate
  limit, one set of routes. Every deployment of BeepBite has the same API,
  because it's the same binary.
