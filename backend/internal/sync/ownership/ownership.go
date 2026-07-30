// Package ownership records, as data, which node is allowed to write each
// table and which merge primitive that table's rows replicate under.
//
// ROADMAP Now-5 states the model in prose:
//
//	The unit of authority is the branch, which is what makes this tractable at
//	all: orders, order sequence numbers, the cash drawer, table state and
//	shifts have exactly one writer, so money and sequencing have no conflicts
//	to resolve. Menu, pricing and staff are group-owned and replicated down.
//	Stock movements, sales events, audit rows, GPS trails and earnings are
//	append-only and union-merged — quantities are SUM(qty) at read time, never
//	a stored counter.
//
// tables.go is that paragraph, per table, in a form the emit path can execute
// and a test can check against the live schema. It is deliberately a table of
// data rather than a switch statement or a set of struct tags: the decision for
// each table is the thing being reviewed, and it should be readable in one file
// without following code.
//
// # The classes, and the §4.10 selection test behind each
//
// SYNC.md §4.10 requires an implementation to say, per modelled object, which
// primitive it chose and how it answered the selection test. Every Table below
// carries that answer in Why. The four classes are:
//
//	Local   — never leaves this node. Emits nothing.
//	Branch  — exactly one writer (the branch that owns the row). §4.4 registers.
//	Group   — group-owned, edited centrally, replicated down. §4.4 registers.
//	Ledger  — append-only fact. §4.3 add-only set, SUM(qty) at read time.
//
// Branch and Group both map onto §4.4 last-writer-wins registers and differ in
// who is permitted to author one, not in how the algebra merges them. That
// difference is not decoration. A branch-owned row has exactly one writer by
// construction, so LWW never actually arbitrates anything for it, and a second
// writer appearing is a bug rather than a conflict to resolve — which is why
// Emitter refuses to author a Branch op for a row belonging to another branch
// instead of minting one and letting the timestamps sort it out. A group-owned
// row genuinely can be edited from two places at once, and LWW is the answer
// there rather than a fallback.
//
// # Derived columns: the stored-counter trap, written down per column
//
// The failure ROADMAP Now-5 names by name is a stored quantity. Two tills each
// sell the last steak while offline; each reads "1 left", each writes "0"; LWW
// keeps one of those two writes and the shop believes it sold one steak it did
// not have rather than two. The fix is that the quantity is never stored — each
// sale is its own append-only movement, and quantity on hand is SUM(qty) over
// the union at read time, which converges honestly at −2.
//
// BeepBite's schema predates that rule and has the stored counters anyway:
// items.current_stock, gift_cards.current_balance_cents,
// customers.loyalty_points and a dozen more. They cannot simply be replicated
// as registers, because a register is exactly the clobbering thing. So every
// one of them is listed in its table's Derived map, naming the ledger that is
// its actual truth, and the emit path never authors an op for it. The column
// stays in Postgres as a local cache for this node's own reads; it is not a
// fact this node is entitled to tell another node about.
//
// A test asserts Derived is exhaustive for the columns it can detect
// mechanically (see ownership_schema_test.go), and every entry names a Ledger
// table that exists. That is what stops the list from being a comment.
//
// # Secrets
//
// Secret lists columns of a replicated table that must never be emitted:
// password and PIN hashes, ciphertext, API-key material. The schema test fails
// closed — a column in a replicated table whose name matches the sensitive
// patterns must be listed in Secret or the table must be Local — so a column
// added later cannot start replicating a credential because nobody thought
// about it.
//
// # What this package does not do
//
// It does not read or write anything, it does not know what a node id is, and
// it has no dependency outside the standard library. It is a lookup table with
// an invariant checker. internal/sync/emit is what turns a row into operations
// using it.
package ownership

import (
	"fmt"
	"sort"
	"strings"
)

// Class is how a table's rows replicate, and who may author a change to one.
type Class uint8

const (
	// Local data never leaves the node that wrote it. Sessions, tokens,
	// caches, queues, derived summaries and this product's own sync
	// bookkeeping. Emits nothing at all.
	Local Class = iota + 1

	// Branch data has exactly one writer: the branch that owns the row. It
	// replicates as §4.4 last-writer-wins registers, one per column, but the
	// last-writer rule never arbitrates anything because there is only ever
	// one writer. A second author is a bug and is refused.
	Branch

	// Group data is owned by the organisation, edited centrally and
	// replicated down. §4.4 registers, one per column. Two managers editing
	// the same menu item from two places is an ordinary conflict and LWW is
	// the answer.
	Group

	// Ledger data is an append-only fact: it is never updated and never
	// deleted, and its aggregate is SUM(qty) over the union at read time.
	// §4.3 add-only set.
	Ledger
)

