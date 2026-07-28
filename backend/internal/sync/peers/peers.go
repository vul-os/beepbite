// Package peers stores the branches this node syncs with, and the nonces they
// have spent.
//
// # Trust on first use, and never again
//
// A peer's public key is pinned when an operator pairs the two branches by
// typing the other's URL into Settings → Sync. After that the key is fixed. If
// the same peer later presents a different key, that is an error and the stored
// key is left alone — it is never re-learned.
//
// This is the entire security value of TOFU and it is easy to give away by
// accident: an Enrol that upserts, or a handler that "refreshes" a peer record
// on connect, turns a pinned key into a hint. A peer whose key changed is
// either a compromised branch or a different machine wearing its name, and
// both cases want an operator looking at them rather than a silent re-pin.
package peers

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/internal/db"
)

var (
	// ErrKeyChanged means an enrolled peer presented a different public key.
	// The stored key is unchanged. Resolving it is an operator's decision:
	// revoke the peer and pair again, having established out of band that the
	// new key is the one they meant.
	ErrKeyChanged = errors.New("peers: enrolled peer presented a different public key")

	// ErrNotFound means no active peer with that node ID exists for the org.
	// A revoked peer is not found, which is what makes revocation effective on
	// the authentication path rather than only in the operator's list.
	ErrNotFound = errors.New("peers: no such active peer")
)

// Peer is an enrolled branch.
type Peer struct {
	ID         string
	Name       string
	URL        string
	NodeID     string
	PublicKey  []byte
	Engine     string
	LastPullAt *time.Time
	LastPushAt *time.Time
	LastError  string
	CreatedAt  time.Time
}

// NewPeer is what an operator supplies at pairing.
type NewPeer struct {
	Name      string
	URL       string
	NodeID    string
	PublicKey []byte
}

// Store is the peer registry for one deployment.
type Store struct{ pool *pgxpool.Pool }

// New returns a Store over pool.
func New(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

const peerCols = `id::text, name, url, node_id, public_key, engine,
                  last_pull_at, last_push_at, coalesce(last_error, ''), created_at`

func scanPeer(row pgx.Row) (Peer, error) {
	var p Peer
	err := row.Scan(&p.ID, &p.Name, &p.URL, &p.NodeID, &p.PublicKey, &p.Engine,
		&p.LastPullAt, &p.LastPushAt, &p.LastError, &p.CreatedAt)
	return p, err
}

// Enrol pairs a branch, or confirms an existing pairing.
//
// Re-enrolling with the same key is idempotent and refreshes the name and URL,
// because those are labels an operator may legitimately correct. Re-enrolling
// with a different key returns ErrKeyChanged and writes nothing — see the
// package doc for why that is not a policy decision but the whole point.
func (s *Store) Enrol(ctx context.Context, scope db.Scope, np NewPeer) (Peer, error) {
	if np.NodeID == "" || len(np.PublicKey) == 0 {
		return Peer{}, fmt.Errorf("peers: enrol needs a node id and a public key")
	}

	var out Peer
	err := db.Scoped(ctx, s.pool, scope, func(tx pgx.Tx) error {
		// Look first, including revoked rows: a revoked peer still holds the
		// pin. Re-pairing after revocation is an explicit unrevoke, not a
		// fresh trust decision made silently by an INSERT.
		var existingKey []byte
		var revoked *time.Time
		err := tx.QueryRow(ctx,
			`SELECT public_key, revoked_at FROM sync_peers
			  WHERE organization_id = current_org_id() AND node_id = $1`,
			np.NodeID).Scan(&existingKey, &revoked)

		switch {
		case errors.Is(err, pgx.ErrNoRows):
			row := tx.QueryRow(ctx,
				`INSERT INTO sync_peers (organization_id, name, url, node_id, public_key)
				 VALUES (current_org_id(), $1, $2, $3, $4)
				 RETURNING `+peerCols,
				np.Name, np.URL, np.NodeID, np.PublicKey)
			out, err = scanPeer(row)
			return err

		case err != nil:
			return fmt.Errorf("peers: lookup: %w", err)
		}

		if !equalKeys(existingKey, np.PublicKey) {
			return ErrKeyChanged
		}

		row := tx.QueryRow(ctx,
			`UPDATE sync_peers
			    SET name = $1, url = $2, revoked_at = NULL
			  WHERE organization_id = current_org_id() AND node_id = $3
			  RETURNING `+peerCols,
			np.Name, np.URL, np.NodeID)
		out, err = scanPeer(row)
		return err
	})
	if err != nil {
		return Peer{}, err
	}
	return out, nil
}

// equalKeys compares two public keys. Not constant-time on purpose: both sides
// are public values, and the comparison's result is already reported to the
// caller as an error.
func equalKeys(a, b []byte) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// List returns the active peers for the org, oldest first.
func (s *Store) List(ctx context.Context, scope db.Scope) ([]Peer, error) {
	var out []Peer
	err := db.Scoped(ctx, s.pool, scope, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx,
			`SELECT `+peerCols+` FROM sync_peers
			  WHERE organization_id = current_org_id() AND revoked_at IS NULL
			  ORDER BY created_at`)
		if err != nil {
			return fmt.Errorf("peers: list: %w", err)
		}
		defer rows.Close()
		for rows.Next() {
			p, err := scanPeer(rows)
			if err != nil {
				return fmt.Errorf("peers: scan: %w", err)
			}
			out = append(out, p)
		}
		return rows.Err()
	})
	return out, err
}

