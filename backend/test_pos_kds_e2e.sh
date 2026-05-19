#!/usr/bin/env bash
# =============================================================================
# E2E test: POS order → KDS ticket with ingredients + prep steps
# =============================================================================
# Usage:  bash backend/test_pos_kds_e2e.sh
#
# Prerequisites:
#   - Postgres running at postgres://beepbite:beepbite@localhost:5432/beepbite
#   - Backend server running at http://localhost:8080
#   - All migrations applied (including 20240101000044_item_prep_steps)
#   - Seed data run (seed.sql) so 'Allsion Burgers' location + items exist
#
# The script is idempotent: it upserts its test fixtures and cleans them up at
# exit unless KEEP_FIXTURES=1 is set in the environment.
# =============================================================================
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:8080}"
DB_URL="${DATABASE_URL:-postgres://beepbite:beepbite@localhost:5432/beepbite?sslmode=disable}"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
pass() { echo -e "${GREEN}PASS${NC}  $*"; }
fail() { echo -e "${RED}FAIL${NC}  $*"; exit 1; }
info() { echo -e "${YELLOW}INFO${NC}  $*"; }

# ─── helpers ────────────────────────────────────────────────────────────────
psql_q() { psql "$DB_URL" -t -A -c "$1" 2>/dev/null; }

require_nonempty() {
    local val="$1" desc="$2"
    if [ -z "$val" ] || [ "$val" = "null" ]; then
        fail "Expected non-empty value for: $desc (got: '${val}')"
    fi
}

require_json_array_nonempty() {
    local json="$1" field="$2"
    local count
    count=$(echo "$json" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('$field', [])))" 2>/dev/null || echo 0)
    if [ "$count" -eq 0 ]; then
        fail "Expected non-empty array for field '$field' in: $json"
    fi
}

jq_val() {
    echo "$1" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d$2)" 2>/dev/null || echo ""
}

# ─── check prerequisites ─────────────────────────────────────────────────────
info "Checking prerequisites…"

if ! curl -sf "$BASE_URL/health" > /dev/null; then
    fail "Backend not reachable at $BASE_URL — start with: cd backend && go run ./cmd/server"
fi
pass "Server is up"

# ─── resolve test fixtures from DB ───────────────────────────────────────────
info "Resolving seed data…"

LOCATION_ID=$(psql_q "SELECT l.id FROM locations l WHERE l.name = 'Allsion Burgers' LIMIT 1")
require_nonempty "$LOCATION_ID" "location_id for 'Allsion Burgers'"
info "location_id = $LOCATION_ID"

BURGER_ID=$(psql_q "SELECT id FROM items WHERE location_id = '$LOCATION_ID' AND name = 'Classic Burger' LIMIT 1")
FRIES_ID=$(psql_q "SELECT id FROM items WHERE location_id = '$LOCATION_ID' AND name = 'Fries' LIMIT 1")
require_nonempty "$BURGER_ID" "item_id for 'Classic Burger'"
require_nonempty "$FRIES_ID"  "item_id for 'Fries'"
info "Classic Burger id = $BURGER_ID"
info "Fries id          = $FRIES_ID"

# ─── seed kitchen station + routing + recipes + cash drawer ──────────────────
info "Seeding test fixtures (kitchen station, routing, recipes, cash drawer)…"

psql "$DB_URL" -v ON_ERROR_STOP=1 <<SQL
-- 1. Kitchen station (grill) — idempotent via UNIQUE(location_id, name)
INSERT INTO kitchen_stations (id, location_id, name, station_type, sort_order, is_active)
VALUES (
    'aaaaaaaa-0000-0000-0000-000000000001',
    '$LOCATION_ID',
    'Test Grill Station',
    'prep',
    1,
    true
)
ON CONFLICT (location_id, name) DO UPDATE SET is_active = true;

-- 2. Route both items to the grill station
INSERT INTO item_station_routing (item_id, station_id, is_primary)
VALUES ('$BURGER_ID', 'aaaaaaaa-0000-0000-0000-000000000001', true)
ON CONFLICT (item_id, station_id) DO NOTHING;

INSERT INTO item_station_routing (item_id, station_id, is_primary)
VALUES ('$FRIES_ID', 'aaaaaaaa-0000-0000-0000-000000000001', false)
ON CONFLICT (item_id, station_id) DO NOTHING;

-- 3. Seed item_recipes so ingredients appear in the KDS detail
--    We'll use Fries as a child ingredient of Burger (demonstration).
--    Real scenario: burger bun, patty, etc. Here we add a "Fries" component.
INSERT INTO item_recipes (parent_item_id, child_item_id, quantity_needed, unit, recipe_level)
VALUES ('$BURGER_ID', '$FRIES_ID', 0.5, 'portion', 1)
ON CONFLICT (parent_item_id, child_item_id) DO NOTHING;

-- 4. Cash drawer for session open test
INSERT INTO cash_drawers (id, location_id, name, is_active)
VALUES (
    'bbbbbbbb-0000-0000-0000-000000000001',
    '$LOCATION_ID',
    'Test Drawer E2E',
    true
)
ON CONFLICT (location_id, name) DO UPDATE SET is_active = true;
SQL