// String renders a Class for diagnostics.
func (c Class) String() string {
	switch c {
	case Local:
		return "local"
	case Branch:
		return "branch"
	case Group:
		return "group"
	case Ledger:
		return "ledger"
	default:
		return fmt.Sprintf("Class(%d)", uint8(c))
	}
}

// Replicated reports whether a table of this class produces operations.
func (c Class) Replicated() bool { return c == Branch || c == Group || c == Ledger }

// Table is one table's entry in the registry.
//
// A zero Table is not valid; Validate rejects one. Every field that has a
// sensible default has it applied by init (Key defaults to "id"), so the data
// in tables.go states only what is actually a decision.
type Table struct {
	// Name is the Postgres table name, without the schema qualifier. It is
	// also the operation's Entity, so it must not contain "/" (the substrate
	// target separator). Validate checks that.
	Name string

	// Class is how this table replicates.
	Class Class

	// Key names the column whose value identifies the row. Defaults to "id".
	// For a Ledger it is unused — a ledger op is addressed by Group, and the
	// row's own key travels inside the payload.
	Key string

	// Owner names the column that says which branch owns the row, for a
	// Branch table. Normally "location_id". Empty on a Branch table means the
	// table is owned by the branch as a whole rather than per row (there is
	// currently one: fiscal_sequences, keyed by location_id already).
	Owner string

	// Group names the column whose value is the §4.3 set target for a Ledger
	// table — the thing a read-side SUM groups by. Required for Ledger,
	// forbidden otherwise.
	//
	// Choosing it is choosing what "everything that happened to this" means.
	// stock_movements groups by inventory_item_id because the question the
	// ledger answers is "how much of this ingredient is on hand", and that is
	// SUM(quantity) over exactly that set.
	Group string

	// Qty names the column a read-side SUM adds up, for a Ledger table whose
	// members carry a quantity. Empty for a ledger of events with nothing to
	// total (audit rows, GPS pings). Purely descriptive here — this package
	// computes nothing — but it is the column the read path must sum instead
	// of trusting a Derived counter, so it is written down next to the
	// decision rather than in a handler.
	Qty string

	// Derived maps a column of THIS table to the Ledger table that is its
	// actual truth. Those columns are never emitted: they are stored counters
	// or cached aggregates, and replicating one as a register is the exact
	// clobbering failure the ledger exists to avoid.
	Derived map[string]string

	// Secret lists columns that must never be emitted because they carry
	// credential material.
	Secret []string

	// Exclude maps a column not emitted for any other reason to the reason.
	// Node-local bookkeeping on an otherwise replicated row, and the stored
	// counters whose truth is a table that is NOT a ledger and so cannot be
	// named in Derived. The reason is a required part of the entry because
	// "we don't send this one" without a reason is indistinguishable from an
	// oversight.
	Exclude map[string]string

	// Why records the §4.10 selection-test answer: why this class and not a
	// neighbouring one. Required. A table without a reason is a table nobody
	// decided about.
	Why string
}

// DeletedField is the reserved register field a delete writes.
//
// There is deliberately no §4.5 death certificate in BeepBite's mapping (see
// internal/sync/substrate's package doc for the selection test: every row this
// product deletes can be restored by the same ordinary write that created it,
// and a certificate would dominate every later write and make the restored row
// invisible on every replica with no error anywhere). A delete is therefore an
// ordinary last-writer-wins register write, on a field name no column can have.
//
// The name is checked against the live schema: ownership_schema_test.go fails
// if any replicated table grows a column called this, because that column's
// register and the tombstone would then be the same address.
const DeletedField = "_deleted"

// registry is the parsed, defaulted, validated form of tables.go.
var registry map[string]Table

// Lookup returns the registry entry for a table name.
//
// The second return is false for a table this registry has never heard of,
// which callers must treat as a refusal rather than as "not replicated". A
// table nobody has classified is not a table anybody has decided is safe to
// skip; ownership_schema_test.go fails closed on exactly this, so the only way
// to reach it at runtime is a table that exists in code and not in the schema.
func Lookup(name string) (Table, bool) {
	t, ok := registry[name]
	return t, ok
}

// Names returns every registered table name, sorted.
func Names() []string {
	out := make([]string, 0, len(registry))
	for name := range registry {
		out = append(out, name)
	}
	sort.Strings(out)
	return out
}

// OfClass returns every registered table of one class, sorted.
func OfClass(c Class) []Table {
	var out []Table
	for _, name := range Names() {
		if registry[name].Class == c {
			out = append(out, registry[name])
		}
	}
	return out
}

// Emits reports whether a column of this table is emitted at all.
//
// A Ledger's Group column IS emitted: the payload is the fact, and the fact
// includes what it is about. What is never emitted is a Derived counter, a
// Secret, or an explicitly Excluded column.
func (t Table) Emits(column string) bool {
	_, ok := t.Suppressed()[column]
	return !ok
}

