package emit_test

// emit_test.go — what a row becomes, and what it refuses to become.
//
// These run without a database and without the engine: Plan is a pure function
// of the ownership registry and a row, and the properties worth pinning are
// properties of that mapping. The engine-backed proofs — that two identical
// facts survive the union, that two partitioned branches converge byte for
// byte — are in internal/sync/opsink/converge_test.go, because they need a real
// replica to be worth anything.

import (
	"errors"
	"sort"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"math/big"

	"github.com/beepbite/backend/internal/oplog"
	"github.com/beepbite/backend/internal/sync/emit"
	"github.com/beepbite/backend/internal/sync/ownership"
)

const branch = "11111111-1111-1111-1111-111111111111"

func here() emit.Options { return emit.Options{Branch: branch} }

func plan(t *testing.T, c emit.Change, opt emit.Options) []oplog.Op {
	t.Helper()
	ops, err := emit.Plan(c, opt)
	if err != nil {
		t.Fatalf("Plan(%s %s): %v", c.Kind, c.Table, err)
	}
	return ops
}

func fields(ops []oplog.Op) []string {
	out := make([]string, 0, len(ops))
	for _, op := range ops {
		out = append(out, op.Field)
	}
	sort.Strings(out)
	return out
}

// ---------------------------------------------------------------------------
// Group-owned registers
// ---------------------------------------------------------------------------

// A menu edit becomes one last-writer-wins write per column, not one per row.
// That is the difference between two managers' concurrent edits both surviving
// and one of them silently disappearing.
func TestGroupRowBecomesOneRegisterPerColumn(t *testing.T) {
	ops := plan(t, emit.Change{
		Table: "items",
		Kind:  emit.Update,
		Row: map[string]any{
			"id":          "item-1",
			"name":        "Ribeye",
			"price":       numeric(24950, -2),
			"description": "300g",
		},
	}, here())

	if len(ops) != 4 {
		t.Fatalf("got %d ops, want one per column: %v", len(ops), fields(ops))
	}
	for _, op := range ops {
		if op.Kind != oplog.KindSet {
			t.Errorf("%s: kind %v, want a last-writer-wins register write", op.Field, op.Kind)
		}
		if op.Entity != "items" || op.Key != "item-1" {
			t.Errorf("op addressed %s/%s, want items/item-1", op.Entity, op.Key)
		}
		if err := op.Validate(); err != nil {
			t.Errorf("%s: %v", op.Field, err)
		}
	}
	want := []string{"description", "id", "name", "price"}
	if got := fields(ops); !equal(got, want) {
		t.Errorf("fields = %v, want %v", got, want)
	}
}

// The stored-counter rule, at the emit boundary. items.current_stock is the
// cache of SUM over stock_movements; publishing it as a register is exactly the
// clobbering the ledger exists to prevent, so it never becomes an op — even
// when the write that produced this row set it.
func TestDerivedCountersAreNeverEmitted(t *testing.T) {
	ops := plan(t, emit.Change{
		Table: "items",
		Kind:  emit.Update,
		Row: map[string]any{
			"id":            "item-1",
			"current_stock": numeric(7, 0),
		},
	}, here())

	for _, op := range ops {
		if op.Field == "current_stock" {
			t.Fatal("items.current_stock was emitted as a register; two branches selling the last " +
				"one offline would then each publish the same decremented value and one sale " +
				"would be lost on merge")
		}
	}
	if len(ops) != 1 || ops[0].Field != "id" {
		t.Fatalf("got %v, want only the key", fields(ops))
	}
}

// A write that touched nothing but suppressed columns has nothing to say, and
// saying nothing is the right answer rather than an error.
func TestAWriteOfOnlySuppressedColumnsEmitsNothing(t *testing.T) {
	ops, err := emit.Plan(emit.Change{
		Table: "staff",
		Kind:  emit.Update,
		Row: map[string]any{
			"password_hash":         "$argon2id$...",
			"failed_login_attempts": int32(3),
		},
	}, here())
	// staff's key is "id" and the row does not carry it, so this is refused for
	// a different reason — which is itself the point: a register write with no
	// address cannot be emitted.
	if err == nil {
		t.Fatalf("expected a refusal for a row with no key, got %d ops", len(ops))
	}

	ops = plan(t, emit.Change{
		Table: "staff",
		Kind:  emit.Update,
		Row: map[string]any{
			"id":                    "staff-1",
			"password_hash":         "$argon2id$...",
			"failed_login_attempts": int32(3),
		},
	}, here())
	if got := fields(ops); !equal(got, []string{"id"}) {
		t.Fatalf("fields = %v; the credential and the lockout counter must not leave this node", got)
	}
}

