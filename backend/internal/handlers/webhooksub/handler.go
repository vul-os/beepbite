// Package webhooksub exposes tenant webhook-endpoint management REST routes
// (Wave 22). Mount under an already-authenticated + org-scoped chi.Router:
//
//	h := webhooksub.NewHandler(pool)
//	h.Mount(r) // registers /webhook-endpoints and sub-routes
//
// All write endpoints (POST/PUT/DELETE) require the caller to hold the role
// 'owner' or 'manager' in the OrgScope resolved by auth.RequireOrgScope.
// Reads (GET list, GET deliveries) are open to any authenticated org member.
//
// Signing-secret format: "whsec_" + 32 random bytes as hex (64 hex chars),
// giving 192 bits of entropy. The secret is stored in plain text and returned
// on every GET so tenants can re-copy it. Callers must enforce TLS.
package webhooksub

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/internal/auth"
	"github.com/beepbite/backend/internal/db"
)

// knownEvents is the authoritative set of event types a tenant may subscribe
// to. Attempts to register unknown event types are rejected with 400.
var knownEvents = map[string]struct{}{
	"order.created":  {},
	"order.paid":     {},
	"order.refunded": {},
	"item.created":   {},
	"item.updated":   {},
	"staff.invited":  {},
}

// Handler wires HTTP routes to the Store.
type Handler struct {
	store *Store
}

// NewHandler constructs a Handler backed by pool.
func NewHandler(pool *pgxpool.Pool) *Handler {
	return &Handler{store: NewStore(pool)}
}

// Mount registers webhook-endpoint routes on r.
//
// Routes:
//
//	POST   /webhook-endpoints                    — register a new endpoint
//	GET    /webhook-endpoints                    — list org's endpoints
//	PUT    /webhook-endpoints/{id}               — update url/events/active/description
//	DELETE /webhook-endpoints/{id}               — remove an endpoint
//	GET    /webhook-endpoints/{id}/deliveries    — recent delivery attempts
func (h *Handler) Mount(r chi.Router) {
	r.Route("/webhook-endpoints", func(r chi.Router) {
		r.Post("/", h.createEndpoint)
		r.Get("/", h.listEndpoints)
		r.Put("/{id}", h.updateEndpoint)
		r.Delete("/{id}", h.deleteEndpoint)
		r.Get("/{id}/deliveries", h.listDeliveries)
	})
}

// ---- request / response types ------------------------------------------------

type createEndpointReq struct {
	URL         string   `json:"url"`
	Events      []string `json:"events"`
	Description *string  `json:"description"`
}

type updateEndpointReq struct {
	URL         string   `json:"url"`
	Events      []string `json:"events"`
	Active      bool     `json:"active"`
	Description *string  `json:"description"`
}

// ---- handlers ----------------------------------------------------------------

// POST /webhook-endpoints
//
// Body: {"url":"https://…","events":["order.created"],"description":"…"}
// Requires: owner or manager role.
// Returns 201 + the created endpoint, including the signing_secret.
func (h *Handler) createEndpoint(w http.ResponseWriter, r *http.Request) {
	if !callerIsOwnerOrManager(r) {
		writeErr(w, http.StatusForbidden, "requires owner or manager role")
		return
	}

	var req createEndpointReq
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}

	if err := validateURL(req.URL); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := validateEvents(req.Events); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}

	scope := db.ScopeFromContext(r.Context())
	if scope.OrgID == "" {
		writeErr(w, http.StatusBadRequest, "no org scope resolved")
		return
	}

	secret, err := generateSigningSecret()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "failed to generate signing secret")
		return
	}

	ep, err := h.store.CreateEndpoint(r.Context(), scope.OrgID, req.URL, secret, req.Events, req.Description)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, ep)
}

// GET /webhook-endpoints
//
// Returns all webhook endpoints for the caller's org, including signing_secret
// so tenants can re-copy it. Access is open to any authenticated org member.
func (h *Handler) listEndpoints(w http.ResponseWriter, r *http.Request) {
	scope := db.ScopeFromContext(r.Context())
	if scope.OrgID == "" {
		writeErr(w, http.StatusBadRequest, "no org scope resolved")
		return
	}

	eps, err := h.store.ListEndpoints(r.Context(), scope.OrgID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, eps)
}