// ByNodeID is the authentication path's lookup: it returns the pinned key for
// an active peer, and ErrNotFound for one that is revoked or absent. A revoked
// peer must fail here, not merely disappear from the operator's list.
func (s *Store) ByNodeID(ctx context.Context, scope db.Scope, nodeID string) (Peer, error) {
	var out Peer
	err := db.Scoped(ctx, s.pool, scope, func(tx pgx.Tx) error {
		row := tx.QueryRow(ctx,
			`SELECT `+peerCols+` FROM sync_peers
			  WHERE organization_id = current_org_id()
			    AND node_id = $1 AND revoked_at IS NULL`, nodeID)
		p, err := scanPeer(row)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return fmt.Errorf("peers: by node id: %w", err)
		}
		out = p
		return nil
	})
	return out, err
}

// Revoke unpairs a branch. The row survives with a timestamp so an operator can
// see that a branch was unpaired and when — a deleted row answers neither.
func (s *Store) Revoke(ctx context.Context, scope db.Scope, nodeID string) error {
	return db.Scoped(ctx, s.pool, scope, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx,
			`UPDATE sync_peers SET revoked_at = now()
			  WHERE organization_id = current_org_id()
			    AND node_id = $1 AND revoked_at IS NULL`, nodeID)
		if err != nil {
			return fmt.Errorf("peers: revoke: %w", err)
		}
		if tag.RowsAffected() == 0 {
			return ErrNotFound
		}
		return nil
	})
}

// SetEngine records the merge algebra a peer advertised at its last handshake,
// for the operator-facing status. Refusing a mismatched round is the protocol's
// job; this is only the record of what was seen.
func (s *Store) SetEngine(ctx context.Context, scope db.Scope, nodeID, engine string) error {
	return s.touch(ctx, scope, nodeID, `engine = $2`, engine)
}

// RecordPull, RecordPush and RecordError maintain the status an operator reads
// to answer "is this branch actually talking to that one?".
func (s *Store) RecordPull(ctx context.Context, scope db.Scope, nodeID string, at time.Time) error {
	return s.touch(ctx, scope, nodeID, `last_pull_at = $2, last_error = NULL`, at)
}

func (s *Store) RecordPush(ctx context.Context, scope db.Scope, nodeID string, at time.Time) error {
	return s.touch(ctx, scope, nodeID, `last_push_at = $2, last_error = NULL`, at)
}

func (s *Store) RecordError(ctx context.Context, scope db.Scope, nodeID, msg string) error {
	return s.touch(ctx, scope, nodeID, `last_error = $2`, msg)
}

func (s *Store) touch(ctx context.Context, scope db.Scope, nodeID, set string, arg any) error {
	return db.Scoped(ctx, s.pool, scope, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx,
			`UPDATE sync_peers SET `+set+`
			  WHERE organization_id = current_org_id() AND node_id = $1`, nodeID, arg)
		if err != nil {
			return fmt.Errorf("peers: update: %w", err)
		}
		if tag.RowsAffected() == 0 {
			return ErrNotFound
		}
		return nil
	})
}