// ---------------------------------------------------------------------------
// Deletes
// ---------------------------------------------------------------------------

// There is no §4.5 death certificate in this mapping. A delete is an ordinary
// register write to a reserved field, so an un-delete is an ordinary register
// write too and a later edit outranks it by timestamp like any other.
func TestDeleteIsATombstoneRegisterAndNotACertificate(t *testing.T) {
	ops := plan(t, emit.Change{
		Table: "categories",
		Kind:  emit.Delete,
		Row:   map[string]any{"id": "cat-1"},
	}, here())

	if len(ops) != 1 {
		t.Fatalf("got %d ops, want one", len(ops))
	}
	if ops[0].Kind != oplog.KindSet || ops[0].Field != ownership.DeletedField {
		t.Fatalf("delete emitted %v on field %q, want a register write on %q",
			ops[0].Kind, ops[0].Field, ownership.DeletedField)
	}
	if ops[0].Key != "cat-1" {
		t.Fatalf("tombstone addressed %q", ops[0].Key)
	}
}

// ---------------------------------------------------------------------------
// Ledgers
// ---------------------------------------------------------------------------

func TestLedgerRowBecomesOneAddAddressedByItsGroup(t *testing.T) {
	ops := plan(t, emit.Change{
		Table: "stock_movements",
		Kind:  emit.Insert,
		Row: map[string]any{
			"id":                "mv-1",
			"inventory_item_id": "ing-steak",
			"movement_type":     "sale",
			"quantity":          numeric(-1, 0),
		},
	}, here())

	if len(ops) != 1 {
		t.Fatalf("got %d ops, want exactly one add", len(ops))
	}
	op := ops[0]
	if op.Kind != oplog.KindAdd {
		t.Fatalf("kind = %v, want an add-only set member", op.Kind)
	}
	if op.Entity != "stock_movements" || op.Key != "ing-steak" {
		t.Fatalf("addressed %s/%s, want stock_movements/ing-steak — the set a read-time "+
			"SUM(quantity) groups by", op.Entity, op.Key)
	}
	if op.Field != "" {
		t.Fatalf("an add carries a field %q; §4.3 members have no column address", op.Field)
	}
	if err := op.Validate(); err != nil {
		t.Fatal(err)
	}
}

// The loudest refusal in the package. A ledger edited in place is not a ledger,
// and every quantity in this product is a SUM over one.
func TestLedgerCannotBeUpdatedOrDeleted(t *testing.T) {
	for _, kind := range []emit.Kind{emit.Update, emit.Delete} {
		_, err := emit.Plan(emit.Change{
			Table: "stock_movements",
			Kind:  kind,
			Row:   map[string]any{"id": "mv-1", "inventory_item_id": "ing-steak"},
		}, here())
		if !errors.Is(err, emit.ErrLedgerMutated) {
			t.Errorf("%s of a ledger row: err = %v, want ErrLedgerMutated", kind, err)
		}
	}
}

func TestLedgerRowWithoutItsGroupIsRefused(t *testing.T) {
	_, err := emit.Plan(emit.Change{
		Table: "stock_movements",
		Kind:  emit.Insert,
		Row:   map[string]any{"id": "mv-1", "quantity": numeric(-1, 0)},
	}, here())
	if err == nil {
		t.Fatal("a movement with no inventory_item_id was accepted; it would have joined no set")
	}
}

// §4.3 identifies a set element BY ITS VALUE, so two facts that encode
// identically collapse into one. The payload carries the row's own primary key
// precisely so that two movements of the same quantity of the same ingredient
// are two different byte strings before the engine's stamp is even considered.
func TestTwoIdenticalMovementsHaveDifferentPayloads(t *testing.T) {
	row := func(id string) map[string]any {
		return map[string]any{
			"id":                id,
			"inventory_item_id": "ing-steak",
			"movement_type":     "sale",
			"quantity":          numeric(-1, 0),
			"notes":             nil,
		}
	}
	a := plan(t, emit.Change{Table: "stock_movements", Kind: emit.Insert, Row: row("mv-1")}, here())
	b := plan(t, emit.Change{Table: "stock_movements", Kind: emit.Insert, Row: row("mv-2")}, here())

	if string(a[0].Value) == string(b[0].Value) {
		t.Fatal("two stock movements that differ only by primary key encoded to identical bytes; " +
			"§4.3 would collapse them into one element and a read-time SUM would report −1 " +
			"where two units were sold")
	}
	if a[0].Key != b[0].Key {
		t.Fatal("the two movements landed in different sets, so nothing would sum them together")
	}
}

