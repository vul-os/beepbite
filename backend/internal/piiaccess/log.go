// Package piiaccess provides a helper for logging PII (personally-identifiable
// information) access events. Call Log from any handler that reads or exports
// sensitive customer fields such as email, phone, or address.
package piiaccess

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// ActorType enumerates the kinds of principals that may access PII.
type ActorType string

const (
	ActorMember  ActorType = "member"
	ActorStaff   ActorType = "staff"
	ActorSystem  ActorType = "system"
	ActorWebhook ActorType = "webhook"
)

// AccessKind enumerates the operations that may be logged.
type AccessKind string

const (
	KindView   AccessKind = "view"
	KindExport AccessKind = "export"
	KindUpdate AccessKind = "update"
	KindSearch AccessKind = "search"
)

// Entry holds all information needed to write a pii_access_log row.
type Entry struct {
	// ActorType is required; use one of the Actor* constants.
	ActorType ActorType
	// ActorID is the UUID of the actor (member, staff, etc.). May be nil for
	// system or webhook actors.
	ActorID *string
	// CustomerID is the UUID of the customer whose PII was accessed. May be nil
	// when the access is not tied to a single customer (e.g. a bulk search).
	CustomerID *string
	// Kind is the type of access; use one of the Kind* constants.
	Kind AccessKind
	// Fields lists the column names that were accessed, e.g. ["email","phone"].
	Fields []string
	// Reason is an optional human-readable description of why the data was
	// accessed (e.g. "support ticket #1234").
	Reason *string
	// RequestID is the inbound HTTP request identifier, if available.
	RequestID *string
	// IPAddress is the client IP in text form (IPv4 or IPv6). May be empty.
	IPAddress *string
	// UserAgent is the raw User-Agent header value. May be empty.
	UserAgent *string
}

// Log inserts a single row into pii_access_log. It is safe to call from any
// goroutine. Errors are returned to the caller; the caller should log and
// handle them but should NOT abort the primary request on a logging failure.
func Log(ctx context.Context, db *pgxpool.Pool, e Entry) error {
	_, err := db.Exec(ctx, `
INSERT INTO pii_access_log
    (actor_type, actor_id, customer_id, access_kind, fields_accessed,
     reason, request_id, ip_address, user_agent)
VALUES
    ($1, $2, $3, $4, $5,
     $6, $7, $8::inet, $9)
`,
		string(e.ActorType),
		e.ActorID,
		e.CustomerID,
		string(e.Kind),
		e.Fields,
		e.Reason,
		e.RequestID,
		e.IPAddress,
		e.UserAgent,
	)
	if err != nil {
		return fmt.Errorf("piiaccess: log: %w", err)
	}
	return nil
}
