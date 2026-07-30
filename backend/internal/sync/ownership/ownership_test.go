package ownership_test

// ownership_test.go — the invariants that hold without a database.
//
// The registry's real anti-rot check is ownership_schema_test.go, which
// compares it against a migrated Postgres. These are the properties that are
// true of the data on its own: that every table carries a reason, that the
// classes are used the way their doc comments say, and that the suppression
// lists are internally coherent.

import (
	"strings"
	"testing"

	"github.com/beepbite/backend/internal/sync/ownership"
)

// TestEveryTableRecordsAReason is the one that keeps the registry honest as a
// document rather than as a lookup table. Validate already refuses an empty
// Why at init, so this asserts the stronger thing: that the reason is an
// argument and not a restatement of the class name.
func TestEveryTableRecordsAReason(t *testing.T) {
	for _, name := range ownership.Names() {
		tbl, _ := ownership.Lookup(name)
		if len(tbl.Why) < 40 {
			t.Errorf("%s: Why is %d characters (%q) — the §4.10 selection test wants the reason "+
				"this primitive was chosen over the neighbouring one, not a label",
				name, len(tbl.Why), tbl.Why)
		}
	}
}

// TestClassesAreAllUsed guards against a class quietly falling out of use — if
// nothing is a Ledger any more, the stored-counter model has been abandoned and
// this test is where that shows up.
func TestClassesAreAllUsed(t *testing.T) {
	for _, c := range []ownership.Class{ownership.Local, ownership.Branch, ownership.Group, ownership.Ledger} {
		if got := len(ownership.OfClass(c)); got == 0 {
			t.Errorf("no table is classified %s", c)
		}
	}
}

// TestLedgersNameAGroupingColumn: a ledger op is addressed by its grouping
// column's value, so a ledger without one would put every member of every set
// at the same target.
func TestLedgersNameAGroupingColumn(t *testing.T) {
	for _, tbl := range ownership.OfClass(ownership.Ledger) {
		if tbl.Group == "" {
			t.Errorf("ledger %s names no grouping column", tbl.Name)
		}
		if !tbl.Emits(tbl.Group) {
			t.Errorf("ledger %s suppresses its own grouping column %q", tbl.Name, tbl.Group)
		}
	}
}

// TestDerivedColumnsNameALedger is the stored-counter rule made checkable. A
// counter that claims to be derived from a table that is not a ledger is not
// derived from anything a union can reproduce.
func TestDerivedColumnsNameALedger(t *testing.T) {
	var found int
	for _, name := range ownership.Names() {
		tbl, _ := ownership.Lookup(name)
		for col, ledgerName := range tbl.Derived {
			found++
			ledger, ok := ownership.Lookup(ledgerName)
			if !ok {
				t.Errorf("%s.%s derives from %q, which is not a registered table", name, col, ledgerName)
				continue
			}
			if ledger.Class != ownership.Ledger {
				t.Errorf("%s.%s derives from %s, which is a %s table", name, col, ledgerName, ledger.Class)
			}
			if tbl.Emits(col) {
				t.Errorf("%s.%s is derived but is still emitted", name, col)
			}
		}
	}
	// The count is asserted so that deleting the Derived entries — which would
	// make every other assertion in this test vacuously true — fails here.
	if found < 8 {
		t.Errorf("only %d derived columns are recorded; the schema carries at least the stock, "+
			"gift-card, store-credit, house-account, loyalty and coupon counters", found)
	}
}

// TestLocalTablesSuppressNothing: suppression is a statement about what a
// replicated row does not carry. A local row carries nothing anywhere, so a
// suppression list on one is a sign somebody meant to replicate it.
func TestLocalTablesSuppressNothing(t *testing.T) {
	for _, tbl := range ownership.OfClass(ownership.Local) {
		if n := len(tbl.Suppressed()); n != 0 {
			t.Errorf("local table %s suppresses %d columns, but emits nothing at all", tbl.Name, n)
		}
	}
}

// TestOwnerOnlyOnBranchTables: the owning-branch column is what lets the
// emitter refuse a write authored by the wrong node. On a group-owned table
// there is no such refusal to make, and an Owner there would read as one.
func TestOwnerOnlyOnBranchTables(t *testing.T) {
	for _, name := range ownership.Names() {
		tbl, _ := ownership.Lookup(name)
		if tbl.Class != ownership.Branch && tbl.Owner != "" {
			t.Errorf("%s is %s but names an owning branch column %q", name, tbl.Class, tbl.Owner)
		}
	}
	var withOwner int
	for _, tbl := range ownership.OfClass(ownership.Branch) {
		if tbl.Owner != "" {
			withOwner++
		}
	}
	if withOwner == 0 {
		t.Error("no branch-owned table names its owning column, so the ownership guard can never fire")
	}
}

// TestUnknownTableIsNotSilentlyUnreplicated. Lookup's contract is that a miss
// is a refusal, not a default. This pins the shape callers depend on.
func TestUnknownTableIsNotSilentlyUnreplicated(t *testing.T) {
	if _, ok := ownership.Lookup("a_table_that_does_not_exist"); ok {
		t.Fatal("Lookup invented an entry")
	}
}

// TestDeletedFieldCannotCollideWithAColumn is checked against the live schema
// in ownership_schema_test.go; here it only asserts the sentinel is spelled in
// a way no Postgres column in this schema is. Every column in migrations/ is
// lowercase and none begins with an underscore.
func TestDeletedFieldIsReserved(t *testing.T) {
	if !strings.HasPrefix(ownership.DeletedField, "_") {
		t.Fatalf("DeletedField = %q; it must be spelled so no column can collide with it",
			ownership.DeletedField)
	}
}
