// Usage example in main.go (do not edit main.go — the orchestrator wires this):
//
//	r.With(idempotency.Middleware(pool, "orders")).Post("/orders", ordersHandler)
//	r.With(idempotency.Middleware(pool, "payments")).Post("/payments", paymentsHandler)
//	r.With(idempotency.Middleware(pool, "webhook_paystack_charge")).Post("/webhooks/paystack", paystackHandler)

package idempotency

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Middleware returns a chi-compatible middleware that deduplicates POST
// requests using the Idempotency-Key header.  scope identifies the route
// family so keys from different routes cannot collide.
//
// Behaviour when the header is present:
//
//  1. Compute request_hash = sha256(method + path + body).
//  2. INSERT a new in_progress row (ON CONFLICT DO NOTHING).
//  3. Read back the row and branch:
//     a. Fresh insert              → run handler, store response, return it.
//     b. Completed (status=completed, response_status set) → replay stored response.
//     c. In-flight (in_progress, locked_at fresh)         → 409 Conflict.
//     d. Stale lock (in_progress, locked_at expired)      → take over and run handler.
//     e. Hash mismatch             → 422 Unprocessable Entity.
//
// When the header is absent the middleware is a no-op pass-through.
func Middleware(pool *pgxpool.Pool, scope string) func(http.Handler) http.Handler {
	st := &store{pool: pool}

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			key := r.Header.Get("Idempotency-Key")
			if key == "" {
				next.ServeHTTP(w, r)
				return
			}

			// Buffer the body so we can both hash it and still pass it to the handler.
			bodyBytes, err := io.ReadAll(r.Body)
			if err != nil {
				http.Error(w, "failed to read request body", http.StatusBadRequest)
				return
			}
			r.Body = io.NopCloser(bytes.NewReader(bodyBytes))

			requestHash := hashRequest(r.Method, r.URL.Path, bodyBytes)

			ctx := r.Context()

			inserted, row, err := st.acquireOrFetch(ctx, scope, key, requestHash)
			if err != nil {
				http.Error(w, "idempotency check failed", http.StatusInternalServerError)
				return
			}

			// --- hash mismatch: same key, different payload ---
			if row.RequestHash != nil && *row.RequestHash != requestHash {
				writeJSON(w, http.StatusUnprocessableEntity, map[string]string{
					"error": "Idempotency-Key reused with different payload",
				})
				return
			}

			// --- completed: replay the stored response ---
			if row.Status == "completed" && row.ResponseStatus != nil {
				replayResponse(w, *row.ResponseStatus, row.ResponseBody)
				return
			}

			// --- not a fresh insert: decide between in-flight and stale ---
			if !inserted {
				if row.Status == "in_progress" {
					// Determine if the lock is still fresh (within 30 s).
					lockFresh := row.LockedAt != nil && time.Since(*row.LockedAt) < 30*time.Second
					if lockFresh {
						// Another request is actively processing this key.
						writeJSON(w, http.StatusConflict, map[string]string{
							"error": "A request with this Idempotency-Key is already in progress",
						})
						return
					}
					// Lock has expired — previous attempt likely died. Take over.
					if err := st.takeover(ctx, scope, key, requestHash); err != nil {
						http.Error(w, "idempotency takeover failed", http.StatusInternalServerError)
						return
					}
					// Re-supply the body for the handler.
					r.Body = io.NopCloser(bytes.NewReader(bodyBytes))
				}
			}

			// --- run the inner handler and capture its response ---
			rec := &responseRecorder{
				header: w.Header(),
				buf:    &bytes.Buffer{},
				code:   http.StatusOK,
			}
			next.ServeHTTP(rec, r)

			// Store the result regardless of success/failure so replays work.
			var respBody []byte
			if rec.buf.Len() > 0 {
				respBody = rec.buf.Bytes()
			} else {
				respBody = []byte("null")
			}

			// Only mark completed for 2xx; mark failed otherwise so a later
			// attempt is not replayed with an error response.
			if rec.code >= 200 && rec.code < 300 {
				_ = st.complete(ctx, scope, key, rec.code, respBody)
			} else {
				_ = st.markFailed(ctx, scope, key)
			}

			// Write the captured response to the real client.
			w.WriteHeader(rec.code)
			_, _ = w.Write(rec.buf.Bytes())
		})
	}
}

// hashRequest returns the hex-encoded sha256 of method+path+body.
func hashRequest(method, path string, body []byte) string {
	h := sha256.New()
	_, _ = fmt.Fprintf(h, "%s\n%s\n", method, path)
	_, _ = h.Write(body)
	return fmt.Sprintf("%x", h.Sum(nil))
}

// replayResponse writes a previously captured response to the client.
func replayResponse(w http.ResponseWriter, status int, body []byte) {
	w.Header().Set("X-Idempotency-Replayed", "true")
	w.WriteHeader(status)
	if len(body) > 0 && string(body) != "null" {
		_, _ = w.Write(body)
	}
}

// writeJSON marshals v as JSON and writes it with the given status code.
func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// responseRecorder captures the handler's status code and body so the
// middleware can persist them before forwarding to the real ResponseWriter.
type responseRecorder struct {
	header http.Header
	buf    *bytes.Buffer
	code   int
}

func (r *responseRecorder) Header() http.Header         { return r.header }
func (r *responseRecorder) WriteHeader(code int)        { r.code = code }
func (r *responseRecorder) Write(b []byte) (int, error) { return r.buf.Write(b) }
