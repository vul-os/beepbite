# User Guide

Running service on BeepBite, screen by screen, written for the person
running the restaurant rather than the person who built the software. For a
tagged, area-by-area account of what's built versus not, see
[Features](features.md) and [README's Status table](../README.md#status) —
this guide assumes the Built column, but flags it plainly wherever a screen
here is thinner than you'd expect.

Two things this guide is not:

- **Not the install guide.** Getting an instance running — PostgreSQL,
  migrations, starting the server — is a one-time technical job. If nobody's
  done that yet, hand [Setup](setup.md) to whoever does your IT and come
  back once you have a web address to open. Nothing past this paragraph
  needs a terminal.
- **Not a sales pitch.** BeepBite is free — MIT OR Apache-2.0, no per-order
  fee, no subscription, no feature tier a payment unlocks, every feature in
  every copy. It's self-hosted: your data lives in a Postgres database on
  hardware you (or whoever you hired) control. There's no BeepBite cloud, no
  company to call, no bill to appeal. See [FAQ](faq.md) for the blunt
  version of that trade.

---

## 1. Before your first service

A few decisions are cheaper to make once, before staff start typing orders
in, than to fix after a week of live data.

- **How many locations?** "Location" is the unit almost everything hangs
  off — menu, tax, currency, staff, drawers, floor plan. A second site is a
  second location in the same organization, not a second install.

  > [!WARNING]
  > Two *separate* BeepBite instances don't share data today — no push, no
  > pull, no peer enrolment. If you run more than one physical site, put
  > both locations in **one** instance, or accept two fully independent
  > restaurants with no shared books. See
  > [Features → What is not a feature](features.md#what-is-not-a-feature).

- **Currency and tax convention, per location.** Any ISO 4217 currency, a
  tax rate, a free-text tax label ("VAT," "GST," "Sales Tax"…), and an
  inclusive/exclusive setting — decide now whether menu prices already
  include tax (EU/UK/SA/Japan) or tax is added at the till (US/Canada).
- **Timezone** — decides when a location's trading day starts and ends, for
  every daily report and drawer session.
- **How do you serve customers?** Dine-in with tables, or counter/takeaway
  with no floor plan — a real setting, see [First login](#2-first-login-and-setting-up-your-shop).
- **Staff roles.** Five fixed roles — Owner, Admin, Manager, Cashier,
  Kitchen Staff — each with a baked-in set of *capabilities* (void an order,
  approve a comp, close a drawer…). No screen exists to hand-pick
  capabilities per person, so decide who needs manager-level approval power
  before the role gets assigned.
- **Payment methods.** Cash, your existing card machine, bank transfer,
  gift cards and house accounts are all first-class. Online card payment
  through BeepBite itself is not something to plan around — see
  [Taking payment](#8-taking-payment).
- **Customers ordering from outside the shop?** WhatsApp ordering and a
  public ordering page both need your own WhatsApp Business (Meta Cloud API)
  credentials and/or a public web address — arrange both with your
  technical operator before service. See
  [Orders from outside the building](#10-orders-from-outside-the-building).

---

## 2. First login and setting up your shop

Once your instance is running with a web address, open it in a browser.
There's no salesperson-operated signup — you create your own owner account
on the sign-up screen, against your own database. If someone else already
set the instance up, ask them for your login instead.

**The onboarding wizard** runs the first time you sign in as owner: six
steps, each linking to the real page where the work happens, each only
marked done once it can actually see you did it (a **Refresh** button if it
hasn't caught up):

1. **Verify your email.**
2. **Create your first store** — shortcut into Settings → Locations → Add
   location: name, URL slug, city.
3. **How do you serve customers?** — Dine-in (turns on the floor plan) or
   Takeaway/counter (skips straight to order entry). Revisit later under
   Settings → \[location\] → Status.
4. **Add 5 menu items** — see [Building your menu](#3-building-your-menu).
5. **Invite a staff member or driver.**
6. **Ship a test order** — ring anything up at the till and complete the
   sale.

**Settings** is grouped into four sidebar sections: **Business**
(Organization, Locations, Domains), **Storefront** (Promotions, Delivery
zones, Loyalty), **System** (API keys, Hardware, Kitchen routing), **You**
(Account). The screen worth knowing well is **Settings → Locations →
\[your location\]**, four tabs:

- **Details** — name, WhatsApp number, description, address.
- **Regional** — country, currency, timezone ("use mine" auto-detect),
  locale, plus a tax card (rate, label, **"Prices include tax"** toggle) —
  with a live formatting preview.
- **Delivery** — fee, free-delivery threshold, max distance, prep time,
  and accept-delivery/accept-pickup switches.
- **Status** — the dine-in/takeaway picker from onboarding, and a
  location-active toggle.

Worth knowing exist even if you don't touch them day one: **Business
Info** (legal name, address, tax registration number — used on B2B
invoices), **Domains** (connect a custom hostname via DNS records, with a
verify flow), and **Hardware** — register printers. **Network printers
work today** (BeepBite talks straight to the printer's IP, no driver
needed) and can kick a cash drawer over the same cable; **USB printers are
not wired up yet**. Every receipt can also print from the browser's own
print dialog regardless. **Kitchen routing** (which categories/items route
to which station) is covered in [The kitchen display](#7-the-kitchen-display).

> [!NOTE]
> There's no screen to edit what a role can do. The five roles carry fixed
> capabilities. If you need finer-grained permissions than that, it's a
> real limitation today, not a setting you haven't found.

---

## 3. Building your menu

The **Menu & Recipes** page (search, filters, **Add Item**) and a separate
**Categories** page cover this.

**Categories** are two levels deep — main categories with one level of
subcategories. Reordering is up/down arrow buttons only, no drag-and-drop.
A category can't be deleted while it still has subcategories.

**Items.** **Add Item**: name, category (with an inline "+ add"), selling
price, cost price, prep time, description, a **Recipe Type** (Simple Item /
Component / Recipe), and four switches — Active, auto-calculate cost from
recipe, track inventory, and "usable as an ingredient in other recipes."
Track-inventory adds current-stock and low-stock-alert fields.

**Modifiers** live inside an item's Recipe dialog (tree icon), under a
Modifiers tab: groups (e.g. "Choose a size") with min/max selections and a
required switch, options with a signed price delta and a default flag.
Options can be individually 86'd without touching the whole group.

**Courses** — Starter, Main, Dessert — are managed on their own page,
**Menu → Courses**. Each has a name, sort order, and an **"Auto-fire when
previous course is bumped"** switch: turn it on so the next course fires
automatically once every ticket in the one before it is bumped, instead of
a runner firing it by hand. Items don't carry a fixed course in the editor
— a course is assigned per line at the till.

**Recipes and costing.** The Recipe Builder (tree icon) has three tabs:
**Ingredients** (pick from items flagged "recipe ingredient," set quantity/
unit/cost — sub-recipes genuinely nest, tracked by depth), **Prep Steps**
(ordered plain-language instructions that ride onto the KDS ticket), and
**Modifiers** (above). Back on the main Menu page, **Recipe Breakdown**
gives a collapsible cost tree per recipe, and **Cost Analysis** compares
listed vs. calculated cost per item, buckets margin (low/moderate/good/
high), and flags a **cost mismatch** when the two costs disagree by more
than a dollar — sort by variance, switch on **"Problems only"** to triage.

**The 86 list.** 86'ing an item happens at the till — every tile has a
one-tap **86** control. The manager dashboard's **86'd Items** card lists
everything currently 86'd and why (low inventory, a date limit, or manual).

---

## 4. Taking orders at the till

The till is the **POS Workspace** at `/pos/login`. Owners/managers sign in
with email and password; day-to-day staff use the **PIN** tab — username
plus a numeric keypad.

**Starting an order.** Dine-in locations ask **"How will the customer be
ordering?"** — **Eat-in** opens a table picker, **Takeaway** starts a
walk-in ticket. Takeaway-only locations get one **New order** button. A
strip across the top shows every table (color-coded, see
[The floor plan](#6-the-floor-plan)) plus open tabs and a **"+ New tab"**
button. Tapping an available table opens a session; tapping an occupied one
reloads its order.

**Adding items.** A searchable menu grid, grouped by category, with live
"N left"/"Sold out" countdowns where a daily limit applies. Items with
modifiers open a **Customise** dialog with a running total. The ticket
panel has two halves: **Sent to kitchen** (read-only, grouped by round,
per-item status Fired/Cooking/Ready) and **New — not yet sent** (editable
qty, remove, course dropdown). **Send** fires only new items as a fresh
round; **Charge** opens payment once something's sent and unpaid.

**Seats and splits.** The header's **Split** button (once a table has sent
items) opens **Split Check by Seat**: name seats, allocate every item to
one or more (a "Left" column flags what's unallocated), **Apply Split**
breaks the check into per-seat totals each with its own **Tender** button —
the table clears once every seat is paid.

**Voids, comps, discounts, manager approval.** Right-click, long-press, or
the **⋮** on a sent order (**Void**) or item (**Comp**/**Discount** — a
price override). Pick a reason; reasons flagged for manager sign-off add a
step — pick the approving manager and enter their PIN, a lightweight
step-up that doesn't log anyone out. The same pattern fires automatically
whenever any action needs a capability the signed-in PIN lacks. Every void,
comp, discount and approval is written to the audit log against whoever
actually authenticated it.

**Assign/move table** — header button, opens a search-and-filter dialog
over the floor plan; occupied tables are disabled with a tooltip.

---

## 5. Quick POS / kiosk mode

At `/q/your-store-slug` — no login, no tables, no held-open tabs, no
splits, no voids/comps, just menu → cart → tender in as few taps as
possible. Use it for a **self-order kiosk** (a tablet on a stand, or a QR
code that opens this page) or a **fast-counter flow** (coffee, a market
stall) where every transaction is order-pay-done. Don't use it if you need
tabs held open across a meal, seat splits, or manager approval — that's the
full POS Workspace.

---

## 6. The floor plan

**Floor** (auto-refreshes every 15 seconds) shows every table's status with
a color, icon and text label together — never color alone:

| Status | Meaning |
|---|---|
| Available (green) | Free to seat |
| Occupied (orange) | Has an open tab |
| Reserved (amber) | Held for a booking |
| Out of service (gray, dashed) | Not usable |

Tapping a table opens a session or jumps to its existing ticket. Section
tabs filter the view.

> [!NOTE]
> There's no seated-duration or turnover-time indicator today. For a sense
> of how long a table's been sitting, check the fired times on its ticket.

**Floor Editor** (Edit Floor button): drag tables to reposition (auto-saves,
snaps), **Add Table** (label/capacity/section), and an **AI floor plan**
tool — describe your space in plain English, review the generated layout,
and apply it additively. You need at least one **section** before adding a
table; the editor points you at Settings for section management, but the
AI floor plan tool is the most reliable way to create your first one — it
creates sections and tables together.

---

## 7. The kitchen display

Each station has its own board at `/kds/:stationId`, no separate kitchen
login. Tickets are colored by age since fired — **green** (Fresh, under 5
min), **amber** (Warming, 5–10 min), **red, pulsing** (Late, 10+ min) —
and show item, qty, status pill, allergens, modifiers, notes, and an
expandable recipe/prep-steps panel.

- **Mark Ready** bumps a ticket off the board, opening a 30-second
  **Recall** window.
- **Rush** flags priority without bumping.
- **Refire** brings a bumped ticket back if it needs remaking.

Shortcuts (press **?** for the list): **1–9** bump the matching ticket,
**Space** bumps the focused one, **r** recalls the last bump, arrows move
focus. If the live feed drops, a banner says so plainly rather than failing
silently.

**Expo** (Kitchen → Expo, or the till's **Kitchen** button) is the
cross-station board for whoever runs food: one card per order, one block
per station it touches. **Waiting** means one station's done while another
still cooks; **Ready to plate!** means every station's done. Expo is
read-only — no bump button, just "what's blocking this order."

**Course firing** is configured on Menu → Courses (see
[Building your menu](#3-building-your-menu)): turn on auto-fire, and the
next course's tickets fire on their own once every ticket in the course
ahead of it is bumped. There's no "held for course" indicator beforehand —
a waiting course just isn't on the board yet, then appears as a normal new
ticket once it fires.

---

## 8. Taking payment

BeepBite **records tenders — it does not process card payments.** There's
no gateway between you and the customer's card. Your card machine, bank
account and cash drawer move the money; BeepBite records which one was
used, so the drawer reconciles and reports stay true.

| Code | Name | What it means |
|---|---|---|
| `cash` | Cash | Notes and coins into the drawer. |
| `card` | Card Machine | Your own card machine. Amount and slip number recorded, nothing more. |
| `transfer` | Bank Transfer | EFT — capture the reference to match your bank statement. |
| `voucher` | Voucher | Gift card, meal voucher, comp instrument. |
| `cash_on_delivery` | Cash on Delivery | Collected at the door. |
| `card_on_delivery` | Card on Delivery | Collected at the door on a portable machine. |

**At the till:** tap **Charge**, then a quick **Cash**/**Card** tile for a
single method, or **Split Tender** to record several legs against one
order (each with a reference field for card/gift card/house account). A
live "remaining" balance gates **Confirm Payment** until it hits zero; cash
change is calculated for you. A receipt opens automatically — printing
works, emailing/WhatsApp-sending a receipt are visible but not wired up.

**Gift cards** — the **Gift Cards** page: **Issue** (balance, digital or
physical, optional expiry/PIN, optional customer and staff link) and
**Lookup** (balance, **Reload**, or **Refund to Card**). There's no
separate "store credit" ledger — a gift card is the closest equivalent.
Redeem one at the till by choosing **Gift Card** as a tender leg and
entering the code as the reference.

**House accounts and invoices.** A house account is a running tab for a
regular customer or business — create one under **House Accounts** with a
credit limit and terms (e.g. Net 30), add member customers. Orders charged
to it (choose **House Account** as tender) accumulate as open charges;
**Generate invoice** bundles them, and the account's **Invoices** tab
tracks open/partial/paid with **Record Payment**. The separate,
standalone **Invoices** page is a general B2B tool for hand-built invoices
(line items, tax, PDF) — it isn't connected to house accounts.

**Delivery orders** sit unpaid until the driver collects; **Mark paid on
delivery** then records `cash_on_delivery`/`card_on_delivery` — kept
distinct because that money never touched your drawer.

**Refunds** — fastest via the till header's **Return** button while an
order's fresh, or **Orders → \[order\] → Refund** for anything closed out;
select items or a custom amount. BeepBite records the refund against the
original tender — actually returning the money (drawer, card machine) is
on you.

> [!WARNING]
> An **optional, off-by-default** online card payment path exists for
> remote orders with no counter to pay at. It's gated behind a compile-time
> build flag (`-tags patala`) not in the default build, its own integration
> tests currently **fail**, and it has **never run against a live
> processor**. Don't plan around it. See [ONLINE-PAYMENTS.md](ONLINE-PAYMENTS.md).

---

## 9. The cash drawer

Pick a drawer on the **Cash** page.

**Opening a session** — enter the opening float as a number, or switch to
**Count denominations** for a tile per note/coin. Tick **Blind close** if
the closer should count without seeing the expected total. **Open Session.**

**During the session** — **Record Movement** covers **Paid In, Paid Out,
Petty Cash, Tip Out, No Sale, Drop, Pickup**, each with an amount and a
reason. Every cash tender rung up is automatically linked to whichever
session is open — if reconciliation looks wrong, check first whether a
session was actually open when the shift started.

**Closing** — expected balance shows up front unless it's blind, in which
case it's hidden until you submit your count. Enter a declared amount (or
count denominations), and a live variance reads **Balanced/Over/Short**,
flagging anything past a few currency units for a required note.
**Confirm Close** finishes it. Right after, an **End-of-Day report** shows
expected vs. declared per payment method; reopen it later as that session's
**Cash-Out Report**. That per-session report — not a Reports-page menu
item — is where cash reconciliation actually happens today.

---

## 10. Orders from outside the building

**WhatsApp** needs your own Meta Business/Cloud API credentials — entirely
off, nothing reaching Meta, until you supply them. Setup (number, webhook,
a public HTTPS address for your instance) is a one-time technical step —
see [Setup](setup.md). Once live, WhatsApp orders land in the **same
stream** as the till, one kitchen queue, and order-ready notifications go
back out over WhatsApp automatically. A separate, smaller screen lets a
customer who messages your WhatsApp number link that phone to their
BeepBite account (up to three numbers) — customer-facing, not a staff tool.

**Your public store page** — served straight from your own instance at
`/store/your-shop-slug`, no external credentials needed. A customer picks
**Delivery** or **Collection**, enters name and phone, and pays on a hosted
page (only if online payment is enabled) or by cash/card on delivery.

> [!NOTE]
> This page supports delivery and pickup ordering; it has no table-number
> field and doesn't route an order back to a floor-plan table. A "QR at the
> table" workflow today means printing a QR code that opens this same
> public menu — a convenient way to hand a customer a menu on their phone,
> not a system that ties an order to their seat automatically.

BeepBite is not a marketplace and doesn't list your restaurant anywhere by
default — this page shows your menu, and only your menu. Discord, Slack
and email ordering are **not built**; WhatsApp and this page are the two
channels that exist.

---

## 11. Delivery and pickup

**Zones** — Settings → Delivery zones: draw a polygon per zone, set fee,
minimum order, ETA and priority.

**Drivers** work from a web page in their phone's browser, no app to
install — an **Online/Offline** switch controls whether they're receiving
work; while online with an accepted delivery, location pings automatically
for the customer's tracking page. Assignments move **Offered → Accepted →
Picked up → Delivered**, cancellable up to pickup.

**Customer tracking** — every delivery order gets a public, no-login link
at `/track/:token`; the token itself is the access control. Customers see a
four-step progress bar (**Order placed → Preparing → Out for delivery →
Delivered**, or a cancelled state), an ETA, and a map.

> [!NOTE]
> Be realistic about the map: it only appears once an order is genuinely
> out for delivery, and for an anonymous link (no customer login) the
> driver's own position essentially never shows on it, by design. What
> customers reliably get is the step tracker and a rough ETA.

**Pickup slots** exist as a time-slot picker showing remaining capacity per
window — confirm with whoever manages your storefront whether it's turned
on for your flow. This whole area sees less exercise than the till; treat
it as usable, not battle-tested.

---

## 12. Inventory and purchasing

> [!NOTE]
> Inventory uses a **separate catalog** from your menu. Menu items are what
> you sell; inventory items are the raw stock you buy from suppliers.
> Purchase orders are built against the inventory catalog — don't expect
> menu items in a PO's item picker.

**Suppliers** — name, contact, payment terms (net days), address, active
flag.

**Purchase orders** — PO number, supplier, expected delivery, a line-item
table (inventory item, qty, unit, unit cost). A new PO starts **Draft**;
the only status change on screen is **Submit PO**, moving it to **Sent** —
there's no separate approve/reject screen, so submitting is the approval
step.

**Auto-PO suggestions** groups low-stock items with a preferred supplier,
one card per supplier, **"Create N selected POs"** drafts them in one go —
driven by stock counts and movement history, not a demand forecast.

**Goods receipts (GRN)** — when a PO delivery arrives, find its receipt and
hit **Receive**; confirming updates stock and logs a movement per line.
There's no manual "create a GRN" screen — receipts generate once a PO is
sent, ready to confirm as stock shows up.

**Invoice matching** — find a supplier invoice on **Invoice Match**, hit
**Run Match**: BeepBite lines invoice quantities/prices up against the PO
and GRN, flags variance beyond tolerance.

> [!NOTE]
> A dedicated stock-movements ledger, a waste-tracking screen, and an
> ingredient price-history view aren't in the current build — the
> underlying stock counts driving low-stock alerts are real, but there's no
> page to browse movements, log waste, or see price trends over time yet.

---

## 13. Reservations and the waitlist

Both are ordinary staff-facing pages — no separate booking widget or
third-party service.

**Reservations** — pick a date; bookings sort into **Pending, Confirmed,
Seated, Past/Cancelled**. **New Reservation**: name, phone, email, party
size, duration, date/time, special requests. **Confirm**, **Seat**, and
**Cancel** move it along; a booking more than 15 minutes past its time gets
a **Running late** flag.

> [!NOTE]
> Seating a reservation just changes its status — it doesn't hand you a
> table or open a session. You still open the table and start the order
> from the till or floor plan yourself.

**Waitlist** — **Add Guest**: name, phone, party size, quoted wait
(minutes), notes. Entries show actual elapsed wait, flagged **(overdue)**
past the quote. **Seat Now**, **Left**, **No Show** remove them from the
queue.

> [!NOTE]
> There's no automatic text or WhatsApp message to a waiting guest — the
> quoted wait is just a number tracked against the clock; calling the name
> is still on you.

---

## 14. Staff

**Roles** — Owner, Admin, Manager, Cashier, Kitchen Staff, each with fixed
capabilities (void, comp, close a drawer, manage staff, view reports,
drive). No screen reassigns what a role can do — pick the closest one.

**Adding staff** — the **Staff** page: name, email, employee ID, role,
password, plus **Set/Reset PIN** (4–6 digits, used to sign in at the till).
**Staff → Manage** adds pay-rate history, a weekly shift-scheduling grid,
and the same PIN/password tools under Security.

**Signing in at the till (PIN)** — username plus a numeric keypad. On a
device already signed in, entering a PIN is a lightweight step-up layering
that staff member's identity on top for a stretch of active use, clearing
after 15 minutes idle or a refresh; on a fresh device it's a full sign-in.
Five wrong PINs lock the account for **15 minutes** — waiting it out or a
manager PIN reset is the only fix.

**The time clock** — the **Timeclock** page: pick your name, **Clock In**/
**Clock Out**, with a status banner. A manager-only panel lists every entry
(clock in/out, break start/end) with an edit option that requires a reason
for the change, keeping edits auditable.

**Tips and payroll.** Tip pooling runs on the backend but has no on-screen
setup yet — a request for your technical operator, not a Settings page.
Payroll is a **CSV export of hours, rates and tips for a pay period — not a
payroll run.** BeepBite doesn't calculate withholding, file taxes, or pay
anyone; the export is the handoff to whatever you already use for that. As
of this writing there's no button in the app for it — it's an API endpoint
your technical operator can pull on a schedule, one of the few places here
where "ask someone technical" is the honest answer.

---

## 15. Customers

**Loyalty (stamp cards)** — Settings → Loyalty: enable a stamp programme,
set stamps required for a free item, and optionally restrict which item
qualifies.

**Promotions and coupons** — Settings → Promotions: percent off, fixed off,
BOGO, free item, happy-hour price, or free delivery, scoped to order, item,
category or delivery, each with its own coupon codes managed inline.

**Reviews** — the **Reviews** page: filter by time range and rating (shown
as five stars alongside the underlying 10-point score), an overview of your
average, and a **Reply** tool. There's no delete or hide action — replying
is the only owner-side action wired up, so plan on responding rather than
moderating.

---

## 16. Reading your numbers

**Reports** is a single page, filterable by date range. What's genuinely
live today:

| Chart / card | What it shows |
|---|---|
| Total Orders | Real order counts for the selected range |
| Weekly Order Volume | Orders and revenue per day |
| Orders by Hour | Order counts by hour, useful for staffing peaks |

> [!NOTE]
> Average rating, completion rate, response-time trends and a per-order
> response-time table are visibly present but currently show zero or "N/A"
> — the data behind them isn't wired up yet. Don't read anything into a
> blank value there.

Six reporting views exist in the database; only the two above have a
screen built on them. The other four are computed and ready, just without
a page yet:

| View (database only) | Computes | Supports |
|---|---|---|
| Menu engineering | Units sold, revenue, cost, margin per item (30 days), classified star/plowhorse/puzzle/dog | Promote, reprice, or cut a dish |
| Labor hours | Clocked hours per shift, break time deducted | Labor cost vs. scheduled hours |
| Theoretical vs. actual COGS | Menu-cost-implied food cost vs. actual stock movement | Food-cost and waste variance |
| Revenue by payment method | Totals per tender, per day | Cash/card mix, matching your card machine's settlement |

If you need one of those, that's a question for whoever runs your database
directly (the same Postgres your orders live in), not a button in the app.
For **cash reconciliation**, see [The cash drawer](#9-the-cash-drawer) — it
lives on the Cash page, per session, not on Reports.

---

## 17. The assistant

The **Store Assistant** — a page inside BeepBite styled like a chat, not
WhatsApp itself — is an owner/manager tool for quick edits without clicking
through several screens. Type a message, or use a literal slash command:

| Command | What it does |
|---|---|
| `/86 <item name>` | Marks the item unavailable |
| `/un86 <item name>` | Brings it back |
| `/price <item name> <amount>` | Updates its price |
| `/sales` | Today's orders, gross, net, average order value |
| `/help` | Lists commands and natural-language examples |

Anything else — including an unrecognized `/`-message — is handled as plain
language: list items, create a category, add an item at a price, check
kitchen-ticket counts, or list low stock, among others. It can also take a
menu photo, PDF or CSV and build a **draft** import — review each line
(**Create new**/**Update existing**/**Skip**), then **Commit to menu** or
**Discard**; nothing writes to your live menu until you commit.

> [!NOTE]
> Don't confuse this with the **Chat** page — that's the diner-facing
> ordering assistant customers use to browse and order. The Store Assistant
> is for you and your managers.

With no AI provider key configured, the slash commands above still work
(they're not AI-backed), but free text just replies that the AI assistant
isn't configured.

---

## 18. Working in another language or currency

Currency, tax convention, timezone, locale and dial code are all configured
per **location** — a second site in a different country is a configuration
change, not a different build.

- **Currency** — any ISO 4217 code, with zero-decimal (JPY, KRW…) and
  three-decimal (KWD…) currencies both handled correctly. An unconfigured
  location shows bare numbers rather than guessing.
- **Tax** — a rate, an inclusive/exclusive flag, and a free-text label.
- **Language** — nine ship today: English, Afrikaans, Arabic, Spanish,
  French, Hindi, Portuguese, Xhosa, Zulu, set per location alongside locale.

Running several locations in different currencies and want one
consolidated set of books? An off-by-default currency-conversion seam
exists for exactly that case — built for one operator wanting a single
combined report, not a general feature to switch on lightly. Ask your
technical operator first.

---

## 19. When something goes wrong during service

- **Cash doesn't reconcile at close.** Usually no drawer session was open
  when the shift started — check the Cash page. A cash sale still gets
  recorded with no session open, just not attributed to one.
- **KDS shows "Reconnecting" or "Offline."** Tickets may be stale — refresh.
  If it doesn't return, that's a network/server issue for whoever runs your
  instance.
- **WhatsApp orders stop arriving.** Almost always a credentials/webhook
  problem, not a till issue — flag it to whoever set up the integration and
  see [Troubleshooting](troubleshooting.md).
- **A staff member's locked out of the PIN screen.** Five wrong PINs locks
  the account 15 minutes — wait it out or have a manager reset the PIN.
- **A button's grayed out or errors.** Usually their role lacks a needed
  capability; a manager PIN step-up should pop up to authorize it on the
  spot. If it never appears, that role genuinely can't do this, and fixing
  it permanently means changing the role.
- **A split-by-seat total looks wrong.** Reopen **Split Check by Seat** and
  check the "Left" column for unallocated items.
- **Anything else** — see [Troubleshooting](troubleshooting.md). There's no
  phone line and no "business hours" desk operated by anyone else — the
  [issue tracker](https://github.com/vul-os/beepbite) and this
  documentation are what exist. If your instance breaks, you (or whoever
  you hired to run it) are the first and last line of support.

---

## 20. What this guide deliberately does not cover

- **Installing, upgrading or configuring the server** — environment
  variables, migrations, deployment. That's [Setup](setup.md).
- **Multi-branch sync between two BeepBite instances.** Doesn't exist yet —
  no push/pull, no peer enrolment, no apply path. See
  [Before your first service](#1-before-your-first-service).
- **Working through an internet or power outage.** Offline order-taking
  isn't implemented — scaffolding exists in the codebase but nothing in the
  running app uses it; a dropped connection behaves exactly like it always
  has.
- **Online card payments as a finished feature.** Optional, off by default,
  compile-time gated, its integration tests currently fail. See
  [Taking payment](#8-taking-payment).
- **Discord, Slack or email ordering.** Not built.
- **Any compliance certification.** No claim to PCI-DSS, GDPR or SOC 2 —
  those describe an operator's practices, and nobody has audited a
  self-hosted deployment you run.
- **How to appeal a bill, or reach customer success.** There's no bill and
  no such desk. See the top of this guide.
