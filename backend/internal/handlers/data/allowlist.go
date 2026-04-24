package data

// Allowlists what the generic REST layer is willing to touch. Anything not in
// these maps returns 404. Keeps a typo in the frontend from accidentally
// deleting from the wrong table.
//
// Keys are table names; the value indicates which ops are permitted.

type ops struct {
	Select bool
	Insert bool
	Update bool
	Delete bool
}

var allTables = map[string]ops{
	"profiles":                  {Select: true, Insert: true, Update: true},
	"organizations":             {Select: true, Insert: true, Update: true},
	"locations":                 {Select: true, Insert: true, Update: true},
	"organization_members":      {Select: true, Insert: true, Update: true, Delete: true},
	"organization_invites":      {Select: true, Insert: true, Update: true, Delete: true},
	"staff":                     {Select: true, Insert: true, Update: true, Delete: true},
	"staff_time_entries":        {Select: true, Insert: true, Update: true},
	"staff_shifts":              {Select: true, Insert: true, Update: true, Delete: true},
	"staff_attendance_summary":  {Select: true},
	"customers":                 {Select: true, Insert: true, Update: true},
	"customer_addresses":        {Select: true, Insert: true, Update: true, Delete: true},
	"categories":                {Select: true, Insert: true, Update: true, Delete: true},
	"items":                     {Select: true, Insert: true, Update: true, Delete: true},
	"item_variations":           {Select: true, Insert: true, Update: true, Delete: true},
	"item_variation_options":    {Select: true, Insert: true, Update: true, Delete: true},
	"delivery_drivers":          {Select: true, Insert: true, Update: true, Delete: true},
	"driver_locations":          {Select: true, Insert: true},
	"orders":                    {Select: true, Insert: true, Update: true},
	"order_details":             {Select: true, Insert: true, Update: true},
	"order_financial_details":   {Select: true, Insert: true, Update: true},
	"order_items":               {Select: true, Insert: true, Update: true},
	"order_item_variations":     {Select: true, Insert: true},
	"driver_ratings":            {Select: true, Insert: true},
	"driver_earnings":           {Select: true, Insert: true, Update: true},
	"notifications":             {Select: true, Insert: true, Update: true},
	"bots":                      {Select: true, Insert: true, Update: true, Delete: true},
	"chats":                     {Select: true, Insert: true, Update: true, Delete: true},
	"messages":                  {Select: true, Insert: true, Update: true},
	"inventory_items":           {Select: true, Insert: true, Update: true, Delete: true},
	"stock_movements":           {Select: true, Insert: true},
	"tax_rates":                 {Select: true, Insert: true, Update: true, Delete: true},
	"reviews":                   {Select: true, Insert: true, Update: true},
	"item_recipes":              {Select: true, Insert: true, Update: true, Delete: true},
	"recipe_breakdown":          {Select: true}, // view
	"recipe_summary":            {Select: true}, // view

	// Migration 16 — dine-in / tables / floor plan
	"sections":          {Select: true, Insert: true, Update: true, Delete: true},
	"tables":            {Select: true, Insert: true, Update: true, Delete: true},
	"table_sessions":    {Select: true, Insert: true, Update: true},
	"seats":             {Select: true, Insert: true, Update: true, Delete: true},
	"check_splits":      {Select: true, Insert: true, Update: true, Delete: true},
	"check_split_items": {Select: true, Insert: true, Update: true, Delete: true},

	// Migration 17 — kitchen display system
	"kitchen_stations":     {Select: true, Insert: true, Update: true, Delete: true},
	"item_station_routing": {Select: true, Insert: true, Update: true, Delete: true},
	"kds_tickets":          {Select: true, Insert: true, Update: true},
	"kds_ticket_items":     {Select: true, Insert: true, Update: true},
	"kds_ticket_events":    {Select: true, Insert: true}, // append-only audit log

	// Migration 18 — cash drawer + order adjustments (voids/comps/overrides)
	"cash_drawers":                 {Select: true, Insert: true, Update: true, Delete: true},
	"cash_drawer_sessions":         {Select: true, Insert: true, Update: true},
	"cash_drawer_movements":        {Select: true, Insert: true}, // append-only
	"cash_drawer_counts":           {Select: true, Insert: true},
	"cash_drawer_session_payments": {Select: true, Insert: true},
	"adjustment_reasons":           {Select: true, Insert: true, Update: true, Delete: true},
	"order_adjustments":            {Select: true, Insert: true, Update: true}, // Update for approval flow

	// Migration 19 — promotions / coupons / discounts
	"promotions":                    {Select: true, Insert: true, Update: true, Delete: true},
	"promotion_target_items":        {Select: true, Insert: true, Delete: true},
	"promotion_target_categories":   {Select: true, Insert: true, Delete: true},
	"coupon_codes":                  {Select: true, Insert: true, Update: true, Delete: true},
	"promotion_redemptions":         {Select: true, Insert: true}, // append-only
	"order_item_discounts":          {Select: true, Insert: true}, // append-only

	// Migration 20 — suppliers, purchasing, ingredient price history
	"suppliers":                 {Select: true, Insert: true, Update: true, Delete: true},
	"supplier_contacts":         {Select: true, Insert: true, Update: true, Delete: true},
	"supplier_locations":        {Select: true, Insert: true, Update: true, Delete: true},
	"supplier_inventory_items":  {Select: true, Insert: true, Update: true, Delete: true},
	"purchase_orders":           {Select: true, Insert: true, Update: true, Delete: true},
	"purchase_order_items":      {Select: true, Insert: true, Update: true, Delete: true},
	"goods_receipts":            {Select: true, Insert: true, Update: true},
	"goods_receipt_items":       {Select: true, Insert: true, Update: true},
	"supplier_invoices":         {Select: true, Insert: true, Update: true},
	"supplier_invoice_lines":    {Select: true, Insert: true, Update: true, Delete: true},
	"ingredient_price_history":  {Select: true, Insert: true}, // append-only audit

	// Migration 22 — reporting views (read-only)
	"daily_sales_summary":       {Select: true}, // view
	"hourly_sales_heatmap":      {Select: true}, // view
	"menu_engineering":          {Select: true}, // view
	"labor_hours_daily":         {Select: true}, // view
	"theoretical_vs_actual_cogs": {Select: true}, // view
	"revenue_by_payment_method": {Select: true}, // view

	// Migration 23 — audit log + idempotency + webhook events
	// audit_log / idempotency_keys / webhook_event_log are written by the Go
	// backend itself; the generic REST layer only exposes read access.
	"audit_log":         {Select: true},
	"idempotency_keys":  {Select: true},
	"webhook_event_log": {Select: true},

	// Migration 24 — menu extensions (allergens, dietary tags, schedules, happy hour)
	"allergens":             {Select: true, Insert: true, Update: true, Delete: true},
	"item_allergens":        {Select: true, Insert: true, Delete: true},
	"dietary_tags":          {Select: true, Insert: true, Update: true, Delete: true},
	"item_dietary_tags":     {Select: true, Insert: true, Delete: true},
	"menu_schedules":        {Select: true, Insert: true, Update: true, Delete: true},
	"menu_schedule_slots":   {Select: true, Insert: true, Update: true, Delete: true},
	"item_menu_schedules":   {Select: true, Insert: true, Delete: true},
	"item_price_schedules":  {Select: true, Insert: true, Update: true, Delete: true},

	// Migration 25 — gift cards / store credit / house accounts / loyalty
	// Balance mutations go through Go handlers (ledger enforcement), so ledgers
	// are read-only via the REST layer; balance rows are read-only too.
	"gift_cards":               {Select: true, Insert: true, Update: true}, // Update for status/notes; balance via handler
	"gift_card_transactions":   {Select: true},                             // append-only ledger
	"store_credits":            {Select: true},                             // balance read-only
	"store_credit_transactions": {Select: true},                            // append-only ledger
	"house_accounts":           {Select: true, Insert: true, Update: true, Delete: true},
	"house_account_members":    {Select: true, Insert: true, Update: true, Delete: true},
	"house_account_charges":    {Select: true},                             // append-only
	"house_account_invoices":   {Select: true, Insert: true, Update: true},
	"loyalty_config":           {Select: true, Insert: true, Update: true},
	"loyalty_transactions":     {Select: true},                             // append-only ledger

	// Migration 26 — regions + central gateways (BYO removed)
	// regions is config — insert/update guarded by admin-only UI; exposing both
	// for now. payment_provider text column on regions is set per deployment;
	// actual gateway credentials live in env vars, not the DB.
	"regions": {Select: true, Insert: true, Update: true},

	// Migration 27 — subscription plans + payouts
	// subscription_plans: read-only via generic API (mutations via admin flow)
	"subscription_plans": {Select: true},
	"bank_accounts":      {Select: true, Insert: true, Update: true, Delete: true}, // account number stored encrypted; writes go through a Go handler in practice
	"payout_schedules":   {Select: true, Insert: true, Update: true, Delete: true},

	// Migration 29 — staff pay rates (effective-dated)
	"staff_pay_rates": {Select: true, Insert: true, Update: true, Delete: true},
}

// allRPCs names the Postgres functions the /rpc/:fn endpoint is willing to
// invoke. Anything else is rejected. Order of args is enforced by the caller.
var allRPCs = map[string]bool{
	// invite_functions.sql
	"check_invites":                 true,
	"respond_invitation":            true,
	"send_invitation":               true,
	"cancel_invitation":             true,
	"list_organization_invitations": true,

	// recursive_recipes.sql / apply_recursive_recipes.sql
	"calculate_recipe_cost":   true,
	"update_recipe_metadata":  true,

	// payment_system.sql
	"lookup_customer_details": true,
}

func allowed(table string) (ops, bool) {
	o, ok := allTables[table]
	return o, ok
}

func rpcAllowed(fn string) bool { return allRPCs[fn] }
