// Package emit turns a row BeepBite is about to write into the operations that
// carry it to another branch.
//
// It is the missing half of Now-5. internal/sync/substrate runs the merge
// engine, internal/sync/opstore persists its operations under RLS, and
// internal/sync/protocol carries them on the wire — but until this package
// existed no table write produced an operation at all, so the log had nothing
// in it and two instances could not sync no matter how correct the machinery
// below them was.
//
// # Where this sits on the write path
//
// There is no single chokepoint in this backend, and pretending otherwise would
// be the wrong answer to build against. Writes reach Postgres two ways:
//
//   - internal/handlers/data, the generic REST layer the frontend uses. One
//     insert, one update and one delete function between them cover about a
//     hundred tables. This IS a chokepoint, and it is where this package is
//     wired.
//   - ~343 hand-written INSERT/UPDATE/DELETE statements across 78 files in
//     internal/handlers/*, internal/jobs/* and elsewhere. There is no seam
//     above them; db.Scoped is the only thing they share and it takes an
//     opaque func(pgx.Tx), so it sees no table name and no row.
//
// Emitter.Scoped is the seam offered to the second group: it is db.Scoped with
// a recorder passed alongside the transaction, so a store adds one Record call
// beside the statement it already runs and gets transactional emission for
// free. Converting those call sites is deliberately NOT part of the change that
// introduced this package — the ownership decision per table is the hard part
// and is in internal/sync/ownership, and converting call sites is mechanical
// work that should follow a settled model rather than race it.
//
// # Why emission has to be inside the caller's transaction
//
// An operation that exists without its row, or a row that exists without its
// operation, is worse than no replication at all: the log stops describing the
// database and nothing errors. So Emit takes the pgx.Tx the write itself is
// running in and inserts into sync_ops through it. Either both land or neither
// does.
//
// That leaves one ordering problem, and Settle is the answer to it. Minting an
// operation also ADMITS it to this node's in-memory replica, and a replica
// cannot un-admit an operation whose transaction later rolled back. So Emit
// prepares and persists without touching the replica, and Settle — called after
// the commit has returned — is what admits it. If the process dies between the
// two, nothing is lost: sync_ops is the durable log and the replica is rebuilt
// from it.
//
// # What this package deliberately does not do
//
// It does not push, pull, or apply. A peer's operations arriving and being
// written back into BeepBite's tables is the other direction and is a separate
// piece of work with its own failure modes. An emit layer with no transport is
// honest and useful — the log now has content, and the ownership model it
// encodes is testable — whereas a transport on top of an unsettled ownership
// model would look like it worked.
package emit

import (
	"errors"
	"fmt"
	"sort"

	"github.com/beepbite/backend/internal/oplog"
	"github.com/beepbite/backend/internal/sync/ownership"
)

// Kind is the shape of a row-level write.
type Kind uint8

const (
	// Insert is a row that did not exist before.
	Insert Kind = iota + 1
	// Update is an in-place write to an existing row.
	Update
	// Delete is a row's removal. It emits a last-writer-wins write to the
	// reserved tombstone field rather than a §4.5 death certificate — see
	// ownership.DeletedField.
	Delete
)

// String renders a Kind for diagnostics.
func (k Kind) String() string {
	switch k {
	case Insert:
		return "insert"
	case Update:
		return "update"
	case Delete:
		return "delete"
	default:
		return fmt.Sprintf("Kind(%d)", uint8(k))
	}
}

// Change is one row-level write, described in terms the ownership registry can
// act on.
type Change struct {
	// Table is the Postgres table name. It must be in the ownership registry;
	// a table nobody has classified is refused rather than skipped.
	Table string

	// Kind is what happened to the row.
	Kind Kind

	// Row holds the columns this write is asserting, AFTER the write. For an
	// insert that is normally the whole returned row; for an update it should
	// be the columns the update actually touched, because a register write
	// this node did not make is a claim it should not be publishing. It must
	// always contain the table's key column (and, for a ledger, its grouping
	// column) — those are the address, not the payload.
	//
	// For a delete, Row need only carry the key.
	Row map[string]any
}

// Options configures how changes become operations.
type Options struct {
	// Branch is the location id this node writes for — the branch it IS.
	//
	// It is what makes Now-5's single-writer claim enforceable rather than
	// aspirational. A branch-owned row belongs to exactly one branch, so an
	// operation on one authored anywhere else is a bug and not a conflict, and
	// Plan refuses to mint it instead of leaving last-writer-wins to arbitrate
	// between two writers who should never both have existed.
	//
	// Empty means this node has not been told which branch it is, and then no
	// branch-owned operation can be authored at all. That is the fail-closed
	// direction: emitting them anyway would publish rows under an ownership
	// claim nobody has made.
	Branch string
}