// PUT /webhook-endpoints/{id}
//
// Body: {"url":"https://…","events":["order.paid"],"active":true,"description":"…"}
// Requires: owner or manager role.
// Returns 200 + updated endpoint.
func (h *Handler) updateEndpoint(w http.ResponseWriter, r *http.Request) {
	if !callerIsOwnerOrManager(r) {
		writeErr(w, http.StatusForbidden, "requires owner or manager role")
		return
	}

	endpointID := chi.URLParam(r, "id")
	if endpointID == "" {
		writeErr(w, http.StatusBadRequest, "id required")
		return
	}

	var req updateEndpointReq
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}

	if err := validateURL(req.URL); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := validateEvents(req.Events); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}

	scope := db.ScopeFromContext(r.Context())
	if scope.OrgID == "" {
		writeErr(w, http.StatusBadRequest, "no org scope resolved")
		return
	}

	ep, err := h.store.UpdateEndpoint(r.Context(), scope.OrgID, endpointID, UpdateEndpointParams{
		URL:         req.URL,
		Events:      req.Events,
		Active:      req.Active,
		Description: req.Description,
	})
	switch {
	case errors.Is(err, ErrEndpointNotFound):
		writeErr(w, http.StatusNotFound, "webhook endpoint not found")
		return
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, ep)
}

// DELETE /webhook-endpoints/{id}
//
// Requires: owner or manager role.
// Returns 204 on success.
func (h *Handler) deleteEndpoint(w http.ResponseWriter, r *http.Request) {
	if !callerIsOwnerOrManager(r) {
		writeErr(w, http.StatusForbidden, "requires owner or manager role")
		return
	}

	endpointID := chi.URLParam(r, "id")
	if endpointID == "" {
		writeErr(w, http.StatusBadRequest, "id required")
		return
	}

	scope := db.ScopeFromContext(r.Context())
	if scope.OrgID == "" {
		writeErr(w, http.StatusBadRequest, "no org scope resolved")
		return
	}

	err := h.store.DeleteEndpoint(r.Context(), scope.OrgID, endpointID)
	switch {
	case errors.Is(err, ErrEndpointNotFound):
		writeErr(w, http.StatusNotFound, "webhook endpoint not found")
		return
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// GET /webhook-endpoints/{id}/deliveries?limit=50
//
// Returns recent delivery attempts for the given endpoint (debugging).
// Access is open to any authenticated org member.
// Query param: limit (default 50, max 100).
func (h *Handler) listDeliveries(w http.ResponseWriter, r *http.Request) {
	endpointID := chi.URLParam(r, "id")
	if endpointID == "" {
		writeErr(w, http.StatusBadRequest, "id required")
		return
	}

	scope := db.ScopeFromContext(r.Context())
	if scope.OrgID == "" {
		writeErr(w, http.StatusBadRequest, "no org scope resolved")
		return
	}

	limit := 50
	if raw := r.URL.Query().Get("limit"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n <= 0 {
			writeErr(w, http.StatusBadRequest, "limit must be a positive integer")
			return
		}
		limit = n
	}

	deliveries, err := h.store.ListDeliveries(r.Context(), scope.OrgID, endpointID, limit)
	switch {
	case errors.Is(err, ErrEndpointNotFound):
		writeErr(w, http.StatusNotFound, "webhook endpoint not found")
		return
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, deliveries)
}

// ---- authorization helpers ---------------------------------------------------

// callerIsOwnerOrManager returns true when the OrgScope in context contains at
// least one membership with role 'owner' or 'manager'.
func callerIsOwnerOrManager(r *http.Request) bool {
	scope := auth.OrgScopeFrom(r.Context())
	for _, m := range scope.Memberships {
		if m.Role == "owner" || m.Role == "manager" {
			return true
		}
	}
	return false
}

// ---- validation helpers ------------------------------------------------------

// validateURL rejects empty or non-https URLs.
func validateURL(raw string) error {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return errors.New("url is required")
	}
	u, err := url.ParseRequestURI(raw)
	if err != nil {
		return fmt.Errorf("url is invalid: %w", err)
	}
	if u.Scheme != "https" {
		return errors.New("url must use https")
	}
	if u.Host == "" {
		return errors.New("url must include a host")
	}
	return nil
}

// validateEvents checks that the list is non-empty and every item is a known
// event type.
func validateEvents(events []string) error {
	if len(events) == 0 {
		return errors.New("events must contain at least one event type")
	}
	for _, e := range events {
		if _, ok := knownEvents[e]; !ok {
			return fmt.Errorf("unknown event type %q; valid types: order.created, order.paid, order.refunded, item.created, item.updated, staff.invited", e)
		}
	}
	return nil
}

// generateSigningSecret returns a "whsec_<64 hex chars>" secret derived from
// 32 cryptographically random bytes (192 bits of entropy after the prefix).
func generateSigningSecret() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return "whsec_" + hex.EncodeToString(b), nil
}

// ---- tiny HTTP helpers -------------------------------------------------------

func decodeJSON(r *http.Request, v any) error {
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	return dec.Decode(v)
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}
