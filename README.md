<div align="center">

# BeepBite

### A restaurant point-of-sale you actually own.

Front of house, kitchen, delivery, and however your customers already order —
one system, running on your own hardware. No cloud account, no per-order fee,
no platform standing between you and them.

<sub>Part of <strong><a href="https://vulos.org">VulOS</a></strong> — the open, self-hostable web OS &amp; app suite. Runs standalone, or as an app hosted by the Vulos OS.</sub>

[![Version](https://img.shields.io/badge/version-0.1.0-blue.svg)](CHANGELOG.md)
[![License: MIT](https://img.shields.io/badge/License-MIT-FF6B35.svg)](LICENSE)
[![Self-hostable](https://img.shields.io/badge/self--hostable-your%20hardware-E8871E)](docs/setup.md)
[![Platform fee](https://img.shields.io/badge/platform%20fee-none-14B8A6)](#what-beepbite-is-not)
[![Go](https://img.shields.io/badge/Go-1.25-00ADD8?logo=go&logoColor=white)](https://golang.org)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev)

[**Quick start**](#quick-start) · [**Screenshots**](#screenshots) · [**Features**](#features) · [**How it works**](#how-it-works) · [**Status**](#status) · [**Docs**](docs/) · [**Roadmap**](ROADMAP.md)

<sub><em>Vulos — rooted in <strong>vula</strong>, the Zulu and Xhosa word for <strong>open</strong>.</em></sub>

<br/>

<img src="docs/screenshots/hero.png" alt="BeepBite dashboard — sales trend, busy hours, and the live orders feed for a real seeded restaurant" width="900" />

</div>

---

## What is BeepBite?

A complete restaurant system: take the order, cook it, serve it, deliver it,
and know what it cost you. A Go API and a React app running against your own
Postgres — on a laptop in the back office, a machine in the cupboard, or a VM
you rent.

What makes it different is **who it belongs to**. Delivery platforms take
15–30% of every order and own the customer relationship. Cloud POS vendors
charge per terminal per month and hold your data hostage to a subscription.
BeepBite takes nothing and holds nothing, because there is no BeepBite service
— there is only the copy you run.

Ordering is meant to be **channel-agnostic**: customers order from wherever
they already are, not wherever BeepBite decided to build first. Today that
means WhatsApp chat (built, using your own Meta credentials) and QR-at-table
or web ordering (built). Discord, Slack, and email — including over
[DMTAP](https://github.com/vul-os/dmtap), our own decentralized mail protocol,
the option with no Meta or Google in the middle — are the intended next
adapters, not yet built. See [Status](#status) for exactly which is which.

> [!NOTE]
> **Status: pre-1.0 and under active rebuild.** The POS, kitchen, inventory and
> ordering surfaces are substantially built; several architectural changes are
> in flight. Read [Status](#status) for an honest per-area breakdown before
> deploying this anywhere real.

## Screenshots

<table>
<tr>
<td width="50%"><img src="docs/screenshots/pos-workspace.png" alt="POS till" width="400"/><br/><sub><em>POS till — table bar, menu grid, and a running cart.</em></sub></td>
<td width="50%"><img src="docs/screenshots/kds-expo.png" alt="Kitchen display" width="400"/><br/><sub><em>Kitchen display — expo view, per-station routing, fire timers.</em></sub></td>
</tr>
<tr>
<td width="50%"><img src="docs/screenshots/floor.png" alt="Floor plan" width="400"/><br/><sub><em>Floor plan — live table status, auto-refreshing every 15s.</em></sub></td>
<td width="50%"><img src="docs/screenshots/menu.png" alt="Menu management" width="400"/><br/><sub><em>Menu management — items, cost and margin per dish.</em></sub></td>
</tr>
<tr>
<td width="50%"><img src="docs/screenshots/inventory-purchase-orders.png" alt="Inventory" width="400"/><br/><sub><em>Inventory — purchase orders by supplier and status.</em></sub></td>
<td width="50%"><img src="docs/screenshots/home-dark.png" alt="Dashboard, dark mode" width="400"/><br/><sub><em>Dashboard in dark mode — sales trend, busy hours, live orders.</em></sub></td>
</tr>
</table>

<sub>Every shot above is a real seeded tenant ("The Copper Table"), captured from the actual running app by <code>npm run screenshots</code> — nothing is mocked up. Light and dark variants of every surface, and a note on what didn't make the cut and why, are in <a href="docs/screenshots.md">docs/screenshots.md</a>.</sub>

## Features

| Front of house | Kitchen &amp; stock |
|---|---|
| Touch POS — tabs, splits, voids, comps, manager approval | Kitchen display with per-station routing and expo |
| Floor plan and table management | Recipes, costing, and the 86 list |
| Customer-facing display | Suppliers, purchase orders, goods receipts |
| Reservations and waitlist | Invoice matching and waste tracking |
| Gift cards, store credit, house accounts | Stock counts and reorder suggestions |

| Money &amp; people | Ordering &amp; delivery |
|---|---|
| Cash drawer sessions and reconciliation | WhatsApp ordering, and QR-at-table / web ordering |
| Tenders — cash, card, transfer, voucher | Delivery zones, driver app, live tracking |
| Promotions, coupons, loyalty | Pickup slots and order status |
| Invoicing and house-account billing | Public customer tracking page |
| Time clock, payroll, tip pools | Discord, Slack, email/DMTAP ordering — planned, not built |

**Infrastructure you can trust**

- **Your database, your building.** Postgres you control. Nothing phones home,
  and a fresh install makes no outbound network calls at all.
- **No payment facilitator.** BeepBite records tenders; it never touches your
  money. "Card" means your own card machine on your own counter. No PCI scope,
  no settlement delay, no cut of your revenue.
- **Row-level security**, with tenant scoping enforced server-side from the
  authenticated identity — never from a filter the client supplies.
- **Audit log and idempotency keys** throughout, so a retried request can't
  double-charge.
- **Every integration is optional.** WhatsApp, maps and AI are each off unless
  you supply your own credentials.

## What BeepBite is not

- **Not a marketplace.** It will not bring you customers. It stops a
  marketplace from owning the ones you already have.
- **Not a payment processor.** It records what was tendered. Bring your own
  card machine and your own bank.
- **Not a hosted service.** No signup, no dashboard we operate, nobody to call.
  You run it, you back it up, you own the consequences.
- **Not finished.** See [Status](#status).

## Quick start

```bash
# 1. Database
createdb beepbite

# 2. Configure — set DATABASE_URL and JWT_SECRET
cp .env.example .env

# 3. Migrate
cd backend && go run ./cmd/migrate --env=local --up

# 4. API
go run ./cmd/server --env=local

# 5. App
cd .. && npm install && npm run dev        # http://localhost:5173
```

Want something to look at first?

```bash
cd backend && go run ./cmd/seedcopper --env=local --clean   # full demo restaurant, ~1500 orders, live KDS tickets
# or: go run ./cmd/seeddemo --email owner@example.com       # lighter seed onto an existing org
```

`seedcopper` is also what generates every screenshot in this README — see
`npm run screenshots` and [docs/screenshots.md](docs/screenshots.md).

## How it works

```mermaid
flowchart LR
  subgraph Customer
    W["WhatsApp"]
    Q["QR at table / web"]
    T["Tracking page"]
  end
  subgraph "Your hardware"
    API["Go API<br/><i>chi · pgx</i>"]
    DB[("Postgres")]
    UI["POS · KDS · Floor<br/><i>React</i>"]
  end
  D["Driver app"]
  W --> API
  Q --> API
  UI --> API
  API --> DB
  API --> D
  API --> T
```

Orders arrive from WhatsApp, a table QR code / web storefront, or the till,
and land in one order stream. They route to the right kitchen station and, if
they're going out, to a driver — with a tracking link for the customer. Live
updates are server-sent events, so there is no polling and no message broker
to operate.

## Configuration

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | — | Postgres connection string. **Required.** |
| `JWT_SECRET` | — | Signing key for access tokens. **Required.** |
| `PORT` | `8080` | API listen port |
| `WHATSAPP_TOKEN` | — | Meta Cloud API token. WhatsApp ordering stays off without it. |
| `WHATSAPP_PHONE_ID` | — | Meta phone number ID |
| `MAPBOX_TOKEN` | — | Delivery-zone geocoding. Optional. |

See [docs/setup.md](docs/setup.md) for the full list.

## Status

An honest per-area account, because a feature that silently does nothing is
worse than one that says it isn't built:

| Area | State |
|---|---|
| POS, KDS, floor plan, orders | **Built** — substantially complete, covered by integration and e2e tests |
| Inventory, purchasing, recipes | **Built** |
| Gift cards, loyalty, house accounts | **Built** |
| WhatsApp ordering | **Built** — direct Meta Cloud API integration, needs your own credentials |
| QR-at-table / web ordering | **Built** |
| Discord, Slack, email/DMTAP ordering | **Not built.** No channel-adapter abstraction exists yet — WhatsApp and web ordering are each their own direct integration, not plugins behind a common interface. Channel-agnostic is the intent; today it is two channels, not an open architecture. |
| Delivery zones, driver, tracking | **Built**, but less exercised than the POS. The customer tracking page (`/track/:token`) has a real gap: the backend returns a flat JSON shape and the frontend expects a nested one, so the order-progress stepper works but the live map and ETA never render — a genuine bug, found while building this README's screenshot tooling, not yet fixed. |
| Payments | **Tender recording only, by design.** Card processing was deliberately removed |
| Currency &amp; locale neutrality | **Built.** Currency, tax convention, timezone, locale and dial code all resolve per location from configuration; no hardcoded ZAR/South-Africa defaults remain in application logic |
| Single binary + SQLite | **Planned, not done.** Postgres is required today |
| Offline-first sync between sites | **Not implemented.** Some client-side scaffolding exists (`src/offline/`) but nothing in the app uses it yet |
| Screenshots | **Real**, captured from a live seeded instance — see [Screenshots](#screenshots) and [docs/screenshots.md](docs/screenshots.md) |

## Development

```bash
npm run dev              # frontend on :5173
npm run build            # production bundle
npm run test:unit        # vitest
npm run test:e2e         # playwright
npm run screenshots      # regenerate docs/screenshots/ against a real seeded instance
cd backend && go test ./...
cd backend && go run ./cmd/tests     # integration + pentest suites
```

## Documentation

| Doc | |
|---|---|
| [Setup](docs/setup.md) | Install, configure, deploy |
| [User guide](docs/user-guide.md) | Running a service day to day |
| [Features](docs/features.md) | What each surface does |
| [API](docs/api.md) | HTTP contract |
| [Development](docs/development.md) | Working on the code |
| [Screenshots](docs/screenshots.md) | How the gallery is generated, and what's excluded and why |
| [Troubleshooting](docs/troubleshooting.md) | When it misbehaves |
| [Roadmap](ROADMAP.md) | Gap analysis and what's next |

## Contributing

Issues and pull requests welcome. Read [ROADMAP.md](ROADMAP.md) first — some
gaps are deliberate design choices and some are simply unbuilt, and the
difference matters.

## License

[MIT](LICENSE)

<div align="center">
<sub><strong>Built with purpose. Open by design.</strong></sub>
</div>
