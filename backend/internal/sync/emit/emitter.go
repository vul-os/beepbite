package emit

// emitter.go — the write-path seam: transactional emission, and the interface
// that keeps the engine off the server's import graph.
//
// # Why Sink is an interface
//
// ROADMAP Stage 0's standing property is that cmd/server does not link the
// substrate engine: "a BeepBite that never syncs never instantiates it", and
// wiring it in costs 4.31 MiB of binary. If this package imported
// internal/sync/substrate to mint an operation, every handler that called it
// would drag the engine into the server binary whether or not the deployment
// ever enrols a peer.
//
// So the minting side is an interface, spoken in internal/oplog's vocabulary,
// and internal/sync/opsink is the implementation that links the engine. A
// handler holds an *Emitter; a deployment with no sync configured holds a nil
// one, every method is a no-op, and nothing in the graph reaches the engine.

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/internal/db"
	"github.com/beepbite/backend/internal/oplog"
)

// Batch is whatever a Sink needs handed back to Settle. It is opaque here on
// purpose: this package must not learn what a COSE envelope is.
type Batch any

// Sink mints operations and persists them.
//
// The split into two calls is the whole reason this interface is not just
// "write these ops". Minting an operation also admits it to this node's
// in-memory replica, and a replica cannot un-admit an operation whose
// transaction later rolled back — so Prepare must not touch the replica, and
// Settle, which does, runs only after the commit has returned.
type Sink interface {
	// Prepare mints and persists ops through tx, without admitting them to
	// this node's replica. It must be atomic with whatever else tx is doing.
	Prepare(ctx context.Context, tx pgx.Tx, orgID string, ops []oplog.Op) (Batch, error)

	// Settle admits a prepared batch to this node's replica. It is called
	// after the transaction has committed, and only then.
	//
	// A failure here does not lose data: sync_ops is the durable log and the
	// replica is derived from it, so the operations are still there and a
	// restart replays them. It is still returned rather than swallowed,
	// because a replica that is quietly behind its own log is the state every
	// later reconciliation round would be computed against.
	Settle(ctx context.Context, b Batch) error
}

// Recorder collects the changes one transaction is making.
//
// It is handed to the function running inside the transaction rather than
// returned from it, so that recording a change is one line next to the
// statement that made it, and so a store cannot record a change for a
// transaction that has already committed.
type Recorder struct {
	changes []Change
}

// Record notes that a row-level write just happened.
//
// It never fails at the call site. A change that cannot be planned — an
// unknown table, a ledger updated in place, a branch-owned row belonging to
// somebody else — is held and returned from the surrounding Scoped call, so the
// transaction aborts as a whole rather than a caller deciding per statement
// whether an emit failure is worth rolling back for. Fail closed: the write and
// its operation live or die together.
func (r *Recorder) Record(changes ...Change) {
	if r == nil {
		return
	}
	r.changes = append(r.changes, changes...)
}

// Emitter is the write path's handle on replication.
//
// A nil *Emitter is valid and inert: Scoped runs the transaction and emits
// nothing. That is what a deployment with no sync configured holds, and it is
// what keeps the engine out of the binary — see this file's header.
type Emitter struct {
	sink Sink
	opt  Options
}

// New returns an Emitter writing to sink.
//
// branch is the location id this node writes for. It is required: a node that
// does not know which branch it is cannot author a branch-owned operation, and
// New refuses rather than constructing an Emitter that would fail later, one
// order at a time, in production.
func New(sink Sink, branch string) (*Emitter, error) {
	if sink == nil {
		return nil, errors.New("emit: New needs a Sink; a deployment with no sync holds a nil *Emitter instead")
	}
	if branch == "" {
		return nil, fmt.Errorf("emit: New needs this node's branch (location id): %w", ErrNoBranch)
	}
	return &Emitter{sink: sink, opt: Options{Branch: branch}}, nil
}

// Scoped runs fn inside a db.Scoped transaction and emits, inside that same
// transaction, the operations for whatever fn recorded — then settles them once
// the commit has returned.
//
// This is the seam the write path is meant to use. db.Scoped is already the one
// thing every store in this backend has in common; the only thing it lacks is
// any idea of what the transaction did, and Recorder is exactly that and
// nothing more. Converting a store is adding one Record call beside the
// statement it already runs.
//
// The ordering is the guarantee, and it is structural rather than documented:
//
//  1. fn runs and records.
//  2. Still inside the transaction, the recorded changes are planned, minted
//     and inserted into sync_ops. A failure here aborts the transaction, so a
//     row whose operation could not be written is not committed.
//  3. The transaction commits.
//  4. Only now are the operations admitted to this node's replica.
//
// A nil Emitter runs step 1 and step 3 and nothing else.
func (e *Emitter) Scoped(ctx context.Context, pool *pgxpool.Pool, scope db.Scope, fn func(tx pgx.Tx, rec *Recorder) error) error {
	if e == nil {
		return db.Scoped(ctx, pool, scope, func(tx pgx.Tx) error { return fn(tx, nil) })
	}

	rec := &Recorder{}
	var batch Batch
	err := db.Scoped(ctx, pool, scope, func(tx pgx.Tx) error {
		if err := fn(tx, rec); err != nil {
			return err
		}
		var perr error
		batch, perr = e.prepare(ctx, tx, scope.OrgID, rec.changes)
		return perr
	})
	if err != nil {
		return err
	}
	if batch == nil {
		return nil
	}
	return e.sink.Settle(ctx, batch)
}

func (e *Emitter) prepare(ctx context.Context, tx pgx.Tx, orgID string, changes []Change) (Batch, error) {
	if len(changes) == 0 {
		return nil, nil
	}
	ops, err := planAll(changes, e.opt)
	if err != nil {
		return nil, err
	}
	if len(ops) == 0 {
		return nil, nil
	}
	if orgID == "" {
		// Every sync_ops row is NOT NULL organization_id, and the substrate's
		// §7 namespace is the org id. A change with no org is one this node
		// cannot address into a namespace, and writing it under someone else's
		// would be worse than refusing.
		return nil, errors.New("emit: no organization in scope, so these operations have no namespace")
	}
	return e.sink.Prepare(ctx, tx, orgID, ops)
}

func planAll(changes []Change, opt Options) ([]oplog.Op, error) {
	var ops []oplog.Op
	for i, c := range changes {
		got, err := Plan(c, opt)
		if err != nil {
			return nil, fmt.Errorf("emit: change %d (%s %s): %w", i, c.Kind, c.Table, err)
		}
		ops = append(ops, got...)
	}
	return ops, nil
}
