package peers

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/internal/db"
)

// NonceStore is the durable replay cache, satisfying protocol.ReplayCache.
//
// It writes to sync_nonces, which is deliberately not organisation-scoped:
// replay checking happens while a request is being authenticated, before any
// organisation context has been established. A tenant-scoped policy there would
// make the check unable to see its own rows and would therefore never detect a
// replay — a failure that looks exactly like everything working.
//
// It runs as the service role for the same reason.
type NonceStore struct{ pool *pgxpool.Pool }

// NewNonceStore returns a replay cache over pool.
func NewNonceStore(pool *pgxpool.Pool) *NonceStore { return &NonceStore{pool: pool} }

func serviceScope() db.Scope { return db.Scope{IsServiceRole: true} }

// Seen reports whether this peer has already spent this nonce.
//
// Callers should prefer Remember, which answers the same question atomically —
// see the note there. Seen exists to satisfy the ReplayCache interface and for
// read-only inspection.
func (n *NonceStore) Seen(ctx context.Context, peerNode, nonce string) (bool, error) {
	var exists bool
	err := db.Scoped(ctx, n.pool, serviceScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx,
			`SELECT EXISTS (SELECT 1 FROM sync_nonces WHERE peer_node = $1 AND nonce = $2)`,
			peerNode, nonce).Scan(&exists)
	})
	if err != nil {
		return false, fmt.Errorf("peers: nonce lookup: %w", err)
	}
	return exists, nil
}

// Remember records a nonce as spent, and is the check as well as the record.
//
// "Has this nonce been seen? If not, remember it" as two statements is a
// time-of-check-to-time-of-use race: two concurrent requests bearing the same
// captured nonce can both read "not seen" before either writes. One
// INSERT ... ON CONFLICT DO NOTHING makes the database the arbiter — exactly
// one of them inserts a row, and the other learns it lost by being told zero
// rows were affected.
//
// It returns ErrReplayed-equivalent information through inserted=false; the
// protocol layer's Authenticate calls Seen then Remember for interface
// compatibility, and callers wanting the atomic form should use this directly.
func (n *NonceStore) Remember(ctx context.Context, peerNode, nonce string, at time.Time) error {
	_, err := n.RememberOnce(ctx, peerNode, nonce, at)
	return err
}

// RememberOnce is Remember with the answer: inserted is false when this peer
// had already spent this nonce.
func (n *NonceStore) RememberOnce(ctx context.Context, peerNode, nonce string, at time.Time) (bool, error) {
	var inserted bool
	err := db.Scoped(ctx, n.pool, serviceScope(), func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx,
			`INSERT INTO sync_nonces (peer_node, nonce, seen_at) VALUES ($1, $2, $3)
			 ON CONFLICT (peer_node, nonce) DO NOTHING`,
			peerNode, nonce, at)
		if err != nil {
			return err
		}
		inserted = tag.RowsAffected() == 1
		return nil
	})
	if err != nil {
		return false, fmt.Errorf("peers: nonce insert: %w", err)
	}
	return inserted, nil
}

// Sweep deletes nonces older than the cutoff and reports how many went.
//
// A nonce only has to be remembered for as long as an envelope bearing it could
// still pass the freshness check; past that it is dead weight, and without a
// sweep the table is an unbounded disk-fill on a slow timer.
func (n *NonceStore) Sweep(ctx context.Context, olderThan time.Time) (int64, error) {
	var deleted int64
	err := db.Scoped(ctx, n.pool, serviceScope(), func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `DELETE FROM sync_nonces WHERE seen_at < $1`, olderThan)
		if err != nil {
			return err
		}
		deleted = tag.RowsAffected()
		return nil
	})
	if err != nil {
		return 0, fmt.Errorf("peers: nonce sweep: %w", err)
	}
	return deleted, nil
}
