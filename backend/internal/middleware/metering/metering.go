// Package metering provides chi-compatible HTTP middleware that wires the
// internal/metering and internal/quota packages into the request lifecycle.
//
// # Two variants
//
//   - Meter(pool, resource, opts...) — post-success debit. Passes the request
//     through to the inner handler unchanged; after a 2xx response it calls
//     metering.Meter.Record to increment quota_usage and debit the wallet. On
//     non-2xx nothing is recorded, so failed requests never cost the org.
//
//   - Guard(pool, resource, opts...) — pre-check + post-success debit. Before
//     calling the inner handler it reads the current usage via quota.Checker.Check
//     and, when the org is on a hard-cap (free) tier and has already exhausted its
//     allowance, it short-circuits with HTTP 402 Payment Required. On a successful
//     (2xx) inner response it then records usage exactly as Meter does.
//
// # Idempotency
//
// The metering.Meter.Record call uses ON CONFLICT DO NOTHING on the
// wallet_transactions table, keyed by IdempotencyKey. The middleware derives
// this key (in order of preference) from:
//  1. The Idempotency-Key request header.
//  2. The X-Request-Id request header.
//  3. A deterministic sha256 of method + path + org-id + resource + minute
//     (1-minute window; coarse but safe — overage billing is approximate).
//
// This matches the idempotency contract already established by the
// internal/idempotency middleware so the two can coexist on the same route.
//
// # Org scope
//
// Both variants read the OrgScope injected by auth.RequireOrgScope.  When no
// scope is present (unit tests, public endpoints) the middleware skips metering
// entirely rather than panicking.
//
// # Wiring example (see main.go snippet in the project docs)
//
//	import mw "github.com/beepbite/backend/internal/middleware/metering"
//
//	// Post-success debit only:
//	r.With(mw.Meter(pool, metering.ResourceOrders)).Post("/orders", ordersHandler)
//
//	// Pre-check (hard-cap enforcement) + post-success debit:
//	r.With(mw.Guard(pool, metering.ResourceOrders)).Post("/orders", ordersHandler)
package metering

import (
	"bytes"
	"crypto/sha256"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/internal/auth"
	intmetering "github.com/beepbite/backend/internal/metering"
	"github.com/beepbite/backend/internal/quota"
)

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

// Option is a functional option for Meter and Guard.
type Option func(*config)

type config struct {
	// units is the number of resource units consumed per request (default 1).
	units int64
	// costCents is the per-unit wallet debit in smallest currency unit.
	// Zero means no wallet debit — only quota_usage is updated.
	costCents int64
	// refType is the polymorphic reference type (e.g. "order").
	// When empty the wallet transaction row has a NULL reference_type.
	refType string
	// locationHeaderName is the request header (or chi URL param) that carries
	// the location UUID. When present it is forwarded to Record as LocationID.
	// Defaults to "X-Location-Id".
	locationHeaderName string
}

func defaultConfig() config {
	return config{
		units:              1,
		locationHeaderName: "X-Location-Id",
	}
}

// WithUnits sets the number of resource units consumed per successful request
// (default 1). Use a value > 1 for batch endpoints (e.g. bulk_imports).
func WithUnits(n int64) Option {
	return func(c *config) { c.units = n }
}

// WithCostCents sets the wallet debit in the smallest currency unit (e.g. ZAR
// cents) for each successful metered request. When set to 0 (the default),
// only quota_usage.used_count is incremented and no wallet debit is performed.
func WithCostCents(cents int64) Option {
	return func(c *config) { c.costCents = cents }
}

// WithRefType sets the reference_type column on the wallet_transactions row.
// Typical values: "order", "chat_message", "email", "import".
func WithRefType(rt string) Option {
	return func(c *config) { c.refType = rt }
}

// WithLocationHeader overrides the header name used to read the location UUID
// from the incoming request. The default is "X-Location-Id".
func WithLocationHeader(name string) Option {
	return func(c *config) { c.locationHeaderName = name }
}

// ---------------------------------------------------------------------------
// Meter — post-success debit only
// ---------------------------------------------------------------------------

