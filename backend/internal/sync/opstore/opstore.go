// Package opstore is the Postgres persistence layer for internal/oplog's
// operation log (ROADMAP.md, "Now-5 — Multi-branch sync: HLC oplog, manual
// peer enrollment"). It maps oplog.Op directly onto the sync_ops table
// defined in migrations/002_sync.sql and does nothing else: no transport, no
// peer handshake, no signature verification. Those are Now-5's push/pull
// round, which is layered on top of this.
//
// Every method runs its query inside db.Scoped so RLS is in force — see that
// migration's comment on sync_ops for why append-only is enforced by policy
// rather than by convention (no UPDATE/DELETE grant to tenant roles at all).
// This package adds nothing on top of that: it has no admin bypass and no
// direct pool access outside db.Scoped.
package opstore

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/internal/db"
	"github.com/beepbite/backend/internal/oplog"
)

// ---------------------------------------------------------------------------
// Sentinel errors
// ---------------------------------------------------------------------------

// ErrEmptyOrgScope is returned by Append when scope.OrgID is empty. Every
// sync_ops row has a NOT NULL organization_id; catching this in Go gives a
// comprehensible error instead of a Postgres uuid-cast failure on an empty
// string, or — worse — a batch that silently writes with the wrong
// organization_id because a caller forgot to populate the scope.
var ErrEmptyOrgScope = errors.New("opstore: scope has no organization id")

// ErrSigsLengthMismatch is returned by Append when sigs is non-empty but its
// length does not match ops. sigs may be omitted entirely (nil or
// zero-length) for callers that have not wired up signing yet — see
// migration 002's comment on sync_ops.signature being nullable for exactly
// that reason — but a partial slice is always a caller bug, not a case
// worth guessing at.
var ErrSigsLengthMismatch = errors.New("opstore: sigs must be empty or the same length as ops")

// ---------------------------------------------------------------------------
// Kind mapping
// ---------------------------------------------------------------------------
//
// sync_ops.kind stores oplog.Kind's own values (KindSet=1, KindAdd=2) rather
// than renumbering them, so these conversions are range checks and not a
// mapping. An earlier draft of the schema numbered them from zero, which meant
// a translation table here that nothing prevented a later caller from
// bypassing with a bare cast — the schema moved to match the Go constants
// instead, which removes the class of bug rather than documenting it.

// toDBKind range-checks an oplog.Kind on the way to the database.
func toDBKind(k oplog.Kind) (int16, error) {
	switch k {
	case oplog.KindSet, oplog.KindAdd:
		return int16(k), nil
	default:
		return 0, oplog.ErrUnknownKind
	}
}