STATION_ID=$(psql_q "SELECT id FROM kitchen_stations WHERE location_id = '$LOCATION_ID' AND name = 'Test Grill Station' LIMIT 1")
DRAWER_ID=$(psql_q "SELECT id FROM cash_drawers WHERE location_id = '$LOCATION_ID' AND name = 'Test Drawer E2E' LIMIT 1")
require_nonempty "$STATION_ID" "kitchen station id"
require_nonempty "$DRAWER_ID"  "cash drawer id"
info "station_id  = $STATION_ID"
info "drawer_id   = $DRAWER_ID"

# Verify prep steps seeded by migration 44
PREP_COUNT=$(psql_q "SELECT COUNT(*) FROM item_prep_steps WHERE item_id IN ('$BURGER_ID','$FRIES_ID')")
info "Prep steps for burger+fries: $PREP_COUNT"
if [ "$PREP_COUNT" -eq 0 ]; then
    fail "No prep steps found — was migration 20240101000044_item_prep_steps applied?"
fi
pass "Prep steps present ($PREP_COUNT rows)"

# ─── cleanup trap ─────────────────────────────────────────────────────────────
cleanup() {
    if [ "${KEEP_FIXTURES:-0}" = "1" ]; then
        info "KEEP_FIXTURES=1 — leaving test fixtures in place"
        return
    fi
    info "Cleaning up test fixtures…"
    psql "$DB_URL" <<SQL2 2>/dev/null || true
DELETE FROM item_recipes WHERE parent_item_id = '$BURGER_ID' AND child_item_id = '$FRIES_ID';
DELETE FROM item_station_routing WHERE station_id = 'aaaaaaaa-0000-0000-0000-000000000001';
DELETE FROM kitchen_stations WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';
DELETE FROM cash_drawers WHERE id = 'bbbbbbbb-0000-0000-0000-000000000001';
SQL2
    info "Test fixtures removed"
}
trap cleanup EXIT

# ─── STEP 1: Staff PIN login ──────────────────────────────────────────────────
info "STEP 1: Staff PIN login…"

LOGIN_RESP=$(curl -sf -X POST "$BASE_URL/auth/staff/pin-login" \
    -H "Content-Type: application/json" \
    -d "{\"location_id\":\"$LOCATION_ID\",\"username\":\"bongani\",\"pin\":\"1234\"}")

echo "  login response: $LOGIN_RESP"

ACCESS_TOKEN=$(jq_val "$LOGIN_RESP" "['access_token']")
require_nonempty "$ACCESS_TOKEN" "access_token from pin-login"
pass "PIN login succeeded, got JWT"

# ─── STEP 2: Open a cash drawer session ──────────────────────────────────────
info "STEP 2: Opening cash drawer session…"

# Close any existing open session first (idempotency)
EXISTING_OPEN=$(psql_q "SELECT id FROM cash_drawer_sessions WHERE cash_drawer_id = '$DRAWER_ID' AND status = 'open' LIMIT 1")
if [ -n "$EXISTING_OPEN" ]; then
    info "  Found existing open session $EXISTING_OPEN — closing it first"
    psql "$DB_URL" -c "UPDATE cash_drawer_sessions SET status = 'closed', closed_at = now() WHERE id = '$EXISTING_OPEN';" > /dev/null
fi

SESSION_RESP=$(curl -sf -X POST "$BASE_URL/cash-drawers/$DRAWER_ID/sessions/open" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -d '{"opening_float_cents": 50000, "is_blind_close": false}')

echo "  session response: $SESSION_RESP"

REGISTER_SESSION_ID=$(jq_val "$SESSION_RESP" "['id']")
require_nonempty "$REGISTER_SESSION_ID" "register_session_id from open-session"
pass "Cash drawer session opened: $REGISTER_SESSION_ID"

# ─── STEP 3: POST /pos/orders ─────────────────────────────────────────────────
info "STEP 3: Creating POS order (Classic Burger x1 + Fries x2)…"

ORDER_BODY=$(cat <<JSON
{
    "location_id": "$LOCATION_ID",
    "order_type": "dine_in",
    "table_number": "T-07",
    "register_session_id": "$REGISTER_SESSION_ID",
    "items": [
        {"item_id": "$BURGER_ID", "quantity": 1, "variation_option_ids": [], "notes": "No pickles"},
        {"item_id": "$FRIES_ID",  "quantity": 2, "variation_option_ids": [], "notes": "Extra salt"}
    ]
}
JSON
)

ORDER_RESP=$(curl -sf -X POST "$BASE_URL/pos/orders" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -d "$ORDER_BODY")

echo "  order response: $ORDER_RESP"

# ─── STEP 4: Assert order response ───────────────────────────────────────────
info "STEP 4: Asserting order response…"