// Meter returns a chi-compatible middleware that records metered consumption
// AFTER the inner handler returns a 2xx response. Non-2xx responses are never
// charged. It is a thin adapter over metering.Meter.Record.
//
// The org and location are read from the auth.OrgScope injected by
// auth.RequireOrgScope. When no scope is present the middleware is a no-op.
func Meter(pool *pgxpool.Pool, resource string, opts ...Option) func(http.Handler) http.Handler {
	cfg := defaultConfig()
	for _, o := range opts {
		o(&cfg)
	}
	m := intmetering.New(pool)

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Capture inner handler response so we can inspect the status code.
			rec := newResponseRecorder(w)
			next.ServeHTTP(rec, r)
			rec.flush()

			// Only meter successful responses.
			if rec.code < 200 || rec.code >= 300 {
				return
			}

			// Resolve org scope — skip silently if not present.
			scope := auth.OrgScopeFrom(r.Context())
			orgID := primaryOrgID(scope)
			if orgID == "" {
				return
			}
			locationID := r.Header.Get(cfg.locationHeaderName)

			idem := idempotencyKey(r, orgID, resource)

			if err := m.Record(r.Context(), intmetering.RecordInput{
				OrgID:          orgID,
				LocationID:     locationID,
				Resource:       resource,
				Units:          cfg.units,
				CostCents:      cfg.costCents,
				RefType:        cfg.refType,
				IdempotencyKey: idem,
			}); err != nil {
				// Log but do not fail the request — the handler already returned 2xx.
				log.Printf("metering middleware: record %s for org %s: %v", resource, orgID, err)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// Guard — pre-check (hard-cap) + post-success debit
// ---------------------------------------------------------------------------

// Guard returns a chi-compatible middleware that:
//
//  1. Reads the current billing-period usage for the org via quota.Checker.Check.
//  2. When the org is over its included_count (i.e. hard-capped / free tier),
//     returns HTTP 402 Payment Required before the inner handler runs.
//  3. On a successful (2xx) inner response, records usage via metering.Meter.Record
//     exactly as Meter does.
//
// Guard never rejects a request when quota.ErrNoUsageRow is returned (no row →
// treat as allowed, to avoid blocking brand-new orgs that haven't been
// provisioned yet). Callers that want stricter enforcement should pre-populate
// quota_usage rows via quota.Checker.SetIncluded in their provisioning flow.
func Guard(pool *pgxpool.Pool, resource string, opts ...Option) func(http.Handler) http.Handler {
	cfg := defaultConfig()
	for _, o := range opts {
		o(&cfg)
	}
	m := intmetering.New(pool)
	q := quota.New(pool)

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Resolve org scope.
			scope := auth.OrgScopeFrom(r.Context())
			orgID := primaryOrgID(scope)
			locationID := r.Header.Get(cfg.locationHeaderName)

			// --- Pre-check: enforce hard cap ---
			if orgID != "" {
				allowed, used, included, err := q.Check(r.Context(), orgID, locationID, resource)
				switch {
				case err == quota.ErrNoUsageRow:
					// No row yet → allow through (brand-new org / unprovisioned resource).
				case err != nil:
					log.Printf("metering guard: quota check for org %s resource %s: %v", orgID, resource, err)
					// Fail open: do not block the request on a transient DB error.
				case !allowed:
					// Over the included quota. Reject before the handler runs.
					w.Header().Set("Content-Type", "application/json")
					w.WriteHeader(http.StatusPaymentRequired)
					_, _ = fmt.Fprintf(w,
						`{"error":"quota_exceeded","resource":%q,"used":%d,"included":%d}`,
						resource, used, included,
					)
					return
				}
			}

			// --- Run inner handler ---
			rec := newResponseRecorder(w)
			next.ServeHTTP(rec, r)
			rec.flush()

			// --- Post-success debit ---
			if rec.code < 200 || rec.code >= 300 {
				return
			}
			if orgID == "" {
				return
			}

			idem := idempotencyKey(r, orgID, resource)

			if err := m.Record(r.Context(), intmetering.RecordInput{
				OrgID:          orgID,
				LocationID:     locationID,
				Resource:       resource,
				Units:          cfg.units,
				CostCents:      cfg.costCents,
				RefType:        cfg.refType,
				IdempotencyKey: idem,
			}); err != nil {
				log.Printf("metering guard: record %s for org %s: %v", resource, orgID, err)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// primaryOrgID returns the first org ID from an OrgScope.  Returns "" when
// the scope carries no memberships (anonymous or fresh-signup path).
func primaryOrgID(scope auth.OrgScope) string {
	if len(scope.Memberships) > 0 {
		return scope.Memberships[0].OrgID
	}
	return ""
}

// idempotencyKey derives a stable per-request idempotency key used as the
// wallet_transactions.idempotency_key. Priority:
//  1. Idempotency-Key header (set by the client for mutation endpoints).
//  2. X-Request-Id header (set by the load balancer or chi middleware).
//  3. Deterministic fallback: sha256(method + path + orgID + resource + minute).
//     The 1-minute window makes this coarse but safe — metering is approximate
//     for burst traffic. The window prevents double-billing on HTTP retries.
func idempotencyKey(r *http.Request, orgID, resource string) string {
	if k := r.Header.Get("Idempotency-Key"); k != "" {
		return "meter:" + resource + ":" + k
	}
	if k := r.Header.Get("X-Request-Id"); k != "" {
		return "meter:" + resource + ":" + k
	}
	// Fallback: deterministic key scoped to a 1-minute bucket.
	minute := time.Now().UTC().Truncate(time.Minute).Format(time.RFC3339)
	h := sha256.New()
	_, _ = fmt.Fprintf(h, "%s\n%s\n%s\n%s\n%s", r.Method, r.URL.Path, orgID, resource, minute)
	return fmt.Sprintf("meter:%s:fallback:%x", resource, h.Sum(nil))
}

// ---------------------------------------------------------------------------
// responseRecorder — captures status code without buffering body
// ---------------------------------------------------------------------------

// responseRecorder wraps the real ResponseWriter to capture the status code
// written by the inner handler. Unlike the idempotency middleware, metering
// does not need to buffer or replay the body — it only needs to inspect 2xx vs
// non-2xx. The body bytes are forwarded to the underlying writer immediately.
type responseRecorder struct {
	w    http.ResponseWriter
	code int
	buf  *bytes.Buffer
	// headerWritten tracks whether WriteHeader has been called so we emit it
	// exactly once via flush().
	headerWritten bool
}

func newResponseRecorder(w http.ResponseWriter) *responseRecorder {
	return &responseRecorder{w: w, code: http.StatusOK, buf: &bytes.Buffer{}}
}

func (r *responseRecorder) Header() http.Header {
	return r.w.Header()
}

func (r *responseRecorder) WriteHeader(code int) {
	if !r.headerWritten {
		r.code = code
		r.headerWritten = true
	}
}

func (r *responseRecorder) Write(b []byte) (int, error) {
	// Buffer the body; we cannot write to the underlying writer before calling
	// WriteHeader (the status code must be inspected first).
	return r.buf.Write(b)
}

// flush writes the captured status code and body to the real ResponseWriter.
// Must be called after the inner handler returns.
func (r *responseRecorder) flush() {
	r.w.WriteHeader(r.code)
	_, _ = r.w.Write(r.buf.Bytes())
}
