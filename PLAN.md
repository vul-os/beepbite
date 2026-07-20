# BeepBite — standalone, decentralized rebuild

Working plan. Supersedes `ROADMAP.md` and `ROADMAP-andile.md` on direction;
those remain useful as a domain spec for POS behaviour.

## 1. What BeepBite becomes

A **free, open-source, self-run point-of-sale and delivery-dispatch system**.
One static Go binary, one SQLite file, no cloud account, no subscription, no
external services. Runs on a R3,000 Android tablet, a laptop, a NAS or a Pi.

The shape is FlowStock's: leaderless multi-node sync, manual peer enrollment,
mutual Ed25519 auth, offline-first, `site/` landing + docs embedded in the
binary. Nothing phones home.

Positioning: **you run it.** There is no hosted BeepBite, no rake, no
facilitator. The only optional paid service in the ecosystem is Vulos Relay,
and it is never required.

## 2. Stack

| Layer | Choice | Note |
|---|---|---|
| Language | Go 1.25 | House language; existing backend is Go |
| Database | `modernc.org/sqlite` | Pure Go, no cgo, single static binary |
| Sync (default) | Hand-rolled HLC oplog | FlowStock's engine, ported |
| Sync (opt-in) | DMTAP-SYNC via wazero | Behind `store.Merger`, off by default |
| Frontend | React 19 + Vite + Tailwind + shadcn | Keep; it works |
| Maps | MapLibre + Protomaps + GeoLite2 | Replaces Mapbox; offline-capable tiles |
| Real-time | SSE (existing broadcasters) | In-process is correct per-branch |
| Docs/landing | `site/` — hand-written, marked + mermaid | wede pattern, no build step |

Rust was considered and rejected: `envoir/bindings/go` embeds the Rust core as
WASM under wazero with **no cgo**, so Go keeps the single-binary property while
still reaching DMTAP-SYNC. Rust would cost the house language and buy nothing.

## 3. Deletions

Removing the payment-facilitator business and all cloud tethers:

- `integrations/paystack/`, `integrations/stripe/`, `handlers/payments/yoco.go`
- `handlers/paymentwebhooks/`, `handlers/bankaccounts/`, `handlers/payoutshandler/`
- The 5-minute payout runner (`internal/payouts/`)
- Migrations 26–27: `regions`, central gateway env keys, `subscription_plans`,
  `merchant_payouts`, `payout_schedules`, `bank_accounts`
- `billingmodel/` (Python pricing simulation)
- `delivery_partners` (dead Uber Eats / DoorDash / Grubhub seed)
- Firebase hosting + analytics; `.firebaserc`, `firebase.json`, the hosting workflow
- Google OAuth, Resend
- Gemini menu creator (currently mislabelled `OPENAI_API_KEY`) → optional llmux
  or local model, off by default

Already done: `.claude/` and ~160 MB of committed Go binaries stripped from all
92 commits across 8 branches via `git filter-repo` (173 MB → 35 MB).

## 4. Payments

BeepBite **records tenders; it does not process cards.** Cash, card, transfer,
voucher recorded against the order and reconciled into the drawer at close. The
shop already has a card machine on the counter.

A `PaymentProvider` seam (`Charge` / `Refund` / `GetStatus`) is defined now with
exactly one implementation: manual tender. Real providers (Paystack, Stripe,
Xendit, Yoco) are BYO-key adapters added on demand.

**Poll-first, never webhooks.** Providers expose verify/fetch-transaction
endpoints; a POS charge is synchronous at the counter. Outbound-only polling
works behind CGNAT with no port forwarding, static IP, DNS, or any box operated
by us. Existing idempotency keys make this safe against double-charging.

Vulos Relay covers the residual async cases (overnight EFT settlement) if push
is ever wanted — documented honestly, since relay is content-visible L7 and
would see payload contents. It can never forge a webhook: signature
verification happens on the shop's node with the shop's own secret, and relay
holds no secrets.

Consequence: no PCI scope, no money-transmitter exposure.

## 5. Data model — authority by branch

The unit of authority is the **branch**. This is what makes the distributed
problem tractable.

**Branch-owned, single writer** — orders, order sequence numbers, cash drawer,
table state, shifts. No concurrent writers, so money and sequencing have no
conflicts at all. Order IDs namespaced by branch, allocated without coordination.

