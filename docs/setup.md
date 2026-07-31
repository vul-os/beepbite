# Setup

This guide is for two different people at once: the owner deciding whether to
say yes to this, and whoever ends up typing the commands. The first six
sections are written so either can follow them; if you're only here to run
the commands, skip to [3. Install](#3-install).

1. [What you are signing up for](#1-what-you-are-signing-up-for)
2. [What you need before you start](#2-what-you-need-before-you-start)
3. [Install](#3-install)
4. [First login and the onboarding wizard](#4-first-login-and-the-onboarding-wizard)
5. [Setting your location](#5-setting-your-location)
6. [Optional integrations](#6-optional-integrations)
7. [Backups](#7-backups)
8. [Updating](#8-updating)
9. [Building for production / deploying](#9-building-for-production--deploying)
10. [Common install problems](#10-common-install-problems)

## 1. What you are signing up for

BeepBite is three things running on hardware **you** control:

1. **A Go program** (the API) that talks to your database and to whichever
   integrations you turn on.
2. **A Postgres database** that holds every order, menu item, customer and
   staff record. This is your data, in a format you can query, dump and back
   up yourself with ordinary Postgres tools.
3. **A web app** (the till, kitchen display, floor plan, back office) that
   staff open in a browser on your own network.

There is no BeepBite cloud account, no company hosting a copy for you, and no
signup on some other website. If you stop running the Go program, BeepBite
stops running — there is no fallback service that keeps taking orders for
you. That also means nobody but you is responsible for keeping it up,
patched, and backed up. See [docs/faq.md](faq.md) if you're still deciding
whether that trade is right for your shop.

> [!NOTE]
> **Windows is not supported.** Release binaries are built for
> linux/darwin × amd64/arm64 only.

## 2. What you need before you start

- **A machine to run it on.** A laptop, a small office server, or a rented
  VM — Linux or macOS.
- **PostgreSQL 15+** (the project's own CI runs 16), installed locally or in
  Docker. This is the one hard infrastructure dependency; there is no
  single-file / SQLite option yet (tracked in
  [ROADMAP.md](../ROADMAP.md#now-4--sqlite-behind-a-store-seam-and-the-single-file-install)).
- **Go 1.25+** and **Node.js 20+** with npm, if you're building from source
  rather than downloading a release binary.
- **About 30 minutes**, and one person who is comfortable pasting commands
  into a terminal. Nothing here requires deep Go or React knowledge — you
  are running four or five commands, not writing code.
- **A network (TCP/IP) ESC/POS receipt/kitchen printer, if you want physical
  tickets — USB printers are not supported yet.** See
  [FAQ → Hardware](faq.md#hardware-and-practical) for exactly what's
  supported before you buy one.

## 3. Install

Each step does one thing. Run them in order, from the repo root unless noted.

**Create the database** — asks your local Postgres for an empty database
named `beepbite`. Using Docker Postgres instead? Create it however you
normally do; the name and connection details just need to match the next
step.

```bash
createdb beepbite
```

**Copy the environment template, then edit it.** `DATABASE_URL` is how the
Go API finds your database. `JWT_SECRET` signs staff login sessions —
generate one with `openssl rand -hex 32` and never reuse it across
environments. `VITE_API_URL` is how the web app finds the Go API. Everything
else in `.env.example` (WhatsApp, email, Mapbox, the AI assistant) is an
**optional integration** — leave it blank and BeepBite runs without it; see
[§6](#6-optional-integrations).

```bash
cp .env.example .env
```

```env
DATABASE_URL=postgres://localhost/beepbite?sslmode=disable
JWT_SECRET=<random 32+ character string>
VITE_API_URL=http://localhost:8080
```

> [!NOTE]
> **Do you need a public URL?** Not for the counter. The till, kitchen
> display, floor plan and back office are LAN-only. WhatsApp ordering, the
> customer-facing store/tracking pages, and the optional online-payment
> return each need public HTTPS — see
> [Features → Reachability](features.md#reachability--what-actually-needs-a-url)
> for exactly which and why.

**Apply the database schema** — creates every table BeepBite needs inside
the empty database above. Safe to re-run; already-applied migrations are
skipped. `--reset` drops everything and starts over (**destroys all data**);
`--down` rolls back the most recent migration.

```bash
cd backend
go run ./cmd/migrate --env=local --up
```

**Start the API** — the Go program from [§1](#1-what-you-are-signing-up-for).
Leave it running in its own terminal.

```bash
go run ./cmd/server --env=local
# Listens on :8080 by default
```

**Start the web app**, in a second terminal, from the repo root.
`npm install` downloads the frontend's JavaScript dependencies (once, or
after a dependency update); `npm run dev` starts the till/KDS/floor-plan/
back-office app.

```bash
npm install
npm run dev
# http://localhost:5174
```

You now have a running BeepBite with an empty database and no staff account
— [§4](#4-first-login-and-the-onboarding-wizard) covers what to do next.

## 4. First login and the onboarding wizard

Two starting points: a real, empty organisation, or something to look at
first.

**Real and empty:** open `http://localhost:5174/signup`, create an owner
account (email + password: 8+ characters, one uppercase letter, one number),
and sign in. You land in a **six-step onboarding wizard** (`/onboard`) that
walks you through the minimum to take a real order — verify email, create
your first location, pick a service style (dine-in vs. takeaway/counter),
add five menu items, invite one staff member or driver, and ship a test
order through the POS. Progress is saved as you go.

**A populated demo to explore first:**

```bash
cd backend
go run ./cmd/seedcopper --env=local --clean   # a full demo restaurant, ~1500 orders, live KDS tickets
```

Creates a demo organisation ("The Copper Table") with menu, staff, customers
and order history already in it, and prints logins to the terminal — an
owner login (`demo@beepbite.app` / `Demo1234!`) and a POS till login
(username `cashier`, PIN `1234`, with the location slug you'll need to
select it). `--clean` clears previous burner data first, so it's safe to
re-run. To add realistic data to an *existing* org instead of creating a new
one, use `go run ./cmd/seeddemo --email owner@example.com`.

## 5. Setting your location

Every location (Settings → Locations) carries its own:

| Setting | What it controls |
|---|---|
| **Country** | Informational, and feeds the country picker for currency/timezone — not itself a hardcoded behaviour switch. |
| **Currency** | Any ISO 4217 code. Handles 0-decimal currencies (JPY, KRW, VND, …) and 3-decimal currencies (KWD, BHD, OMR, …) correctly — see [FAQ → Currencies](faq.md#which-currencies). |
| **Timezone** | Any IANA timezone name (e.g. `Africa/Johannesburg`, `America/Sao_Paulo`) — governs receipt timestamps, reports and shift boundaries. |
| **Locale** | A BCP-47 tag (e.g. `pt-PT`, `ja-JP`) controlling number and date formatting — independent of language. |
| **Tax rate, inclusive/exclusive, and label** | A percentage, a flag for whether menu prices already include it, and a free-text label ("VAT," "GST," "IVA," "Sales Tax," whatever your jurisdiction calls it) — never a hardcoded rate or country assumption. |
| **Phone dial code** | Digits only, no `+` — used to format customer and staff phone numbers consistently. |

None of these have a global default baked into the application — an
unconfigured location renders money as a bare number rather than guessing a
currency, which is deliberate: an unfinished setup should look unfinished.

## 6. Optional integrations

Every integration below is **off by default and dark until you supply your
own credentials.** A fresh install makes no outbound network call at all.
None of them unlock a feature tier — they're config, not a purchase.

| Integration | Turned on by | What it sends, and where | If you skip it |
|---|---|---|---|
| **WhatsApp ordering** | `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET` (your own Meta Business credentials) | Customer phone number, order text, and chat messages, to and from Meta's Cloud API. Needs a public HTTPS URL — Meta delivers by webhook only. | No WhatsApp ordering channel. The web storefront, and any QR code pointing at it, are unaffected. |
| **AI assistant / floor-plan generator** | `GEMINI_API_KEY` (your own Google account) | Floor-plan descriptions, menu text you paste in, and owner-assistant prompts, to Google's Gemini API. | No AI floor-plan tool and no owner-assistant chat. Nothing else is affected. |
| **Online payments** | `BEEPBITE_ONLINE_PAYMENT_PROVIDER` + that provider's keys — and **a build compiled with `-tags patala`**, which the default build is not | The customer's browser to the payment processor's own hosted page; BeepBite never sees card data. See [ONLINE-PAYMENTS.md](ONLINE-PAYMENTS.md). | Remote orders (WhatsApp/web) stay on-delivery-only, exactly like the in-person counter. |
| **Transactional email** | `SMTP_HOST` and friends, or `EMAIL_PROVIDER_DEFAULT=sendgrid\|mailgun\|ses` with that provider's key | Recipient's email address, name, and message content, to your chosen SMTP server or provider. | No password-reset or notification emails. Everything else works. |
| **Delivery-address geocoding** | `MAPBOX_TOKEN` | Delivery addresses being typed, to Mapbox. | The WhatsApp chatbot asks the customer to share a location pin instead of typing an address. |
| **Multi-currency consolidated reporting** | `FX_PROVIDER` + `FX_OPENRATE_URL` (your own [OpenRate](https://github.com/vul-os/openrate) instance — no third-party FX API is embedded) | Nothing, unless you point it at your own OpenRate instance; it makes zero outbound calls when unset. | The consolidated report groups by currency instead of totalling — arguably more honest anyway. |

> [!IMPORTANT]
> **BeepBite never processes card payments in the default build.** "Card"
> always means your own card machine on your own counter — BeepBite records
> the amount and a reference, nothing more. See
> [FAQ → Does it process card payments?](faq.md#does-it-process-card-payments).

Full detail on every third party you might choose to engage, including what
happens to the data if you turn one off later, is in
[sub-processors.md](sub-processors.md).

## 7. Backups

**This is your job.** There is no BeepBite backup service, because there is
no BeepBite service at all — just your own Postgres. Back up:

- **Your Postgres database**, on a schedule your data-loss tolerance can
  live with. `pg_dump beepbite > backup.sql` is a reasonable start; how you
  schedule and store it (cron + object storage, a managed-backup provider)
  is your choice.
- **Your `.env` file**, specifically `JWT_SECRET` and
  `APP_KEY_ENCRYPTION_SECRET` — the latter encrypts small secrets at rest
  (TOTP seeds, bring-your-own email credentials); **losing it means losing
  access to everything it encrypted**, not just losing convenience.
- Anything outside Postgres you depend on — printer configuration,
  reverse-proxy config, TLS certificates for a public URL.

Restoring is the reverse: stand up Postgres, restore the dump, put the same
`.env` values back, start the server.

## 8. Updating

**Running from source:**

```bash
git pull
cd backend && go run ./cmd/migrate --env=local --up   # apply any new migrations
go run ./cmd/server --env=local                        # restart the API
npm install && npm run dev                              # restart the web app
```

**Running a release binary:** download the newer binary from
[GitHub Releases](https://github.com/vul-os/beepbite/releases), stop the old
process, run `./cmd/migrate --up` against your existing database (never
`--reset` — that destroys data), and start the new binary in its place.

Migrations are forward-only and additive — there is no supported path to
run an older binary against a database already migrated forward.

## 9. Building for production / deploying

BeepBite has no opinion about where you run it — a VPS, a machine in the
shop, a container host you already use. Two things get built and deployed
**separately**:

**The API** — one Go binary. Prebuilt binaries for linux/darwin ×
amd64/arm64 are also published on
[GitHub Releases](https://github.com/vul-os/beepbite/releases) for every
tagged version, with a `SHA256SUMS` manifest to verify against.

```bash
cd backend
go build -o beepbite ./cmd/server
```

**The web app** — a static bundle (HTML/CSS/JS) that something else has to
serve: a static file host, a reverse proxy such as nginx or Caddy, or any
static-hosting provider, pointed at the Go API via `VITE_API_URL` at build
time. The Go binary does **not** serve this bundle itself — the only thing
it optionally serves on its own is this project's marketing/docs mini-site
(`site/`), a separate, cosmetic thing from the app your staff use.

```bash
npm run build       # production bundle, VITE_MODE=main
npm run build:dev    # a "dev" build variant, VITE_MODE=dev
```

Whatever you put in front of either one — reverse proxy, process manager,
firewall rule — is standard ops for "a Go binary and a static web app," not
a BeepBite-specific step.

## 10. Common install problems

Covered in full, with exact error messages and fixes, in
[Troubleshooting](troubleshooting.md). The most common first-run snags:

- **`Error: missing DATABASE_URL`** — you skipped or mistyped the `.env` step
  in [§3](#3-install).
- **`relation "X" does not exist`** — migrations haven't been applied;
  re-run `go run ./cmd/migrate --env=local --up`.
- **Port `8080` or `5174` already in use** — see
  [Troubleshooting](troubleshooting.md#backend-wont-start).
- **Blank page in the browser** — usually `VITE_API_URL` pointing at the
  wrong place, or a stale Vite cache; see
  [Troubleshooting](troubleshooting.md#frontend-wont-start--blank-page).

Anything else: [file an issue](https://github.com/vul-os/beepbite/issues)
with the exact error, a backend log excerpt, and what you already tried —
per [§1](#1-what-you-are-signing-up-for), there's no phone line, but the
issue tracker is read.