// ---------------------------------------------------------------------------
// Branch ownership
// ---------------------------------------------------------------------------

// The single-writer claim, enforced. An order belongs to one branch; a node
// that is not that branch must not author operations for it, and refusing is
// different from letting last-writer-wins arbitrate between two writers who
// should never both have existed.
func TestBranchOwnedRowFromAnotherBranchIsRefused(t *testing.T) {
	other := "22222222-2222-2222-2222-222222222222"
	_, err := emit.Plan(emit.Change{
		Table: "orders",
		Kind:  emit.Update,
		Row:   map[string]any{"id": "order-1", "location_id": other, "status": "ready"},
	}, here())
	if !errors.Is(err, emit.ErrWrongBranch) {
		t.Fatalf("err = %v, want ErrWrongBranch", err)
	}
}

func TestBranchOwnedRowFromThisBranchIsEmitted(t *testing.T) {
	ops := plan(t, emit.Change{
		Table: "orders",
		Kind:  emit.Update,
		Row:   map[string]any{"id": "order-1", "location_id": branch, "status": "ready"},
	}, here())
	if len(ops) != 3 {
		t.Fatalf("got %v", fields(ops))
	}
}

// A node with no branch identity cannot author a branch-owned operation at all.
// That is the fail-closed direction: publishing them anyway would assert an
// ownership claim nobody made.
func TestNodeWithNoBranchIdentityCannotAuthorBranchOps(t *testing.T) {
	_, err := emit.Plan(emit.Change{
		Table: "orders",
		Kind:  emit.Insert,
		Row:   map[string]any{"id": "order-1", "location_id": branch},
	}, emit.Options{})
	if !errors.Is(err, emit.ErrNoBranch) {
		t.Fatalf("err = %v, want ErrNoBranch", err)
	}

	// Group-owned data is unaffected: a node with no branch identity is still
	// entitled to edit the menu.
	if _, err := emit.Plan(emit.Change{
		Table: "categories",
		Kind:  emit.Update,
		Row:   map[string]any{"id": "cat-1", "name": "Grill"},
	}, emit.Options{}); err != nil {
		t.Fatalf("a group-owned edit was refused for want of a branch identity: %v", err)
	}
}

// ---------------------------------------------------------------------------
// Local and unknown tables
// ---------------------------------------------------------------------------

func TestLocalTableEmitsNothing(t *testing.T) {
	for _, table := range []string{"refresh_tokens", "idempotency_keys", "sync_ops", "customer_loyalty_stamps"} {
		ops, err := emit.Plan(emit.Change{
			Table: table,
			Kind:  emit.Insert,
			Row:   map[string]any{"id": "x"},
		}, here())
		if err != nil {
			t.Errorf("%s: %v", table, err)
		}
		if len(ops) != 0 {
			t.Errorf("%s emitted %d ops", table, len(ops))
		}
	}
}

// "Not in the registry" and "not replicated" are different statements and only
// one of them is a decision somebody made.
func TestUnknownTableIsRefusedRatherThanSkipped(t *testing.T) {
	_, err := emit.Plan(emit.Change{
		Table: "some_table_migration_005_added",
		Kind:  emit.Insert,
		Row:   map[string]any{"id": "x"},
	}, here())
	if !errors.Is(err, emit.ErrUnknownTable) {
		t.Fatalf("err = %v, want ErrUnknownTable — a table nobody classified must not "+
			"silently replicate nothing", err)
	}
}

// ---------------------------------------------------------------------------
// The value codec
// ---------------------------------------------------------------------------

// NULL, the empty string and the empty byte string are three different facts
// about a column. An encoding that conflated them would make a cleared field
// and a blanked field the same operation.
func TestNullEmptyStringAndEmptyBytesAreDistinct(t *testing.T) {
	seen := map[string]string{}
	for _, c := range []struct {
		name string
		v    any
	}{
		{"null", nil},
		{"empty string", ""},
		{"empty bytes", []byte{}},
		{"false", false},
		{"zero int", int64(0)},
	} {
		b, err := emit.EncodeValue(c.v)
		if err != nil {
			t.Fatalf("%s: %v", c.name, err)
		}
		if prev, dup := seen[string(b)]; dup {
			t.Errorf("%s and %s encode identically to %x", c.name, prev, b)
		}
		seen[string(b)] = c.name
	}
}

