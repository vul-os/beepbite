// Package opstore is the Postgres persistence layer for the operation log
// (ROADMAP.md, "Now-5 — Multi-branch sync: HLC oplog, manual peer enrollment").
// It maps internal/sync/substrate's minted records onto the sync_ops table
// defined in migrations/004_sync_ops_content_address.sql and does nothing else:
// no transport, no peer handshake, no merge. Those are Now-5's push/pull round
// and the substrate engine respectively, both layered on top of this.
//
// # What identifies a row
//
// A row's primary key is the operation's §4.1 content address — a hash of the
// op's own canonical bytes, computed by the shared engine, identical on every
// branch that holds the operation. Nothing here mints an id, and a caller
// cannot supply one: Append takes the records substrate.Engine.Mint or
// substrate.Engine.Ingest produced, and both set it from the engine.
//
// That is what makes `ON CONFLICT (id) DO NOTHING` mean the same thing to
// Postgres and to the engine. Under migration 002 it did not: the id was a
// caller-minted uuid while the engine deduplicated on content, so one operation
// re-offered under a fresh uuid inserted a second row that the engine
// considered a duplicate — a divergence between the store and the log that
// produced no error anywhere. See that migration file for the whole argument.
//
// The COSE_Sign1 envelope is stored alongside and is the row's source of truth.
// Every other column is a projection of what the envelope carries, present so
// the pull path and the read path are index scans rather than a decode of every
// row. A caller that is about to trust a row's contents should ingest its
// envelope rather than read its columns.
//
// Every method runs its query inside db.Scoped so RLS is in force — see
// migration 004's comment on sync_ops for why append-only is enforced by policy
// rather than by convention (no UPDATE/DELETE grant to tenant roles at all).
// This package adds nothing on top of that: it has no admin bypass and no
// direct pool access outside db.Scoped.
package opstore