var (
	// ErrUnknownTable is returned for a table the ownership registry has never
	// heard of. It is a refusal and not a skip: "not in the registry" and "not
	// replicated" are different statements, and only one of them is a decision
	// somebody made. internal/sync/ownership's schema test fails closed on any
	// table in the schema without an entry, so reaching this at runtime means
	// code is naming a table the database does not have.
	ErrUnknownTable = errors.New("emit: table is not in the ownership registry")

	// ErrNoBranch is returned when a branch-owned row is written by a node
	// that has not been told which branch it is.
	ErrNoBranch = errors.New("emit: this node has no branch identity, so it may not author a branch-owned operation")

	// ErrWrongBranch is returned when a branch-owned row belonging to another
	// branch is written here. See Options.Branch.
	ErrWrongBranch = errors.New("emit: this node is not the branch that owns this row")

	// ErrLedgerMutated is returned for an update or delete of an append-only
	// table. It is the loudest refusal in this package on purpose: a ledger
	// that is edited in place is not a ledger, and the SUM(qty) read path that
	// every quantity in this product depends on silently stops being correct
	// the moment one is.
	ErrLedgerMutated = errors.New("emit: an append-only ledger row was modified in place")

	// errNilKey is returned when a row cannot be addressed.
	errNilKey = errors.New("emit: row has no key value, so there is no address to write it at")
)

// Plan turns one change into the operations it produces, minting nothing.
//
// The returned ops carry no ID and no timestamp: both belong to the engine (an
// op's identity is the content address of its canonical bytes, and its stamp
// comes from the substrate's own §3 clock), and a caller that invented either
// would put a row in the log under an identity no other replica would compute.
//
// A change to a Local table returns no ops and no error. That is the one case
// where "nothing to do" is the right answer, and it is reachable only for a
// table somebody classified as Local with a reason.
func Plan(c Change, opt Options) ([]oplog.Op, error) {
	tbl, ok := ownership.Lookup(c.Table)
	if !ok {
		return nil, fmt.Errorf("%w: %q", ErrUnknownTable, c.Table)
	}
	if !tbl.Class.Replicated() {
		return nil, nil
	}
	switch c.Kind {
	case Insert, Update, Delete:
	default:
		return nil, fmt.Errorf("emit: %s: unknown change kind %s", c.Table, c.Kind)
	}
	if c.Row == nil {
		return nil, fmt.Errorf("emit: %s: change carries no row", c.Table)
	}

	if tbl.Class == ownership.Branch {
		if err := checkBranch(tbl, c, opt); err != nil {
			return nil, err
		}
	}

	if tbl.Class == ownership.Ledger {
		return planLedger(tbl, c)
	}
	return planRegisters(tbl, c)
}

// checkBranch enforces the single-writer claim where the row makes it
// checkable.
//
// Where the owning column is not on the row — an order_item knows its order,
// not its location — there is nothing to check here and the guard reaches the
// row only through its parent, or not at all. That limit is real and is stated
// rather than hidden behind a check that always passes: ownership.Table.Owner
// is empty for exactly those tables, and internal/sync/ownership's tests assert
// that at least one branch table names one, so the guard cannot quietly become
// inert everywhere.
func checkBranch(tbl ownership.Table, c Change, opt Options) error {
	if opt.Branch == "" {
		return fmt.Errorf("%w: %s", ErrNoBranch, c.Table)
	}
	if tbl.Owner == "" {
		return nil
	}
	raw, present := c.Row[tbl.Owner]
	if !present || raw == nil {
		return nil
	}
	owner, err := KeyString(raw)
	if err != nil {
		return fmt.Errorf("emit: %s.%s: %w", c.Table, tbl.Owner, err)
	}
	if owner != opt.Branch {
		return fmt.Errorf("%w: %s row belongs to branch %s, this node is %s",
			ErrWrongBranch, c.Table, owner, opt.Branch)
	}
	return nil
}

// planLedger builds the single §4.3 add for an append-only row.
func planLedger(tbl ownership.Table, c Change) ([]oplog.Op, error) {
	if c.Kind != Insert {
		return nil, fmt.Errorf("%w: %s was %sd, and an add-only set has no operation for that",
			ErrLedgerMutated, tbl.Name, c.Kind)
	}
	raw, ok := c.Row[tbl.Group]
	if !ok {
		return nil, fmt.Errorf("emit: %s: the row does not carry its grouping column %q, "+
			"so the fact has no set to join", tbl.Name, tbl.Group)
	}
	group, err := KeyString(raw)
	if err != nil {
		return nil, fmt.Errorf("emit: %s.%s: %w", tbl.Name, tbl.Group, err)
	}

	payload, err := EncodeRow(emitted(tbl, c.Row))
	if err != nil {
		return nil, fmt.Errorf("emit: %s: %w", tbl.Name, err)
	}
	if len(payload) == 0 {
		return nil, fmt.Errorf("emit: %s: every column of this row is suppressed, so the fact "+
			"would join the set carrying nothing", tbl.Name)
	}
	return []oplog.Op{{
		Kind:   oplog.KindAdd,
		Entity: tbl.Name,
		Key:    group,
		Value:  payload,
	}}, nil
}

