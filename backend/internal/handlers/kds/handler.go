// Package kds exposes REST + SSE endpoints for the Kitchen Display System on
// top of consolidated migration 007 (orders_and_kds) which absorbs:
//   - legacy migration-17 (kds_tickets, kds_ticket_items, kds_ticket_events,
//     kitchen_stations, item_station_routing)
//   - legacy migration-28 (kds_expo_view)
//   - legacy migration-36 (kds_fanout_queue)
//
// All DB work runs through db.Scoped so the six app.* session variables
// are set inside the transaction and RLS policies gate every row by org.
// Mount under an already-authenticated chi.Router group at /kds.
//
// Reference port (T0.A.3): this handler is the canonical example of how
// to migrate from direct pool.BeginTx calls to db.Scoped. The store methods
// that open their own transactions have been updated to accept a pgx.Tx
// (see store.go) so they can participate in the handler's Scoped transaction.
package kds

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/internal/auth"
	"github.com/beepbite/backend/internal/db"
)

// Handler wires together the store and the SSE broker.
type Handler struct {
	store  *Store
	pool   *pgxpool.Pool
	broker *broker
}

// NewHandler constructs a Handler with its own broker instance.
func NewHandler(pool *pgxpool.Pool) *Handler {
	return &Handler{
		store:  NewStore(pool),
		pool:   pool,
		broker: newBroker(),
	}
}

// scopeFromAuth reads the db.Scope that auth middleware deposited in the
// context. If no scope is found (e.g. in tests with no middleware) it returns
// a zero Scope, which results in empty session vars and zero rows visible.
func scopeFromAuth(r *http.Request) db.Scope {
	return db.ScopeFromContext(r.Context())
}

// Mount registers all KDS routes under the provided router.
// Call as: r.Route("/kds", h.Mount) or h.Mount(r.Group("/kds", ...)).
func (h *Handler) Mount(r chi.Router) {
	r.Post("/orders/{order_id}/fanout", h.fanoutOrder)
	r.Get("/orders/{order_id}/expo", h.getExpo)

	r.Post("/tickets/{ticket_id}/bump", h.bumpTicket)
	r.Post("/tickets/{ticket_id}/recall", h.recallTicket)
	r.Post("/tickets/{ticket_id}/refire", h.refireTicket)
	r.Post("/tickets/{ticket_id}/rush", h.rushTicket)
	r.Get("/tickets/{ticket_id}/details", h.getTicketDetails)

	r.Get("/stations/{station_id}/tickets", h.listStationTickets)
	r.Get("/stations/{station_id}/stream", h.streamStation)
}

// ---------------------------------------------------------------------------
// Request bodies
// ---------------------------------------------------------------------------

