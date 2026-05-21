package legal

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/internal/db"
)

// Sentinel errors for HTTP status mapping.
var (
	ErrDocumentNotFound = errors.New("legal document not found")
	ErrAlreadyAccepted  = errors.New("document version already accepted")
)

// Document mirrors a legal_documents row returned to callers.
type Document struct {
	ID          string    `json:"id"`
	Kind        string    `json:"kind"`
	Version     string    `json:"version"`
	BodyMD      string    `json:"body_md"`
	EffectiveAt time.Time `json:"effective_at"`
}

// Acceptance mirrors a legal_acceptances row returned to callers.
type Acceptance struct {
	ID         string    `json:"id"`
	ProfileID  string    `json:"profile_id"`
	DocumentID string    `json:"document_id"`
	AcceptedAt time.Time `json:"accepted_at"`
}

// Store wraps pgxpool for all legal-related queries.
type Store struct {
	pool *pgxpool.Pool
}

// NewStore constructs a Store backed by pool.
func NewStore(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

// GetCurrentDocument returns the latest effective legal document for the given
// kind ("terms" or "privacy"). Runs under MarketplaceScope so no auth is
// required — legal documents are public by RLS policy (USING true).
func (s *Store) GetCurrentDocument(ctx context.Context, kind string) (*Document, error) {
	var doc Document
	// Documents are publicly readable (RLS USING true), so we use MarketplaceScope
	// which is the canonical "no-auth public read" scope for this codebase.
	err := db.Scoped(ctx, s.pool, db.MarketplaceScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
SELECT id, kind, version, body_md, effective_at
FROM legal_documents
WHERE kind = $1
  AND effective_at <= now()
ORDER BY effective_at DESC
LIMIT 1
`, kind).Scan(&doc.ID, &doc.Kind, &doc.Version, &doc.BodyMD, &doc.EffectiveAt)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrDocumentNotFound
	}
	if err != nil {
		return nil, err
	}
	return &doc, nil
}

// RecordAcceptance inserts a legal_acceptances row for the given profile and
// document. Runs under the caller's db.Scope (profile-scoped) so RLS INSERT
// policy (profile_id = current_user_id()) is satisfied.
//
// Returns ErrAlreadyAccepted when the (profile_id, document_id) unique index
// is violated — the caller can treat this as a no-op success if desired.
func (s *Store) RecordAcceptance(
	ctx context.Context,
	scope db.Scope,
	profileID string,
	documentID string,
	ip string,
) (*Acceptance, error) {
	var acc Acceptance
	err := db.Scoped(ctx, s.pool, scope, func(tx pgx.Tx) error {
		var ipArg any
		if ip != "" {
			ipArg = ip
		}
		return tx.QueryRow(ctx, `
INSERT INTO legal_acceptances (profile_id, document_id, ip)
VALUES ($1, $2, $3)
ON CONFLICT (profile_id, document_id) DO NOTHING
RETURNING id, profile_id, document_id, accepted_at
`, profileID, documentID, ipArg).Scan(
			&acc.ID, &acc.ProfileID, &acc.DocumentID, &acc.AcceptedAt,
		)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		// ON CONFLICT DO NOTHING fired — already accepted.
		return nil, ErrAlreadyAccepted
	}
	if err != nil {
		return nil, err
	}
	return &acc, nil
}
