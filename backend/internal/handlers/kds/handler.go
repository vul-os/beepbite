// Package kds exposes REST + SSE endpoints for the Kitchen Display System on
// top of migration-17 (kds_tickets, kds_ticket_items, kds_ticket_events,
// kitchen_stations, item_station_routing) and migration-28 (kds_expo_view).
// Mount under an already-authenticated chi.Router group at /kds.
package kds

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Handler wires together the store and the SSE broker.
type Handler struct {
	store  *Store
	broker *broker
}

// NewHandler constructs a Handler with its own broker instance.
func NewHandler(pool *pgxpool.Pool) *Handler {
	return &Handler{
		store:  NewStore(pool),
		broker: newBroker(),
	}
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

	tickets, err := h.store.FanoutOrder(r.Context(), orderID)
	switch {
	case err == ErrOrderNotFound:
		writeErr(w, http.StatusNotFound, "order not found")
		return
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
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
	h.ticketAction(w, r, func(ticketID, performedBy string) (*Ticket, *TicketEventRow, error) {
		return h.store.BumpTicket(r.Context(), ticketID, performedBy)
	})
}

// POST /kds/tickets/{ticket_id}/recall
func (h *Handler) recallTicket(w http.ResponseWriter, r *http.Request) {
	h.ticketAction(w, r, func(ticketID, performedBy string) (*Ticket, *TicketEventRow, error) {
		return h.store.RecallTicket(r.Context(), ticketID, performedBy)
	})
}

// POST /kds/tickets/{ticket_id}/refire
func (h *Handler) refireTicket(w http.ResponseWriter, r *http.Request) {
	h.ticketAction(w, r, func(ticketID, performedBy string) (*Ticket, *TicketEventRow, error) {
		return h.store.RefireTicket(r.Context(), ticketID, performedBy)
	})
}

// POST /kds/tickets/{ticket_id}/rush
func (h *Handler) rushTicket(w http.ResponseWriter, r *http.Request) {
	h.ticketAction(w, r, func(ticketID, performedBy string) (*Ticket, *TicketEventRow, error) {
		return h.store.RushTicket(r.Context(), ticketID, performedBy)
	})
}

// ticketAction is the shared skeleton for all ticket mutation endpoints.
func (h *Handler) ticketAction(
	w http.ResponseWriter,
	r *http.Request,
	fn func(ticketID, performedBy string) (*Ticket, *TicketEventRow, error),
) {
	ticketID := chi.URLParam(r, "ticket_id")
	if ticketID == "" {
		writeErr(w, http.StatusBadRequest, "ticket_id required")
		return
	}

	var req staffReq
	// Body is optional for this endpoint family; ignore decode errors.
	_ = decodeJSON(r, &req)

	t, ev, err := fn(ticketID, req.PerformedBy)
	switch {
	case err == ErrTicketNotFound:
		writeErr(w, http.StatusNotFound, "ticket not found")
		return
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
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

	tickets, err := h.store.ListStationTickets(r.Context(), stationID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if tickets == nil {
		tickets = []TicketWithItems{}
	}

	// If ?details=1, enrich each ticket with full item detail.
	if r.URL.Query().Get("details") == "1" {
		type enrichedTicket struct {
			Ticket
			Items []TicketDetailItem `json:"items"`
		}
		enriched := make([]enrichedTicket, 0, len(tickets))
		for _, tw := range tickets {
			detail, err := h.store.GetTicketDetail(r.Context(), tw.ID)
			if err != nil {
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

	expo, err := h.store.GetExpoOrder(r.Context(), orderID)
	switch {
	case err == ErrOrderNotFound:
		writeErr(w, http.StatusNotFound, "order not found in expo view")
		return
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
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

	detail, err := h.store.GetTicketDetail(r.Context(), ticketID)
	switch {
	case err == ErrTicketNotFound:
		writeErr(w, http.StatusNotFound, "ticket not found")
		return
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
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