type staffReq struct {
	PerformedBy string `json:"performed_by"` // optional staff UUID
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

// POST /kds/orders/{order_id}/fanout
func (h *Handler) fanoutOrder(w http.ResponseWriter, r *http.Request) {
	orderID := chi.URLParam(r, "order_id")
	if orderID == "" {
		writeErr(w, http.StatusBadRequest, "order_id required")
		return
	}

	scope := auth.OrgScopeFrom(r.Context())

	var tickets []TicketWithItems
	err := db.Scoped(r.Context(), h.pool, scopeFromAuth(r), func(tx pgx.Tx) error {
		var err error
		tickets, err = h.store.FanoutOrderTx(r.Context(), tx, orderID)
		return err
	})
	switch {
	case err == ErrOrderNotFound:
		writeErr(w, http.StatusNotFound, "order not found")
		return
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	// Cross-tenant guard: verify every fanned-out station is in scope.
	// A mismatch returns 404 (not 403) to avoid existence leaks.
	for _, tw := range tickets {
		if !scope.AllowsStation(tw.StationID) {
			writeErr(w, http.StatusNotFound, "not found")
			return
		}
	}

	// Publish a 'fired' SSE event for every ticket created.
	for _, tw := range tickets {
		h.broker.publish(tw.StationID, TicketEvent{
			TicketID:  tw.ID,
			StationID: tw.StationID,
			EventType: "fired",
			CreatedAt: tw.FiredAt.Format(time.RFC3339),
		})
	}

	writeJSON(w, http.StatusCreated, tickets)
}

// POST /kds/tickets/{ticket_id}/bump
func (h *Handler) bumpTicket(w http.ResponseWriter, r *http.Request) {
	h.ticketAction(w, r, func(tx pgx.Tx, ticketID, performedBy string) (*Ticket, *TicketEventRow, error) {
		return h.store.BumpTicketTx(r.Context(), tx, ticketID, performedBy)
	})
}

// POST /kds/tickets/{ticket_id}/recall
func (h *Handler) recallTicket(w http.ResponseWriter, r *http.Request) {
	h.ticketAction(w, r, func(tx pgx.Tx, ticketID, performedBy string) (*Ticket, *TicketEventRow, error) {
		return h.store.RecallTicketTx(r.Context(), tx, ticketID, performedBy)
	})
}

// POST /kds/tickets/{ticket_id}/refire
func (h *Handler) refireTicket(w http.ResponseWriter, r *http.Request) {
	h.ticketAction(w, r, func(tx pgx.Tx, ticketID, performedBy string) (*Ticket, *TicketEventRow, error) {
		return h.store.RefireTicketTx(r.Context(), tx, ticketID, performedBy)
	})
}

// POST /kds/tickets/{ticket_id}/rush
func (h *Handler) rushTicket(w http.ResponseWriter, r *http.Request) {
	h.ticketAction(w, r, func(tx pgx.Tx, ticketID, performedBy string) (*Ticket, *TicketEventRow, error) {
		return h.store.RushTicketTx(r.Context(), tx, ticketID, performedBy)
	})
}

// ticketAction is the shared skeleton for all ticket mutation endpoints.
// It wraps the DB call in db.Scoped so that the six app.* session variables
// are set before any SQL executes and RLS gates every row by org.
func (h *Handler) ticketAction(
	w http.ResponseWriter,
	r *http.Request,
	fn func(tx pgx.Tx, ticketID, performedBy string) (*Ticket, *TicketEventRow, error),
) {
	ticketID := chi.URLParam(r, "ticket_id")
	if ticketID == "" {
		writeErr(w, http.StatusBadRequest, "ticket_id required")
		return
	}

	var req staffReq
	// Body is optional for this endpoint family; ignore decode errors.
	_ = decodeJSON(r, &req)

	scope := auth.OrgScopeFrom(r.Context())

	var t *Ticket
	var ev *TicketEventRow
	err := db.Scoped(r.Context(), h.pool, scopeFromAuth(r), func(tx pgx.Tx) error {
		var err error
		t, ev, err = fn(tx, ticketID, req.PerformedBy)
		return err
	})
	switch {
	case err == ErrTicketNotFound:
		writeErr(w, http.StatusNotFound, "ticket not found")
		return
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	// Cross-tenant guard: the ticket was loaded; verify its station is in scope.
	// Return 404 (not 403) to avoid existence leaks.
	if !scope.AllowsStation(t.StationID) {
		writeErr(w, http.StatusNotFound, "not found")
		return
	}

	// Publish to SSE subscribers for this station.
	h.broker.publish(t.StationID, TicketEvent{
		TicketID:  t.ID,
		StationID: t.StationID,
		EventType: ev.EventType,
		CreatedAt: ev.CreatedAt.Format(time.RFC3339),
	})

	writeJSON(w, http.StatusOK, map[string]any{
		"ticket": t,
		"event":  ev,
	})
}

// GET /kds/stations/{station_id}/tickets
// Accepts optional query param ?details=1 to return fully enriched ticket items
// (item name, variations, ingredients, prep steps) instead of the bare list.
func (h *Handler) listStationTickets(w http.ResponseWriter, r *http.Request) {
	stationID := chi.URLParam(r, "station_id")
	if stationID == "" {
		writeErr(w, http.StatusBadRequest, "station_id required")
		return
	}

	// Cross-tenant guard: reject foreign station_ids with 404 to avoid existence leaks.
	if !auth.OrgScopeFrom(r.Context()).AllowsStation(stationID) {
		writeErr(w, http.StatusNotFound, "not found")
		return
	}

	wantDetails := r.URL.Query().Get("details") == "1"

	var tickets []TicketWithItems
	err := db.Scoped(r.Context(), h.pool, scopeFromAuth(r), func(tx pgx.Tx) error {
		var err error
		tickets, err = h.store.ListStationTicketsTx(r.Context(), tx, stationID)
		return err
	})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if tickets == nil {
		tickets = []TicketWithItems{}
	}

	// If ?details=1, enrich each ticket with full item detail.
	if wantDetails {
		type enrichedTicket struct {
			Ticket
			Items []TicketDetailItem `json:"items"`
		}
		enriched := make([]enrichedTicket, 0, len(tickets))
		for _, tw := range tickets {
			var detail *TicketDetail
			_ = db.Scoped(r.Context(), h.pool, scopeFromAuth(r), func(tx pgx.Tx) error {
				var err error
				detail, err = h.store.GetTicketDetailTx(r.Context(), tx, tw.ID)
				return err
			})
			if detail == nil {
				// Partial failure: fall back to bare ticket.
				enriched = append(enriched, enrichedTicket{Ticket: tw.Ticket, Items: []TicketDetailItem{}})
				continue
			}
			enriched = append(enriched, enrichedTicket{Ticket: tw.Ticket, Items: detail.Items})
		}
		writeJSON(w, http.StatusOK, enriched)
		return
	}

	writeJSON(w, http.StatusOK, tickets)
}

// GET /kds/orders/{order_id}/expo
func (h *Handler) getExpo(w http.ResponseWriter, r *http.Request) {
	orderID := chi.URLParam(r, "order_id")
	if orderID == "" {
		writeErr(w, http.StatusBadRequest, "order_id required")
		return
	}

	scope := auth.OrgScopeFrom(r.Context())

	var expo *ExpoRow
	err := db.Scoped(r.Context(), h.pool, scopeFromAuth(r), func(tx pgx.Tx) error {
		var err error
		expo, err = h.store.GetExpoOrderTx(r.Context(), tx, orderID)
		return err
	})
	switch {
	case err == ErrOrderNotFound:
		writeErr(w, http.StatusNotFound, "order not found in expo view")
		return
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	// Cross-tenant guard: expo view exposes location_id; verify it is in scope.
	if !scope.AllowsLocation(expo.LocationID) {
		writeErr(w, http.StatusNotFound, "not found")
		return
	}

	writeJSON(w, http.StatusOK, expo)
}

// GET /kds/tickets/{ticket_id}/details
// Returns full ticket detail including item names, variations, ingredients, and
// prep steps. See TicketDetail for the response shape.
func (h *Handler) getTicketDetails(w http.ResponseWriter, r *http.Request) {
	ticketID := chi.URLParam(r, "ticket_id")
	if ticketID == "" {
		writeErr(w, http.StatusBadRequest, "ticket_id required")
		return
	}

	scope := auth.OrgScopeFrom(r.Context())

	// Load the ticket's station_id first (single query via Scoped) so we can
	// perform the cross-tenant scope check before returning any detail data.
	var stationID string
	var detail *TicketDetail
	err := db.Scoped(r.Context(), h.pool, scopeFromAuth(r), func(tx pgx.Tx) error {
		// Resolve station_id for the scope check.
		row := tx.QueryRow(r.Context(),
			`SELECT station_id FROM kds_tickets WHERE id = $1`, ticketID)
		if scanErr := row.Scan(&stationID); scanErr != nil {
			return ErrTicketNotFound
		}
		var err error
		detail, err = h.store.GetTicketDetailTx(r.Context(), tx, ticketID)
		return err
	})
	switch {
	case err == ErrTicketNotFound:
		writeErr(w, http.StatusNotFound, "ticket not found")
		return
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	// Cross-tenant guard: verify the resolved station is in scope.
	if !scope.AllowsStation(stationID) {
		writeErr(w, http.StatusNotFound, "not found")
		return
	}

	writeJSON(w, http.StatusOK, detail)
}

// GET /kds/stations/{station_id}/stream
// Streams Server-Sent Events for ticket lifecycle events at the given station.
// Each event is formatted as:
//
//	data: {"ticket_id":"...","station_id":"...","event_type":"...","created_at":"..."}\n\n
func (h *Handler) streamStation(w http.ResponseWriter, r *http.Request) {
	stationID := chi.URLParam(r, "station_id")
	if stationID == "" {
		writeErr(w, http.StatusBadRequest, "station_id required")
		return
	}

	// Cross-tenant guard: reject foreign station_ids with 404 to avoid existence leaks.
	if !auth.OrgScopeFrom(r.Context()).AllowsStation(stationID) {
		writeErr(w, http.StatusNotFound, "not found")
		return
	}

	flusher, ok := w.(http.Flusher)
	if !ok {
		writeErr(w, http.StatusInternalServerError, "streaming not supported")
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.WriteHeader(http.StatusOK)

	// Send a comment heartbeat immediately so the client knows the stream is up.
	fmt.Fprintf(w, ": connected to station %s\n\n", stationID)
	flusher.Flush()

	ch := h.broker.subscribe(stationID)
	defer h.broker.unsubscribe(stationID, ch)

	ctx := r.Context()
	ticker := time.NewTicker(25 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case ev, ok := <-ch:
			if !ok {
				return
			}
			b, err := json.Marshal(ev)
			if err != nil {
				continue
			}
			fmt.Fprintf(w, "data: %s\n\n", b)
			flusher.Flush()
		case <-ticker.C:
			// Keepalive comment so proxies/load-balancers don't drop idle conns.
			fmt.Fprintf(w, ": keepalive\n\n")
			flusher.Flush()
		}
	}
}
