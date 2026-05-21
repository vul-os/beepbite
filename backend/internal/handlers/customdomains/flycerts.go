// Package customdomains — Fly.io Certificates integration interface.
//
// FlyCerts abstracts the real Fly API behind a simple interface so the handler
// can work with a no-op stub during development and be wired to the live
// implementation via dependency injection in main.go.
package customdomains

import (
	"context"
	"log"
)

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

// FlyCerts is the interface for issuing TLS certificates via Fly.io.
// The real implementation calls the Fly Machines / Certificates API.
// The stub (StubFlyCerts) is used when the FLYCERTS_ENABLED env var is unset.
type FlyCerts interface {
	// AddCert requests certificate issuance for hostname. It is called after
	// DNS ownership is verified. The call is idempotent — calling it twice
	// for the same hostname is safe.
	AddCert(ctx context.Context, hostname string) error

	// RemoveCert cancels the certificate for hostname. Called when a domain
	// is removed/soft-deleted.
	RemoveCert(ctx context.Context, hostname string) error
}

// ---------------------------------------------------------------------------
// Stub implementation (no-op, logs only)
// ---------------------------------------------------------------------------

// StubFlyCerts is a no-op FlyCerts implementation that logs calls.
// Use it in development and tests; replace with a real Fly API client in
// production by satisfying the FlyCerts interface.
type StubFlyCerts struct{}

// AddCert logs the request and returns nil.
func (s *StubFlyCerts) AddCert(_ context.Context, hostname string) error {
	log.Printf("[customdomains/flycerts] stub: AddCert hostname=%q (no-op)", hostname)
	return nil
}

// RemoveCert logs the request and returns nil.
func (s *StubFlyCerts) RemoveCert(_ context.Context, hostname string) error {
	log.Printf("[customdomains/flycerts] stub: RemoveCert hostname=%q (no-op)", hostname)
	return nil
}