// fromDBKind range-checks a stored value on the way back. An unrecognised one
// means the row did not come from this package, or the CHECK constraint has
// drifted from these constants — either way it is worth surfacing loudly
// rather than coercing into a valid-looking Kind.
func fromDBKind(k int16) (oplog.Kind, error) {
	switch oplog.Kind(k) {
	case oplog.KindSet, oplog.KindAdd:
		return oplog.Kind(k), nil
	default:
		return 0, fmt.Errorf("opstore: sync_ops row has unrecognised kind %d", k)
	}
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

// Store is the data-access layer for the sync_ops table.
type Store struct {
	pool *pgxpool.Pool
}

// New returns a Store backed by pool.
func New(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

// ---------------------------------------------------------------------------
// Append
// ---------------------------------------------------------------------------

// Append inserts a batch of ops — with parallel Ed25519 signatures over each
// op's Canonical() encoding, or a nil/empty sigs when signing is not wired up
// yet — into scope's organization.
//
// Idempotent: sync_ops.id is the primary key, so the whole batch is inserted
// with a single `INSERT ... ON CONFLICT (id) DO NOTHING`, and the returned
// count is exactly how many rows were newly written. A peer re-sending a
// batch it already pushed (a retry after a dropped ack, a resumed sync round)
// gets inserted=0 back, never an error — this is the storage half of the
// same idempotence internal/oplog's Apply implements in memory, and it has
// to hold for the same reason: a caller cannot tell "never arrived" from
// "arrived, ack lost" apart, so both must be safe to resend.
//
// The whole batch commits or none of it does. Every op is checked against
// oplog.Op.Validate() before any transaction opens — so a malformed op never
// reaches Postgres, and the sync_ops_set_has_field / sync_ops_add_has_no_field
// CHECK constraints are a backstop for a bug in this package, not the
// primary validator — and the insert itself is one statement, so there is no
// point at which some ops from a rejected batch could have already landed.
//
// oplog.Op carries no organization identity of its own (the in-memory
// algebra is deliberately storage- and tenant-agnostic — see oplog's package
// doc). Every row in the batch is therefore written with organization_id =
// scope.OrgID; there is no separate per-op value that could disagree with
// it, so "an op belongs to a different org than the scope" cannot arise once
// scope.OrgID is non-empty, which is exactly what is checked below.
func (s *Store) Append(ctx context.Context, scope db.Scope, ops []oplog.Op, sigs [][]byte) (int, error) {
	if len(ops) == 0 {
		return 0, nil
	}
	if scope.OrgID == "" {
		return 0, ErrEmptyOrgScope
	}
	if len(sigs) != 0 && len(sigs) != len(ops) {
		return 0, ErrSigsLengthMismatch
	}

	n := len(ops)
	ids := make([]string, n)
	orgIDs := make([]string, n)
	entities := make([]string, n)
	keys := make([]string, n)
	fields := make([]string, n)
	kinds := make([]int16, n)
	values := make([][]byte, n)
	tsWalls := make([]int64, n)
	tsCounters := make([]int32, n)
	tsNodes := make([]string, n)
	signatures := make([][]byte, n)

	for i, op := range ops {
		if err := op.Validate(); err != nil {
			return 0, fmt.Errorf("opstore: op %d (id=%q): %w", i, op.ID, err)
		}
		kind, err := toDBKind(op.Kind)
		if err != nil {
			// op.Validate() above already rejects any Kind other than
			// KindSet/KindAdd, so this branch is unreachable in practice.
			// Kept because toDBKind returning an error at all should never
			// be silently ignored.
			return 0, fmt.Errorf("opstore: op %d (id=%q): %w", i, op.ID, err)
		}

		ids[i] = op.ID
		orgIDs[i] = scope.OrgID
		entities[i] = op.Entity
		keys[i] = op.Key
		fields[i] = op.Field
		kinds[i] = kind
		// value is NOT NULL DEFAULT '\x'::bytea; a nil Op.Value must become
		// a zero-length (non-nil) slice, never a SQL NULL.
		if op.Value != nil {
			values[i] = op.Value
		} else {
			values[i] = []byte{}
		}
		tsWalls[i] = op.TS.Wall
		tsCounters[i] = int32(op.TS.Counter)
		tsNodes[i] = op.TS.Node
		if i < len(sigs) {
			signatures[i] = sigs[i]
		}
	}

	var inserted int
	err := db.Scoped(ctx, s.pool, scope, func(tx pgx.Tx) error {
		// Casts happen in the SELECT list, not on the unnest() arguments
		// themselves: every array parameter is sent as text/int/bytea (types
		// pgx encodes generically from Go slices without needing a
		// uuid-array-specific codec), and id/organization_id are cast to
		// uuid only once they are scalar columns in the SELECT. This is one
		// round trip and one statement regardless of batch size.
		tag, err := tx.Exec(ctx, `
INSERT INTO sync_ops
    (id, organization_id, entity, key, field, kind, value, ts_wall, ts_counter, ts_node, signature)
SELECT t.id::uuid, t.org::uuid, t.entity, t.key, t.field, t.kind, t.value, t.ts_wall, t.ts_counter, t.ts_node, t.signature
FROM unnest(
    $1::text[], $2::text[], $3::text[], $4::text[], $5::text[],
    $6::smallint[], $7::bytea[], $8::bigint[], $9::int[], $10::text[], $11::bytea[]
) AS t(id, org, entity, key, field, kind, value, ts_wall, ts_counter, ts_node, signature)
ON CONFLICT (id) DO NOTHING
`,
			ids, orgIDs, entities, keys, fields,
			kinds, values, tsWalls, tsCounters, tsNodes, signatures,
		)
		if err != nil {
			return fmt.Errorf("opstore: insert batch: %w", err)
		}
		// RowsAffected() on an INSERT ... ON CONFLICT DO NOTHING counts only
		// the rows actually written — conflicting rows are not affected —
		// which is exactly "how many were new" with no extra query needed.
		inserted = int(tag.RowsAffected())
		return nil
	})
	if err != nil {
		return 0, err
	}
	return inserted, nil
}

// ---------------------------------------------------------------------------
// Since
// ---------------------------------------------------------------------------

// Since returns every op for scope's organization that vv has not seen, in
// total order (ts_wall, ts_counter, ts_node — migration 002's
// sync_ops_org_order_idx), capped at limit rows.
//
// "Not seen" is evaluated per node, matching oplog.VersionVector's own
// definition: for a node vv has an entry for, an op from that node qualifies
// iff its (ts_wall, ts_counter) is strictly greater than that entry's — the
// Node component of Timestamp.Compare's tiebreak never matters here because
// both sides share the same ts_node by construction. For a node vv has no
// entry for at all, every op from that node qualifies, because vv's implicit
// knowledge of an unlisted node is the zero Timestamp (see
// oplog.VersionVector.Missing's doc comment for the same rule stated over
// two in-memory vectors rather than a vector and a log).
//
// A caller pages through a large backlog by re-deriving its VersionVector
// from the ops it has already applied (oplog.VersionVector.Observe over each)
// and calling Since again — not by an offset, which a concurrent Append
// during pagination would silently desync from the log's true order.
func (s *Store) Since(ctx context.Context, scope db.Scope, vv oplog.VersionVector, limit int) ([]oplog.Op, error) {
	if limit <= 0 {
		return nil, nil
	}

	nodes := make([]string, 0, len(vv))
	walls := make([]int64, 0, len(vv))
	counters := make([]int32, 0, len(vv))
	for node, ts := range vv {
		nodes = append(nodes, node)
		walls = append(walls, ts.Wall)
		counters = append(counters, int32(ts.Counter))
	}

	var out []oplog.Op
	err := db.Scoped(ctx, s.pool, scope, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
WITH seen (node, wall, counter) AS (
    SELECT * FROM unnest($1::text[], $2::bigint[], $3::int[])
)
SELECT o.id, o.entity, o.key, o.field, o.kind, o.value, o.ts_wall, o.ts_counter, o.ts_node
FROM   sync_ops o
LEFT JOIN seen s ON s.node = o.ts_node
WHERE  s.node IS NULL
   OR  o.ts_wall > s.wall
   OR (o.ts_wall = s.wall AND o.ts_counter > s.counter)
ORDER BY o.ts_wall, o.ts_counter, o.ts_node
LIMIT $4
`, nodes, walls, counters, limit)
		if err != nil {
			return fmt.Errorf("opstore: query since: %w", err)
		}
		defer rows.Close()

		for rows.Next() {
			op, err := scanOp(rows)
			if err != nil {
				return err
			}
			out = append(out, op)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// ---------------------------------------------------------------------------
// VersionVector
// ---------------------------------------------------------------------------

// VersionVector derives scope's organization's current version vector by
// taking the highest (ts_wall, ts_counter) per node — an index-ordered
// scan of sync_ops_org_node_idx (organization_id, ts_node, ts_wall DESC,
// ts_counter DESC), not a full-table aggregate.
//
// This is always computed fresh, never read from a stored column, because
// there isn't one: migration 002 deliberately has no version-vector table.
// See that migration's package-level comment for why — a stored vector can
// drift from the log it claims to summarise, and the failure mode when it
// does is silent data loss on a peer's next pull.
func (s *Store) VersionVector(ctx context.Context, scope db.Scope) (oplog.VersionVector, error) {
	vv := oplog.NewVersionVector()
	err := db.Scoped(ctx, s.pool, scope, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
SELECT DISTINCT ON (ts_node) ts_node, ts_wall, ts_counter
FROM   sync_ops
ORDER  BY ts_node, ts_wall DESC, ts_counter DESC
`)
		if err != nil {
			return fmt.Errorf("opstore: query version vector: %w", err)
		}
		defer rows.Close()

		for rows.Next() {
			var node string
			var wall int64
			var counter int32
			if err := rows.Scan(&node, &wall, &counter); err != nil {
				return fmt.Errorf("opstore: scan version vector row: %w", err)
			}
			vv[node] = oplog.Timestamp{Wall: wall, Counter: uint32(counter), Node: node}
		}
		return rows.Err()
	})
	if err != nil {
		return nil, err
	}
	return vv, nil
}

