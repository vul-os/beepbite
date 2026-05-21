package obs

import (
	"crypto/rand"
	"encoding/hex"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/beepbite/backend/internal/auth"
)

// responseWriter wraps http.ResponseWriter to capture the status code written
// by downstream handlers.
type responseWriter struct {
	http.ResponseWriter
	status int
}

func (rw *responseWriter) WriteHeader(code int) {
	rw.status = code
	rw.ResponseWriter.WriteHeader(code)
}

// Write implements http.ResponseWriter — ensure status defaults to 200 when
// WriteHeader is never called explicitly.
func (rw *responseWriter) Write(b []byte) (int, error) {
	if rw.status == 0 {
		rw.status = http.StatusOK
	}
	return rw.ResponseWriter.Write(b)
}

// Unwrap lets chi middleware (e.g. middleware.Recoverer) reach the underlying
// ResponseWriter without losing our wrapper.
func (rw *responseWriter) Unwrap() http.ResponseWriter { return rw.ResponseWriter }

// ---------------------------------------------------------------------------
// Request-ID helpers
// ---------------------------------------------------------------------------

const requestIDHeader = "X-Request-Id"

// generateRequestID returns a 16-byte random hex string suitable for use as a
// correlation ID. Falls back to a timestamp string on rand failure.
func generateRequestID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return time.Now().Format("20060102150405.000000")
	}
	return hex.EncodeToString(b)
}

// requestID returns the existing X-Request-Id from the incoming request, or
// generates a fresh one. It also writes the final value back to the response
// header so the client can correlate.
func requestID(r *http.Request, w http.ResponseWriter) string {
	id := r.Header.Get(requestIDHeader)
	if id == "" {
		id = generateRequestID()
	}
	w.Header().Set(requestIDHeader, id)
	return id
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

// Middleware returns a chi-compatible middleware that:
//  1. Generates or propagates X-Request-Id.
//  2. Reads tenant_id and actor_id from the auth context if present (non-blocking).
//  3. Stores request_id/tenant_id/actor_id in context via obs.WithRequestAttrs.
//  4. Logs one structured line per request (method, route, status, duration_ms …).
//  5. Records metrics in reg.
//
// Usage:
//
//	logger := obs.NewLogger()
//	reg    := obs.NewRegistry()
//	r.Use(obs.Middleware(logger, reg))
//	r.Mount("/metrics", reg.Handler())
func Middleware(logger *slog.Logger, reg *Registry) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()

			// 1. Request ID — propagate or generate.
			reqID := requestID(r, w)

			// 2. Pull tenant / actor from auth context if already injected.
			//    These are empty strings for unauthenticated routes — that is fine.
			var tenantID, actorID string
			if scope := auth.OrgScopeFrom(r.Context()); scope.UserID != "" {
				// UserID is the authenticated member. For tenant_id we use the
				// first membership's OrgID if available.
				if len(scope.Memberships) > 0 {
					tenantID = scope.Memberships[0].OrgID
				}
				actorID = auth.ActorIDFromContext(r.Context())
				// actorID may be "" if no actor overlay is active; fall back to
				// the member's own UserID so the field is always populated when
				// the user is authenticated.
				if actorID == "" {
					actorID = scope.UserID
				}
			}

			// 3. Inject request-scoped attrs into context.
			ctx := WithRequestAttrs(r.Context(), reqID, tenantID, actorID)
			r = r.WithContext(ctx)

			// Wrap the response writer to capture the status code.
			wrapped := &responseWriter{ResponseWriter: w, status: 0}

			// 4. Delegate to the next handler.
			next.ServeHTTP(wrapped, r)

			// Ensure we have a sensible status even if the handler never called
			// WriteHeader (implicit 200).
			status := wrapped.status
			if status == 0 {
				status = http.StatusOK
			}

			// 5. Compute duration and resolve the chi route pattern.
			duration := time.Since(start)
			durationMs := float64(duration.Nanoseconds()) / 1e6

			// chi.RouteContext gives us the matched pattern ("/data/{table}",
			// etc.) rather than the concrete URL, which is what we want for
			// grouping metrics and log lines.
			routePattern := r.URL.Path
			if rctx := chi.RouteContext(r.Context()); rctx != nil {
				if p := rctx.RoutePattern(); p != "" {
					routePattern = p
				}
			}

			// Log the structured request line.
			logger.LogAttrs(r.Context(), slog.LevelInfo, "request",
				slog.String("method", r.Method),
				slog.String("route", routePattern),
				slog.Int("status", status),
				slog.Float64("duration_ms", durationMs),
				slog.String("request_id", reqID),
				slog.String("tenant_id", tenantID),
				slog.String("actor_id", actorID),
			)

			// Record metrics.
			reg.record(routePattern, r.Method, status, durationMs)
		})
	}
}
