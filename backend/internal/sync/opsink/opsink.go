// Package opsink is internal/sync/emit's Sink: it mints BeepBite's operations
// through the shared DMTAP-SYNC engine and persists them to sync_ops.
//
// # Why this is a package of its own
//
// It exists to be the ONLY place where the write path and the engine meet, so
// that the engine can be absent from everything else. ROADMAP Stage 0's
// standing property is that cmd/server does not link internal/sync/substrate —
// "a BeepBite that never syncs never instantiates it" — and wiring it in costs
// 4.31 MiB of binary, roughly 90% of which is wazero's optimizing compiler.
//
// internal/sync/emit therefore speaks to an interface, in internal/oplog's
// vocabulary, and this package is what implements it. A handler holds an
// *emit.Emitter; a deployment with no sync configured holds a nil one and
// nothing in its import graph reaches here. Nothing in this package is
// constructed from cmd/server, and internal/sync/opsink/wiring_test.go asserts
// that the server's transitive imports still exclude the engine.
//
// # What it does with an operation
//
// Prepare stamps, addresses, checks and signs — and stops. Settle admits. The
// split is not a convenience: see substrate.Engine.Prepare for why a replica
// that has already admitted an operation cannot survive that operation's
// transaction rolling back.
package opsink

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/beepbite/backend/internal/oplog"
	"github.com/beepbite/backend/internal/sync/emit"
	"github.com/beepbite/backend/internal/sync/opstore"
	"github.com/beepbite/backend/internal/sync/substrate"
)

// Sink mints and persists operations. It satisfies emit.Sink.
type Sink struct {
	engine *substrate.Engine
	store  *opstore.Store

	// now supplies the wall-clock reading operations are stamped from. It is a
	// field rather than a direct call to time.Now so that a caller replaying a
	// stored log can stamp against the log's own era rather than against today.
	now func() time.Time
}

// New returns a Sink over one node's engine and one Postgres store.
func New(engine *substrate.Engine, store *opstore.Store) *Sink {
	return &Sink{engine: engine, store: store, now: time.Now}
}

// batch is what Prepare hands back for Settle to admit. It is emit.Batch's
// concrete type and is deliberately not exported: emit must not learn what a
// COSE envelope is.
type batch struct {
	recs []substrate.Record
}

// Prepare mints ops and writes them to sync_ops through tx, admitting nothing.
//
// Every operation is minted before any is written, so a batch that cannot be
// fully minted never reaches Postgres at all. The insert is one statement with
// ON CONFLICT (id) DO NOTHING on the content address, so re-preparing an
// operation this node already holds is a no-op rather than a duplicate row.
func (s *Sink) Prepare(ctx context.Context, tx pgx.Tx, orgID string, ops []oplog.Op) (emit.Batch, error) {
	if len(ops) == 0 {
		return nil, nil
	}
	if s == nil || s.engine == nil || s.store == nil {
		return nil, errors.New("opsink: sink has no engine or no store")
	}

	now := s.now()
	recs := make([]substrate.Record, 0, len(ops))
	for i, op := range ops {
		rec, err := s.engine.Prepare(op, now)
		if err != nil {
			return nil, fmt.Errorf("opsink: minting op %d (%s %s/%s): %w",
				i, kindName(op.Kind), op.Entity, op.Key, err)
		}
		recs = append(recs, rec)
	}

	if _, err := s.store.AppendTx(ctx, tx, orgID, recs); err != nil {
		return nil, err
	}
	return &batch{recs: recs}, nil
}

// Settle admits a prepared batch to this node's replica.
//
// It runs after the transaction has committed, so by the time it is called the
// operations are durable whatever happens here. A failure is still returned:
// the replica being quietly behind its own log is the state every later
// reconciliation round would be computed against, and it is fixed by replaying
// sync_ops rather than by ignoring it.
func (s *Sink) Settle(ctx context.Context, b emit.Batch) error {
	if b == nil {
		return nil
	}
	bb, ok := b.(*batch)
	if !ok {
		return fmt.Errorf("opsink: Settle was handed a %T, which this sink did not prepare", b)
	}
	now := s.now()
	for _, rec := range bb.recs {
		if _, err := s.engine.Admit(rec, now); err != nil {
			return fmt.Errorf("opsink: admitting op %s to this replica after commit "+
				"(the op IS durable in sync_ops; this replica is behind its own log "+
				"until it replays): %w", rec.ID, err)
		}
	}
	return nil
}

func kindName(k oplog.Kind) string {
	switch k {
	case oplog.KindSet:
		return "set"
	case oplog.KindAdd:
		return "add"
	default:
		return fmt.Sprintf("kind(%d)", uint8(k))
	}
}
