# User Guide

Running a service day to day. For what's actually built vs not, see
[Features](features.md) and [README's Status table](../README.md#status) —
this guide assumes the Built column and doesn't repeat the caveats.

For installing the software in the first place, see [Setup](setup.md).

## First login

There is no signup flow you go through with a vendor — you create the first
account yourself, against your own database:

```bash
cd backend && go run ./cmd/seedcopper --env=local --clean
# full demo restaurant: menu, staff, ~1500 orders, live KDS tickets
```

or, onto a real (empty) organization:

```bash
cd backend && go run ./cmd/seeddemo --email owner@example.com
```

`./scripts/seed-demo-local.sh --create` does the same for local dev and
prints the owner + staff logins. In production you sign up the owner account
via `POST /auth/signup` (or the app's sign-up screen) and build the
organization from there — there is no "Restaurant Registration" step operated
by anyone else, because there is no one else in this.

## The dashboard

The home screen shows: live orders (POS + WhatsApp + web, one queue), a sales
trend, a busy-hours heatmap, and inventory alerts where stock is low. It's a
read view over the same Postgres your orders live in — there's no separate
analytics service to configure.

## Taking orders at the till

1. Start a new order on the POS; assign a table for dine-in, or leave it as a
   quick/pickup ticket.
2. Add items, modifiers and course info; apply any per-item notes.
3. Send to the kitchen — it lands on the Kitchen Display routed to the right
   station(s).
4. At close: choose the tender (cash, card, transfer, voucher — see
   [Features → Money](features.md#money) for what "card" means here), split if
   needed, print or skip the receipt.

Voids, comps, price overrides and refunds each need a reason code, and a
manager/owner approval if the acting staff member's capability flags don't
already permit it. Every one of those actions is written to the audit log
against the authenticated identity — not a name typed into a text box.

## Kitchen display

Tickets appear per station as items fire; expo shows the whole order across
stations. Bumping the previous course can auto-fire the next one if the menu
item is configured with `fire_on_previous_course_bumped` — otherwise fire it
manually. There is no separate kitchen-side login: KDS runs off the same
session as the rest of the app, on whatever screen you point at it.

## Cash drawer

Open a drawer session at the start of a shift (with an opening count), close
it at the end (with a blind or confirmed count). Cash tenders are linked to
whichever session is open when they're recorded — if reconciliation looks
wrong, the first thing to check is whether a session was actually open when
the shift started (see [Troubleshooting](troubleshooting.md)).

## Staff and roles

Owner, manager, and staff/cashier roles are backed by per-member capability
flags, not a fixed hardcoded list — what a "manager" can approve is whatever
capabilities that member actually has. Day-to-day, staff either sign in with
an account (owner/manager) or a PIN (till staff); a PIN can be used to step up
a privileged action mid-shift without anyone logging out of the till itself.

Time clock, tip pools and a payroll **export** (hours, commission, tips as a
CSV, not a payroll run) are built in. BeepBite doesn't file anyone's payroll
taxes or pay anyone; the export is the handoff point to whatever you already
use for that.

## Inventory & purchasing

Recipes cost themselves recursively — change an ingredient's price and every
dish that uses it (directly or through a sub-recipe) recalculates. Purchase
orders go supplier → PO → goods receipt → 3-way match against the invoice.
The 86 list flags what's out; reordering suggestions come from stock counts
and movement history, not a demand forecast.

## Reservations & the waitlist

Both are built as ordinary POS surfaces — no separate booking widget or
third-party reservation service is involved.

## Taking orders from outside the building

- **WhatsApp** needs your own Meta Business/Cloud API credentials
  (`WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID` — see [Setup](setup.md)). Without
  them, WhatsApp ordering is simply off; nothing tries to reach Meta.
- **QR-at-table / web storefront** needs no external credentials — it's a
  public page served by your own instance.
- Discord, Slack, and email/DMTAP ordering are **not built** — see
  [Features](features.md#ordering--delivery).

Both channels land in the same order stream as the till, so the kitchen sees
one queue, not two.

## Delivery

Zones are drawn as polygons; a driver's shift, assignment and location pings
all live in the same system. The public tracking page at `/track/:token`
gives the customer a link with no login — the token itself is the access
control, gated by whether the location has enabled ping visibility. This
surface gets less exercise than the POS; treat it as usable, not
battle-tested.

## Reports

Daily sales, hourly heatmap, menu engineering, labor hours, theoretical-vs-
actual COGS, and revenue by payment method are built-in read-only views,
visible to roles with the `can_view_reports` capability. There is no separate
BI product to buy — it's the same database, queried directly.

## When something goes wrong

See [Troubleshooting](troubleshooting.md) for tender-recording, inventory and
WhatsApp-integration problems specifically. There is no phone support line and
no "business hours" chat operated by anyone else — the issue tracker at
[github.com/vul-os/beepbite](https://github.com/vul-os/beepbite) and this
documentation are what exists. If your instance is broken, you (or whoever you
hired to run it) are the first and last line of support, the same way you'd be
for any other piece of software running on your own hardware.

## What this guide won't tell you

- How to appeal a billing charge — there is no bill.
- How to contact "customer success" — there isn't one.
- Anything about GDPR, PCI-DSS or SOC 2 compliance — those describe an
  operator's practices, and BeepBite can't certify yours on its behalf. See
  [Features → Security & isolation](features.md#security--isolation).