**Group-owned, single writer, replicated down** — menu, pricing, recipes,
promotions, staff roster, permissions.

**Append-only, union-merged** — stock movements, sales events, audit log, GPS
trails, earnings. Merged by `INSERT OR IGNORE`; quantities are `SUM(qty)` at
read time, **never a stored counter**.

That last rule is the answer to "two tills sold the last steak": concurrent
offline sales *add* rather than clobber, landing correctly at −2. Ported
directly from FlowStock, which has e2e coverage for concurrent offline receipt
convergence.

**Catalog rows** merge last-writer-wins on an `hlc` column. Deletes are soft
flags so they replicate.

## 6. Sync

- **HLC**: lexically-sortable `{unix_ms:013}-{counter:04x}-{node_id}`, seeded
  past the oplog max so a backwards wall clock can't mint stale timestamps.
- **Replication**: leaderless, stateless, symmetric rounds — push what the peer
  lacks, pull what we lack. Version vectors derived from the oplog, so no
  per-peer state and any node can transitively relay any other node's ops.
- **Discovery**: none. Deliberate manual enrollment — an operator types the
  other branch's URL into Settings → Sync.
- **Auth**: mutual Ed25519 over a canonical envelope (method + path + body hash
  + timestamp + nonce), ±5 min freshness, nonce replay cache. Shared secret is
  a TOFU pairing bootstrap only; fail-closed after enrollment. Revocation =
  delete the peer row.
- **Folder sync**: each node appends only its own `ops-<node_id>.jsonl` to a
  shared folder, so Dropbox / Syncthing / NAS / **USB stick** can be the
  transport with no write conflict possible. Load-shedding-friendly.
- **Compaction**: signed, checksummed snapshots; prune ops all peers have acked.

## 7. Dispatch — Thuma v0

Generic **work order** core, delivery as the only implemented profile.

A courier is an **Ed25519 keypair**, always. Staff drivers and independent
couriers are the same object with a different trust source, selected by a
`CourierTrust` seam:

| | Staff driver | Independent courier |
|---|---|---|
| Key | Enrolled by branch (TOFU) | Self-sovereign, 8-word key-name |
| Trust | Employment | Portable signed reputation |
| Assignment | Branch picks | Branch picks among bids |

Ship staff mode first; marketplace is an implementation of the interface, not a
rewrite.

| State | Mechanism | Why conflict-free |
|---|---|---|
| Job posted | Branch-owned | The branch that cooked it owns it |
| Bids | Insert-only union | Concurrent bids all survive |
| Assignment | Branch decides | Natural authority, no consensus |
| Job status | LWW keyed to assignee | Single writer once assigned |
| GPS trail | Append-only union | Already `driver_locations`' shape |
| Earnings | `SUM` over rows | Same trick as stock |

The contended decision — who gets the job — has a natural single authority:
whoever cooked the food decides who carries it. No consensus protocol, no
leader election, no distributed lock.

**Reputation is inverted.** Couriers do *not* publish their own reputation —
they control the feed and would omit bad jobs. Shops publish job outcomes on
the shop's own signed DMTAP-PUB feed (append-only, `seq`/`prev` hash-chained,
anti-rollback), and courier reputation is an aggregate over shop attestations.
Neither side can rewrite history.

Existing schema is reused as-is: `delivery_drivers`, `driver_locations`,
`driver_ratings`, `driver_earnings`, `order_details`, and the
`ready → out_for_delivery → delivered → completed` transitions.

**Greenfield work**: geo matching (DMTAP has no geo primitive at any layer),
push wake-up for sleeping courier phones, presence.

## 8. DMTAP integration

`VULOS-PRODUCT-STANDARD.md` forbids hard runtime dependencies on relay, control
plane or DMTAP. So:

- **Default**: hand-rolled HLC oplog. No DMTAP at runtime.
- **Opt-in**: DMTAP-SYNC behind `store.Merger`, chosen at boot, never mixed —
  the two engines cannot share a deployment because they don't share a total
  order (FlowStock ties on node id, the substrate on author public key).
- **DMTAP-PUB** for signed public menus and reputation feeds. Needs no mesh —
  plain HTTPS at `/.well-known/dmtap-pub/*`. Go implementation to lift from
  `vulos-relay/tunnel/pubcache/`.