// Suppressed returns the columns of this table that are never emitted, each
// mapped to the reason. It exists so a test (and a diagnostic) can show the
// whole suppression set rather than probing it column by column.
func (t Table) Suppressed() map[string]string {
	out := make(map[string]string, len(t.Derived)+len(t.Secret)+len(t.Exclude))
	for col, ledger := range t.Derived {
		out[col] = "derived — the truth is SUM over " + ledger
	}
	for _, c := range t.Secret {
		out[c] = "secret — credential material never leaves this node"
	}
	for col, why := range t.Exclude {
		out[col] = why
	}
	return out
}

// Validate reports whether t is internally consistent.
//
// It is run over every entry at package init, so an inconsistent registry is a
// panic at process start rather than a wrong op at 11pm on a Friday.
func (t Table) Validate() error {
	if t.Name == "" {
		return fmt.Errorf("ownership: a table has no name")
	}
	if strings.Contains(t.Name, "/") {
		// The substrate addresses an op as "<entity>/<key>", so an entity
		// containing the separator would split back to a different address.
		return fmt.Errorf("ownership: table %q contains %q, which would make its op target ambiguous", t.Name, "/")
	}
	if t.Why == "" {
		return fmt.Errorf("ownership: table %q records no reason for its class", t.Name)
	}
	switch t.Class {
	case Local, Branch, Group, Ledger:
	default:
		return fmt.Errorf("ownership: table %q has class %s", t.Name, t.Class)
	}

	if t.Class == Ledger {
		if t.Group == "" {
			return fmt.Errorf("ownership: ledger %q names no grouping column, so its ops would have no address", t.Name)
		}
	} else if t.Group != "" || t.Qty != "" {
		return fmt.Errorf("ownership: %s table %q sets Group/Qty, which only a ledger has", t.Class, t.Name)
	}

	if t.Class != Branch && t.Owner != "" {
		return fmt.Errorf("ownership: %s table %q names an owning branch column, which only a branch-owned table has", t.Class, t.Name)
	}

	if !t.Class.Replicated() {
		if len(t.Derived) > 0 || len(t.Secret) > 0 || len(t.Exclude) > 0 {
			return fmt.Errorf("ownership: local table %q suppresses columns, but a local table emits nothing at all", t.Name)
		}
		return nil
	}

	if t.Key == "" {
		return fmt.Errorf("ownership: replicated table %q names no key column", t.Name)
	}
	for col, ledger := range t.Derived {
		if col == "" {
			return fmt.Errorf("ownership: table %q has an empty Derived column name", t.Name)
		}
		l, ok := registry[ledger]
		if !ok {
			return fmt.Errorf("ownership: table %q says %s is derived from %q, which is not a registered table", t.Name, col, ledger)
		}
		if l.Class != Ledger {
			return fmt.Errorf("ownership: table %q says %s is derived from %q, which is a %s table and not a ledger", t.Name, col, ledger, l.Class)
		}
	}
	seen := make(map[string]bool, len(t.Secret))
	for _, c := range t.Secret {
		if c == "" {
			return fmt.Errorf("ownership: table %q has an empty Secret column name", t.Name)
		}
		if seen[c] {
			return fmt.Errorf("ownership: table %q lists secret column %q twice", t.Name, c)
		}
		seen[c] = true
	}
	for col, why := range t.Exclude {
		if col == "" {
			return fmt.Errorf("ownership: table %q has an empty Exclude column name", t.Name)
		}
		if why == "" {
			return fmt.Errorf("ownership: table %q excludes %q with no reason", t.Name, col)
		}
		if _, both := t.Derived[col]; both {
			return fmt.Errorf("ownership: table %q both derives and excludes %q", t.Name, col)
		}
		if seen[col] {
			return fmt.Errorf("ownership: table %q both hides and excludes %q", t.Name, col)
		}
	}
	if t.Key != "" && !t.Emits(t.Key) && t.Class != Ledger {
		// A register op is addressed BY the key. Suppressing it would leave
		// every op on the table addressed by an empty string.
		return fmt.Errorf("ownership: table %q suppresses its own key column %q", t.Name, t.Key)
	}
	if t.Class == Ledger && !t.Emits(t.Group) {
		return fmt.Errorf("ownership: ledger %q suppresses its grouping column %q", t.Name, t.Group)
	}
	return nil
}

func init() {
	registry = make(map[string]Table, len(tables))
	for _, t := range tables {
		if t.Key == "" {
			t.Key = "id"
		}
		if _, dup := registry[t.Name]; dup {
			panic(fmt.Sprintf("ownership: table %q is registered twice", t.Name))
		}
		registry[t.Name] = t
	}
	// Validated in a second pass because Derived cross-references other
	// entries, which do not all exist during the first.
	for _, t := range registry {
		if err := t.Validate(); err != nil {
			panic(err.Error())
		}
	}
}
