// Package obs provides structured logging, per-request middleware, and a
// lightweight in-memory metrics registry for the beepbite HTTP server.
//
// All dependencies are Go standard library only (log/slog, sync, net/http,
// crypto/rand, fmt, time, math, sort, strings, io).
package obs

import (
	"context"
	"log/slog"
	"os"
)

// ctxLogKey is the unexported context key used to carry per-request slog
// attributes (request_id, tenant_id, actor_id).
type ctxLogKey struct{}

// logAttrs is the value stored in context: a slice of slog.Attr appended by
// WithRequestAttrs.
type logAttrs []slog.Attr

// NewLogger returns a JSON slog.Logger writing to os.Stdout at Info level.
// Use this as the application-wide logger; the obs middleware derives
// per-request loggers from it via WithRequestAttrs.
func NewLogger() *slog.Logger {
	h := slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	})
	return slog.New(h)
}

// WithRequestAttrs stores request_id, tenant_id, and actor_id in the context
// so that FromContext can reconstruct a logger with those fields pre-attached.
//
// Callers (including the obs middleware) use this to propagate request-scoped
// fields without threading a *slog.Logger through every function signature.
func WithRequestAttrs(ctx context.Context, requestID, tenantID, actorID string) context.Context {
	attrs := logAttrs{
		slog.String("request_id", requestID),
		slog.String("tenant_id", tenantID),
		slog.String("actor_id", actorID),
	}
	return context.WithValue(ctx, ctxLogKey{}, attrs)
}

// FromContext returns a *slog.Logger derived from base with any per-request
// attrs stored in ctx pre-attached. If no attrs are present ctx is returned
// unchanged and base is returned as-is.
func FromContext(ctx context.Context, base *slog.Logger) *slog.Logger {
	attrs, ok := ctx.Value(ctxLogKey{}).(logAttrs)
	if !ok || len(attrs) == 0 {
		return base
	}
	args := make([]any, len(attrs))
	for i, a := range attrs {
		args[i] = a
	}
	return base.With(args...)
}