Deliberately **not** depended on: MOTE messaging (pre-alpha, simulated
network), DMTAP-Auth (trusted-client half stubbed, so nobody can actually sign
in), Wake/push (not built anywhere conformant), mailbox role (unconfirmed).

## 9. Spec

`docs/THUMA.md` — v0, **no compatibility guarantee**, in-repo, written with RFC
rigor (numbered sections, MUST/SHOULD, explicit encodings, error codes) but
without a stability promise. Shaped like FlowStock's `SYNC.md`.

Three format decisions that make later expansion possible:

1. A **version/suite field** in every object.
2. **CBOR with integer keys** plus an explicit "ignore unknown keys" rule, and
   *reserved* forbidden keys so mistakes are detected rather than tolerated.
3. An **unknown-kind rule** — unimplemented kinds silently ignored, never
   acked, never rejected.

**`dispatch_vectors.json` matters more than the prose.** The parts of DMTAP
that actually work (SYNC, PUB) are exactly those with cross-language vector
suites; the part that is still pre-alpha has beautiful prose and no vectors. A
second implementor can build from vectors plus mediocre prose, never the
reverse.

Vocabulary aligned with [OpenCourier](https://arxiv.org/html/2511.02455v2) —
`deliveryId`, `pickupLocation`, `dropoffLocation`, `Quote`, `deliveryPolygon`,
and its `dispatched/accepted/picked-up/delivered` status enum — cited
explicitly. Not adopted wholesale: it is a position paper with no public repo,
no formal trust model, and an always-online federated-REST architecture that
cannot survive a café's LTE dropping.

Not an RFC, not a standards repo. Revisit promoting it to a DMTAP substrate
profile only when a real external implementor appears.

## 10. Security fixes required

- **RLS is off and tenant isolation depends on the frontend sending correct
  `organization_id` filters** to a generic CRUD endpoint. That is not
  isolation. Server-side scoping from the authenticated identity, always.
- Staff and member JWTs **share one signing secret**, disambiguated only by an
  `aud` claim. Split them.
- `/metrics` is unauthenticated.

## 11. Repo format

FlowStock skeleton — README, Makefile, Dockerfile (3-stage → distroless),
`install.sh`, `docs/`, `e2e/`, `third_party/*/VENDOR.md` — plus wede's `site/`
(hand-written `index.html` + `docs.html`, vendored marked + mermaid, hash
routing, image-path rewriting so the same markdown renders on GitHub and in the
viewer), `scripts/gen-notices.sh`, and `make check`.

`site/` embeds into the binary via the `site_embed.go` / `site_dev.go`
build-tag pair, mounted at `/site/`. Add a `cp docs/*.md site/docs/<slug>.md`
sync step — manual everywhere today, worth automating here.

Docs: `ARCHITECTURE.md`, `GETTING-STARTED.md`, `CONFIGURATION.md`,
`SCREENSHOTS.md`, `SYNC.md`, `THUMA.md`, `TESTING.md`.

MIT. `VERSION` + `CHANGELOG.md` (Keep a Changelog). Register in
`vulos-cloud/scripts/collect-product-sites.mjs`.

## 12. Order of work

1. Repo scaffold in house format; strip §3 deletions
2. SQLite store + HLC oplog + soft deletes + movement-log inventory
3. Port POS surfaces onto the new store; server-side tenant scoping
4. Sync engine — HTTP transport, Ed25519 auth, folder transport, compaction
5. Multi-branch: enrollment, group/branch authority split
6. `store.Merger` seam + DMTAP-SYNC opt-in
7. Thuma dispatch: work orders, bids, assignment, staff couriers
8. Geo — MapLibre/Protomaps, delivery polygons, proximity matching
9. `docs/THUMA.md` + `dispatch_vectors.json`
10. `site/` landing + docs; screenshots; notices
11. Marketplace couriers, DMTAP-PUB reputation — when wanted

## Open

- Confirm courier model. Plan assumes **staff-first, keypair from day one,
  marketplace behind the seam**.
- WhatsApp: keep as an optional adapter with the **shop's own** Meta
  credentials (BeepBite never holds them), QR/PWA ordering as the always-
  available default. It is the product's differentiator and an unavoidable Meta
  dependency — there is no decentralized substitute reaching the same
  customers.
- Whether `site/` ships now or after the POS works.
