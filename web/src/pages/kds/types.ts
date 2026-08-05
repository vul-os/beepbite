// Shared KDS types — mirrors backend/internal/handlers/kds/store.go DTOs.
// Central home so hooks and components across kds/ don't redeclare the same
// shapes (and don't need to import from a page-level route component, which
// would create needless coupling between station.tsx/expo.tsx and their own
// hooks/components).

// ---- Recipe detail (from GET /kds/tickets/{id}/details) -------------------

// Mirrors backend/internal/handlers/kds/store.go PrepStep. `text` is read
// defensively by recipe-section.tsx as a fallback for `instruction` but is
// not a real field on this DTO (Go struct only has StepNumber/Instruction)
// — pre-existing dead read, flagged not fixed.
export interface KdsPrepStep {
  step_number: number;
  instruction: string;
  text?: string;
}

// Mirrors backend/internal/handlers/kds/store.go Ingredient.
export interface KdsIngredient {
  name: string;
  quantity: number;
  unit: string;
}

// ---- Ticket items -----------------------------------------------------------
//
// A ticket card's items may come from either the list/SSE summary shape
// (backend Ticket struct's TicketItem, via GET /kds/stations/{id}/tickets)
// or the enriched detail shape (TicketDetailItem, via GET
// /kds/tickets/{id}/details) — components read a permissive union of both
// field sets since they don't know which they have until /details loads
// (see ticket-card.jsx's own "gracefully renders without details" comment).
export interface KdsTicketItem {
  id?: string;
  ticket_item_id?: string;
  ticket_id?: string;
  order_item_id?: string;
  quantity?: string | number;
  item_status?: string;
  status?: string;
  notes?: string | null;
  item_name?: string;
  name?: string;
  variations?: string[];
  ingredients?: KdsIngredient[];
  prep_steps?: KdsPrepStep[];
  allergens?: string[];
  started_at?: string | null;
  ready_at?: string | null;
  bumped_at?: string | null;
  created_at?: string;
  updated_at?: string;
}

// Mirrors backend/internal/handlers/kds/store.go TicketDetail — the response
// of GET /kds/tickets/{id}/details.
export interface KdsTicketDetail {
  ticket_id: string;
  order_number: string;
  station_name: string;
  table_number?: string | null;
  fired_at: string;
  items: KdsTicketItem[];
}

// ---- Ticket (list/SSE summary) ----------------------------------------------
//
// Mirrors backend/internal/handlers/kds/store.go Ticket/TicketWithItems — the
// response of GET /kds/stations/{id}/tickets.
export interface KdsTicket {
  id: string;
  order_id: string;
  station_id: string;
  ticket_number: number;
  status: string;
  fired_at: string;
  started_at?: string | null;
  ready_at?: string | null;
  bumped_at?: string | null;
  bumped_by?: string | null;
  course_number?: number | null;
  priority: number;
  notes?: string | null;
  created_at: string;
  updated_at: string;
  items?: KdsTicketItem[];
  // NOTE: order_type, table_number, and order_number are read defensively by
  // ticket-card.jsx but do NOT exist on the real Ticket/TicketWithItems DTO
  // — only TicketDetail carries table_number, and ticket_number /
  // details.order_number are the real sources for the order number.
  // Pre-existing dead defensive reads, flagged not fixed.
  order_type?: string;
  table_number?: string;
  order_number?: string;
}

// SSE payload shape, per kds/handler.go streamStation's doc comment:
//   {"ticket_id":"...","station_id":"...","event_type":"...","created_at":"..."}
export interface KdsSSEEvent {
  ticket_id?: string;
  station_id?: string;
  event_type?: string;
  created_at?: string;
}

// ---- Expo view ---------------------------------------------------------------
//
// Mirrors one decoded element of backend/internal/handlers/kds/store.go
// ExpoRow.StationTickets (base64-encoded jsonb_agg), per the Go handler's own
// doc comment: { ticket_id, station_name, status, fired_at, ready_at,
// course_number, items: [{ order_item_id, quantity, item_status, notes }] }.
export interface ExpoStationItem {
  order_item_id?: string;
  quantity?: string | number;
  item_status?: string;
  notes?: string | null;
  name?: string;
  item_name?: string;
}

export interface ExpoStationTicket {
  ticket_id: string;
  station_name?: string;
  status?: string;
  fired_at?: string;
  ready_at?: string | null;
  course_number?: number | null;
  items?: ExpoStationItem[];
}

// Client-side merge of an `orders` row (backend/migrations/001_baseline.sql)
// with backend/internal/handlers/kds/store.go ExpoRow (GET
// /kds/orders/{order_id}/expo) — built in expo.tsx's load(). ExpoRow itself
// has no order_number/order_type/table_number; those come from the `orders`
// row instead (table_number is a dead read there too — orders has no such
// column, dine-in seating lives on table_session_id — flagged not fixed).
export interface ExpoOrder {
  order_id: string;
  order_number?: string;
  order_type?: string;
  table_number?: string;
  earliest_fired_at?: string | number | null;
  station_tickets: ExpoStationTicket[];
  max_priority: number;
  all_ready?: boolean;
  any_in_progress?: boolean;
}
