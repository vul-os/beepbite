package ownership

// tables is ROADMAP Now-5's ownership paragraph, per table.
//
// # How to read an entry
//
// Class is the decision. Why is the §4.10 selection-test answer for it — why
// this primitive and not the neighbouring one — and it is required, because a
// table with no reason is a table nobody decided about. Derived, Secret and
// Exclude are the columns that do NOT replicate, each with its reason; the
// stored counters in particular are the thing ROADMAP Now-5 names as the
// failure mode, so every one of them is listed against the ledger that is its
// actual truth rather than quietly emitted as a register.
//
// # How the four classes were assigned
//
// The question that separates Branch from Group is not where the row lives —
// items, categories and tables all carry a location_id — but WHO EDITS IT.
// Menu, pricing and staff are maintained centrally and pushed down, so two
// managers editing one menu item from two places is an ordinary conflict and
// §4.4 last-writer-wins is the answer. Orders, the drawer, the floor and the
// shift are produced at the counter by the branch standing at it; nobody else
// writes them, so there is no conflict to resolve and the register never
// arbitrates. Recording that distinction is what lets Emitter refuse a
// branch-owned write authored by the wrong node instead of merging it.
//
// Ledger is assigned wherever a row is a FACT THAT HAPPENED rather than a
// current value: it is inserted once, never updated, never deleted, and its
// aggregate is a SUM over the union. Where BeepBite's schema keeps such a
// ledger AND a stored total alongside it, the ledger replicates and the total
// does not.
//
// Local is assigned to anything whose meaning is confined to one node —
// sessions, tokens, nonces, queues, caches, the sync log itself — plus a small
// number of tables that CANNOT be replicated safely as they stand. Those are
// the honest gaps and each says so in its Why.
var tables = []Table{

	// -----------------------------------------------------------------------
	// Ledgers — §4.3 add-only sets. Append once, never update, SUM at read.
	// -----------------------------------------------------------------------

	{
		Name: "stock_movements", Class: Ledger,
		Group: "inventory_item_id", Qty: "quantity",
		Why: "The flagship case in ROADMAP Now-5. Two tills each sell the last steak while offline; " +
			"as a register each would write 'stock = 0' and last-writer-wins would keep one of the two " +
			"sales, so the shop believes it sold one steak it did not have instead of two. As an " +
			"add-only set both movements survive the union and SUM(quantity) lands honestly at −2. " +
			"Grouped by inventory_item_id because 'how much of this ingredient is on hand' is exactly " +
			"a SUM over that set. §4.6's closing note permits this in place of a PN-counter precisely " +
			"because the members are immutable facts and the counter would discard the audit trail.",
	},
	{
		Name: "cash_drawer_movements", Class: Ledger,
		Group: "cash_drawer_session_id", Qty: "amount_cents",
		Why: "A pay-in, pay-out or drop is a fact that happened at a moment, not a current value. " +
			"The session's cash position is SUM(amount_cents) over the union, never a stored total.",
	},
	{
		Name: "cash_drawer_counts", Class: Ledger,
		Group: "cash_drawer_session_id",
		Why: "A physical count is a declaration made at a moment — recounting produces a second count, " +
			"not an edit of the first. No Qty: a count is not something to add up, it is something to " +
			"compare against the movement ledger's sum.",
	},
	{
		Name: "gift_card_transactions", Class: Ledger,
		Group: "gift_card_id", Qty: "amount_cents",
		Why: "A load or redemption is an immutable fact; the balance is SUM(amount_cents) over it. " +
			"gift_cards.current_balance_cents is the cache of that sum and is Derived there.",
	},
	{
		Name: "store_credit_transactions", Class: Ledger,
		Group: "store_credit_id", Qty: "amount_cents",
		Why: "Same shape as gift cards: the ledger is the money and store_credits.balance_cents is a " +
			"cache of its sum.",
	},
	{
		Name: "loyalty_transactions", Class: Ledger,
		Group: "customer_id", Qty: "points",
		Why: "Points earned and redeemed are events. A customer earning points at two branches while " +
			"they are partitioned must end up with both lots, which union gives and a register does not.",
	},
	{
		Name: "house_account_charges", Class: Ledger,
		Group: "house_account_id", Qty: "amount_cents",
		Why: "A charge against an account is a fact. The account balance is the sum, so two branches " +
			"charging the same account offline both land rather than one overwriting the other.",
	},
	{
		Name: "promotion_redemptions", Class: Ledger,
		Group: "promotion_id",
		Why: "A redemption happened or it did not. Grouped by promotion so 'how many times has this " +
			"been used' is a COUNT over the union — which is what coupon_codes.used_count claims to be " +
			"and cannot safely replicate as.",
	},
	{
		Name: "order_item_discounts", Class: Ledger,
		Group: "order_item_id", Qty: "discount_amount_cents",
		Why: "Append-only by construction — the REST allowlist grants Insert and no Update or Delete. " +
			"Its parent order is branch-owned and so has a single writer, but a union cannot lose a row " +
			"and a register can, so the stricter primitive is the right one where both would work.",
	},
	{
		Name: "ingredient_price_history", Class: Ledger,
		Group: "inventory_item_id",
		Why: "A price observed at a moment. It is never corrected in place — a new observation is a new " +
			"row — which is the definition of the primitive.",
	},
	{
		Name: "kds_ticket_events", Class: Ledger,
		Group: "ticket_id",
		Why: "The kitchen ticket's own audit trail: fired, started, bumped, recalled. Union-merged so a " +
			"branch and an expo screen that were briefly partitioned end up with the whole story rather " +
			"than the last chapter.",
	},
	{
		Name: "tip_pool_contributions", Class: Ledger,
		Group: "tip_pool_id", Qty: "amount_cents",
		Why: "Money into the pool, one immutable row per payment. The pool's total is the sum; nothing " +
			"stores it.",
	},
	{
		Name: "tip_distributions", Class: Ledger,
		Group: "tip_pool_id", Qty: "amount_cents",
		Exclude: map[string]string{
			"payroll_exported_at": "node-local export bookkeeping — which node has pushed this row to " +
				"payroll is not a fact about the distribution, and updating it in place would " +
				"contradict the ledger's append-only rule",
		},
		Why: "Money out of the pool, one immutable row per staff member. Together with contributions " +
			"the pool reconciles as two sums rather than one mutable balance.",
	},
	{
		Name: "audit_log", Class: Ledger,
		Group: "organization_id",
		Why: "The canonical append-only table: migration 001 restricts INSERT to the service role and " +
			"grants no UPDATE or DELETE at all, so 'never modified' is already enforced by policy. " +
			"Grouped by organization_id rather than entity_id because entity_id is nullable and a " +
			"nullable address would put two genuinely different audit rows at the same target.",
	},
	{
		Name: "pii_access_log", Class: Ledger,
		Group: "customer_id",
		Why: "Who looked at whose personal data, and when. An access happened; there is nothing to " +
			"update. Grouped by customer so a subject-access request is one set read.",
	},
	{
		Name: "legal_acceptances", Class: Ledger,
		Group: "profile_id",
		Why: "An acceptance is dated and immutable — withdrawing consent is a later fact, not an edit " +
			"of the earlier one.",
	},
	{
		Name: "driver_location_pings", Class: Ledger,
		Group: "driver_member_id",
		Why: "The GPS trail ROADMAP Now-5 names. Pings from a driver whose phone was offline for ten " +
			"minutes must union into the trail when it reconnects, not replace it.",
	},

	// -----------------------------------------------------------------------
	// Branch-owned — §4.4 registers with exactly one writer, so the
	// last-writer rule never actually arbitrates.
	// -----------------------------------------------------------------------

	{
		Name: "orders", Class: Branch, Owner: "location_id",
		Exclude: map[string]string{
			"idempotency_key": "node-local request de-duplication; it identifies an HTTP call to this " +
				"node, not a fact about the order",
		},
		Why: "ROADMAP Now-5 names orders first: the branch that takes the order is its only writer, so " +
			"money and sequencing have no conflict to resolve. Emitter refuses an order op authored by " +
			"a node that is not this order's branch rather than letting last-writer-wins decide, " +
			"because a second writer here is a bug and not a race.",
	},
	{
		Name: "order_items", Class: Branch,
		Exclude: map[string]string{
			"idempotency_key": "node-local request de-duplication, as on orders",
		},
		Why: "A line on a branch-owned order. Owned by whoever owns the order; there is no location_id " +
			"on the row to check against, so the guard reaches it through its parent or not at all.",
	},
	{
		Name: "order_item_modifiers", Class: Branch,
		Why: "A line's modifiers, written once with the line by the branch that owns the order.",
	},
	{
		Name: "order_adjustments", Class: Branch,
		Why: "A void, comp or override on a branch-owned order, including its approval state — which is " +
			"updated in place, so this is a register and not the ledger it otherwise resembles.",
	},
	{
		Name: "order_payments", Class: Branch,
		Why: "Money taken at one till for one order. Single writer, and payment_status is updated in " +
			"place as a gateway confirms, so it is a register.",
	},
	{
		Name: "refunds", Class: Branch,
		Why: "Refund state moves through requested/approved/processed in place, so it is a register " +
			"rather than an append-only fact. Owned by the branch that took the original payment.",
	},
	{
		Name: "fiscal_sequences", Class: Branch, Key: "location_id",
		Why: "The order-number sequence ROADMAP Now-5 calls out. current_number is a stored counter and " +
			"stays one deliberately: the branch is its only writer, so it can never be concurrently " +
			"incremented, and the whole reason sequencing 'has no conflicts to resolve' is that this " +
			"row has one author. Two branches CAN hold the same number for different orders — that is " +
			"why the receipt number is scoped by location and not global.",
	},
	{
		Name: "cash_drawers", Class: Branch, Owner: "location_id",
		Why: "A physical drawer stands at one branch. Nobody else configures it.",
	},
	{
		Name: "cash_drawer_sessions", Class: Branch,
		Derived: map[string]string{
			"expected_closing_cents": "cash_drawer_movements",
		},
		Why: "A shift on one drawer at one branch. expected_closing_cents is the float plus the movement " +
			"ledger's sum and is derived rather than replicated, so a session that closed during a " +
			"partition recomputes from the movements that arrived rather than trusting a total that " +
			"was correct on one side only.",
	},
	{
		Name: "cash_drawer_session_payments", Class: Branch,
		Why: "The join between a drawer session and the payments that landed in it. Written by the " +
			"branch running the session, alongside the payment.",
	},
	{
		Name: "pos_shifts", Class: Branch, Owner: "location_id",
		Why: "ROADMAP Now-5 names shifts among the single-writer set. A shift is opened and closed at " +
			"one till.",
	},
	{
		Name: "tables", Class: Branch, Owner: "location_id",
		Why: "'Table state' in ROADMAP Now-5. The row carries both the floor-plan position and the live " +
			"status, and both are written at the branch the table physically stands in.",
	},
	{
		Name: "sections", Class: Branch, Owner: "location_id",
		Why: "The floor the tables stand on, edited by the branch that walks it.",
	},
	{
		Name: "table_sessions", Class: Branch, Owner: "location_id",
		Why: "Who is sitting at a table right now. There is exactly one branch in a position to know.",
	},
	{
		Name: "seats", Class: Branch,
		Why: "A seat within a live table session, written by the branch running it.",
	},
	{
		Name: "check_splits", Class: Branch,
		Why: "How a live check is being split at the table. Single writer, and edited in place while the " +
			"party argues about it.",
	},
	{
		Name: "check_split_items", Class: Branch,
		Why: "Which line went onto which split. Written with the split by the same branch.",
	},
	{
		Name: "kds_tickets", Class: Branch,
		Why: "A kitchen ticket belongs to one kitchen. Its status is updated in place as the line moves, " +
			"which is a register; the immutable history of those moves is kds_ticket_events, which is " +
			"the ledger.",
	},
	{
		Name: "kds_ticket_items", Class: Branch,
		Why: "A line on a branch-owned kitchen ticket, bumped in place.",
	},
	{
		Name: "staff_time_entries", Class: Branch, Owner: "location_id",
		Why: "A punch is recorded at the branch the staff member is standing in. It SHOULD be a ledger — " +
			"a punch is a fact that happened — but internal/handlers/timeclock updates entry_type, " +
			"timestamp and notes in place when a manager corrects one, so as the schema stands it is " +
			"not append-only and classifying it as a ledger would be a claim the code contradicts. " +
			"Modelling corrections as later facts is the fix, and it is a schema change, not a " +
			"registry entry.",
	},
	{
		Name: "staff_shifts", Class: Branch, Owner: "location_id",
		Why: "The rostered shift, and the actual start/end clocked against it at one branch. The roster " +
			"is edited centrally but only the branch writes the actuals, and one writer for the whole " +
			"row is the safer of the two readings.",
	},
	{
		Name: "driver_shifts", Class: Branch,
		Why: "A driver signs on and off against one branch's dispatch.",
	},
	{
		Name: "driver_assignments", Class: Branch,
		Why: "One order, one driver, assigned and progressed by the branch that dispatched it.",
	},
	{
		Name: "waitlist", Class: Branch, Owner: "location_id",
		Why: "The queue at one door, quoted and seated by the people standing at it.",
	},
	{
		Name: "reservations", Class: Branch, Owner: "location_id",
		Why: "A booking against one branch's floor at one time. The branch owns the table it commits.",
	},
	{
		Name: "prep_batches", Class: Branch, Owner: "location_id",
		Why: "A batch produced in one kitchen. Its consumption of ingredients reaches the shared world " +
			"through stock_movements, which is the ledger.",
	},
	{
		Name: "prep_batch_inputs", Class: Branch,
		Why: "What went into a branch-owned batch. It is written once with the batch by the kitchen that " +
			"made it; the depletion it causes reaches the shared world through stock_movements.",
	},
	{
		Name: "goods_receipts", Class: Branch,
		Why: "Goods arrived at one back door and were checked in by the people there.",
	},
	{
		Name: "goods_receipt_items", Class: Branch,
		Why: "A line on a branch-owned receipt. stock_movement_id is filled in after the movement is " +
			"written, which is an in-place update and so a register.",
	},
	{
		Name: "purchase_orders", Class: Branch, Owner: "location_id",
		Why: "A branch orders its own stock and moves the order through its statuses.",
	},
	{
		Name: "purchase_order_items", Class: Branch,
		Why: "A line on a branch-owned purchase order, updated in place as quantities are received.",
	},
	{
		Name: "supplier_invoices", Class: Branch, Owner: "location_id",
		Why: "The invoice a branch received and is matching against its own receipts.",
	},
	{
		Name: "supplier_invoice_lines", Class: Branch,
		Why: "A line on a branch-owned supplier invoice.",
	},
	{
		Name: "house_account_invoices", Class: Branch,
		Why: "An invoice raised against a house account by the branch that raised it, then moved through " +
			"sent/paid in place.",
	},
	{
		Name: "tip_pools", Class: Branch, Owner: "location_id",
		Why: "A pool for one branch's shift. Contributions and distributions are the ledgers either " +
			"side of it; the pool row itself is its configuration and is written once by that branch.",
	},
	{
		Name: "payroll_periods", Class: Branch, Owner: "location_id",
		Why: "A period is opened, totalled and exported by one branch's payroll run.",
	},
	{
		Name: "reviews", Class: Branch,
		Why: "The private review attached to one branch's order, replied to by that branch. The public " +
			"marketplace review is marketplace_reviews and is a different row with a different owner.",
	},

	// -----------------------------------------------------------------------
	// Group-owned — §4.4 registers, edited centrally, replicated down.
	// -----------------------------------------------------------------------

	{
		Name: "organizations", Class: Group,
		Exclude: map[string]string{
			"deleted_at":         "soft-delete and purge scheduling are operated per deployment; a purge scheduled on one node is not an instruction another node should obey",
			"scheduled_purge_at": "as deleted_at",
			"paused_at":          "billing state belongs to whoever runs the billing, not to the mesh",
		},
		Why: "The group itself. Its name and default currency are edited in one place and every branch " +
			"needs them.",
	},
	{
		Name: "locations", Class: Group,
		Derived: map[string]string{},
		Exclude: map[string]string{
			"avg_rating":   "an aggregate over marketplace_reviews, recomputed locally; replicating the cached number would let one node's stale average overwrite another's fresh one",
			"rating_count": "as avg_rating",
		},
		Why: "A branch's own description, hours, tax defaults and delivery settings are group-owned: " +
			"they are edited in the dashboard and every node needs the same answer. This is the row " +
			"that DESCRIBES a branch, not the rows a branch WRITES.",
	},
	{
		Name: "organization_members", Class: Group,
		Why: "Who is in the group and what they may do. Central by definition — a membership that " +
			"replicated only downward from one branch would be a branch granting itself access.",
	},
	{
		Name: "organization_invites", Class: Group,
		Why: "An invitation is issued centrally and its status is updated in place when answered.",
	},
	{
		Name: "profiles", Class: Group,
		Why: "The person behind a membership, edited by them and needed wherever they work.",
	},
	{
		Name: "staff", Class: Group,
		Secret: []string{"password_hash", "pin_hash"},
		Exclude: map[string]string{
			"failed_login_attempts": "node-local lockout counting; a failed PIN at one branch is not a fact other branches should count, and replicating it would let one till lock a person out everywhere",
			"locked_until":          "as failed_login_attempts",
			"last_login_at":         "node-local session bookkeeping",
			"password_set_at":       "meaningful only alongside the hash, which never leaves this node",
			"must_change_password":  "a policy flag about the local credential; without the hash it describes nothing a peer can act on, and replicating it would let one branch force a password change against a credential it cannot see",
		},
		Why: "ROADMAP Now-5 names staff among the group-owned set. The credential columns do not " +
			"replicate: a PIN hash on the wire is a PIN hash to attack offline, and the guarantee this " +
			"programme is held to is that replication is safe on the open internet. The consequence is " +
			"real and stated rather than hidden — a staff member cannot yet sign in at a branch that " +
			"has never seen them, and enrolling them there is a local act.",
	},
	{
		Name: "staff_pay_rates", Class: Group,
		Why: "Effective-dated pay is set centrally and needed wherever hours are worked.",
	},
	{
		Name: "categories", Class: Group,
		Why: "Menu structure. ROADMAP Now-5: menu is group-owned and replicates down.",
	},
	{
		Name: "items", Class: Group,
		Derived: map[string]string{
			"current_stock": "stock_movements",
		},
		Exclude: map[string]string{
			"daily_sold_count":   "a stored counter with NO movement ledger behind it. It cannot replicate as a register — two branches selling the last daily special would each write the same decremented count and one sale would vanish — and there is nothing to sum instead. Until a per-sale ledger exists this number is node-local and the daily-special cap is a per-branch cap.",
			"daily_quantity":     "the cap the node-local counter is compared against; replicating one without the other would let a branch enforce another branch's cap against its own count",
			"daily_counter_date": "the day daily_sold_count resets, and meaningless without it",
		},
		Why: "The menu item. Group-owned per ROADMAP Now-5, and per-column registers so a manager " +
			"editing the description in one place and the price in another lose neither edit. " +
			"current_stock is the stored quantity the whole model exists to avoid: it is the cache of " +
			"SUM over stock_movements (reached through inventory_items.link_to_item_id) and is never " +
			"emitted.",
	},
	{
		Name: "modifier_groups", Class: Group,
		Why: "A modifier group is part of the menu structure an item hangs off, edited in the same seat and " +
			"replicated down with it.",
	},
	{
		Name: "modifiers", Class: Group,
		Why: "A modifier carries a price delta, and ROADMAP Now-5 names pricing as group-owned. A branch " +
			"charging its own price for extra cheese is a pricing decision, not an operational one.",
	},
	{
		Name: "courses", Class: Group,
		Why: "Menu coursing, configured once for the group's service style.",
	},
	{
		Name: "allergens", Class: Group,
		Why: "Menu reference data. Getting a different answer at two branches is a safety problem, not " +
			"a merge problem, so there is one owner.",
	},
	{
		Name: "item_allergens", Class: Group,
		Why: "The join that carries the allergen claim, owned with the menu.",
	},
	{
		Name: "dietary_tags", Class: Group,
		Why: "Menu reference data, as allergens: one owner so a tag means the same thing on every screen. " +
			"Customer-facing, so a branch inventing its own would be a claim to a customer nobody vetted.",
	},
	{
		Name: "item_dietary_tags", Class: Group,
		Why: "The join that puts a dietary tag on an item. Owned with the menu rather than with the branch, " +
			"for the same reason the tag itself is.",
	},
	{
		Name: "menu_schedules", Class: Group,
		Why: "When a menu applies. Central so breakfast starts at the same time everywhere it is meant to.",
	},
	{
		Name: "menu_schedule_slots", Class: Group,
		Why: "The day-and-time slots of a group-owned schedule. Splitting the schedule from its slots across " +
			"two owners would let a branch move breakfast without touching the schedule it belongs to.",
	},
	{
		Name: "item_menu_schedules", Class: Group,
		Why: "Which items a group-owned schedule shows.",
	},
	{
		Name: "item_price_schedules", Class: Group,
		Why: "Scheduled pricing. ROADMAP Now-5 names pricing as group-owned.",
	},
	{
		Name: "item_prep_steps", Class: Group,
		Why: "The recipe method, written once and read in every kitchen.",
	},
	{
		Name: "item_recipes", Class: Group,
		Why: "What an item is made of, and therefore what a sale consumes. Central so cost and " +
			"depletion mean the same thing at every branch.",
	},
	{
		Name: "item_station_routing", Class: Group,
		Why: "Which station cooks an item. Kitchen layout is configured centrally against a shared " +
			"station list.",
	},
	{
		Name: "category_station_routing", Class: Group,
		Why: "As item_station_routing, at category granularity.",
	},
	{
		Name: "kitchen_stations", Class: Group,
		Why: "The stations routing refers to. If these were branch-owned, a routing rule replicated down " +
			"would point at a station id that does not exist on the receiving node.",
	},
	{
		Name: "kds_display_groups", Class: Group,
		Why: "How stations are grouped onto screens, configured with the stations themselves.",
	},
	{
		Name: "tax_rates", Class: Group,
		Why: "Tax is a legal fact about a jurisdiction, not an operational choice at a till. One owner, " +
			"replicated down.",
	},
	{
		Name: "tax_profiles", Class: Group, Key: "org_id",
		Why: "The group's own registered tax identity. There is exactly one and it is not a branch's to " +
			"edit.",
	},
	{
		Name: "adjustment_reasons", Class: Group,
		Why: "The void/comp reason list a branch may pick from. Being able to pick is branch-owned; " +
			"defining the list is not.",
	},
	{
		Name: "promotions", Class: Group,
		Why: "A promotion is offered by the group. Redemptions of it are a ledger, which is what makes " +
			"'used 5 times' safe to count across a partition.",
	},
	{
		Name: "promotion_target_items", Class: Group,
		Why: "What a group-owned promotion applies to.",
	},
	{
		Name: "promotion_target_categories", Class: Group,
		Why: "As promotion_target_items: the scope of a group-owned promotion, which the group decides. A " +
			"branch widening its own promotion would be spending the group's margin.",
	},
	{
		Name: "coupon_codes", Class: Group,
		Derived: map[string]string{
			"used_count": "promotion_redemptions",
		},
		Why: "Codes are issued centrally. used_count is the stored counter — two branches redeeming the " +
			"last use of a code offline would each write the same incremented value and one redemption " +
			"would disappear — so it is derived from the redemption ledger and never emitted. The " +
			"honest converged answer is that the code was over-redeemed and both uses are visible, " +
			"which is the same shape as the two tills and the last steak.",
	},
	{
		Name: "inventory_items", Class: Group,
		Derived: map[string]string{
			"current_stock": "stock_movements",
		},
		Why: "The ingredient itself — its name, unit and cost — is group-owned reference data. Its " +
			"quantity is not data at all: it is SUM(quantity) over stock_movements, and current_stock " +
			"is a local cache of that sum that never goes on the wire.",
	},
	{
		Name: "suppliers", Class: Group,
		Why: "Supplier relationships are held by the group, and a branch ordering from one needs the " +
			"same terms as every other.",
	},
	{
		Name: "supplier_contacts", Class: Group,
		Why: "Part of a group-owned supplier record. Who to phone about a delivery is the same answer at " +
			"every branch, and the group negotiated the relationship.",
	},
	{
		Name: "supplier_locations", Class: Group,
		Why: "Which branches a group-owned supplier serves.",
	},
	{
		Name: "supplier_inventory_items", Class: Group,
		Why: "The supplier's catalogue as the group has negotiated it: pack sizes, lead times, preferred " +
			"status.",
	},
	{
		Name: "customers", Class: Group,
		Derived: map[string]string{
			"loyalty_points":        "loyalty_transactions",
			"points_earned_total":   "loyalty_transactions",
			"points_redeemed_total": "loyalty_transactions",
		},
		Exclude: map[string]string{
			"total_orders":  "an aggregate over orders, which is branch-owned rather than a ledger, so there is no set to SUM; recomputed locally from the orders a node holds",
			"total_spent":   "as total_orders",
			"last_order_at": "as total_orders",
			"last_seen_at":  "node-local presence, true of the branch that saw them and not of the group",
			"pii_purged_at": "a purge executed on one node is not an instruction another node should replay against rows it may not hold",
		},
		Why: "A customer belongs to the group, not to whichever branch first served them, and every " +
			"branch needs the same contact details and block status. Every points column is a stored " +
			"counter and derives from the loyalty ledger instead.",
	},
	{
		Name: "customer_addresses", Class: Group,
		Why: "Where a group-owned customer lives. Needed by whichever branch is delivering.",
	},
	{
		Name: "customer_favorite_items", Class: Group,
		Why: "A customer's own list, theirs across every branch of the group.",
	},
	{
		Name: "gift_cards", Class: Group,
		Secret: []string{"pin_hash"},
		Derived: map[string]string{
			"current_balance_cents": "gift_card_transactions",
		},
		Why: "A card is issued by the group and honoured anywhere in it. The balance is the transaction " +
			"ledger's sum — the case where a register would be catastrophic, because two branches each " +
			"redeeming the last R100 offline would both write a zero balance and the group would have " +
			"paid out twice while believing it paid out once. The PIN hash never leaves this node.",
	},
	{
		Name: "store_credits", Class: Group,
		Derived: map[string]string{
			"balance_cents": "store_credit_transactions",
		},
		Why: "The customer's credit balance row. Same argument as gift cards: the row exists, the number " +
			"on it does not replicate.",
	},
	{
		Name: "house_accounts", Class: Group,
		Derived: map[string]string{
			"current_balance_cents": "house_account_charges",
		},
		Why: "A corporate account held by the group. Its limit is group-owned configuration; its balance " +
			"is the charge ledger's sum.",
	},
	{
		Name: "house_account_members", Class: Group,
		Why: "Who may charge to a group-owned account.",
	},
	{
		Name: "loyalty_config", Class: Group,
		Why: "The rules points are earned under. Two branches applying different rules is the failure " +
			"this prevents.",
	},
	{
		Name: "delivery_zones", Class: Group,
		Why: "Zones and fees are set in the dashboard against a branch, not typed at its till.",
	},
	{
		Name: "location_printers", Class: Group,
		Why: "Printer configuration is edited in the dashboard. It names hardware at one branch but the " +
			"editing seat is central, and a branch cannot see its own printer list to fix it if the " +
			"list only exists there.",
	},
	{
		Name: "payment_methods", Class: Group,
		Why: "The tender types the group accepts and their fee structure.",
	},
	{
		Name: "currencies", Class: Group, Key: "code",
		Why: "Reference data, keyed by ISO code rather than a uuid.",
	},
	{
		Name: "marketplace_reviews", Class: Group,
		Why: "A public review belongs to the customer who wrote it and the group that answers it; the " +
			"owner reply is edited in place, which is a register.",
	},
	{
		Name: "legal_documents", Class: Group,
		Why: "The terms a group publishes. Versioned, so a new version is a new row and an edit to an " +
			"unpublished draft is an ordinary register write.",
	},
	{
		Name: "driver_emergency_contacts", Class: Group,
		Why: "Held about a person, needed by whichever branch is dispatching them.",
	},
	{
		Name: "whatsapp_routing", Class: Group,
		Why: "Which branch a WhatsApp number routes to. Configured centrally; a branch editing its own " +
			"routing could silently take another branch's traffic.",
	},
	{
		Name: "invoices", Class: Group,
		Why: "A platform invoice raised against the group. One issuer, replicated down so any branch can " +
			"see what is owed.",
	},

	// -----------------------------------------------------------------------
	// Local — never leaves this node.
	// -----------------------------------------------------------------------

	// --- Credentials, sessions and one-shot tokens.
	{Name: "auth_users", Class: Local, Why: "Password hashes and TOTP ciphertext. Account identity is deliberately node-local: replicating a credential store is how one compromised branch becomes every branch."},
	{Name: "refresh_tokens", Class: Local, Why: "A session belongs to the node that issued it. Replicating one would let a stolen token be replayed against a branch that never saw the login."},
	{Name: "staff_refresh_tokens", Class: Local, Why: "As refresh_tokens, for the staff PIN overlay. A till session is held by the till; a branch that " +
		"never saw the sign-in must not be able to continue it."},
	{Name: "password_reset_tokens", Class: Local, Why: "One-shot secret, consumed where it was issued."},
	{Name: "staff_password_reset_tokens", Class: Local, Why: "As password_reset_tokens: a one-shot secret, consumed at the node that issued it. Replicating " +
		"one would widen the window it exists to narrow."},
	{Name: "email_verification_tokens", Class: Local, Why: "One-shot secret, consumed where it was issued."},
	{Name: "elevation_tokens_used", Class: Local, Why: "A replay-defence record. It is only meaningful against the node that would replay it, and shipping it would broaden rather than narrow the window."},
	{Name: "user_backup_codes", Class: Local, Why: "Second-factor recovery codes. They are credential material and a code is redeemable exactly " +
		"once, so a replica holding a copy is a second place it can be spent."},
	{Name: "order_tracking_tokens", Class: Local, Key: "token", Why: "A bearer link handed to a customer by one node."},
	{Name: "whatsapp_link_tokens", Class: Local, Key: "token", Why: "A one-shot linking secret with an expiry, consumed at the node that issued it. It is a bearer " +
		"credential, and bearer credentials do not replicate."},
	{Name: "api_keys", Class: Local, Why: "Key hashes and scopes for calls made against this node's API."},
	{Name: "location_email_credentials", Class: Local, Why: "Encrypted provider keys. The ciphertext is only decryptable where its key lives, so replicating it moves an attackable blob and nothing useful."},
	{Name: "webhook_endpoints", Class: Local, Why: "Carries signing_secret_ciphertext, and a webhook is delivered by the node that holds the subscription."},

	// --- Queues, delivery attempts and other in-flight machinery.
	{Name: "webhook_deliveries", Class: Local, Why: "Delivery attempts by this node. Replicating them would let two nodes each believe the other had delivered."},
	{Name: "kds_fanout_queue", Class: Local, Why: "This node's work queue for pushing tickets to screens. A queue is a node's intention, not a shared fact."},
	{Name: "idempotency_keys", Class: Local, Why: "De-duplication of HTTP calls made to THIS node. A key means 'I already answered this request', which is never true of another node."},
	{Name: "data_export_jobs", Class: Local, Why: "A job run by one node against storage that node can reach."},
	{Name: "recipe_cost_runs", Class: Local, Why: "Bookkeeping for a recompute this node performed."},
	{Name: "cart_items", Class: Local, Why: "A customer's in-progress basket on one storefront, discarded at checkout. It becomes an order, and the order replicates."},
	{Name: "cart_item_variations", Class: Local, Why: "A variation chosen on a node-local cart line. It disappears with the cart at checkout; what " +
		"survives is the order line, and that replicates."},
	{Name: "receipt_documents", Class: Local, Why: "A rendered PDF's storage key. The key names an object in a bucket the issuing node can reach; the order it was rendered from is what replicates."},

	// --- Derived, archived, and platform-scoped.
	{Name: "staff_attendance_summary", Class: Local, Why: "Wholly derived from staff_time_entries. Replicating a computed summary alongside its inputs is two answers to one question, and the stale one wins whenever it was written later."},
	{Name: "audit_log_archived", Class: Local, Why: "Retention-archived rows of audit_log. The live table replicates; shipping the archive too would re-insert facts a peer has already compacted."},
	{Name: "exchange_rates", Class: Local, Why: "Fetched from an external source with an expiry. Each node fetches its own; replicating them would spread one node's stale rate to nodes that could have got a fresh one."},
	{Name: "llm_messages", Class: Local, Why: "Usage accounting for calls this node made."},
	{Name: "llm_tool_executions", Class: Local, Why: "As llm_messages: the record of a call this node made to a model provider, priced against this " +
		"node's budget. Another node did not make the call and does not owe for it."},
	{Name: "llm_model_pricing", Class: Local, Why: "A price list refreshed from a provider, not a fact about the shop."},
	{Name: "platform_admin_actions", Class: Local, Why: "Platform-operator actions, above the tenant. There is no organization_id on the row and no tenant that owns it."},
	{Name: "email_providers", Class: Local, Key: "code", Why: "Which provider integrations this build supports. Deployment configuration, not shop data."},
	{Name: "onboarding_progress", Class: Local, Key: "org_id", Why: "How far the setup wizard got on this node. A branch installed later has genuinely not done those steps."},
	{Name: "user_preferences", Class: Local, Key: "profile_id", Why: "Which screen this person last had open on this device."},
	{Name: "custom_domains", Class: Local, Why: "A hostname and its certificate state belong to the node serving it. A verification token replicated elsewhere is a token that cannot be used there."},
	{Name: "whatsapp_accounts", Class: Local, Why: "A phone binding held by the node that holds the WhatsApp session."},
	{Name: "whatsapp_account_links", Class: Local, Why: "As whatsapp_accounts: a phone binding is only usable by the node holding the WhatsApp session " +
		"it was made in, so a copy elsewhere is an identity claim nothing can act on."},
	{Name: "whatsapp_phone_numbers", Class: Local, Why: "Meta-side numbering for the node that owns the integration."},
	{Name: "driver_location_pings_default", Class: Local, Why: "The default PARTITION of driver_location_pings. Its rows are the parent's and are emitted once, there; emitting from both would put every ping in the set twice."},

	// --- Cannot be replicated safely as the schema stands. Honest gaps.
	{
		Name: "customer_loyalty_stamps", Class: Local,
		Why: "A stored counter with no movement ledger behind it — the row IS the number. It cannot be " +
			"a register, because two branches stamping the same card offline would each write the same " +
			"incremented value and one stamp would vanish, which is exactly the failure ROADMAP Now-5 " +
			"forbids. It cannot be a ledger either, because there is no per-stamp row to union. So it " +
			"stays node-local and stamps are per-branch until a stamp-event table exists. This is a " +
			"gap, recorded as one rather than papered over with a register that looks like it works.",
	},

	// --- This product's own sync bookkeeping.
	{Name: "sync_ops", Class: Local, Why: "The operation log itself. An op describing the insertion of an op is a loop, and the log is carried by the transport rather than by its own contents."},
	{Name: "sync_peers", Class: Local, Why: "Who THIS node is enrolled with, and the keys it pinned. Peer enrolment is manual over an operator-supplied address by design; replicating a peer list would turn it into a directory, which the sovereignty ruling forbids."},
	{Name: "sync_nonces", Class: Local, Key: "nonce", Why: "This node's replay cache. A nonce another node has seen is not a nonce this one may accept."},
}
