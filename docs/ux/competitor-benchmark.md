# BeepBite UX Competitor Benchmark

**Scope:** Toast, Square for Restaurants, Lightspeed Restaurant (K-Series), TouchBistro, Lavu
**Market context:** South African restaurants — ZAR currency, WhatsApp-first ordering, Yoco/SnapScan/PayShap payment rails
**Research date:** June 2026
**Surfaces:** Dashboard · POS Order Entry · Menu Management · KDS · Reports · Onboarding · Empty States

---

## 1. Owner / Manager Dashboard (Home)

### Table stakes — every serious competitor has these

- **Live net-sales figure** prominently on the home screen, updating in real time or on manual refresh. Square surfaces this in their Restaurants POS app live sales report; TouchBistro claims 50+ reports updating in real time. ([Square](https://squareup.com/help/us/en/article/8142-get-real-time-sales-data-on-square-restaurants-pos), [TouchBistro](https://www.touchbistro.com/features/reporting-analytics/))
- **Covers (guest count) + average check** alongside net sales — the three core daily KPIs that move together. ([breakingac.com](https://breakingac.com/news/2026/feb/17/what-restaurant-owners-should-track-daily-not-vanity-metrics/))
- **Labor cost %** visible during the shift so managers can make cut decisions in real time. Toast surfaces labor % and SPLH (sales per labor hour) in dedicated labor reports. ([Toast labor reports](https://support.toasttab.com/en/article/Labor-Reports-Overview))
- **Multi-device access** — dashboard readable on phone, tablet, or desktop with no friction. Square's Dashboard App, SpotOn's "single tap on your phone" access, and Toast's cloud reports all hit this bar.
- **Day comparison** — today vs. yesterday and vs. same day last week. Lightspeed shows a 7-day average alongside current-day bars. ([Lightspeed](https://k-series-support.lightspeedhq.com/hc/en-us/articles/18234292249883-Sales-Reports))
- **Open-check count** — how many tables are currently seated / ordering. Square's live report explicitly shows open checks separately from closed.

### Differentiators — best-in-class touches

- **AI "For you" feed (Toast ToastIQ):** A personalized recommendations panel that asks "What single change would improve my business most?" in plain language. It draws on weather, local events, historical patterns, and cross-restaurant benchmarks from 130,000+ locations to surface proactive nudges — without the owner needing to construct a query. It can also take action directly (update a menu price, fire a shift adjustment) from the same interface. Launched May 2025. ([Toast ToastIQ](https://pos.toasttab.com/news/toast-launches-toastiq-superpower-future-of-restaurants), [BusinessWire](https://www.businesswire.com/news/home/20251029752451/en/Toast-Expands-Toast-IQ-from-Smart-Features-to-Smart-AI-Assistant))
- **Hourly heat maps (Lightspeed):** The daily sales overview shows a bar chart by hour with hover-state breakdown (total sales, check count, % of day total). Lightweight but immediately actionable for staffing. ([Lightspeed sales reports](https://k-series-support.lightspeedhq.com/hc/en-us/articles/18234292249883-Sales-Reports))
- **Automated daily email digest (TouchBistro):** Report emailed to owner at end of day/shift. Zero-friction ownership — no login required to stay informed. ([TouchBistro reporting](https://www.touchbistro.com/features/reporting-analytics/))
- **Multi-location at a glance:** Oracle Simphony and Lightspeed both surface per-location breakdowns in a unified view for group operators. Lightspeed shines specifically at multi-location analytics. ([Sonary comparison](https://sonary.com/content/lightspeed-vs-touchbistro-pos-2025-which-restaurant-pos-is-better-for-growing-hospitality-businesses/))

### Actionable recommendations for BeepBite

| # | Recommendation | Impact | Effort |
|---|----------------|--------|--------|
| D1 | **Prime-cost widget on home screen** — show Food Cost % + Labor % side-by-side in a single card with a green/amber/red RAG colour. Threshold configurable per restaurant. Owners scan it without opening a report. | [HIGH] | [S] |
| D2 | **"Today vs. same day last week" comparison row** — below the live KPIs, one row of delta badges (↑ 12% net sales, ↓ 3% covers). Auto-computed, no interaction needed. | [HIGH] | [S] |
| D3 | **Live open-check ticker in the app header** — a small badge showing "4 open tables / R2 340 in-flight" so the manager can gauge throughput at a glance during service. Tap to see the open-check list. | [HIGH] | [M] |
| D4 | **Daily email digest** — a simple end-of-day email (cron job or Supabase Edge Function) with: net sales, covers, avg check, top item, biggest void. No-config default; owner can opt out. Differentiates from competitors that bury this behind a login. | [MED] | [S] |
| D5 | **WhatsApp alert for anomalies** — since BeepBite targets WhatsApp-first operators: when net sales exceed or lag last-week same-slot by >20%, send a WhatsApp message. This is a genuine differentiator vs. Toast/Square in the SA market. | [HIGH] | [M] |
| D6 | **Hourly sales heat-map bar chart** — 24-bar horizontal chart on the dashboard (greyed-out future hours). Hover/tap for sales + cover count per hour. Essential for staffing decisions. | [MED] | [M] |

---

## 2. POS Order-Entry Workspace

### Table stakes

- **Customizable item tile grid** with drag-and-drop reordering. Square Restaurants lets staff tap "Edit POS Layout" to rearrange tiles, change tile size, add/delete pages. ([Square community](https://community.squareup.com/t5/Orders-Menu-Items-Catalog/How-do-I-rearrange-the-tiles-on-my-Restaurants-POS-layout/m-p/772547))
- **Auto-progression through required modifier sets.** After an item is tapped, the system moves through modifier screens in sequence without an extra "next" tap. Square defines the order at item level (drag to reorder in Modifier Library). ([Square modifiers](https://squareup.com/help/us/en/article/6426-modifiers-and-categories-with-square-for-restaurants))
- **Check splitting** — minimum: by item, by seat, evenly. Square implements all three with touch-only interaction. ([Square split check](https://squareup.com/help/us/en/article/8165-split-a-payment-and-check-with-square-for-restaurants))
- **Table / seat assignment** — items are associated with seats so course firing and split-by-seat work correctly.
- **Move items between checks/tables** — drag-and-drop or tap-to-select-then-transfer. Lightspeed supports transferring individual order items between checks. ([Lightspeed transfer](https://resto-support.lightspeedhq.com/hc/en-us/articles/226306387-Transferring-order-items))
- **Course hold & fire** — servers hold subsequent courses on the POS; kitchen doesn't see them until fired. Both Toast and Square support this. ([Toast coursing](https://doc.toasttab.com/doc/platformguide/platformKDSWorkflowUsingCoursePacing.html), [Square coursing](https://squareup.com/help/us/en/article/7748-coursing-with-square-kds))
- **Search** alongside the grid — for menus with 100+ items, instant fuzzy search is non-negotiable. Warning: Square's September 2025 UI update caused documented 2-3 second search delays that broke cashier motor patterns. ([interface-design.co.uk](https://interface-design.co.uk/blog/pos-software-ux-benchmarking-2026-the-coherence-gap/))

### Differentiators

- **AI upsell prompts mid-order (Toast ToastIQ):** After key items are added, ToastIQ surfaces a contextual "Guests also add..." prompt. Tested across 130,000 locations. Not yet standard elsewhere. ([Toast ToastIQ news](https://pos.toasttab.com/news/toast-launches-toastiq-superpower-future-of-restaurants))
- **Swipe-gesture course management (Lightspeed):** Swipe right on an item or Course header to reveal the Hold icon — eliminates the need to tap into a sub-menu to fire/hold. Discovered motor shortcut reduces cognitive load during service. ([Lightspeed U-series](https://help.upserve.com/s/article/Lightspeed-Restaurant-U-Series-POS-Tableside-Mobile-Application-2024))
- **Tableside mobile ordering (Square):** Full order-entry on a handheld device with the same modifier flows. Reduces walk-back trips and increases table turns. ([Square tableside](https://squareup.com/help/us/en/article/8152-take-orders-tableside-with-square-for-restaurants-mobile-pos))
- **Conditioning stability (Toast):** An independent 2026 benchmarking study identified Toast as scoring highest on "conditioning stability" — preserving core navigation through updates, so trained muscle memory is not disrupted. ([interface-design.co.uk](https://interface-design.co.uk/blog/pos-software-ux-benchmarking-2026-the-coherence-gap/))
- **Permanent check details panel (Toast):** A persistent side panel showing the live check without requiring the server to navigate away from the item grid. Reduces context-switching during complex orders. ([interface-design.co.uk](https://interface-design.co.uk/blog/pos-software-ux-benchmarking-2026-the-coherence-gap/))

### Actionable recommendations for BeepBite

| # | Recommendation | Impact | Effort |
|---|----------------|--------|--------|
| P1 | **Persistent split-panel layout on tablet**: item grid left, live check right — always visible simultaneously. Never require a "view check" navigation step. Toast proved this reduces errors. | [HIGH] | [M] |
| P2 | **Per-item modifier ordering** — allow owners to drag modifier sets into the exact sequence cashiers need (most-common first). Auto-progress through required sets; make optional sets dismissible with one swipe. | [HIGH] | [M] |
| P3 | **Hold/Fire visual language on the cart** — held items show with a muted colour + lock icon; a "Fire course 2" button is always visible and large when held items exist. Don't bury this in a sub-menu. | [HIGH] | [S] |
| P4 | **Swipe-to-remove item** on the check line — right-swipe reveals a red Remove button, left-swipe reveals Move-to-other-check. Mirrors native iOS/Android list patterns; zero learning curve. | [MED] | [S] |
| P5 | **Item grid search with < 200 ms response** — debounced search against in-memory menu data. Never hit the network for item lookup during service. Measure and gate this in CI. The Square search regression (2-3 sec) is a cautionary tale. | [HIGH] | [S] |
| P6 | **Seat-aware ordering mode** — optional toggle to assign each item to a seat number. Enables split-by-seat and course firing without manual annotation later. | [MED] | [L] |

---

## 3. Menu Management

### Table stakes

- **Bulk price update** — select multiple items, set price in one action. Toast's Item Update CSV template and Square's multi-select + Edit both handle this. ([Toast bulk import](https://doc.toasttab.com/doc/platformguide/platformBulkImportToolOverview.html), [Square bulk edit](https://squareup.com/help/us/en/article/6424-create-menus-with-square-for-restaurants))
- **86 item / countdown** — TouchBistro's Countdown button decrements as items are ordered; when it hits zero the item auto-86s across POS and online ordering. A simpler version: a manual availability toggle. ([TouchBistro inventory](https://www.touchbistro.com/inventory-management/))
- **Modifier groups** — shared modifier sets that attach to multiple items. Both TouchBistro and Lightspeed support this; Square uses a Modifier Library. ([TouchBistro modifiers](https://help.touchbistro.com/s/article/Menu-Management-Modifier-Groups?language=en_US))
- **Category / menu group management** — drag-and-drop reorder, colour or icon tagging.
- **Item photo upload** — Toast supports adding images in Menu Builder (+ Add item image). ([Toast photo upload](https://support.toasttab.com/en/article/Adding-Images-to-Menu-Items-in-the-Menu))
- **Dayparting / scheduled menus** — Square's menu groups support per-day-of-week + time-of-day scheduling, with group-level hours overriding menu-level hours. ([Square menu hours](https://squareup.com/help/us/en/article/6424-create-menus-with-square-for-restaurants))

### Differentiators

- **CSV bulk import with rollback (Toast):** Three spreadsheet templates (Basic / Item Update / Advanced). Items can be created, updated, or deleted in batch. Critical for multi-location operators pushing menu changes from head office. ([Toast bulk import overview](https://doc.toasttab.com/doc/platformguide/platformBulkImportToolOverview.html))
- **Natural-language 86 via AI (ToastIQ):** "86 all items with avocado" typed into the AI chat updates availability across all menus instantly. ([Toast ToastIQ](https://pos.toasttab.com/news/toast-launches-toastiq-superpower-future-of-restaurants))
- **Real-time cross-channel sync:** Square changes propagate to the register, KDS, and online ordering simultaneously. Lightspeed does the same. Prevents the "online order for an 86'd item" problem.
- **Countdown inventory in POS (TouchBistro):** Stock count is decremented per order, not per end-of-shift inventory count. Auto-86 fires when count hits zero, no manager action required.
- **Multi-location menu push (Lightspeed):** Head-office menu changes replicate to child locations with override options per location. Positioned as a differentiator for groups. ([Lightspeed](https://www.lightspeedhq.com/pos/restaurant/))

### Actionable recommendations for BeepBite

| # | Recommendation | Impact | Effort |
|---|----------------|--------|--------|
| M1 | **One-tap 86 toggle from the POS order screen** — server can mark an item "sold out" directly while taking an order (no manager back-office login needed). Shows a red SOLD OUT badge on the item tile and blocks new orders. Auto-resets at midnight or on manual un-toggle. | [HIGH] | [S] |
| M2 | **Countdown field on menu items** — optionally set a stock count; system decrements on each order; auto-86s at zero; pushes a WhatsApp alert to the owner. This is a zero-UI resolution for the "three portions of duck left" problem. | [HIGH] | [M] |
| M3 | **Bulk multi-select in the menu editor** — checkbox column, select all / select by category, then a context action bar: "Set price...", "Move to category...", "Toggle availability", "Delete". No CSV required for common tasks. | [HIGH] | [M] |
| M4 | **Scheduled menu groups (dayparting)** — each category has optional "active hours" (Mon–Fri 06:00–11:00 = Breakfast). Items in an inactive group are hidden from POS and online ordering automatically. Critical for dual-concept venues. | [MED] | [L] |
| M5 | **Photo drag-and-drop in menu editor** — drag an image file from the desktop onto an item card. Instant preview + auto-resize to 4:3. No separate upload modal. This is table stakes but many POS implementations make it painful. | [MED] | [S] |
| M6 | **Modifier group library** — define a modifier set once ("Steak doneness", "Sauce choice"), apply to N items. Editing the group propagates to all linked items. Missing this creates divergent modifier definitions. | [HIGH] | [M] |

---

## 4. KDS (Kitchen Display System)

### Table stakes

- **Color-coded ticket aging** — Lightspeed's documented scheme is representative: Gray (new), Blue (preparing), Green (ready), Red (canceled); orange glow at configurable warning threshold, red glow when late. ([Lightspeed KDS 2.0](https://k-series-support.lightspeedhq.com/hc/en-us/articles/22708154090267-Using-the-Kitchen-Display-System-2-0))
- **Bump / status progression** — multiple input methods: double-tap ticket, long-press for menu, or physical bump bar. Toast's bump bar numbers the first 10 tickets for keypad assignment. ([Toast bump bar](https://support.toasttab.com/en/article/Use-a-Bump-Bar-With-Toast-KDS))
- **5-second undo** after bump — prevents accidental dismissal. Lightspeed KDS 2.0 implements this. Critical for high-volume kitchens.
- **Ticket grid sizing** — small/medium/large or dynamic. Toast's grid view supports 5×2 (10 tickets) up to dynamic (20–30). ([Toast KDS grid](https://support.toasttab.com/en/article/Grid-KDS-Overview))
- **Course hold display** — held courses must be visually distinct (dimmed items) so kitchen doesn't start prepping them. Fresh KDS uses a dimmed state + 🚫 icon; fired items switch to active. ([Fresh KDS](https://www.fresh.technology/kds-features/hold-fire-courses))
- **Allergen flagging** — displayed in red on the ticket. Lightspeed KDS 2.0 shows allergen info in red, notes in blue.
- **Items list view** — groups identical items across all tickets (e.g. "14× Chips") for batch prep. Lightspeed KDS 2.0 has this. ([Lightspeed KDS](https://k-series-support.lightspeedhq.com/hc/en-us/articles/22708154090267-Using-the-Kitchen-Display-System-2-0))

### Differentiators

- **Configurable wait-time thresholds per station (Lightspeed):** Each station (grill, pass, bar) can have its own orange/red glow thresholds. A bar ticket at 3 minutes is not late; a dessert at 12 minutes is. ([Lightspeed KDS](https://k-series-support.lightspeedhq.com/hc/en-us/articles/22708154090267-Using-the-Kitchen-Display-System-2-0))
- **Smart recall management (Fresh KDS):** If tickets are bumped while held items remain, only the fired items move to recall; held items stay in their holds section. Prevents expo from losing track of unfired courses. ([Fresh KDS](https://www.fresh.technology/kds-features/hold-fire-courses))
- **Statistics heatmap on KDS (Lightspeed):** The KDS itself can show a heatmap of ticket counts by interval — exposing kitchen bottlenecks without leaving the station.
- **Expo mode** — a separate KDS screen aggregates all "ready" items across stations so the expeditor sees a unified ready queue.
- **Light / dark theme toggle (Lightspeed KDS 2.0):** Kitchens vary in ambient light; both themes are documented options.
- **Order filtering by floor / device:** A KDS in the bar only shows bar tickets. Lightspeed KDS 2.0 configures this per station.

### Actionable recommendations for BeepBite

| # | Recommendation | Impact | Effort |
|---|----------------|--------|--------|
| K1 | **Three-tier color aging system with configurable thresholds** — ticket border: white (new) → amber (> X min) → red (> Y min). X and Y are set per station in the back office. Default: 5 min / 12 min. Threshold editing takes < 30 seconds. | [HIGH] | [S] |
| K2 | **Batch quantity view ("Items" tab)** — secondary KDS view that lists all in-flight items aggregated by name with quantities (14× Chips, 6× Beef Burger). Grill cook preps in batch, not per ticket. Toggle between "Tickets" and "Items" tabs with one tap. | [HIGH] | [M] |
| K3 | **5-second undo on bump** — a bottom-of-screen slide-up toast with "Undo" after every bump action. Dismiss automatically after 5 seconds. Prevent accidental mis-bumps during rush service. | [HIGH] | [S] |
| K4 | **Course fire from KDS** — allow expo to fire the next course for a table directly from the KDS (not just from the POS). Reduces radio calls between floor and kitchen. | [MED] | [M] |
| K5 | **Allergen highlight in red on every item line** — if an item has an allergen flag or modifier note containing keywords (nut, gluten, dairy, etc.), render that line in red. No chef should have to hunt for allergen info. | [HIGH] | [S] |
| K6 | **Dark mode** — toggle in KDS settings, persists per device. Kitchens with low ambient light and high-glare stainless steel benefit significantly. Zero feature effort if CSS variables are already in place. | [LOW] | [S] |

---

## 5. Reports & Analytics

### Table stakes — reports owners actually use daily

The highest-value daily reports across all competitors, confirmed by multiple operator surveys: ([Toast top 10 reports](https://pos.toasttab.com/blog/restaurant-data-pos-software), [Lavu top 7](https://lavu.com/top-7-pos-reports-for-sales-trend-analysis/), [Foodics](https://www.foodics.com/point-of-sale-pos-reports/))

1. **Daily Sales Summary** — net sales, gross sales, covers, avg check, discount total, void total. The single most-opened report.
2. **Product Mix / Menu Performance** — item-level sales count, revenue, % of total. Identifies slow movers and heroes.
3. **Labor Cost Report** — labor %, SPLH (sales per labor hour), breakdown by job and employee.
4. **Voids & Discounts Report** — fraud detection; surfaced by Toast as a top-10 report.
5. **Hourly Sales Heatmap** — peak hour identification; critical for staffing.
6. **End-of-Day / Z-Report** — closing summary for cash reconciliation.

All competitors provide these. Lightspeed's sales totals, hourly, and daily reports cover #1, #5, and partial #6. Toast's product mix and labor reports cover #2, #3, #4.

Export: CSV export is standard on Toast, Lightspeed, TouchBistro. PDF "share" for the daily report is common.

### Differentiators

- **ToastIQ conversational analytics (Toast):** Ask "Which shifts drive the highest labor cost?" or "Which menu item should I retire?" in plain English. The AI queries across POS data and answers with a specific recommendation + the ability to act on it immediately. ([Toast ToastIQ](https://pos.toasttab.com/news/toast-expands-toast-iq-smart-ai-assistant))
- **Square AI Order Guide (Square):** Turns your menu into an ingredient list, normalizes units, and shows vendor pricing side-by-side for purchasing decisions. Extends reporting into purchasing workflow. ([Square Vol. 2 2025 updates](https://community.squareup.com/t5/Product-Updates/Square-Releases-Vol-2-2025-New-tools-for-restaurants/ba-p/820230))
- **RevPASH metric (industry best):** Revenue Per Available Seat Hour — more accurate than revenue per square foot because it accounts for time and space. Included by operators benchmarking dining room efficiency. ([Lightspeed KPI guide](https://www.lightspeedhq.com/blog/restaurant-kpis/))
- **Multi-location benchmarking (Toast, Lightspeed):** Compare sales, labor, and product mix across locations in a single view. Significant for growing chains.

### Actionable recommendations for BeepBite

| # | Recommendation | Impact | Effort |
|---|----------------|--------|--------|
| R1 | **Single "Daily Snapshot" report as the default view** — net sales, covers, avg check, labor %, prime cost %, top 5 items, void total. All for today, yesterday, and same day last week. One screen, no navigation. This is the most-opened report; make it the landing page of the Reports section. | [HIGH] | [M] |
| R2 | **Product mix sorted by revenue, with "hero / zero" tagging** — automatically flag top 20% revenue items as heroes, bottom 20% as zeros. Give the owner a one-tap "Archive zero performers" action. | [HIGH] | [M] |
| R3 | **Void / discount report with server-level breakdown** — voids and comps grouped by staff member, with a % of their own sales figure. Surfaces fraud and training issues without accusation. Add a threshold alert ("Server X voids exceed 5% of sales today"). | [HIGH] | [M] |
| R4 | **CSV export on every report** — one button, no modal, no email step. Downloads immediately. This is table stakes but several competitor implementations add unnecessary friction here. | [MED] | [S] |
| R5 | **WhatsApp/email report share** — from any report, a share button sends the current view as a formatted message to a phone number or email (the owner's, a GM's). Differentiator in the SA WhatsApp-first market. | [MED] | [M] |

---

## 6. Onboarding — Getting a Restaurant Live Fast

### Table stakes

- **Guided setup checklist** visible at all times after first login. Toast implements this as a persistent icon in the top-right of Toast Web; the checklist is tailored to the products purchased (quick service vs. full service). ([Toast self-service guide](https://support.toasttab.com/en/article/Self-Service-Guide))
- **Smart defaults pre-configured** — jobs (Server, Bartender, Manager), common discounts (Staff Meal, Manager Comp), dining options, tax rates. Toast does this on account creation so the restaurant doesn't start from blank. ([Toast self-service guide](https://support.toasttab.com/en/article/Self-Service-Guide))
- **Menu building as the critical path** — all onboarding flows converge on "build your menu" before the restaurant can take real orders. TouchBistro has a dedicated menu upload team. Toast has Menu Builder in the checklist.
- **Timeline clarity** — Toast self-service: 14 days. Remote/onsite: 4-6 weeks. Operators need to know what they're committing to. ([Toast self-service guide](https://support.toasttab.com/en/article/Self-Service-Guide))
- **Training resources bundled** — Toast Classroom (including Spanish), TouchBistro's video library, Square's in-app help. Staff self-serve training is expected.

### Differentiators

- **Toast's phase-based self-service flow (5 phases):** Your Setup Guide → Kickoff → Build + Install → Configuration Check-in → Go-Live. Each phase is a clear milestone with a specific deliverable. The pop-up on first login introduces the guide and links to a tour. ([Toast self-service guide](https://support.toasttab.com/en/article/Self-Service-Guide))
- **TouchBistro dedicated specialist:** A named human who manages the timeline, uploads the menu on your behalf, and records training sessions for staff replay. Highest-touch approach; 84% reported satisfaction rate. ([TouchBistro onboarding tips](https://www.touchbistro.com/blog/tips-for-easy-onboarding-experience/))
- **Square's minimal-friction self-service:** No specialist required; start accepting payments within hours. Positions as the fastest to revenue. Training time is "minimal." ([TouchBistro vs Square](https://www.touchbistro.com/blog/touchbistro-vs-square/))
- **Menu import from photo / AI parsing (emerging):** Several 2025 entrants let operators photograph a paper menu; AI parses it into items, prices, and categories. Not yet standard in the five benchmarked competitors but directionally important.

### Actionable recommendations for BeepBite

| # | Recommendation | Impact | Effort |
|---|----------------|--------|--------|
| O1 | **Checklist sidebar, always accessible** — a collapsible sidebar showing setup progress: ✅ Add your first category → ✅ Add 5 menu items → ⬜ Add a modifier group → ⬜ Create your first staff account → ⬜ Run a test transaction. Progress bar at top. Dismiss when 100% complete. | [HIGH] | [M] |
| O2 | **Sample menu on first account creation** — pre-load a starter menu ("BeepBite Demo Menu") with 3 categories, 8 items, and 2 modifier groups. Operator can delete it wholesale or use it as a template. Lets them explore every surface without having to build first. | [HIGH] | [S] |
| O3 | **WhatsApp number as the first onboarding field** — since BeepBite is WhatsApp-first, capturing the owner's WhatsApp number at registration enables the daily digest, low-stock alerts, and anomaly notifications without any further configuration. | [HIGH] | [S] |
| O4 | **In-app video walk-throughs at each step** — 60-second Loom-style clips embedded at each checklist item. "How to add a modifier" plays inside the checklist panel, not on YouTube. Reduces support tickets during week 1. | [MED] | [M] |
| O5 | **"Run a test transaction" as a required checklist step** — guide the owner through ringing up the sample menu item, applying a discount, and completing payment with a test card. This inoculates them against confusion during the first real service and validates the hardware setup. | [HIGH] | [S] |
| O6 | **Smart defaults for SA restaurants** — pre-set: currency = ZAR, VAT = 15%, common service types (Dine-in / Takeaway / Delivery), payment types (Cash / Card / SnapScan / Yoco). Owner confirms or edits; no blank fields to fill in. | [HIGH] | [S] |

---

## 7. Empty States & First-Run UX

### Table stakes

- **Explain what this section does** — an empty Reports page must not just say "No data". It must say "Your daily sales report will appear here once you've completed your first transaction." ([Toptal empty states](https://www.toptal.com/designers/ux/empty-state-ux-design))
- **A single obvious CTA** — one button taking the operator to the action that will resolve the emptiness. "Add your first menu item" → opens Menu Editor. "Run a test order" → opens POS.
- **Relevant illustration** — not a generic sad cloud. Use the BeepBite design language: a receipt, a ticket, a menu card.
- **No empty state below the fold** — if the dashboard has a charts section and there's no data, that section shouldn't be invisible. It should be present but placeholder-styled.

### Differentiators — best-in-class patterns (general SaaS, applicable to POS)

- **Starter content / sample data:** Pre-seeded data lets owners explore the product before they've done anything. Seeing a filled dashboard builds confidence. The risk: operators accidentally rely on demo data; mitigate with an obvious "This is demo data — clear it" banner. ([Vendasta empty state guide](https://www.vendasta.com/blog/user-experience-empty-state-best-practices/), [eleken.co](https://www.eleken.co/blog-posts/empty-state-ux))
- **"What you'll see here" preview:** Show a greyed-out or ghosted version of what the screen will look like with data. Used effectively in Notion, Linear, Superhuman onboarding flows. Transforms the empty state from a dead end into a preview. ([UserOnboard](https://www.useronboard.com/onboarding-ux-patterns/empty-states/))
- **Progressive disclosure — activate on first data:** The reports section shows only the Daily Snapshot card until the first transaction; after that, all report types unlock with a subtle animation. Prevents overwhelming new owners with 50+ empty report tabs on day 0.
- **In-context tips during first use:** After the first menu item is added, a coach mark appears on the POS item grid showing "Tap here to start an order". These one-time tooltips guide muscle memory without requiring a formal walkthrough.

### Actionable recommendations for BeepBite

| # | Recommendation | Impact | Effort |
|---|----------------|--------|--------|
| E1 | **Every empty list has: illustration + headline + 1-line description + 1 CTA button.** Apply this consistently across all 7 surfaces (menu items, staff, reports, orders, tips). Define the component once in the design system; drop it in wherever `data.length === 0`. | [HIGH] | [S] |
| E2 | **Demo data mode** — a toggle in account settings: "Show sample data". Dashboard, reports, and order history populate with realistic ZAR amounts, South African menu items, and believable patterns (Friday dinner > Monday lunch). Owner can explore without risk. Clearly watermarked "DEMO". | [HIGH] | [M] |
| E3 | **Ghosted preview on empty charts** — reports chart area renders a blurred/greyscale version of what the chart looks like with data, overlaid with "Complete your first transaction to unlock this report." Converts a confusing blank into an aspirational target. | [MED] | [S] |
| E4 | **First-transaction celebration** — after the first real paid order, a brief full-screen moment: confetti, the order amount, and "Your first BeepBite sale! 🎉 Check your daily report →". One-time event; motivates completion of the onboarding journey. | [MED] | [S] |

---

## Summary Priority Matrix

| Rank | Rec | Surface | Impact | Effort | Why it wins |
|------|-----|---------|--------|--------|-------------|
| 1 | D1 | Dashboard | HIGH | S | Prime cost at a glance is the #1 daily owner need; no extra infrastructure |
| 2 | M1 | Menu | HIGH | S | One-tap 86 from POS is a genuine time-saver every shift |
| 3 | O6 | Onboarding | HIGH | S | ZAR + VAT 15% + SA payment defaults = zero friction for target market |
| 4 | P1 | POS order entry | HIGH | M | Split-panel layout prevents the most common order-taking errors |
| 5 | K1 | KDS | HIGH | S | Colour aging is the single biggest kitchen safety improvement |
| 6 | K5 | KDS | HIGH | S | Allergen red highlight has legal/safety implications beyond UX |
| 7 | O1 | Onboarding | HIGH | M | Persistent checklist is the highest-leverage activation driver |
| 8 | R1 | Reports | HIGH | M | Daily snapshot landing page = most-used report surfaced with zero navigation |
| 9 | D5 | Dashboard | HIGH | M | WhatsApp anomaly alerts are a genuine differentiator in SA market |
| 10 | E1 | Empty states | HIGH | S | Consistent empty-state component raises perceived quality across all surfaces |

---

## Research Sources

- [POS UX Benchmarking 2026: Square, Toast, Lightspeed (interface-design.co.uk)](https://interface-design.co.uk/blog/pos-software-ux-benchmarking-2026-the-coherence-gap/)
- [Toast POS Reporting & Analytics](https://pos.toasttab.com/products/reporting)
- [Toast Self-Service Onboarding Guide](https://support.toasttab.com/en/article/Self-Service-Guide)
- [Toast Labor Reports Overview](https://support.toasttab.com/en/article/Labor-Reports-Overview)
- [Toast KDS Grid View Overview](https://support.toasttab.com/en/article/Grid-KDS-Overview)
- [Toast Bump Bar Guide](https://support.toasttab.com/en/article/Use-a-Bump-Bar-With-Toast-KDS)
- [Toast KDS Course Pacing Workflow](https://doc.toasttab.com/doc/platformguide/platformKDSWorkflowUsingCoursePacing.html)
- [Toast Menu Bulk Import Overview](https://doc.toasttab.com/doc/platformguide/platformBulkImportToolOverview.html)
- [Toast Top 10 POS Reports](https://pos.toasttab.com/blog/restaurant-data-pos-software)
- [Toast Launches ToastIQ](https://pos.toasttab.com/news/toast-launches-toastiq-superpower-future-of-restaurants)
- [Toast Expands ToastIQ to AI Assistant (BusinessWire)](https://www.businesswire.com/news/home/20251029752451/en/Toast-Expands-Toast-IQ-from-Smart-Features-to-Smart-AI-Assistant)
- [Square for Restaurants: Create and Update Menus](https://squareup.com/help/us/en/article/6424-create-menus-with-square-for-restaurants)
- [Square for Restaurants: Modifiers](https://squareup.com/help/us/en/article/6426-modifiers-and-categories-with-square-for-restaurants)
- [Square for Restaurants: Split Check](https://squareup.com/help/us/en/article/8165-split-a-payment-and-check-with-square-for-restaurants)
- [Square for Restaurants: Coursing + KDS](https://squareup.com/help/us/en/article/7748-coursing-with-square-kds)
- [Square for Restaurants: Live Sales Report](https://squareup.com/help/us/en/article/8142-get-real-time-sales-data-on-square-restaurants-pos)
- [Square for Restaurants: Tableside Ordering](https://squareup.com/help/us/en/article/8152-take-orders-tableside-with-square-for-restaurants-mobile-pos)
- [Square Releases Vol. 2 2025 — New Restaurant Tools](https://community.squareup.com/t5/Product-Updates/Square-Releases-Vol-2-2025-New-tools-for-restaurants/ba-p/820230)
- [Lightspeed KDS 2.0](https://k-series-support.lightspeedhq.com/hc/en-us/articles/22708154090267-Using-the-Kitchen-Display-System-2-0)
- [Lightspeed About KDS](https://k-series-support.lightspeedhq.com/hc/en-us/articles/4418209500443-About-the-Lightspeed-Kitchen-Display-System)
- [Lightspeed Sales Reports (K-Series)](https://k-series-support.lightspeedhq.com/hc/en-us/articles/18234292249883-Sales-Reports)
- [Lightspeed Restaurant KPIs Guide](https://www.lightspeedhq.com/blog/restaurant-kpis/)
- [Lightspeed Modifier Selection (L-Series)](https://resto-support.lightspeedhq.com/hc/en-us/articles/226405468-Selecting-modifiers)
- [Lightspeed Item Transfer (L-Series)](https://resto-support.lightspeedhq.com/hc/en-us/articles/226306387-Transferring-order-items)
- [TouchBistro Reporting & Analytics](https://www.touchbistro.com/features/reporting-analytics/)
- [TouchBistro Menu Modifier Groups](https://help.touchbistro.com/s/article/Menu-Management-Modifier-Groups?language=en_US)
- [TouchBistro Onboarding Tips](https://www.touchbistro.com/blog/tips-for-easy-onboarding-experience/)
- [TouchBistro vs Square (TouchBistro)](https://www.touchbistro.com/blog/touchbistro-vs-square/)
- [TouchBistro vs Lightspeed (TouchBistro)](https://www.touchbistro.com/blog/touchbistro-vs-lightspeed/)
- [Lavu POS NerdWallet Review](https://www.nerdwallet.com/business/software/reviews/lavu-pos)
- [Fresh KDS: Hold & Fire Courses](https://www.fresh.technology/kds-features/hold-fire-courses)
- [Restaurant KPIs: Daily Tracking](https://breakingac.com/news/2026/feb/17/what-restaurant-owners-should-track-daily-not-vanity-metrics/)
- [12 Essential Restaurant POS Reports (gloriafood-pos.com)](https://www.gloriafood-pos.com/restaurant-pos-reports)
- [Best Restaurant POS South Africa 2026 (skynode)](https://skynode.co.za/tafela/blog/best-restaurant-pos-systems-south-africa/)
- [Eleken: Empty State UX](https://www.eleken.co/blog-posts/empty-state-ux)
- [UserOnboard: Empty State Patterns](https://www.useronboard.com/onboarding-ux-patterns/empty-states/)
- [Toptal: Empty States](https://www.toptal.com/designers/ux/empty-state-ux-design)
- [Vendasta: Empty State Best Practices](https://www.vendasta.com/blog/user-experience-empty-state-best-practices/)
