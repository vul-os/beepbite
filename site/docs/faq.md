# FAQ

Straight answers for the person deciding whether to run BeepBite, and for the
person who already does. If a question isn't here, [Features](features.md),
[Setup](setup.md) and [ROADMAP.md](../ROADMAP.md) go deeper — ROADMAP in
particular is where "planned" and "shipped" are kept honestly separate.

## Money and licensing

### What does it cost?

Nothing. BeepBite is [MIT OR Apache-2.0](../LICENSE-MIT) licensed — you pick
either license, use it, modify it, run it commercially, and never owe anyone a
fee for it. There is no per-order fee, no subscription, no per-seat or
per-terminal price, and no feature tier that a payment unlocks. Every feature
in [Features](features.md) is in every copy.

### Do you take a cut of my orders?

No. There is no BeepBite payment facilitator — see
[Does it process card payments?](#does-it-process-card-payments) — so there is
no revenue to take a cut of in the first place.

### Is there a paid tier?

No. There is one binary, and it is not metered, gated or licensed per
location. If someone offers you a "BeepBite Pro" or a hosted BeepBite
subscription, it did not come from this project — there is no company
selling one.

### What's the catch?

You are the entire operations team. Nobody is paged if your Postgres runs out
of disk at 11pm on a Friday. Nobody rotates your backups, patches your server,
or answers a phone when the till won't start. You get the source code, the
documentation, and the issue tracker — the same thing every other self-hosted
project gives you. If that trade doesn't work for your shop, a hosted POS with
a support contract is a legitimate choice and this is not it.

## Ownership and hosting

### Where does my data live?

Wherever you put your Postgres database — a laptop in the back office, a
machine in a cupboard, or a VM you rent. There is no BeepBite-operated
database anywhere. You choose the machine, you choose the region, you choose
who else can reach it.

### Can you see my data?

No. There is no BeepBite service that your instance talks to. A fresh install
makes no outbound network calls at all — nothing phones home. The only things
that ever leave your server are the ones you explicitly configure: WhatsApp
messages to Meta if you set up WhatsApp ordering, email through the SMTP
server you point at, and so on. See
[What each optional integration sends where](setup.md#optional-integrations)
for the full, specific list.

### What happens if the project stops being maintained?

Your instance keeps running exactly as it did the day before — it's a binary
and a database on your own hardware, not a subscription that lapses. Because
the license is MIT OR Apache-2.0, you (or anyone) can keep patching your own
fork forever with no permission needed from anyone.

### Can I export everything?

Everything lives in your own Postgres database. `pg_dump` gives you the whole
thing — every order, every customer, every menu item, in a format Postgres
itself can restore anywhere. There is no proprietary export format standing
between you and your own data because there was never an import into
somebody else's format in the first place.

### Do I need to be online?

For the till, kitchen display, floor plan and back office — no. Those talk to
your Go API over your own LAN. **Offline order-taking during an internet
outage is not implemented today**, though: `src/offline/` exists in the tree
(ULIDs, an idempotency helper, a mutation queue) but nothing in the running
app calls it yet, so a dropped connection at the till behaves like a dropped
connection always has. Postgres itself has to be reachable from the API at
all times, whether that's "on the same box" or "on your LAN."

> [!NOTE]
> Bringing offline tolerance online is a committed roadmap item (Now-2 in
> [ROADMAP.md](../ROADMAP.md)) — the target is 30 seconds to two minutes of
> outage tolerance, not full offline POS. It is not shipped yet.

### Do I need a public URL?

Not for the counter. Whether you need one at all depends on which surfaces
you use — see the reachability table in
[Features → Reachability](features.md#reachability--what-actually-needs-a-url)
for exactly which surfaces need inbound HTTPS (WhatsApp ordering, the public
storefront/tracking page, the online-payment return URL) and which never do
(till, KDS, floor plan, back office, driver app on your own Wi-Fi). Getting a
URL, if you need one, is a commodity problem BeepBite deliberately has no
opinion about — a tunnel, a small VPS, a reachability broker, whatever you
already trust.

## Countries and currencies

### Which countries does it work in?

Any. There is no hardcoded country list and no country BeepBite refuses to
run in. Currency, tax convention, timezone, locale and dial code are all
per-location configuration, not a build-time or country-level choice — see
[Setting your location](setup.md#5-setting-your-location) in Setup.

### Which currencies?

Any ISO 4217 currency code. `src/lib/currency.js` formats money by asking
`Intl.NumberFormat` to render the amount in the reader's own locale, and
tracks the currency's actual minor-unit exponent rather than assuming every
currency has 2 decimal places:

- **Zero-decimal currencies** (the major unit *is* the minor unit) — JPY,
  KRW, VND, CLP, ISK and others — are handled explicitly, so ¥1000 prints as
  ¥1,000, not ¥10.
- **Three-decimal currencies** — KWD, BHD, OMR, JOD, TND and others — are
  handled explicitly too, so KD 1.000 prints correctly instead of KD 10.00.

An unconfigured location renders amounts as a bare number rather than
guessing a currency — deliberately, so an unfinished setup looks unfinished
instead of confidently wrong.

### Which languages ship?

Nine, in `src/i18n/locales/`: English, Afrikaans, Arabic, Spanish, French,
Hindi, Portuguese, Xhosa and Zulu. Locale (for number/date formatting) and
language are both per-location settings — see
[Setting your location](setup.md#5-setting-your-location).

### Do tax, timezone and dial code also resolve per location?

Yes, all four — currency, tax convention, timezone and dial code — resolve
per location from configuration (`backend/internal/locations`), not from a
single global default. Tax is a rate, an inclusive/exclusive flag, and a
free-text label (so it can read "VAT," "GST," "IVA," "Sales Tax," or whatever
your jurisdiction calls it) — never a hardcoded percentage or country. See
[Features → Currency, tax & locale](features.md#currency-tax--locale).

## What it does and doesn't do

### Does it handle multiple branches?

**Not today.** BeepBite is one instance, one restaurant's data. Two running
instances **cannot exchange data** — there is no push/pull between them, no
way for one branch to enroll as a peer of another, and no path for one
instance's changes to apply to a second instance's database. What exists
toward this is genuinely partial and worth being precise about, because the
pieces sound more finished than the feature is:

- `internal/nodeid` can generate and persist a node keypair — nothing calls
  it yet.
- `internal/oplog` implements the merge algebra (a hybrid logical clock,
  last-writer-wins registers, version vectors) — it has no persistence, no
  transport, and nothing in the server writes to it.
- A newer `internal/sync/substrate` engine can classify all 149 tables by
  ownership and turn a database write into the operations that describe it
  — but there is still **no push/pull round, no peer enrolment, and no apply
  path.** A peer's operations arriving and being written back into your
  tables is a separate, unbuilt piece of work.

If you run two locations today, run two separate BeepBite instances with two
separate menus, two separate sets of books, and no shared data. See
[Now-5 in ROADMAP.md](../ROADMAP.md#now-5--multi-branch-sync-hlc-oplog-manual-peer-enrollment)
for the actual design and what's landed of it.

### Does it work offline?

No — see [Do I need to be online?](#do-i-need-to-be-online) above.

### Can customers order on WhatsApp?

Yes, and it's a real, shipped integration — a direct Meta Cloud API
integration using **your own** WhatsApp Business credentials
(`WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`).
BeepBite never holds a shared account or a shared number pool; without your
credentials the whole channel is dark and QR/web ordering still works fine.
It also needs a public HTTPS URL, because Meta's Cloud API only delivers
messages by webhook — see
[Features → Reachability](features.md#reachability--what-actually-needs-a-url).

### Discord, Slack, or email ordering?

**Not built.** WhatsApp and the QR/web storefront are the two ordering
channels that exist. A channel-adapter interface (`internal/channel`) exists
in the tree so that adding a new channel is a smaller job than it used to be,
but that lowers the *cost* of adding Discord, Slack or email — it does not
add them. Nobody should be told BeepBite already does this. See
[Now-3 and "Later" in ROADMAP.md](../ROADMAP.md#later--deferred-behind-triggers)
for what's actually scheduled and what its trigger is.

### Does it process card payments?

No, by design, and this is one of the firmest lines in the project. BeepBite
**records tenders** — cash, card, transfer, voucher — against the order and
reconciles them into the drawer at close. "Card" means your own card machine
on your own counter: BeepBite records the amount and a reference, nothing
more. Card data never reaches the application, so BeepBite holds **no PCI
scope** — not because it was certified out of scope, but because it never
touches the thing that would put it in scope.

There is one optional, off-by-default exception for **remote** orders (placed
over WhatsApp or the web storefront) that have no counter to pay at: a
verify-on-return online-payment path behind a compile-time build tag
(`-tags patala`), **not present in the default build at all**. It is unit-
and integration-tested but its own integration tests currently **fail**, and
it has **never been run against a live payment processor**. Treat it as
unproven. Full detail in [ONLINE-PAYMENTS.md](ONLINE-PAYMENTS.md).

## Hardware and practical

### What hardware do I need, actually?

- **A computer to run the API and Postgres on** — a laptop, a small server, a
  cupboard machine, a VM. Linux or macOS, x86-64 or ARM. **Windows binaries
  are not built.**
- **Screens/devices for the till, kitchen display and floor plan** — any
  device with a modern browser on your LAN. No special POS terminal is
  required.
- **A receipt/kitchen printer, if you want physical tickets** — verified in
  code, not assumed:
  - **Network (TCP/IP) ESC/POS thermal printers are genuinely supported.**
    `backend/internal/escpos` builds real ESC/POS command sequences (text,
    bold, cut, barcodes) and sends them over a raw TCP socket to the
    printer's IP and port (9100 by default) — this works today, no agent or
    driver needed on your side beyond the printer itself.
  - **Cash-drawer kick is supported through that same network printer** —
    the standard ESC/POS drawer-kick pulse is sent down the printer's
    cable, which is how RJ11-connected cash drawers are normally triggered.
    There is no separately-driven cash drawer device.
  - **USB printers are not actually wired up.** The backend accepts a "usb"
    connection type and always reports a stub success with the message "usb:
    send via pos agent" — but no such POS agent exists anywhere in this
    repository. Don't rely on USB printing today.
  - **Every receipt can also be printed from the browser.** The POS and the
    order-detail screen both have a "Print" button that calls the browser's
    own `window.print()` — this works with any printer your OS already
    knows about, network or USB, with no BeepBite-specific driver at all.
- **A barcode scanner, if you use one, needs no special support.** Any
  scanner in USB/Bluetooth "keyboard wedge" mode works out of the box — the
  POS listens for the rapid burst of keystrokes a scanner types and treats
  it as a scanned code (`src/pages/pos/hooks/use-barcode-scanner.js`).
  There's no scanner driver or pairing flow to install.

### Who do I call if something breaks?

Nobody. There's no phone line, no support contract, and no "business hours."
What exists: this documentation, the [issue tracker](https://github.com/vul-os/beepbite/issues),
and the source code itself. [Troubleshooting](troubleshooting.md) covers the
problems people actually hit.

### Is it audited or certified?

No. BeepBite makes **no claim** to PCI-DSS, GDPR, or SOC 2 certification —
those describe an *operator's* practices, not software someone installed, and
there is no single BeepBite operator to certify. Card data never reaching the
app removes PCI scope by construction (see
[Does it process card payments?](#does-it-process-card-payments)), which is a
property of what BeepBite refuses to do, not a control that was audited. No
outside firm has reviewed a self-hosted deployment you run, because there
isn't one deployment to review — there's whichever one you stood up.

### Can I import from my current POS?

No — there is no importer for Square, Toast, Lightspeed, Clover, or anything
else. Menu items, staff, and historical orders all have to be entered by
hand or via BeepBite's own CSV-less admin screens. If you need your sales
history for accounting, export it from your current system before you
switch; BeepBite has nothing that reads another vendor's export format.

## A few more, quickly

**Is it a marketplace or a directory that brings me customers?**
No. It will not list your restaurant anywhere or send you customers — it
exists to stop a marketplace from owning the customers you already have.
There is no BeepBite directory, no discovery surface, no slug namespace
anyone else administers.

**Does payroll actually run payroll?**
No — it's a CSV **export** of hours, tip pools and commission, for you to
feed into whatever actually files and pays. BeepBite does not calculate
withholding, file taxes, or move money to anyone's bank account.

**Does the customer tracking page show a live map?**
Partly, and it is worth knowing which part. The order-progress stepper
(pending → confirmed → preparing → out for delivery → delivered) and the ETA
both work. The map only appears once the order actually reaches **out for
delivery** — before that there is nothing moving to show, so the page renders
an empty state rather than a blank box. The driver's own position is withheld
from anonymous tracking links by a server-side privacy gate, so a customer
following a plain `/track/:token` link generally sees progress and an ETA
rather than a moving marker.

An older version of this answer described the map and ETA as a known unfixed
bug, where the backend returned a flat payload and the frontend expected a
nested one. That was true, and it was fixed in commit `7739452` by
`normalizeTracking()` in `src/services/tracking.js`.

**Is there an AI feature, and does it phone home if I don't want it to?**
An AI floor-plan generator and an owner-assistant chat exist, wired to
Google's Gemini API. Like every other integration, it is **off unless you
supply `GEMINI_API_KEY`**; without it, nothing related makes a network call.

**Can I run this on a Raspberry Pi or a tiny VPS?**
Postgres is the real requirement, not CPU — anything that can run
PostgreSQL 15+ and a small Go binary comfortably will run BeepBite. There is
no published minimum-spec number because nobody has benchmarked one; if you
try it on constrained hardware, the [issue tracker](https://github.com/vul-os/beepbite/issues)
is the place to report what you found.

**One instance, one restaurant, or can it host several unrelated
businesses?**
The schema and every handler are multi-org internally, and nothing stops you
running several unrelated businesses' data in one instance if you administer
it that way. That said, this is listed as an open, **unratified** founder
decision in [ROADMAP.md's Open section](../ROADMAP.md#open--founder-decisions)
— don't build a business on an assumption the project itself hasn't
committed to yet.