import (
	"context"
	"encoding/hex"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/internal/db"
	"github.com/beepbite/backend/internal/oplog"
	"github.com/beepbite/backend/internal/sync/substrate"
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

// ErrNoEnvelope is returned by Append for a record carrying no COSE_Sign1.
// sync_ops.cose is NOT NULL because an operation the engine would not sign is
// one that was never minted, not one that is merely unreplicable.
var ErrNoEnvelope = errors.New("opstore: record has no signed envelope")

// ErrBadOpID is returned when a record's id is not a 33-byte content address in
// lowercase hex. Nothing in this package computes one, so a malformed id means
// the record did not come from the engine — and storing it would put a row in
// the log under an identity no other replica would ever derive.
var ErrBadOpID = errors.New("opstore: op id is not a 33-byte content address")

// opIDLen is the §18.1.5 v0 content-address length in bytes.
const opIDLen = 33

// ---------------------------------------------------------------------------
// Kind mapping
// ---------------------------------------------------------------------------

// KindCodec translates between BeepBite's two op kinds and the numbers
// sync_ops.kind stores, which are the shared engine's §4.2 kinds.
//
// It is an interface, and the numbers are not written down in this package, for
// one specific reason: they collide. internal/oplog's KindSet is 1 and the
// substrate's set_add is also 1, while KindSet maps to lww_set which is 3. A
// hard-coded 1 anywhere in this file would be silently wrong in exactly the
// direction nothing catches — the row would store a valid kind, pass the CHECK
// constraint, and describe the opposite operation. substrate.Engine implements
// this by asking the engine which kind is which at startup.
type KindCodec interface {
	// DBKind renders an oplog.Kind as the value sync_ops.kind holds.
	DBKind(oplog.Kind) (int16, error)
	// OplogKind reads a stored value back, refusing one this product does not
	// model rather than coercing it into a valid-looking Kind.
	OplogKind(int16) (oplog.Kind, error)
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

// Store is the data-access layer for the sync_ops table.
type Store struct {
	pool  *pgxpool.Pool
	kinds KindCodec
}

// New returns a Store backed by pool, translating op kinds through kinds —
// normally the *substrate.Engine this node runs.
func New(pool *pgxpool.Pool, kinds KindCodec) *Store {
	return &Store{pool: pool, kinds: kinds}
}

// ---------------------------------------------------------------------------
// Append
// ---------------------------------------------------------------------------

// Append inserts a batch of minted records into scope's organization and
// returns how many rows were newly written.
//
// Idempotent, and now idempotent in the same sense the engine is. sync_ops.id
// is the operation's content address, so the whole batch goes in with a single
// `INSERT ... ON CONFLICT (id) DO NOTHING` and a peer re-sending a batch it
// already pushed — a retry after a dropped ack, a resumed sync round, an op
// re-derived from the same inputs — gets inserted=0 back rather than a second
// row. A caller cannot tell "never arrived" from "arrived, ack lost" apart, so
// both have to be safe to resend.
//
// The whole batch commits or none of it does. Every record is checked before
// any transaction opens — so a malformed one never reaches Postgres, and the
// CHECK constraints are a backstop for a bug in this package rather than the
// primary validator — and the insert itself is one statement, so there is no
// point at which some records from a rejected batch could have already landed.
//
// A record carries no organization identity of its own (the algebra is
// deliberately tenant-agnostic; the substrate's own scoping is the §7
// namespace, which internal/sync/substrate sets to the org id). Every row is
// therefore written with organization_id = scope.OrgID; there is no separate
// per-record value that could disagree with it.
func (s *Store) Append(ctx context.Context, scope db.Scope, recs []substrate.Record) (int, error) {
	if len(recs) == 0 {
		return 0, nil
	}
	if scope.OrgID == "" {
		return 0, ErrEmptyOrgScope
	}

	n := len(recs)
	ids := make([][]byte, n)
	orgIDs := make([]string, n)
	coses := make([][]byte, n)
	entities := make([]string, n)
	keys := make([]string, n)
	fields := make([]string, n)
	kinds := make([]int16, n)
	values := make([][]byte, n)
	tsWalls := make([]int64, n)
	tsCounters := make([]int32, n)
	tsNodes := make([]string, n)

	for i, rec := range recs {
		if err := rec.Op.Validate(); err != nil {
			return 0, fmt.Errorf("opstore: record %d (id=%q): %w", i, rec.ID, err)
		}
		id, err := decodeOpID(rec.ID)
		if err != nil {
			return 0, fmt.Errorf("opstore: record %d: %w", i, err)
		}
		if len(rec.Cose) == 0 {
			return 0, fmt.Errorf("opstore: record %d (id=%s): %w", i, rec.ID, ErrNoEnvelope)
		}
		kind, err := s.kinds.DBKind(rec.Op.Kind)
		if err != nil {
			return 0, fmt.Errorf("opstore: record %d (id=%s): %w", i, rec.ID, err)
		}

		ids[i] = id
		orgIDs[i] = scope.OrgID
		coses[i] = rec.Cose
		entities[i] = rec.Op.Entity
		keys[i] = rec.Op.Key
		fields[i] = rec.Op.Field
		kinds[i] = kind
		// value is NOT NULL DEFAULT '\x'::bytea; a nil payload must become a
		// zero-length (non-nil) slice, never a SQL NULL.
		if rec.Op.Value != nil {
			values[i] = rec.Op.Value
		} else {
			values[i] = []byte{}
		}
		tsWalls[i] = rec.Op.TS.Wall
		tsCounters[i] = int32(rec.Op.TS.Counter)
		tsNodes[i] = rec.Op.TS.Node
	}

	var inserted int
	err := db.Scoped(ctx, s.pool, scope, func(tx pgx.Tx) error {
		// Casts happen in the SELECT list, not on the unnest() arguments
		// themselves: every array parameter is sent as text/int/bytea (types
		// pgx encodes generically from Go slices without needing a
		// uuid-array-specific codec), and organization_id is cast to uuid only
		// once it is a scalar column in the SELECT. This is one round trip and
		// one statement regardless of batch size.
		tag, err := tx.Exec(ctx, `
INSERT INTO sync_ops
    (id, organization_id, cose, entity, key, field, kind, value, ts_wall, ts_counter, ts_node)
SELECT t.id, t.org::uuid, t.cose, t.entity, t.key, t.field, t.kind, t.value, t.ts_wall, t.ts_counter, t.ts_node
FROM unnest(
    $1::bytea[], $2::text[], $3::bytea[], $4::text[], $5::text[], $6::text[],
    $7::smallint[], $8::bytea[], $9::bigint[], $10::int[], $11::text[]
) AS t(id, org, cose, entity, key, field, kind, value, ts_wall, ts_counter, ts_node)
ON CONFLICT (id) DO NOTHING
`,
			ids, orgIDs, coses, entities, keys, fields,
			kinds, values, tsWalls, tsCounters, tsNodes,
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

// Since returns every record for scope's organization that vv has not seen, in
// total order (ts_wall, ts_counter, ts_node — migration 004's
// sync_ops_org_order_idx), capped at limit rows.
//
// "Not seen" is evaluated per node, matching oplog.VersionVector's own
// definition: for a node vv has an entry for, an op from that node qualifies
// iff its (ts_wall, ts_counter) is strictly greater than that entry's — the
// Node component of Timestamp.Compare's tiebreak never matters here because
// both sides share the same ts_node by construction. For a node vv has no
// entry for at all, every op from that node qualifies, because vv's implicit
// knowledge of an unlisted node is the zero Timestamp (see
// oplog.VersionVector.Missing's doc comment for the same rule stated over two
// in-memory vectors rather than a vector and a log).
//
// A caller pages through a large backlog by re-deriving its VersionVector from
// the records it has already ingested and calling Since again — not by an
// offset, which a concurrent Append during pagination would silently desync
// from the log's true order.
func (s *Store) Since(ctx context.Context, scope db.Scope, vv oplog.VersionVector, limit int) ([]substrate.Record, error) {
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

	var out []substrate.Record
	err := db.Scoped(ctx, s.pool, scope, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
WITH seen (node, wall, counter) AS (
    SELECT * FROM unnest($1::text[], $2::bigint[], $3::int[])
)
SELECT o.id, o.cose, o.entity, o.key, o.field, o.kind, o.value, o.ts_wall, o.ts_counter, o.ts_node
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
			rec, err := s.scanRecord(rows)
			if err != nil {
				return err
			}
			out = append(out, rec)
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

// VersionVector derives scope's organization's current version vector by taking
// the highest (ts_wall, ts_counter) per node — an index-ordered scan of
// sync_ops_org_node_idx (organization_id, ts_node, ts_wall DESC, ts_counter
// DESC), not a full-table aggregate.
//
// This is always computed fresh, never read from a stored column, because there
// isn't one: there is deliberately no version-vector table. A stored vector can
// drift from the log it claims to summarise — a crash between writing the
// vector and the op it describes, in either order — and the failure mode when
// it does is silent data loss on a peer's next pull.
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

// OpsFor returns every record touching (entity, key) within scope's
// organization, in total order (ts_wall, ts_counter, ts_node), backed by
// migration 004's sync_ops_entity_key_idx.
//
// A caller rebuilds that row's merged state by feeding each envelope to
// substrate.Engine.Ingest — in this order, or in any other, since the algebra
// is order-independent. Total order is what makes the result reproducible and
// debuggable, not what makes it correct.
func (s *Store) OpsFor(ctx context.Context, scope db.Scope, entity, key string) ([]substrate.Record, error) {
	var out []substrate.Record
	err := db.Scoped(ctx, s.pool, scope, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
SELECT id, cose, entity, key, field, kind, value, ts_wall, ts_counter, ts_node
FROM   sync_ops
WHERE  entity = $1 AND key = $2
ORDER BY ts_wall, ts_counter, ts_node
`, entity, key)
		if err != nil {
			return fmt.Errorf("opstore: query ops for %s/%s: %w", entity, key, err)
		}
		defer rows.Close()

		for rows.Next() {
			rec, err := s.scanRecord(rows)
			if err != nil {
				return err
			}
			out = append(out, rec)
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

// rowScanner is satisfied by both pgx.Rows and pgx.Row, so scanRecord works for
// either a multi-row Query loop or (were one ever needed) a single QueryRow.
type rowScanner interface {
	Scan(dest ...any) error
}

// scanRecord reads one sync_ops row (id, cose, entity, key, field, kind, value,
// ts_wall, ts_counter, ts_node — the column list every SELECT above uses, in
// that order) into a substrate.Record.
func (s *Store) scanRecord(row rowScanner) (substrate.Record, error) {
	var (
		id, cose, value            []byte
		entity, key, field, tsNode string
		kind                       int16
		tsWall                     int64
		tsCounter                  int32
	)
	if err := row.Scan(&id, &cose, &entity, &key, &field, &kind, &value, &tsWall, &tsCounter, &tsNode); err != nil {
		return substrate.Record{}, fmt.Errorf("opstore: scan op row: %w", err)
	}
	if len(id) != opIDLen {
		return substrate.Record{}, fmt.Errorf("opstore: stored id is %d bytes: %w", len(id), ErrBadOpID)
	}
	k, err := s.kinds.OplogKind(kind)
	if err != nil {
		return substrate.Record{}, fmt.Errorf("opstore: sync_ops row %x: %w", id, err)
	}
	return substrate.Record{
		ID:   hex.EncodeToString(id),
		Cose: cose,
		Op: oplog.Op{
			ID:     hex.EncodeToString(id),
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
		},
	}, nil
}

// decodeOpID parses a content address, refusing anything that is not exactly
// one rather than letting a short or mis-encoded value become a primary key.
func decodeOpID(s string) ([]byte, error) {
	b, err := hex.DecodeString(s)
	if err != nil {
		return nil, fmt.Errorf("%w: %q is not hex", ErrBadOpID, s)
	}
	if len(b) != opIDLen {
		return nil, fmt.Errorf("%w: %q decodes to %d bytes", ErrBadOpID, s, len(b))
	}
	return b, nil
}
