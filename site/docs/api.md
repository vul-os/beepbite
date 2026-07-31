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

A missing, malformed, revoked, or expired key gets a `401` carrying the same
`{"error": "unauthorized"}` JSON body every other error path in this API
returns (`apiauth.writeUnauthorizedJSON`).

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
> on them as an access boundary yet. Note also that several scopes documented
> above as creatable (`read:customers`, `write:webhooks`, `write:items`,
> `read:inventory`, `write:inventory`) have no entry at all in
> `scopeCapabilities` — they map to zero capabilities, which currently makes
> no practical difference since capability checks are barely wired anyway.

## A worked example

Authenticate, read some orders, create one idempotently, and register (but
don't expect delivery of) a webhook. Assumes `bb_live_...` is a key with
`read:orders`/`write:orders` scopes, against a server at
`http://localhost:8080`.

**1. Query pending orders, newest first, five at a time:**

```bash
curl "http://localhost:8080/api/v1/data/orders?eq=status,pending&order=created_at.desc&limit=5" \
  -H "Authorization: Bearer bb_live_aB3kQr7mPxN2vY9wTd4sUcFoZeHiLj1R"
```

Returns a bare JSON array — no envelope:

```json
[
  {"id": "b1f...", "status": "pending", "total_cents": 4599, "created_at": "2026-07-30T18:04:11Z", ...},
  ...
]
```

**2. Create an order, safely retryable:**

```bash
curl -X POST "http://localhost:8080/api/v1/data/orders" \
  -H "Authorization: Bearer bb_live_aB3kQr7mPxN2vY9wTd4sUcFoZeHiLj1R" \
  -H "Idempotency-Key: 2b6b6f2e-2a68-4c2a-9a3e-2a1b6f0c9d11" \
  -H "Content-Type: application/json" \
  -d '{"customer_name": "J. Botha", "order_type": "pickup", "total_cents": 4599}'
```

`organization_id` is auto-injected from the key's org since it's omitted. If
your HTTP client retries this exact request (same `Idempotency-Key`, same
body) after a timeout, the retried call returns the **original** `201`
response instead of inserting a second order — see
[Idempotency keys](#idempotency-keys) below.

**3. Fetch a single order by id:**

```bash
curl "http://localhost:8080/api/v1/data/orders?eq=id,b1f...&single=true" \
  -H "Authorization: Bearer bb_live_..."
```

**4. Register a webhook for future order events** (JWT session, not the API
key — see [Webhooks](#webhooks--registered-delivered-never-triggered) for why
this step, today, changes nothing observable):

```bash
curl -X POST "http://localhost:8080/webhook-endpoints" \
  -H "Authorization: Bearer <your JWT>" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com/hook", "events": ["order.created", "order.paid"]}'
```

There is no step 5 where you "subscribe to changes" in the sense of a
long-lived stream or a webhook that actually fires — see the warning under
Webhooks. Polling the data endpoint with an `order=created_at.desc` filter and
your own high-water mark is, today, the only thing that actually works for
"tell me about new orders."

### Rate limiting

Flat and identical for every key — there is no tier to buy your way out of it:
**1000 requests/minute, burst 3000**, a token bucket per key
(`backend/internal/ratelimit`). Every response, success or failure, carries:

```http
X-RateLimit-Limit: 3000
X-RateLimit-Remaining: 2999
```

`X-RateLimit-Remaining` is `floor(tokens currently in the bucket)`, so it
decrements per request and refills continuously at `1000/min`, not in
discrete per-minute resets. A `429` additionally carries
`Retry-After: <seconds>` — computed as `int(60.0 / rate_per_min) + 1`, which
at the default 1000/min is always `Retry-After: 1` — and a JSON body
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
(`backend/internal/handlers/data/allowlist.go`, 98 tables/views); anything not
on the list returns `404 {"error": "table not exposed"}` (or `"insert not
allowed"` / `"update not allowed"` / `"delete not allowed"` for an operation a
listed table doesn't permit — some tables are read-only through this layer).
Relevant tables for integrations today include `orders`, `order_items`,
`order_payments`, `customers`, `items`, `categories`, `inventory_items`,
`suppliers`, `purchase_orders`, `gift_cards`, `reviews`, `staff`, and the six
read-only reporting views (`daily_sales_summary`, `hourly_sales_heatmap`,
`menu_engineering`, `labor_hours_daily`, `theoretical_vs_actual_cogs`,
`revenue_by_payment_method`). The allowlist file is the source of truth —
read it before assuming a table is reachable. See
[development.md](development.md#architecture-overview) for how this layer
compares to the hand-written handler packages the frontend also uses.

### Querying (`GET`)

Query parameters mirror the supabase-js shape the frontend was written
against:

| Param | Meaning |
|---|---|
| `select=col1,col2` | Columns to return. Default `*`. Each column must match `^[a-z_][a-z0-9_]*$` or the request is `400 "invalid select"`. |
| `eq=col,val` / `neq=` / `gt=` / `gte=` / `lt=` / `lte=` / `like=` / `ilike=` | Repeat per filter — all repeats, across all operators, are joined with `AND`. |
| `in=col,v1,v2,...` | `col::text = ANY(...)`. Requires at least one value after the column — `in=col` alone is rejected as `400 "invalid in filter"`. |
| `is=col,null` \| `not.null` \| `true` \| `false` | `IS` filter. Value is matched case-insensitively. |
| `or=col.op.val,col2.op2.val2` | One parenthesized `OR` group per `or=` param; supported sub-ops are `eq, neq, gt, gte, lt, lte, like, ilike, is`. Repeat `or=` for multiple independent OR groups, each AND-ed with everything else. |
| `order=col.asc` \| `col.desc` | Repeatable, applied in the order the params appear in the query string. Missing direction defaults to `asc`. |
| `limit=N` | Row cap. |
| `single=true` | Return one object, `404 "no rows"` if none, instead of an array. |

**Filtering examples:**

```http
# Two independent AND'd conditions
GET /api/v1/data/orders?eq=status,pending&gte=total_cents,1000

# IN
GET /api/v1/data/order_items?in=order_id,b1f...,c2a...,d3e...

# NULL check
GET /api/v1/data/customers?is=phone,not.null

# OR group: status is pending OR refunded
GET /api/v1/data/orders?or=status.eq.pending,status.eq.refunded

# Multi-column sort
GET /api/v1/data/orders?order=status.asc&order=created_at.desc
```

> [!WARNING]
> **Repeating `eq=` on the *same* column is an AND, not an OR — and it's
> almost always a mistake.** `?eq=status,pending&eq=status,paid` compiles to
> `status = $1 AND status = $2` with two different literals, which can never
> match a row. If you want "status is one of these," use `in=status,pending,paid`
> or an explicit `or=status.eq.pending,status.eq.paid` group — not repeated
> `eq=` on one column.

A raw query string containing a semicolon is rejected outright (`400 invalid
query string`) — a deliberate guard against filter-injection payloads, not a
bug.

Responses are the bare row data — a JSON array (or, with `single=true`, one
object). There is no `{"success": true, "data": {...}}` envelope, no
`total_count`/`has_more` pagination metadata, and no `count=exact` header
support despite what an older draft of this document claimed.

**Pagination.** There is no `offset=`/`page=` parameter and no cursor
mechanism — `limit=` is the *only* paging primitive, and it has no default (a
request with no `limit=` runs with no `LIMIT` clause at all, returning every
matching row) and no upper bound (any non-negative integer is accepted
verbatim). For anything beyond a single bounded pull, page yourself with
`order=` plus a `gt`/`lt` filter on the sort column — keyset pagination, not
offset:

```http
# first page
GET /api/v1/data/orders?order=created_at.desc&limit=50

# next page: use the last row's created_at from the previous response
GET /api/v1/data/orders?order=created_at.desc&lt=created_at,2026-07-30T18:04:11Z&limit=50
```

Always set `limit=` explicitly — a filter that unexpectedly matches your
entire `orders` table with no `limit=` will return your entire `orders`
table.

### Writing (`POST` / `PATCH` / `DELETE`)

`POST` accepts one object or an array of objects and returns the inserted
row(s) with `201`. Tables with an `organization_id` column
(`allTables`/`tablesWithOrgID` in the allowlist file — 16 tables, including
`orders`, `customers`, `locations`, `categories`, `suppliers`, `promotions`)
get it auto-injected from your key's organization if you omit it. In a batch
insert, the column set is the union of keys across all rows — a row missing a
column present on a sibling row gets `NULL` for it silently, not an error.

`PATCH` and `DELETE` require at least one `eq=`/filter query parameter — an
unfiltered mass update or delete is rejected with `400`, not silently scoped
to "everything." `PATCH` on `organizations` additionally rejects
`subscription_tier`, `subscription_plan_id`, `billing_status`, and
`trial_ends_at` in the body with `403` — billing state doesn't move through
this generic layer.

### Idempotency keys

Send `Idempotency-Key: <uuid>` on `POST` to `orders` or `order_payments` and a
retried request with the same key returns the original response instead of
re-inserting — this is the one place idempotency is wired into the public API
layer today (the JWT-session POS charge endpoint has its own, separate
idempotency scope; see [development.md](development.md)).

Mechanics (`backend/internal/idempotency`):

1. The middleware hashes `sha256(method + "\n" + path + "\n" + body)` and
   tries to insert a `(scope, key)` row with `status=in_progress`.
2. **First time seeing the key** → request runs normally. On a `2xx`
   response, the row is marked `completed` with the response status/body
   attached; on anything else, `failed` (so a failed attempt is never
   replayed as a success).
3. **Same key, same body, request already completed** → the stored response
   is replayed verbatim, with an added `X-Idempotency-Replayed: true` header.
   No handler code runs a second time.
4. **Same key, different body** → `422 {"error": "Idempotency-Key reused with
   different payload"}`.
5. **Same key, an earlier request is still in flight** (lock younger than 30
   seconds) → `409 {"error": "A request with this Idempotency-Key is already
   in progress"}`. Older than 30 seconds, the lock is assumed abandoned and
   taken over.
6. Rows are kept for **48 hours** (`expires_at`), though nothing currently
   sweeps expired rows — they simply stop matching new requests once your
   client stops sending the same key.

Pick a key per logical operation (e.g. a UUID generated once when the user
clicks "place order," reused only on retry of that exact click) — a fresh key
per HTTP attempt defeats the purpose.

### RPC

`POST /api/v1/rpc/{fn}` invokes one of a fixed set of Postgres functions —
nothing else, and there is no way to add one without a code change:

`check_invites`, `respond_invitation`, `send_invitation`, `cancel_invitation`,
`list_organization_invitations`, `calculate_recipe_cost`,
`update_recipe_metadata`, `lookup_customer_details`.

**How the allowlist works.** `allRPCs` (`allowlist.go`) is a plain string set
— membership is the only check, there's no per-function metadata there. The
actual SQL and argument mapping live in a hand-written `switch` in `buildRPC`
(`handler.go`): each case returns a fixed `SELECT * FROM fn($1, $2, ...)`
string plus an ordered list of JSON body keys to pull as positional args —
e.g. `respond_invitation` maps to `p_user_id, p_invite_id, p_accept` in that
exact order. A key missing from the request body becomes `nil` (SQL `NULL`)
rather than an error; the Postgres function does its own validation from
there. The function name itself is never interpolated from user input — it
only ever comes from the fixed `switch` — so there's no path from an
allowlisted-looking-but-wrong `{fn}` to arbitrary SQL execution. This
contract is pinned by `backend/internal/handlers/data/rpc_test.go`
(`TestBuildRPC_CoversAllowlistWithMatchingArity`, which fails if any
allowlisted name lacks a matching `switch` case or has a placeholder count
that doesn't match its arg list; `TestBuildRPC_UnknownFnErrors`, which checks
rejection of unknown names *and* injection attempts like
`"orders; DROP TABLE users"`).

If the result is exactly one row with exactly one column, the response is
that scalar value unwrapped (not an array/object); otherwise it's the full
array of row objects.

```bash
curl -X POST "http://localhost:8080/api/v1/rpc/calculate_recipe_cost" \
  -H "Authorization: Bearer bb_live_..." \
  -H "Content-Type: application/json" \
  -d '{"p_item_id": "9c7a..."}'
```

## Webhooks — registered, delivered, never triggered

`POST /webhook-endpoints` (JWT session only, owner/manager — **not** reachable
with an API key; there is no route for it under `/api/v1`) registers a URL and
a set of event types, and returns a signing secret **once**, in the 201
response body as `signing_secret`:

```json
{"url": "https://example.com/hook", "events": ["order.created", "order.paid"]}
```

`GET /webhook-endpoints` does **not** return it. The secret is encrypted at
rest (AES-256-GCM) and a tenant who loses it rotates the endpoint rather than
re-reading it. Until 2026-07 (fixed in commit `75c0261`, "bound the signature
in time, encrypt the secret at rest") the column held plaintext under the
name `signing_secret_ciphertext`, every list response handed the secret to
any authenticated org member, and the signature had no time bound at all — a
captured, valid signature verified forever, with no defense against replay.
See `backend/migrations/003_webhook_secret_misnomer.sql` for the misnomer
(the column name can't change post-migration, so it's just documented, and
the *value* is what got fixed) and `backend/cmd/encryptwebhooksecrets` for
converting a database written before the change (`--check` reports the
plaintext row count without converting; the default mode seals every
`whsec_`-prefixed row and refuses to exit clean if any remain plaintext
afterward).

Known event types: `order.created`, `order.paid`, `order.refunded`,
`item.created`, `item.updated`, `staff.invited`.

There's a real delivery pipeline behind this: a background runner
(`backend/internal/webhookdelivery`) takes a Postgres advisory lock (so only
one instance delivers at a time) and polls a `webhook_deliveries` table every
10 seconds, POSTs the payload with:

```http
X-BeepBite-Signature: t=<unix-seconds>,v1=<hex hmac-sha256 of "<t>.<delivery-id>.<body>">
X-BeepBite-Delivery: <delivery-id>
X-BeepBite-Event: <event-type>
```

— and retries up to **5 attempts total** before permanently marking a
delivery `failed`. A retry reuses the same `X-BeepBite-Delivery` id on
purpose, so a receiver can recognise it as a duplicate. (The retry pacing is
currently just "next 10-second tick," not true exponential backoff — the code
computes a backoff duration but doesn't yet gate on it, for lack of a
`next_attempt_at` column.)

**Verifying a webhook payload:**

1. Parse the header: `t=<unix>,v1=<hex>` — reject anything that doesn't match
   exactly this shape (no reordered fields, no extra params).
2. Recompute `hmac_sha256(secret, "<t>.<delivery-id>.<raw body>")` and compare
   to the `v1` value in **constant time**.
3. Reject if `|now - t|` exceeds 5 minutes, **in either direction** — a
   signature from the future is rejected exactly like a stale one, closing
   off "capture now, replay later once my clock check would otherwise pass."
4. Maintain your own cache of accepted `X-BeepBite-Delivery` ids and ignore
   ones you've already processed — `webhookdelivery.Verify` does steps 2–3 for
   you (`ErrSignatureMismatch`, `ErrTimestampSkew`) but deliberately leaves
   deduplication to you, since only you know how long your own processing
   pipeline needs a delivery id remembered.

```python
import hmac, hashlib, time

def verify(secret: str, delivery_id: str, body: bytes, header: str, max_skew=300) -> bool:
    t_str, v1 = None, None
    for part in header.split(","):
        k, _, v = part.partition("=")
        if k == "t": t_str = v
        if k == "v1": v1 = v
    if t_str is None or v1 is None:
        return False
    mac = hmac.new(secret.encode(), f"{t_str}.{delivery_id}.".encode() + body, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(mac, v1):
        return False
    return abs(time.time() - int(t_str)) <= max_skew
```

> [!WARNING]
> **Not built, despite the plumbing existing.** The only function that
> actually queues a delivery is `webhookdelivery.Emit(ctx, pool, orgID,
> eventType, payload)`. As of this writing, nothing in the codebase calls it —
> no order creation, no payment, no item change, no staff invite anywhere in
> `backend/internal/handlers` triggers an `Emit`. You can register an endpoint,
> the signing secret will be real, the delivery worker will run, and it will
> have nothing to deliver. This is a genuine gap, not a documented limitation
> someone chose — found while writing this doc, the same way README's `/track`
> bug was found while writing the screenshot tooling. If your integration
> needs to know about new orders today, poll `/api/v1/data/orders` (see the
> pagination note above) — don't build against webhooks yet.

## Errors

```json
{"error": "human-readable message"}
```

That's it — no `{"success": false, "error": {"code": ..., "details": ...}}`
envelope, no catalog of machine-readable error codes. HTTP status carries the
meaning: `400` bad input, `401` bad/missing credential, `403` capability or
role denied, `404` unknown resource or table not on the allowlist, `409`/`422`
idempotency conflicts, `429` rate limited, `500` something broke server-side.
Every path, including the API-key `401`, uses this one `{"error": "..."}`
shape — with one inconsistency worth knowing about: idempotency middleware
*infrastructure* failures (e.g. the DB check itself erroring) currently go
out via `http.Error`, which is plain text, not this JSON shape.

### Error catalogue (data + RPC endpoints)

| Status | Message | When |
|---|---|---|
| 400 | `invalid query string` | Raw query string contains a semicolon |
| 400 | `invalid select` | A `select=` column fails identifier validation |
| 400 | `invalid eq filter` / `invalid in filter` / `invalid is filter` / `invalid is value` / `invalid or term: ...` / `unsupported or operator: ...` | Malformed filter parameter |
| 400 | `invalid order` | Malformed `order=` clause |
| 400 | `invalid limit` | `limit=` isn't a non-negative integer |
| 400 | `empty body` | `POST`/`PATCH` body has zero rows / zero changed columns |
| 400 | `invalid column: <col>` | A `PATCH` SET column fails identifier validation |
| 400 | `update requires at least one filter` | `PATCH` with no `eq=`/filter |
| 400 | `delete requires at least one filter` | `DELETE` with no `eq=`/filter |
| 400 | `request could not be completed` | Any underlying DB error — deliberately generic; the real error is logged server-side only |
| 401 | `unauthorized` | Missing, malformed, revoked, or expired API key/JWT |
| 403 | `missing capability: can_view_reports` | `GET` on one of the six reporting views without that capability |
| 403 | `subscription tier cannot be changed via this endpoint` | `PATCH organizations` touching billing columns |
| 404 | `table not exposed` / `insert not allowed` / `update not allowed` / `delete not allowed` | Table not allowlisted, or allowlisted without that operation |
| 404 | `rpc not exposed` | `{fn}` not in `allRPCs` |
| 404 | `no rows` | `single=true` with zero matching rows |
| 409 | `A request with this Idempotency-Key is already in progress` | Idempotency lock held <30s |
| 422 | `Idempotency-Key reused with different payload` | Same key, different request hash |
| 429 | `rate limit exceeded` | Token bucket exhausted |

## Writing a client

There's no SDK (see below), but the surface is narrow enough that a client is
a small wrapper:

1. **Auth.** Store the API key; send it as `Authorization: Bearer <key>` on
   every request. There's no refresh flow for API keys — they don't expire on
   a timer the way JWTs do, only on manual revocation.
2. **Build one function per shape**, not one per resource: a `select(table,
   params)` that builds the query-string grammar above, an `insert(table,
   rows, { idempotencyKey })`, an `update(table, filters, changes)`, a
   `remove(table, filters)`, and an `rpc(fn, args)`. Every table you touch
   goes through the same four verbs — you're writing one client against one
   generic layer, not eight resource-specific ones.
3. **Always set `limit=`** on reads (see Pagination above) and page with
   `order=` + a `gt`/`lt` filter rather than assuming an offset exists.
4. **Retry writes with the same `Idempotency-Key`**, not a fresh one, so a
   network timeout followed by a client-side retry can't double-insert an
   order.
5. **Treat every error body as `{"error": string}`** — there's no error code
   to switch on, only the HTTP status plus that string for logs/humans.
6. **Don't build against webhooks** until `webhookdelivery.Emit` actually gets
   called from somewhere — poll instead.

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