ORDER_ID=$(jq_val "$ORDER_RESP" "['order_id']")
ORDER_NUMBER=$(jq_val "$ORDER_RESP" "['order_number']")
KDS_TICKET_COUNT=$(jq_val "$ORDER_RESP" "['kds_ticket_ids']" | python3 -c "import sys; arr=eval(sys.stdin.read()); print(len(arr))" 2>/dev/null || echo 0)

require_nonempty "$ORDER_ID" "order_id"
require_nonempty "$ORDER_NUMBER" "order_number"

if [ "$KDS_TICKET_COUNT" -lt 1 ]; then
    fail "Expected kds_ticket_ids to be non-empty, got count=$KDS_TICKET_COUNT in: $ORDER_RESP"
fi

pass "Order created: $ORDER_NUMBER (id=$ORDER_ID)"
pass "KDS tickets fired: $KDS_TICKET_COUNT ticket(s)"

# Extract first ticket ID
TICKET_ID=$(jq_val "$ORDER_RESP" "['kds_ticket_ids'][0]")
require_nonempty "$TICKET_ID" "kds_ticket_ids[0]"
info "First ticket_id = $TICKET_ID"

# ─── STEP 5: GET /kds/tickets/{id}/details ───────────────────────────────────
# KDS routes are namespaced under /kds via r.Route("/kds", kdsH.Mount).
info "STEP 5: Fetching KDS ticket details…"

TICKET_DETAIL=$(curl -sf "$BASE_URL/kds/tickets/$TICKET_ID/details" \
    -H "Authorization: Bearer $ACCESS_TOKEN")

echo "  ticket detail: $TICKET_DETAIL"

# Assert items array
ITEM_COUNT=$(jq_val "$TICKET_DETAIL" "['items']" | python3 -c "import sys; arr=eval(sys.stdin.read()); print(len(arr))" 2>/dev/null || echo 0)
if [ "$ITEM_COUNT" -lt 1 ]; then
    fail "Expected non-empty items in ticket detail, got: $TICKET_DETAIL"
fi
pass "Ticket detail has $ITEM_COUNT item(s)"

# Assert ingredients on at least one item
ING_COUNT=$(echo "$TICKET_DETAIL" | python3 -c "
import sys, json
d = json.load(sys.stdin)
total = sum(len(it.get('ingredients', [])) for it in d.get('items', []))
print(total)
" 2>/dev/null || echo 0)

if [ "$ING_COUNT" -lt 1 ]; then
    fail "Expected at least one ingredient across ticket items, got 0 in: $TICKET_DETAIL"
fi
pass "Ingredients present ($ING_COUNT total across all items)"

# Assert prep_steps on at least one item
PS_COUNT=$(echo "$TICKET_DETAIL" | python3 -c "
import sys, json
d = json.load(sys.stdin)
total = sum(len(it.get('prep_steps', [])) for it in d.get('items', []))
print(total)
" 2>/dev/null || echo 0)

if [ "$PS_COUNT" -lt 1 ]; then
    fail "Expected at least one prep_step across ticket items, got 0 in: $TICKET_DETAIL"
fi
pass "Prep steps present ($PS_COUNT total across all items)"

# ─── STEP 6: GET /stations/{station_id}/tickets ──────────────────────────────
info "STEP 6: Verifying new ticket appears in station listing…"

STATION_TICKETS=$(curl -sf "$BASE_URL/kds/stations/$STATION_ID/tickets" \
    -H "Authorization: Bearer $ACCESS_TOKEN")

echo "  station tickets: $STATION_TICKETS"

STATION_TICKET_COUNT=$(echo "$STATION_TICKETS" | python3 -c "
import sys, json
arr = json.load(sys.stdin)
print(len(arr))
" 2>/dev/null || echo 0)

# Check the specific ticket is in the list
FOUND=$(echo "$STATION_TICKETS" | python3 -c "
import sys, json
arr = json.load(sys.stdin)
ids = [t.get('id','') for t in arr]
print('yes' if '$TICKET_ID' in ids else 'no')
" 2>/dev/null || echo no)

if [ "$FOUND" != "yes" ]; then
    fail "Ticket $TICKET_ID not found in station listing. Station tickets: $STATION_TICKETS"
fi
pass "Ticket $TICKET_ID appears in station listing ($STATION_TICKET_COUNT active ticket(s))"

# ─── Summary ─────────────────────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════════════════════════════════"
echo -e "  ${GREEN}ALL STEPS PASSED${NC}"
echo "════════════════════════════════════════════════════════════════════"
echo "  Order:         $ORDER_NUMBER  ($ORDER_ID)"
echo "  KDS tickets:   $KDS_TICKET_COUNT"
echo "  First ticket:  $TICKET_ID"
echo "  Ingredients:   $ING_COUNT"
echo "  Prep steps:    $PS_COUNT"
echo ""
echo "  Sample GET /kds/tickets/$TICKET_ID/details response:"
echo "$TICKET_DETAIL" | python3 -m json.tool 2>/dev/null || echo "$TICKET_DETAIL"
echo "════════════════════════════════════════════════════════════════════"