// ---------------------------------------------------------------------------
// OpsFor
// ---------------------------------------------------------------------------

// OpsFor returns every op touching (entity, key) within scope's organization,
// in total order (ts_wall, ts_counter, ts_node), backed by migration 002's
// sync_ops_entity_key_idx. A caller rebuilds that row's merged state by
// replaying the result through a fresh oplog.State's Apply, in order — or,
// since Apply is order-independent for a fixed set of ops (see merge.go), in
// any order at all; total order is what makes the result reproducible and
// debuggable, not what makes it correct.
func (s *Store) OpsFor(ctx context.Context, scope db.Scope, entity, key string) ([]oplog.Op, error) {
	var out []oplog.Op
	err := db.Scoped(ctx, s.pool, scope, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
SELECT id, entity, key, field, kind, value, ts_wall, ts_counter, ts_node
FROM   sync_ops
WHERE  entity = $1 AND key = $2
ORDER BY ts_wall, ts_counter, ts_node
`, entity, key)
		if err != nil {
			return fmt.Errorf("opstore: query ops for %s/%s: %w", entity, key, err)
		}
		defer rows.Close()

		for rows.Next() {
			op, err := scanOp(rows)
			if err != nil {
				return err
			}
			out = append(out, op)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// ---------------------------------------------------------------------------
// Row scanning
// ---------------------------------------------------------------------------

// rowScanner is satisfied by both pgx.Rows and pgx.Row, so scanOp works for
// either a multi-row Query loop or (were one ever needed) a single QueryRow.
type rowScanner interface {
	Scan(dest ...any) error
}

// scanOp reads one sync_ops row (id, entity, key, field, kind, value,
// ts_wall, ts_counter, ts_node — the column list every SELECT above uses, in
// that order) into an oplog.Op.
func scanOp(row rowScanner) (oplog.Op, error) {
	var (
		id, entity, key, field, tsNode string
		kind                           int16
		value                          []byte
		tsWall                         int64
		tsCounter                      int32
	)
	if err := row.Scan(&id, &entity, &key, &field, &kind, &value, &tsWall, &tsCounter, &tsNode); err != nil {
		return oplog.Op{}, fmt.Errorf("opstore: scan op row: %w", err)
	}
	k, err := fromDBKind(kind)
	if err != nil {
		return oplog.Op{}, err
	}
	return oplog.Op{
		ID:     id,
		Kind:   k,
		Entity: entity,
		Key:    key,
		Field:  field,
		Value:  value,
		TS: oplog.Timestamp{
			Wall:    tsWall,
			Counter: uint32(tsCounter),
			Node:    tsNode,
		},
	}, nil
}
