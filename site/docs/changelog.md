# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Removed
- Payment facilitator: Paystack, Stripe and Yoco integrations, payment
  webhooks, merchant payouts, bank accounts and subscription billing. BeepBite
  records tenders; it never touches your money.
- Firebase hosting and analytics, Google OAuth, Resend, and the Gemini-backed
  AI menu creator. A fresh install now makes no outbound network calls.
- The delivery-marketplace partner tables (Uber Eats, DoorDash, Grubhub).

### Added
- **Multi-branch sync: the ownership model, written down as data, and the emit
  layer that acts on it.** `internal/sync/ownership` classifies all 149 tables of
  the schema — 55 group-owned, 37 branch-owned, 17 append-only ledgers, 40
  node-local — each with the reason for its class recorded next to it. Every
  stored counter (`items.current_stock`, `gift_cards.current_balance_cents`,
  `customers.loyalty_points`, `coupon_codes.used_count`, …) is listed against the
  ledger that is its actual truth and is never replicated: quantities are
  `SUM(qty)` over the union at read time, which is what makes two tills selling
  the last steak converge at −2 instead of silently at −1. A test compares the
  registry against a live migrated Postgres and **fails closed** on any table it
  does not classify, on any credential-shaped column that would be emitted, and
  on any money column that is a float.
- `internal/sync/emit` turns a row-level write into the operations that model
  produces, **inside the caller's own transaction**, so a row and its operation
  commit together or neither does, and `data.Handler.WithEmitter` gives the
  generic REST layer (`internal/handlers/data` — this backend's one genuine
  write chokepoint) a seam to adopt it; `emit.Emitter.Scoped` is the seam the
  hand-written stores adopt next. Proven end-to-end against a real migrated
  Postgres in `emit_integration_test.go`. **Not wired into the running
  server**: `cmd/server` never calls `WithEmitter`, so the emitter is nil in
  production and, exactly as before this landed, nothing in the product
  emits a single operation today. Peers still do not exchange anything —
  there is no push/pull round and no apply path above this either.
- BeepBite's own multi-branch merge suite under induced partition
  (`internal/sync/opsink/converge_test.go`), covering all four properties ROADMAP
  Stage 2 precondition 4 names, with byte-identical converged state across every
  exchange order and the same answers from both merge engines. Named as its own
  CI step so it cannot quietly stop running.
- `PaymentProvider` seam with a single manual-tender implementation — cash,
  card, transfer and voucher recorded against the order and reconciled into the
  drawer at close.

### Fixed
- Marketplace checkout collected a tip, added it into the customer-facing
  total and the on-delivery "have cash ready" prompt, but `CheckoutReq` had
  no field for it: the tip never reached the backend, was never persisted,
  and was never billed on the online-payment path. `tip_cents` is now a real,
  server-validated field, folded into the one server-side total computation
  and stored on `orders.gratuity_cents` (no migration needed — the column
  already existed for POS auto-gratuity).
- Cash tenders were never linked to the cash-drawer session, so every drawer
  close read as a shortage.
- The POS "Card" button referenced a tender code that did not exist and would
  have failed on use.
- The end-to-end suite was silently skipping every test rather than running
  them, hiding three live breakages.

### Changed
- `PAYMENT_KEY_ENCRYPTION_SECRET` renamed to `APP_KEY_ENCRYPTION_SECRET`.
  **Existing deployments must rename this variable.**
- Country and currency assumptions are being removed throughout; currency now
  resolves per location.
