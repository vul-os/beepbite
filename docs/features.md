# Features

What each surface actually does, tagged the way [README](../README.md) tags
things: **Built** and **Not built** are different words, used precisely. See
[README's Status table](../README.md#status) for the top-level summary — this
document goes one level deeper, area by area.

There is no tier that unlocks a feature below. There is one binary, and every
feature in it is in every copy.

## Front of house

**Built.**

- Touch POS: tabs, seat/amount splits, modifiers, courses, void/comp/discount
  with manager approval, split tender.
- Quick POS kiosk mode.
- Floor plan and table sessions — live status, assignment, turnover.
- Customer-facing display.
- Reservations and a waitlist.
- Gift cards, store credit, and house accounts (with account-level invoicing).
- Loyalty, including stamp cards.
- Promotions and coupon codes.

## Kitchen

**Built.**

- Kitchen display system: per-station routing, an expo view, a fan-out queue,
  fire timers, and course-fire-on-bump (fire the next course automatically
  when the previous one is bumped).
- Recipes with recursive costing (a dish's cost follows its ingredients'
  costs through sub-recipes), the 86 list, and prep-step tracking.

## Inventory & purchasing

**Built.**

- Suppliers, purchase orders, goods receipts, and 3-way invoice matching.
- Stock movements and waste tracking, with reorder suggestions.
- Ingredient price history.

## Money

**Built**, with one deliberate absence:

> [!IMPORTANT]
> **BeepBite records tenders; it does not process cards.** Cash, card,
> transfer and voucher are recorded against the order and reconciled into the
> drawer at close. "Card" means your own card machine on your own counter —
> BeepBite records the amount and the tender type, nothing more. There is no
> payment gateway, no card data ever reaches it, and it holds no PCI scope.
> Card processing was deliberately removed, not left unbuilt — see
> `CHANGELOG.md`.

- Cash drawer sessions: denomination counts, blind close, paid-in/paid-out.
- Void, comp, price-override and refund, each with a reason code and manager
  approval where the role requires it.
- Idempotency keys on order and payment inserts, so a retried request cannot
  double-record a tender.

**Optional, off by default:** a verify-on-return online-payment path for
orders with no counter to pay at (a WhatsApp or web order). It is
unit- and integration-tested but has **never been run against a live
processor** — the default build links no gateway code at all. See
[docs/ONLINE-PAYMENTS.md](ONLINE-PAYMENTS.md) for exactly what "verified"
would mean and what isn't yet.

## Staff

**Built.**

- Role-based access: owner, manager, cashier/staff roles, each gated by
  per-member capability flags, not a hardcoded role list.
- PIN-based till actor overlay on top of a logged-in session (a manager can
  step in to authorize a void without anyone logging out), with a 5-strike /
  15-minute lockout.
- Time clock, tip pools, and a payroll export (hours, commission, tips —
  export, not a payroll *run*; BeepBite does not file or pay anyone's taxes).
- An audit log recording who did what, tied to the authenticated identity —
  never a client-supplied field.

## Ordering & delivery

| Channel | State |
|---|---|
| QR-at-table / web storefront | **Built.** Public store page, cart, checkout, order status. |
| WhatsApp ordering | **Built** — a direct Meta Cloud API integration using **your own** WhatsApp Business credentials. Entirely dark without them: no BeepBite number pool, no shared account. |
| Order-ready notifications over WhatsApp | **Built.** Replaces a buzzer/pager; sent when kitchen marks an order ready. |
| Discord, Slack, email / DMTAP ordering | **Not built.** There is no channel-adapter abstraction yet — WhatsApp and web ordering are each their own direct integration, not plugins behind a shared interface. "Channel-agnostic" is the direction, not the current architecture. |
| Delivery zones, driver portal, live tracking | **Built**, but less exercised than the POS. Zones use polygon lookup; drivers get assignments, shifts and a location-ping feed; customers get a public `/track/:token` page with a privacy-gated map. |
| Pickup slots | **Built.** |

## Customer engagement

**Built.**

- Reviews: collection and owner responses (public read, authenticated write).
- Customer search and recent-order lookup for taking a repeat order quickly.
- Favorites.

Review requests and other automated messages ride the same WhatsApp
integration above — they are notifications sent through your own credentials,
not a separate marketing platform.

## Reporting

**Built**, as read-only database views, gated by a `can_view_reports`
capability: daily sales summary, hourly sales heatmap, menu engineering (which
items earn their keep), labor hours, theoretical-vs-actual cost of goods, and
revenue by payment method. There is no separate analytics product — these are
the same Postgres your orders live in, queried directly.

Multi-location reporting across a three-currency operation is **built as an
off-by-default conversion seam** (`internal/fx`): it makes no network call
when disabled and never rewrites a stored amount. It is for one operator
wanting a single consolidated set of books, not a platform-wide FX billing
system — BeepBite doesn't bill anyone.

## Security & isolation

**Built.**

- Row-level security on every tenant-scoped table from creation, enforced
  server-side from the authenticated identity — never from a filter the
  client happens to send.
- Audit log and idempotency keys throughout mutating paths.
- No PCI scope, because card data never reaches the application in the first
  place — a property of what BeepBite refuses to do, not a control it added.

What BeepBite cannot promise on your behalf: **GDPR, PCI-DSS, SOC 2, or any
other compliance certification.** Those describe an operator's practices, not
software they installed. Nobody has audited a self-hosted deployment you run,
because there is no one operator to audit.

## Currency, tax & locale

**Built.** Currency, tax convention, timezone, locale and dial code all
resolve per location from configuration. No hardcoded currency or country
defaults remain in application logic.

## Installation & data ownership

| Claim | State |
|---|---|
| Single Go binary | **Built.** The release workflow embeds the frontend and cross-compiles one binary for linux/darwin × amd64/arm64. |
| Single-*file* install (no separate database service) | **Planned, not done.** Postgres is required today; there is no SQLite driver in the tree yet. |
| Offline tolerance at the till | **Not implemented as a feature.** Client-side scaffolding exists (`src/offline/`) — ULIDs, an idempotency helper, a mutation queue — but nothing in the running app uses it yet. A dropped connection today behaves like it always did. |
| Nothing phones home | **Built.** A fresh install makes no outbound network calls. WhatsApp, maps and AI are each dark until you supply your own credentials. |
| Backups | **Your responsibility.** It's your Postgres; BeepBite has no backup service of its own to sell you. |

## What is not a feature

- **Not a marketplace.** No directory, no discovery, no slug namespace anyone
  else administers.
- **Not multi-tenant SaaS.** There is no plan/tier system, no per-seat
  pricing, no usage metering, because there is no vendor billing you.
- **Not a support contract.** There is no phone line, no "business hours"
  live chat, and no paid onboarding team. Documentation and the issue tracker
  at `github.com/vul-os/beepbite` are what exists.
- **Not multiple deployments kept in sync.** Two BeepBite instances do not
  yet talk to each other — see `ROADMAP.md` for the planned branch-sync
  design. Today, one instance is one restaurant's data.
