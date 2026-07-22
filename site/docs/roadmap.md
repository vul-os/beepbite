# BeepBite — Product Roadmap

> **One restaurant, one instance, one owner.** BeepBite is a self-hosted point-of-sale: front of
> house, kitchen, inventory, delivery and however customers already order — a single Go binary and a
> React app running on the operator's own hardware. There is no BeepBite service to sign up for, no
> per-order fee, and no company between a shop and its customers. The only copy that exists is the
> one you run.

This document is the source of truth for **direction and sequencing**. It is written to be quotable:
every line under [Now](#now--committed) is a real, customer-visible promise, and nothing appears
there that the code does not already make reachable.

**Honesty conventions — these are load-bearing, not decoration.**

| Category | Means |
|---|---|
| **Shipped** | In the tree, wired into the running server, exercised by a test or verified by hand. Named precisely: "Built" and "Not built" are different words and are used differently. |
| **Broken / unverified** | Exists but does not work, or works but has never been run against the real thing. Stated with the defect, not softened. |
| **Now** | Committed. In the active backlog. Not "all in flight simultaneously". |
| **Later** | Deferred behind a named trigger. Not committed, not promised, not dated. |
| **Won't** | A deliberate non-goal. Absence is a design decision, not a gap. |
| **Open** | A founder decision that has not been made. Listed, never answered here, never invented. |

Sources of truth this document reconciles against: `README.md` (public status), `docs/internal/PLAN.md`
(architecture direction), `CHANGELOG.md`, `docs/internal/PROGRESS.md`, and — above all — the tree.
Where an internal doc and the tree disagree, **the tree wins** and the disagreement is recorded under
[Documentation drift](#documentation-drift).

---

## The product, in one screen

```
                       ┌───────────────────────────────────┐
   Customer orders ──▶ │   WhatsApp (shop's own Meta keys) │
   from wherever       │   QR at table / web storefront    │──┐
   they already are    │   the till itself                 │  │
                       └───────────────────────────────────┘  │
                                                              ▼
   ┌────────────────────────────────────────────────────────────────────────┐
   │  YOUR HARDWARE — laptop in the back office, machine in the cupboard,   │
   │  a VM you rent. Nothing phones home.                                    │
   │                                                                         │
   │   ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────┐ │
   │   │   POS    │  │   KDS    │  │  Floor   │  │Inventory │  │ Reports │ │
   │   └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬────┘ │
   │        └─────────────┴─────────────┴─────────────┴─────────────┘      │
   │                      one Go binary (chi · pgx · SSE)                   │
   │                                    │                                   │
   │                            ┌───────▼────────┐                          │
   │                            │  your database  │  ← RLS on from creation │
   │                            └────────────────┘                          │
   └────────────────────────────────────────────────────────────────────────┘
                                        │
                        driver app  ◀───┴───▶  customer tracking link

   Money never passes through BeepBite. Tenders are recorded; the card machine
   on your counter is still your card machine.
```

---

## Won't — the deliberate non-goals

These are not unbuilt. They are refused, and the refusal is the product.

- **No central marketplace.** BeepBite will not bring a shop customers. It stops a marketplace from
  owning the ones the shop already has. There is no BeepBite directory, no discovery service, no
  slug namespace anyone else administers.
- **No payment facilitation.** BeepBite records tenders — cash, card, transfer, voucher — against
  the order and reconciles them into the drawer at close. "Card" means the shop's own card machine.
  No PCI scope, no settlement delay, no cut. The Paystack / Stripe / Yoco facilitator integrations,
  merchant payouts, bank accounts and subscription billing were **removed**, not deferred
  (`CHANGELOG.md`, Unreleased → Removed).
- **No platform pricing.** No tiers, no wallet, no USD price list settled through an FX rate, no
  metered quotas. A self-hosted binary has nobody to bill.
- **No hosted service.** No signup, no dashboard anyone else operates, nobody to call.
- **No mandatory outbound dependency.** A fresh install makes no outbound network calls at all.
  WhatsApp, maps and any AI feature are each dark unless the operator supplies their own credentials.

---

## Shipped

Verified against the tree, not against a plan. Where a claim is narrower than it sounds, it is
narrowed here.

| Area | State |
|---|---|
| POS, KDS, floor plan, order lifecycle | **Built.** Full POS workspace (modifiers, courses, splits by seat and amount, void/comp/discount, split tender), Quick POS kiosk, KDS station + expo with per-station routing and a fan-out queue, live floor plan. Covered by integration suites. |
| Inventory, purchasing, recipes | **Built.** Suppliers, POs, goods receipts, 3-way invoice match, recursive recipe costing, waste, prep batches, the 86 list. |
| Cash & adjustments | **Built.** Drawer sessions, denomination counts, blind close, paid-in/out, void/comp/price-override/refund with reason codes and manager approval. |
| Engagement | **Built.** Promotions, coupons, gift cards, store credit, house accounts, loyalty (incl. stamps), reservations and waitlist. |
| Staff | **Built.** PIN actor-overlay on top of a member session, 5-strike / 15-minute lockout, per-member capability flags, time clock, tip pools, payroll export. |
| WhatsApp ordering | **Built** — direct Meta Cloud API integration using the **shop's own** credentials. Off entirely without them. |
| QR-at-table / web storefront | **Built.** Public store page, cart, checkout, order status. |
| Delivery, driver portal, tracking | **Built.** Zones with polygon lookup, driver assignments and shifts, location pings, public `/track/:token` page with a privacy-gated map. Less exercised than the POS. |
| Payments | **Tender recording only.** `internal/payments/manual.go` is the only `PaymentProvider` wired into the POS and checkout paths. |
| Currency, tax and locale neutrality | **Built.** Currency, tax convention, timezone, locale and dial code all resolve per location from configuration. No hardcoded ZAR/South-Africa defaults remain in application logic. |
| Row-level security | **Built.** Every tenant-scoped table carries RLS from creation; policies read `app.current_org_id` / `app.current_user_id` / `app.current_capabilities` set per request via `SET LOCAL`, with an explicit `OR is_service_role()` escape rather than a `BYPASSRLS` role. A `marketplace_role` can read only `is_marketplace_visible` rows. |
| Consolidated schema | **Built.** One forward-only `backend/migrations/001_baseline.sql` — 146 tables — folded from the 55-file history and verified byte-identical by a `pg_dump --schema-only` diff of "apply the old chain" against "apply the baseline". |
| Audit & idempotency | **Built.** Polymorphic-actor audit log carrying `organization_id` (so the owning tenant can actually see its own rows), idempotency keys on mutating POS routes. |
| Test bar | **Built.** ~20 Go suites under `backend/cmd/tests` including cross-tenant contamination, pen-test probes and RLS verification; CI runs build + vet + gofmt + `go test ./...` + the HTTP smoke suites against a real Postgres, plus the frontend build and Vitest. Playwright renders as a separate job. |
| Single distributable binary | **Built (Postgres-backed).** The release workflow builds the frontend, embeds it via `site_embed.go`, and cross-compiles one `beepbite` binary for linux/darwin × amd64/arm64, gated on the tag matching `VERSION`. |
| Screenshots | **Real.** Regenerated by `npm run screenshots` from a live seeded instance (`seedcopper`), never mocked. |

### Foundation reset — consolidated schema + RLS (done, and why it was worth it)

This was the first thing done and it still holds. Two reasons, both unchanged:

1. **Defense in depth.** Handlers trust JWTs for identity; before this work, tenant isolation also
   depended on the frontend passing the right `organization_id` into a generic CRUD endpoint. That is
   not isolation. RLS makes the database refuse the leak even when the handler above it is wrong.
2. **Comprehensibility.** A chronological migration history is unreadable. One baseline that a
   contributor can read in an afternoon is worth more than an archaeological record of how it got
   there.

The fold was safe **only because BeepBite has no production database** — the baseline's own header
says so. That is a one-time licence. Every migration from here is forward-only and additive, and any
future consolidation has to reconcile rather than replace.

---

## Broken / unverified

A feature that silently does nothing is worse than one that says it isn't built.

1. **Online payments have never been run against a live processor.** The optional gateway path
   (verify-on-return, fail-closed) is unit- and integration-tested but **UNVERIFIED AGAINST LIVE** —
   `docs/ONLINE-PAYMENTS.md` says so itself. A real `checkout → pay → return → verify → confirm` round
   trip per processor is the outstanding work. Until then it cannot be promised to anyone.
2. **Offline is scaffolding, not a feature.** `src/offline/` has ULID generation, an idempotency
   helper, a mutation queue and an SSE cursor. Nothing in the app imports them — only the unit tests
   do. A network blip today loses what it always lost.
3. **No channel-adapter abstraction.** WhatsApp and web ordering are two direct integrations that
   happen to converge on the same order stream. "Channel-agnostic" is the intent and not yet the
   architecture; adding Discord, Slack or email today means writing a third bespoke integration.
4. **Postgres is required.** The single-binary property is real; the single-*file* property is not.
   There is no SQLite driver in `go.mod`, and no store abstraction to put one behind.
5. **Platform-era surfaces are still linked in.** `handlers/admin` (platform-admin gate),
   `handlers/customdomains` (Fly.io certificate issuance), `handlers/wanumbers` (central WhatsApp
   number pool) and the platform-issuer half of `handlers/invoicing` were built for a hosted product
   that no longer exists. They compile, they are mounted, and nothing in the current direction wants
   them. See [Open](#open--founder-decisions).

---

## Documentation drift

Recorded rather than quietly fixed, because a stale doc that nobody flags is how a roadmap rots.

- **`README.md` Status table understates `/track`.** It reports the flat-vs-nested payload mismatch as
  a live bug. It was fixed in `7739452` by `normalizeTracking()` in `src/services/tracking.js`, which
  also corrected the page's status vocabulary (`canceled` → `cancelled`) and replaced the hidden-div
  map fallback with a real empty state. The README line needs updating; this document does not own it.
- **`docs/internal/tasks.md` describes the platform era.** Its wave plan (central marketplace, wallet
  and quotas, USD billing via FX, platform admin, custom domains) is the direction this document
  replaces. It survives as a **domain spec for POS behaviour** and as the historical record of how the
  shipped surfaces were built. It is not a plan any more, and no task in it should be picked up
  without checking it against this file first.
- **`docs/internal/PROGRESS.md` "Not Started" list is wrong.** It lists waves as unstarted that are
  demonstrably in the tree and mounted in `cmd/server/main.go`. Its dated round-by-round log is
  accurate and useful; its checklist is not.
- **FX survived, but as something else.** `internal/fx` is an **off-by-default converter seam for
  consolidated multi-location reporting** — a three-currency operator wanting one set of books. It is
  not platform pricing, it makes no network call when disabled, and it never rewrites a stored amount.

---

## Now — committed

Ordered. Each item is a promise a shop owner would recognise, and each is reachable from the code
that exists today.

### Now-1 — Verify the optional online-payment path, or turn it off in the docs
A remote order placed over WhatsApp or the web storefront has no counter to pay at. The verify-on-return
seam solves that without the box being publicly reachable: the customer's browser carries the settlement
event back, and BeepBite does exactly one authoritative verify, fail-closed. What is missing is proof.
Run a live sandbox round trip per processor; until each one passes, the honest status stays UNVERIFIED
and the default build — which links no gateway code at all — remains the shipped default.

> *"Take payment for a delivery order without opening a port, and without us ever holding your money."*

### Now-2 — Wire the offline scaffolding into the app (Tier 1)
Client-generated ULIDs, an `Idempotency-Key` on every mutating POS call, an IndexedDB mutation queue
that drains on reconnect, a service worker caching the app shell and the menu snapshot, and the KDS SSE
`since_event_id` cursor so a reconnecting screen replays what it missed. The pieces exist; nothing uses
them. Tier 1 buys **30 seconds to two minutes** of outage tolerance with no behavioural compromise —
that is the whole claim, and it is not "offline POS".

> *"A dropped connection at the till costs you nothing. The order is already yours."*

### Now-3 — A real channel-adapter seam
One interface behind which WhatsApp, the web storefront and anything after them are plugins: inbound
message → order intent → the same order stream, outbound status → the channel that placed it. This is
the prerequisite for every "and also Discord / Slack / email" sentence anyone has ever written about
this product, including the DMTAP one below. Until it exists, those sentences are marketing.

> *"Customers order from wherever they already are — and adding a new 'wherever' is a plugin, not a rewrite."*

### Now-4 — SQLite behind a store seam, and the single-file install
Pure-Go `modernc.org/sqlite`, no cgo, so the binary stays static and the install stays "copy one file
and run it". Postgres remains supported and stays the tested path for anything multi-site. The work is
the seam first, the driver second; RLS has no SQLite equivalent, so the tenant-scoping guarantee has to
be re-proved above the database on that path — that is the hard part and it is not optional.

> *"One file to copy, one process to run, one file to back up."*

### Now-5 — Multi-branch sync: HLC oplog, manual peer enrollment
The unit of authority is the **branch**, which is what makes this tractable at all: orders, order
sequence numbers, the cash drawer, table state and shifts have exactly one writer, so money and
sequencing have no conflicts to resolve. Menu, pricing and staff are group-owned and replicated down.
Stock movements, sales events, audit rows, GPS trails and earnings are append-only and union-merged —
quantities are `SUM(qty)` at read time, **never a stored counter**, which is the answer to "two tills
sold the last steak": concurrent offline sales add rather than clobber and land correctly at −2.

Transport is symmetric, stateless push/pull rounds with version vectors derived from the oplog;
discovery is deliberately manual (an operator types the other branch's URL into Settings → Sync);
auth is mutual Ed25519 over a canonical envelope with a nonce replay cache, TOFU only at pairing and
fail-closed after. A shared folder — Dropbox, Syncthing, a NAS, a USB stick — is a supported transport,
because each node appends only its own `ops-<node_id>.jsonl` and no write conflict is possible.

> *"Two branches, one menu, no server in the middle — and a USB stick works when the line is down."*

### Now-6 — Dispatch (Thuma v0): work orders, bids, assignment
A generic work-order core with delivery as the only implemented profile. A courier is an Ed25519
keypair from day one; staff drivers and independent couriers are the same object with a different trust
source behind a `CourierTrust` seam, so shipping staff mode first does not require a rewrite later. Job
posted is branch-owned, bids are insert-only union, assignment is the branch's decision, job status is
last-writer-wins keyed to the assignee, GPS is append-only, earnings are a `SUM`. **The contended
decision has a natural single authority: whoever cooked the food decides who carries it.** No consensus
protocol, no leader election, no distributed lock.

> *"Your drivers, your dispatch, your rules — no platform taking a cut of the delivery."*

### Now-7 — `docs/THUMA.md` + `dispatch_vectors.json`
An in-repo v0 spec with RFC rigour — numbered sections, MUST/SHOULD, explicit encodings, error codes —
and **no compatibility guarantee**. Three format decisions make later expansion possible: a
version/suite field in every object; CBOR with integer keys plus an explicit ignore-unknown-keys rule
and *reserved* forbidden keys so mistakes are detected rather than tolerated; and an unknown-kind rule
(unimplemented kinds are silently ignored, never acked, never rejected).

The vectors matter more than the prose. A second implementor can build from vectors plus mediocre prose
and never the reverse — which is exactly the lesson the DMTAP section below is built on.

### Now-8 — Hold the security bar that already exists
Not a feature; a standing commitment. Cross-tenant contamination, auth and session adversarial probes,
injection and abuse suites stay green, and every new tenant-scoped table is RLS-enabled at creation,
never after. The bar: every adversarial probe is 403, 404 or a hard 400 — never a 200 leak.

> *"The database itself refuses to leak. Even a buggy handler cannot show one shop's data to another."*

---

## Later — deferred behind triggers

Not committed. Each gets pulled into Now when its trigger fires.

| Item | Trigger |
|---|---|
| **Offline Tier 2** — true offline POS with conflict resolution on reconnect | Tier 1 is solid in production and an operator hits a multi-hour outage |
| **Geo matching** — MapLibre + Protomaps offline tiles, delivery polygons, proximity dispatch | Dispatch (Now-6) is in real use with more than a handful of couriers |
| **Independent-courier marketplace** behind the `CourierTrust` seam from Now-6 | A shop asks to dispatch to couriers it does not employ |
| **Additional ordering channels** (Discord, Slack, email) | The channel seam (Now-3) exists **and** a real operator asks for a specific one |
| **DMTAP adoption** | See the staged plan below — each stage carries its own precondition |
| **Native shell** (Tauri / Capacitor) for guaranteed local persistence and native printing | An operator needs a tablet build that will not sleep, or Tier 2 needs the persistence guarantee |
| **Promoting `docs/THUMA.md` to a DMTAP substrate profile** | A real external implementor appears. Not before. |

---

## DMTAP — a staged, gated adoption plan

[DMTAP](https://github.com/vul-os/dmtap) is a decentralized message-transfer and identity protocol
whose five general capabilities form a **narrow waist** that non-mail products may adopt à la carte:
**① Identity**, **② Feeds & Blobs**, **③ Sync**, **④ Infrastructure Roles**, **⑤ Wake**. Two of its
adoption rules govern everything below:

> *A product MAY adopt any subset of the five capabilities* — there is no prerequisite bundle.
>
> *If a product implements a capability's function, it MUST speak that capability's spec.* A product
> that syncs structured state MUST use the Sync op algebra and wire protocol; it MUST NOT invent a
> parallel CRDT format and call it DMTAP-sync.

### What DMTAP does not buy us

Say this plainly, because the opposite is easy to imply and would be false.

**A point-of-sale has no consensus problem.** The trust model of the core POS is one business running
its own database in its own building. There is exactly one authority over an order, a drawer, a table
and a shift — the branch that owns it. Decentralization cannot improve a problem that does not exist,
and adopting a protocol to solve it would add a signing discipline, a wire format and a conformance
obligation in exchange for nothing.

DMTAP earns its keep on **inter-party** concerns, where two businesses that do not trust each other
need a shared fact:

- **Courier reputation across shops** — genuinely multi-party, genuinely unsolvable inside one
  database, and the one place a signed, append-only, hash-chained feed is the right primitive.
- **Ordering channels that route around Meta and Google** — a real dependency the product would rather
  not have.

Nothing else in BeepBite is inter-party. The roadmap will not promise decentralization value where
there is none.

### Verified status of the waist (checked, not assumed)

| Fact | Source |
|---|---|
| The conformance catalog has **352 numbered cases**, of which **62 are byte-runnable today** (56 vectored + 6 self-contained); 271 are construction recipes and 19 are manual attestations. | `dmtap/README.md`, `dmtap/conformance/README.md` |
| **No implementation has been run against the suite.** The conformance README says so in its own limits section: it "counts cases that exist, not cases that pass". | `dmtap/conformance/README.md` |
| **The `SYNC` family has 5 catalogued cases and *zero* are byte-runnable** — all five are `construction-todo`. | `conformance/suite.json` |
| `substrate/SYNC.md` is described by DMTAP's own README as **"the one new spec"** — the only waist capability that is not a profile of an existing RFC. | `dmtap/README.md`, `substrate/README.md` §1 |
| `sync_vectors.json` (24 frozen vectors) is an **informative companion**, generated by the spec repo's own script — explicitly *not* by the reference core crate, which does not implement Sync. A vector corpus agreeing with its own generator proves they match each other, not that the spec is right. | `conformance/README.md`, `sync_vectors.json` header |
| `SYNC.md` has taken **14 numbered normative corrections (C-01…C-14)**, several of them widening MUST-retain sets and one (C-10) added because a natural modelling choice caused *silent converged data loss*. Most were found by the first implementation and the first product adoption — i.e. by people building on it, not by review. | `substrate/SYNC.md` §14 |
| By contrast, the **`PUB` family (Feeds & Blobs, §22) has 12 vectored cases** — the largest vectored family in the suite — and a reference implementation (`kerf-pub`) that serves the `/.well-known/dmtap-pub/…` surface as static files behind an ordinary web server, proving it works over plain HTTPS with no mesh. | `conformance/suite.json`, `substrate/README.md` §4.2 |

**The conclusion this forces:** a pre-1.0 point-of-sale — the thing that decides whether a shop can
take money tonight — must not depend on the least-proven capability of the waist. Feeds are the
best-proven one and are additive. That ordering is the plan.

### Stage 0 (current, indefinite) — adopt nothing at runtime

**Scope.** BeepBite's default sync engine is the hand-rolled HLC oplog (Now-5). No DMTAP code is in
the tree today and none is required to be. Per `VULOS-PRODUCT-STANDARD.md`, no hard runtime dependency
on relay, control plane or DMTAP is permitted, and this stage honours that by having no dependency at all.

**The rule this stage must not break:** because BeepBite's oplog is *not* the Sync capability, it MUST
NOT be described as DMTAP-sync, in code, docs or landing copy. Adopting zero capabilities is
explicitly allowed by the waist ("a product that adopts zero waist capabilities is simply not a DMTAP
product"). Claiming a capability we do not speak is what is forbidden.

**Rollback path.** None needed — this is the baseline every later stage rolls back to.

### Stage 1 — Courier reputation over DMTAP-PUB (② Feeds & Blobs, + ① Identity floor)

The one adoption whose value is real, whose risk is contained, and which nothing existing depends on.

**Why this and not sync.** Reputation is **inverted** on purpose: couriers do not publish their own
reputation, because they control the feed and would omit the bad jobs. **Shops** publish job outcomes
on the shop's own signed append-only feed (`seq`/`prev` hash-chained, so history cannot be rewritten
and a rollback is detectable), and a courier's reputation is an *aggregate over shop attestations*.
Neither side can rewrite the record. That is a genuinely multi-party problem, and the primitive that
solves it is exactly what §22 specifies.

**Precondition.**
- Dispatch (Now-6) is in real use, so there are real job outcomes to attest to. Publishing an empty
  feed proves nothing.
- The feed is served over plain HTTPS at `/.well-known/dmtap-pub/*` — no mesh, no relay, no libp2p.
  This is already proven possible (`kerf-pub`), and if it stops being possible, the stage stops.
- A Go implementation exists to lift rather than invent: `vulos-relay/tunnel/pubcache/` already
  carries the content-addressing, Merkle and proof code.

**Scope.**
- A shop publishes a signed `FeedHead` / `FeedEntry` chain of job outcomes, using **§22's bytes** —
  `PubAnnounce`/`FeedHead`/`FeedEntry`, not a bespoke JSON feed. Rule 2 of the waist is not optional:
  implementing the function means speaking the spec.
- Courier identity is the Ed25519 keypair BeepBite already gives every courier, with the 8-word
  key-name floor as the zero-authority name. This is the ① Identity capability at its minimum, and it
  is a prerequisite: an attestation has to name a courier by key for it to be portable.
- Reading is opt-in per shop: a shop chooses whose attestations it weighs. **No global reputation
  score, no scoring service, no registry.**

**Abandon if.**
- §22's wire format changes under us in a way that breaks a published feed, or the `PUB` family's
  vectored coverage regresses.
- No second shop ever reads another shop's feed. A single-shop attestation feed is a private table
  with extra ceremony, and the plain table is better.
- Serving it starts to require the mesh. The HTTP test failing is the signal to stop.

**Rollback path.** Delete the feed publisher and the reader. Dispatch, assignment and payment are
untouched — the feed is additive by construction, and no POS path ever reads from it. Reputation
degrades to what it was before: whatever the shop recorded about its own couriers, in its own database.

### Stage 2 — DMTAP-SYNC as an opt-in alternative engine (③ Sync)

**Not a cutover. Not a default. Gated on evidence that does not exist yet.**

**Precondition — all of the following, testably:**

1. The `SYNC` conformance family is **byte-runnable**: its cases carry vectors rather than construction
   recipes, and those vectors are generated by something other than the document's own script.
2. **At least one implementation has actually been run against the suite and passed** — the suite's own
   limits section stops saying "no implementation has been run against the suite".
3. `SYNC.md`'s correction log has been **quiet for a full release cycle**. Fourteen normative
   corrections, several found only by first adopters and at least one guarding against *silent
   converged data loss*, is a spec still discovering itself. A POS is a bad place to discover the
   fifteenth.
4. **BeepBite's own multi-branch merge suite passes against the DMTAP engine under induced partition**,
   with byte-identical converged state versus the HLC oplog on the same op sequence — specifically:
   concurrent offline sales of the last unit converge to −2 (not −1); concurrent menu edits resolve
   identically on both engines; an order sequence never collides across branches; and a partition
   healed after N minutes produces the same drawer total as one that never partitioned.
5. Adopting it costs **no cgo**: `envoir/bindings/go` embeds the Rust core as WASM under wazero
   (verified: its `go.mod` requires `github.com/tetratelabs/wazero` and nothing else). The moment
   reaching DMTAP-SYNC requires cgo, the single static binary is gone and the price is too high.

**Scope.** A second implementation behind the `store.Merger` seam introduced with Now-5, chosen at boot.
The seam is a Now-5 deliverable, not something that exists today.

**The two engines are never mixed in one deployment.** They do not share a total order — the
hand-rolled engine breaks ties on node id, the substrate on author public key — so a deployment that
ran both would converge to two different states and call it success. One engine per deployment,
selected at startup, with the choice recorded in the oplog header so a peer speaking the other one is
refused rather than silently mis-merged.

**Abandon if.** Any precondition regresses; or the WASM path costs more than the correctness buys
(binary size, cold-start latency on a R3,000 tablet, memory on a Pi); or the merge suite diverges even
once in a way that is not a BeepBite bug.

**Rollback path.** The seam is the rollback: flip the boot flag back to the HLC engine and re-sync from
the oplog, which never stopped being the default and never stopped being written. This only works if
DMTAP-SYNC stays opt-in — which is precisely why it does.

### Stage 3 — Ordering over DMTAP mail — blocked, and honestly so

Email ordering, including over DMTAP, is the channel with no Meta and no Google in the middle. It is
also **not built, and doubly blocked**:

1. **There is no channel-adapter abstraction** (see Broken #3 and Now-3). WhatsApp and web ordering are
   each their own direct integration. Adding DMTAP ordering today means writing a third bespoke
   integration and then rewriting it when the seam lands. Now-3 is a hard prerequisite, not a nicety.
2. **Mail is a profile, not a waist capability.** Reaching a legacy inbox needs the mail spine (§2
   MOTE, §5 MLS, §7 gateway) plus a gateway role, which needs the only scarce resource in the whole
   design — a public IP with reverse DNS, unblocked outbound port 25 and a domain. A restaurant does
   not have that, and BeepBite must never require one it operates.

**Precondition.** Now-3 has shipped; Stage 1 has been running long enough to know what adopting DMTAP
bytes actually costs; and a DMTAP address is reachable by a real correspondent without BeepBite
running any infrastructure.

**Abandon if.** The channel seam shows that DMTAP ordering is a plugin nobody installs — this is a
channel of last resort by design, and no traffic is a legitimate answer, not a failure to fix.

**Rollback path.** Remove the adapter. Every other channel is unaffected, which is the entire point of
doing Now-3 first.

### Rules that hold across every stage

- **No capability is adopted silently.** Each is capability-negotiated and advertised; a peer that has
  not advertised one is never expected to serve it, and its silence is never a fault.
- **No silent degradation.** A security-relevant failure is refused or surfaced as an explicit choice —
  never a quiet fallback to an unauthenticated path.
- **DMTAP is never required at runtime.** Every stage above is off by default and removable, and a
  BeepBite that has never heard of DMTAP is a fully working BeepBite.

---

## How we sequence work

- Work lands in **parallel-safe batches**: tasks within a batch do not edit the same files.
- Each task names the files it may touch and the acceptance criteria a reviewer can check in under a
  minute.
- Migrations are forward-only and additive on top of `001_baseline.sql`. A batch that ships migrations
  declares its numbers up front.
- Adversarial testing is a roadmap-level commitment, not a chore: cross-tenant, auth/session,
  injection and abuse suites run in CI and gate merges.
- Nothing is described as shipped until it is mounted in `cmd/server/main.go` and something exercises
  it. "The package exists" is not shipped.

---

## What we promise — landing-page copy points

Each maps to a Shipped line or a Now item above. Nothing here is aspirational.

1. **You own it.** No signup, no account, no subscription, no per-order fee. The only copy that exists
   is the one you run.
2. **Nothing phones home.** A fresh install makes no outbound network calls at all. WhatsApp, maps and
   AI are each dark until you supply your own credentials.
3. **Your money stays yours.** BeepBite records what was tendered and never touches the money. Your
   card machine is still your card machine.
4. **Customers order from wherever they already are.** WhatsApp with your own Meta credentials, a QR
   code on the table, or your own web storefront — all into one order stream.
5. **The kitchen sees it instantly.** Per-station routing, an expo screen, fire timers, live over
   server-sent events — no message broker to operate.
6. **The database itself refuses to leak.** Row-level security is on from the first table, scoped
   server-side from the authenticated identity — never from a filter the client supplies.
7. **Every action has a name on it.** Every void, comp, refund and price override records who did it,
   tied to the staff member by PIN.
8. **It speaks your currency, your tax, your language.** Currency, tax convention, timezone and locale
   resolve per location from configuration.
9. **Your drivers, not a platform's.** Dispatch, a driver portal and a customer tracking link, with
   the privacy guardrails the big platforms forgot.
10. **One binary.** Build it, copy it, run it. The whole app is inside.

---

## Open — founder decisions

Listed, not answered. Nothing below is direction; each needs a decision before it can enter Now.

1. **Is one instance one business, or many?** The schema, RLS and every handler are multi-org.
   `docs/ONLINE-PAYMENTS.md` describes the deployment as "single-tenant-per-process". Both cannot be
   the shipped story, and the answer changes onboarding, the storefront and the whole isolation
   argument.
2. **What happens to the public store-directory endpoints?** `GET /stores` still supports search by
   name, city, country and geo radius across visible locations. On a single-shop instance that is a
   one-row directory; for a multi-branch operator it is a useful storefront index. It is not a
   marketplace, but its shape is left over from one.
3. **What happens to the platform-era surfaces?** `handlers/admin`, `handlers/customdomains` (Fly.io
   cert issuance), `handlers/wanumbers` (central WhatsApp number pool), and the platform-issuer half
   of `handlers/invoicing`. Keep, repurpose or delete — all three are defensible; leaving them mounted
   and undecided is not.
4. **Are the AI features v1 scope?** A four-provider LLM router, an owner assistant and menu import
   are in the tree, off without keys. They are compatible with "nothing phones home" only because they
   are dark by default. Whether they are part of the product or a research branch is undecided.
5. **Is optional online payment a supported feature or an experiment?** It is off by default and not
   even linked into the default build. Promoting it needs the live verification in Now-1 and a
   decision about whether shipped images ever link a gateway.
6. **WhatsApp's Meta dependency.** It is the product's strongest differentiator and an unavoidable
   dependency on a company the rest of this design routes around. There is no decentralized substitute
   that reaches the same customers. Keeping it is the working assumption; it has never been ratified.
7. **The courier model.** Everything above assumes staff-first, keypair from day one, marketplace
   behind the `CourierTrust` seam. That assumption has not been confirmed.
8. **Does `site/` ship now or after the sync work?** The landing and docs viewer embed into the binary
   today; whether they are part of the next tag is undecided.
