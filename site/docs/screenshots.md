# Screenshots

`scripts/screenshots.mjs` captures the images in `docs/screenshots/` using
Playwright/Chromium against a **real, running** BeepBite: a real Postgres, a
real `go run ./cmd/server`, a real `npm run dev`, signed in through the real
`/signin` form with the seeded demo owner. Nothing is mocked and nothing is
drawn by hand.

If `site/docs.html` exists on the checked-out branch (the in-app docs viewer,
added on a sibling branch as this tooling was being written), the script also
mirrors every shot into `site/screenshots/`, which is what that viewer
actually loads at runtime — see its image-path rewrite. This is exactly
PropFix's convention for the same reason. The mirror is skipped, not broken,
on a branch where `site/` doesn't exist yet.

## Prerequisite: Postgres

BeepBite has no in-memory demo mode — unlike some sibling VulOS products, its
UI cannot render anything without a real Postgres behind the API. So, unlike
a screenshotter that just launches a static binary, this one needs somewhere
to put a database. It will stand one up for you:

```bash
npx playwright install chromium   # one-time
npm run screenshots
```

By default this:

1. Runs a throwaway `postgres:16-alpine` container in Docker
   (`beepbite-screenshots-pg`, port `55432` — never your real Postgres).
2. Applies migrations and runs `go run ./cmd/seedcopper --env=dev --clean`,
   which builds "The Copper Table" — a full fictional restaurant tenant
   (menu, floor plan, staff, 1500+ historical orders, live KDS tickets,
   inventory) documented in `backend/cmd/seedcopper/CONTRACT.md` — seeded as
   Portugal/EUR (`SEED_COUNTRY=PT SEED_CURRENCY=EUR …`, set in
   `scripts/screenshots.mjs`), not seedcopper's own default of the reserved
   test currency XTS. XTS is the right default for the seeder itself (it
   keeps demo data unmistakably fake in a dev database or a support ticket),
   but "XTS 195.00" in a README screenshot reads as a bug to someone who
   doesn't know it's a test code — a real-looking currency serves the
   screenshot's actual job, which is to show the product working.
3. Starts the API and the Vite dev server, signs in as the seeded owner
   (`demo@beepbite.app`), captures, and tears everything it started back down.

If you already have BeepBite running (per [setup.md](setup.md)) on the
configured ports, the script reuses it instead of starting anything — see the
comment block at the top of `scripts/screenshots.mjs` for every environment
variable this supports, and for why it deliberately refuses to touch a
pre-existing `.env.dev`.

## Honesty guard

Before writing a single file, the script logs in for real and confirms it
reaches `/home`. If Postgres won't come up, migrations or seeding fail, the
servers don't start, or sign-in fails, it prints exactly why and exits
non-zero — no screenshot, placeholder, or partial output is ever written.

## What's captured, and what isn't

| Surface | Route | Captured? |
|---|---|---|
| Dashboard + live orders feed | `/home` | Yes (hero) |
| POS till | `/pos/workspace` | Yes |
| Kitchen display (KDS expo) | `/kds/expo` | Yes |
| Floor plan | `/floor` | Yes |
| Menu management | `/menu` | Yes |
| Inventory / purchase orders | `/inventory/purchase-orders` | Yes |
| Reports (chat response-time analytics) | `/reports` | No — genuinely empty for this seed data. It reports WhatsApp-conversation response time, rating, and completion rate; `seedcopper` inserts orders directly rather than through a simulated chat, so those specific metrics are honestly zero. Not a rendering bug — just not worth a blank screenshot. |
| Customer order tracking | `/track/:token` | No — loads, and the order-progress stepper works, but the map and ETA never appear. `internal/handlers/tracking/handler.go` returns a **flat** JSON shape (`store_lat`, `delivery_address` as a plain string, no `eta_minutes`), while `src/pages/track/index.jsx` / `src/services/tracking.js` destructure a **nested** one (`store.lat`, `delivery_address.label`, `eta_minutes`) the backend never sends. Real API contract bug, found while building this tooling, not fixed here. |
| "Orders" tab inside `/work` (POS Workspace shell) | `/work` | No — throws `TypeError: Cannot read properties of undefined (reading 'length')` and blanks the page. The Home dashboard's Live Orders panel is the working equivalent. |

Light and dark are both captured (`vite-ui-theme` in `localStorage`). The
kitchen display is intentionally dark-chrome in both, by design — it is not a
capture bug that the two variants look alike there.

## In-app documentation placeholders

Several pages under `src/pages/docs/*.jsx` already have a `Screenshot`
component wired up with a caption naming an exact file to drop into
`public/docs/` (e.g. `pos-overview.jsx` wants `/public/docs/pos-layout.png`).
This script's second output directory exists to fill that convention where
the subject matches something it actually captures; the pos-overview and
menu-management pages have been wired to real captures. The others
(`eod.png`, `signup.png`, `pos-order.png`, `whatsapp-connect.png`) name shots
this script does not currently produce (an end-of-day report, the sign-up
screen, and the WhatsApp settings page) and are left as placeholders rather
than filled with something that doesn't match the caption.