// planRegisters builds one §4.4 last-writer-wins write per emitted column, or
// the single tombstone write for a delete.
//
// Per column rather than per row because that is what the register's address
// space says (§4.1.1 places granularity in the address, and
// internal/sync/substrate maps an op's Field into it): a manager editing an
// item's description in one place while another edits its price somewhere else
// are two writes to two registers and both survive. One register per row would
// make them one write to one register, and one of the two edits would vanish
// with nothing to show for it.
func planRegisters(tbl ownership.Table, c Change) ([]oplog.Op, error) {
	rawKey, ok := c.Row[tbl.Key]
	if !ok {
		return nil, fmt.Errorf("emit: %s: the row does not carry its key column %q", tbl.Name, tbl.Key)
	}
	key, err := KeyString(rawKey)
	if err != nil {
		return nil, fmt.Errorf("emit: %s.%s: %w", tbl.Name, tbl.Key, err)
	}

	if c.Kind == Delete {
		v, err := EncodeValue(true)
		if err != nil {
			return nil, err
		}
		return []oplog.Op{{
			Kind:   oplog.KindSet,
			Entity: tbl.Name,
			Key:    key,
			Field:  ownership.DeletedField,
			Value:  v,
		}}, nil
	}

	cols := emitted(tbl, c.Row)
	names := make([]string, 0, len(cols))
	for name := range cols {
		names = append(names, name)
	}
	// Sorted so a batch of ops for one row is minted in a stable order, and so
	// the HLC counters within that batch are reproducible for a given row.
	sort.Strings(names)

	ops := make([]oplog.Op, 0, len(names))
	for _, name := range names {
		if name == ownership.DeletedField {
			return nil, fmt.Errorf("emit: %s has a column named %q, which is the reserved "+
				"tombstone field", tbl.Name, ownership.DeletedField)
		}
		v, err := EncodeValue(cols[name])
		if err != nil {
			return nil, fmt.Errorf("emit: %s.%s: %w", tbl.Name, name, err)
		}
		ops = append(ops, oplog.Op{
			Kind:   oplog.KindSet,
			Entity: tbl.Name,
			Key:    key,
			Field:  name,
			Value:  v,
		})
	}
	if len(ops) == 0 {
		// Every column the write touched is suppressed — a write that only
		// moved a stored counter, say. There is nothing to tell a peer, and
		// that is a correct outcome rather than an error.
		return nil, nil
	}
	return ops, nil
}

// Touched narrows a row a write returned down to what should be asserted about
// it: the table's key column, plus the columns the write actually named.
//
// It exists because "the row after the write" and "what this write claims" are
// different things for an update. A PATCH that sets one column returns every
// column, and emitting all of them would republish forty registers this node
// did not touch — each with a fresh timestamp, each therefore outranking a
// concurrent edit from another branch that genuinely did touch them. That is
// how a one-column edit silently reverts somebody else's work.
//
// cols nil means the whole row, which is what an insert asserts.
//
// A missing key column is not an error here. Plan refuses the change with a
// message that names the table, which is a better place for it than a second
// error path at every call site.
func Touched(table string, row map[string]any, cols []string) map[string]any {
	if cols == nil {
		return row
	}
	tbl, ok := ownership.Lookup(table)
	out := make(map[string]any, len(cols)+1)
	if ok {
		if v, present := row[tbl.Key]; present {
			out[tbl.Key] = v
		}
		if tbl.Class == ownership.Ledger {
			if v, present := row[tbl.Group]; present {
				out[tbl.Group] = v
			}
		}
		if tbl.Owner != "" {
			if v, present := row[tbl.Owner]; present {
				out[tbl.Owner] = v
			}
		}
	}
	for _, c := range cols {
		if v, present := row[c]; present {
			out[c] = v
		}
	}
	return out
}

// emitted filters a row down to the columns that replicate.
func emitted(tbl ownership.Table, row map[string]any) map[string]any {
	out := make(map[string]any, len(row))
	for name, v := range row {
		if tbl.Emits(name) {
			out[name] = v
		}
	}
	return out
}