// Money is minor units, never floats — and the exact type Postgres uses for a
// quantity is numeric, which must not go through a float on the way to bytes.
func TestNumericIsEncodedExactly(t *testing.T) {
	big1 := new(big.Int)
	big1.SetString("1234567890123456789012345", 10)
	a, err := emit.EncodeValue(pgtype.Numeric{Int: big1, Exp: -2, Valid: true})
	if err != nil {
		t.Fatal(err)
	}
	big2 := new(big.Int)
	big2.SetString("1234567890123456789012346", 10) // one hundredth more
	b, err := emit.EncodeValue(pgtype.Numeric{Int: big2, Exp: -2, Valid: true})
	if err != nil {
		t.Fatal(err)
	}
	if string(a) == string(b) {
		t.Fatal("two numerics one hundredth apart encoded identically; the encoding went " +
			"through a float and lost the cent")
	}
	if !containsSub(string(a), "1234567890123456789012345") {
		t.Fatalf("encoding %q does not carry the exact mantissa", a)
	}
}

// 1.50 and 1.5 are one number that two column scales spell differently. They
// must be one register value, or a scale change would look like an edit.
func TestNumericTrailingZerosAreCanonical(t *testing.T) {
	a, _ := emit.EncodeValue(numeric(150, -2))
	b, _ := emit.EncodeValue(numeric(15, -1))
	if string(a) != string(b) {
		t.Fatalf("1.50 encoded as %q and 1.5 as %q", a, b)
	}
	z1, _ := emit.EncodeValue(numeric(0, -4))
	z2, _ := emit.EncodeValue(numeric(0, 3))
	if string(z1) != string(z2) {
		t.Fatalf("two spellings of zero encoded as %q and %q", z1, z2)
	}
}

// Encoding must not depend on Go's default formatting of a type nobody thought
// about — a value rendered by %v has bytes that a Go release can change.
func TestUnknownTypeIsRefusedRatherThanFormatted(t *testing.T) {
	type weird struct{ A int }
	if _, err := emit.EncodeValue(weird{1}); err == nil {
		t.Fatal("an unmodelled type was encoded; its bytes would be whatever fmt does this year")
	}
}

// A row's encoding must not depend on Go map iteration order.
func TestRowEncodingIsStable(t *testing.T) {
	row := map[string]any{"c": int64(3), "a": "x", "b": true, "d": nil}
	first, err := emit.EncodeRow(row)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 50; i++ {
		again, err := emit.EncodeRow(row)
		if err != nil {
			t.Fatal(err)
		}
		if string(again) != string(first) {
			t.Fatalf("iteration %d produced different bytes for the same row", i)
		}
	}
}

// The framing has to make column boundaries unambiguous: {"ab": "c"} and
// {"a": "bc"} must not be the same bytes, or one row's signature would verify
// over another row.
func TestRowFramingIsUnambiguous(t *testing.T) {
	a, _ := emit.EncodeRow(map[string]any{"ab": "c"})
	b, _ := emit.EncodeRow(map[string]any{"a": "bc"})
	if string(a) == string(b) {
		t.Fatal("two different rows encoded to the same bytes")
	}
}

func TestTimeIsNormalisedToUTC(t *testing.T) {
	utc := time.Date(2026, 7, 30, 12, 0, 0, 0, time.UTC)
	loc := time.FixedZone("SAST", 2*60*60)
	same := utc.In(loc)
	a, _ := emit.EncodeValue(utc)
	b, _ := emit.EncodeValue(same)
	if string(a) != string(b) {
		t.Fatalf("one instant encoded two ways: %q and %q", a, b)
	}
}

// A key containing the substrate's target separator would address a different
// row than it names.
func TestKeyWithTargetSeparatorIsRefused(t *testing.T) {
	if _, err := emit.KeyString("a/b"); err == nil {
		t.Fatal(`a key containing "/" was accepted`)
	}
	if _, err := emit.KeyString(nil); err == nil {
		t.Fatal("a NULL key was accepted; every such row would share one address")
	}
	if _, err := emit.KeyString(""); err == nil {
		t.Fatal("an empty key was accepted")
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

func numeric(mant int64, exp int32) pgtype.Numeric {
	return pgtype.Numeric{Int: big.NewInt(mant), Exp: exp, Valid: true}
}

func equal(a, b []string) bool {
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

func containsSub(s, sub string) bool {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}
