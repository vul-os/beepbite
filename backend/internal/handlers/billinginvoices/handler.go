// Package billinginvoices exposes subscription_invoices as a read-only REST
// resource scoped to the authenticated organisation.
//
// Mount path (wire in main.go):
//
//	h := billinginvoices.NewHandler(pool)
//	r.Route("/billing", func(r chi.Router) {
//	    h.Mount(r)
//	})
//
// Or equivalently:
//
//	h.Mount(r) // where r is already rooted at /billing
//
// The handler expects auth.RequireOrgScope (or equivalent) middleware to have
// run upstream so that auth.OrgScopeFrom(ctx) and db.ScopeFromContext(ctx)
// are populated.
package billinginvoices

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Handler is the HTTP surface for billing invoice reads.
type Handler struct {
	store *Store
}

// NewHandler constructs a Handler backed by the given connection pool.
func NewHandler(pool *pgxpool.Pool) *Handler {
	return &Handler{store: NewStore(pool)}
}

// Mount registers the billing invoice routes onto r.
// Expects r to be rooted at /billing (or any prefix the caller chooses).
//
// Registered routes:
//
//	GET /invoices  — list the caller's org's subscription invoices
func (h *Handler) Mount(r chi.Router) {
	r.Get("/invoices", h.listInvoices)
}

// listInvoices handles GET /billing/invoices.
//
// Returns the caller's org's subscription_invoices, newest first, with both
// USD and local-currency amounts plus the FX rate snapshot.
//
// Response body: JSON array of Invoice objects (empty array when no invoices exist).
//
// HTTP status codes:
//
//	200 OK        — success (possibly empty list)
//	500 Internal  — DB error
func (h *Handler) listInvoices(w http.ResponseWriter, r *http.Request) {
	invoices, err := h.store.ListInvoices(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	// Return an explicit empty array rather than JSON null for an org with no
	// invoices yet, so clients don't need a null guard.
	if invoices == nil {
		invoices = []Invoice{}
	}

	writeJSON(w, http.StatusOK, invoices)
}

// ---------------------------------------------------------------------------
// JSON helpers (local to the package — mirrors cashdrawer/io.go pattern)
// ---------------------------------------------------------------------------

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}
