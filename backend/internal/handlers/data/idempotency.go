package data

// WithIdempotency returns an http.Handler that wraps the data handler's
// /data/{table} POST routes with idempotency deduplication for a fixed set of
// tables.  All other methods (GET, PATCH, DELETE) and all other tables pass
// through to the underlying ServeHTTP without any idempotency check.
//
// Usage in main.go (replace the plain dataH.Mount call):
//
//	dataH.MountWithIdempotency(r, database.Pool)
//
// The wrapped tables and their scope strings are hard-coded here to keep the
// surface small and avoid coupling main.go to the idempotency package.

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/internal/idempotency"
)

// idempotencyTables maps table name → idempotency scope string for tables
// whose POST (insert) requests must be deduplicated.
var idempotencyTables = map[string]string{
	"orders":         "orders",
	"order_payments": "order_payments",
}

// MountWithIdempotency registers the same routes as Mount but wraps the POST
// handler for idempotency-enabled tables so that retried POSTs with the same
// Idempotency-Key header return the cached response instead of re-executing.
//
// Non-POST verbs and tables not listed in idempotencyTables are unaffected.
func (h *Handler) MountWithIdempotency(r chi.Router, pool *pgxpool.Pool) {
	// Build a middleware per table, keyed by table name.
	middlewares := make(map[string]func(http.Handler) http.Handler, len(idempotencyTables))
	for table, scope := range idempotencyTables {
		middlewares[table] = idempotency.Middleware(pool, scope)
	}

	r.Route("/data/{table}", func(r chi.Router) {
		r.Get("/", h.list)
		r.Patch("/", h.update)
		r.Delete("/", h.delete)

		// POST: apply idempotency middleware when the table warrants it;
		// otherwise fall through to the plain insert handler.
		r.Post("/", func(w http.ResponseWriter, req *http.Request) {
			table := chi.URLParam(req, "table")
			mw, ok := middlewares[table]
			if !ok {
				// No idempotency for this table — run insert directly.
				h.insert(w, req)
				return
			}
			// Wrap the insert handler with the per-table middleware and serve.
			mw(http.HandlerFunc(h.insert)).ServeHTTP(w, req)
		})
	})

	r.Post("/rpc/{fn}", h.rpc)
}
