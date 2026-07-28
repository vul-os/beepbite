package oplog

import (
	"bytes"
	"errors"
	"testing"
)

func TestOp_Validate(t *testing.T) {
	baseTS := Timestamp{Wall: 1, Counter: 0, Node: "n1"}

	tests := []struct {
		name string
		op   Op
		want error
	}{
		{
			name: "valid Set",
			op:   Op{ID: "1", Kind: KindSet, Entity: "menu_item", Key: "row1", Field: "price", TS: baseTS},
			want: nil,
		},
		{
			name: "valid Add",
			op:   Op{ID: "1", Kind: KindAdd, Entity: "stock_movement", Key: "steak", TS: baseTS},
			want: nil,
		},
		{
			name: "empty entity",
			op:   Op{ID: "1", Kind: KindSet, Entity: "", Key: "row1", Field: "price", TS: baseTS},
			want: ErrEmptyEntity,
		},
		{
			name: "empty key",
			op:   Op{ID: "1", Kind: KindSet, Entity: "menu_item", Key: "", Field: "price", TS: baseTS},
			want: ErrEmptyKey,
		},
		{
			name: "Set with no field",
			op:   Op{ID: "1", Kind: KindSet, Entity: "menu_item", Key: "row1", Field: "", TS: baseTS},
			want: ErrSetNeedsField,
		},
		{
			name: "Add with a field",
			op:   Op{ID: "1", Kind: KindAdd, Entity: "stock_movement", Key: "steak", Field: "qty", TS: baseTS},
			want: ErrAddHasField,
		},
		{
			name: "unknown kind",
			op:   Op{ID: "1", Kind: Kind(99), Entity: "menu_item", Key: "row1", TS: baseTS},
			want: ErrUnknownKind,
		},
		{
			name: "zero-value kind is unknown",
			op:   Op{ID: "1", Entity: "menu_item", Key: "row1", TS: baseTS},
			want: ErrUnknownKind,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := tt.op.Validate()
			if !errors.Is(err, tt.want) {
				t.Fatalf("Validate() = %v, want %v", err, tt.want)
			}
		})
	}
}

func TestOp_Canonical_StableAcrossCalls(t *testing.T) {
	op := Op{
		ID:     "op-1",
		Kind:   KindSet,
		Entity: "menu_item",
		Key:    "row1",
		Field:  "price",
		Value:  []byte("1299"),
		TS:     Timestamp{Wall: 123456, Counter: 7, Node: "branch-a"},
	}
	a := op.Canonical()
	b := op.Canonical()
	if !bytes.Equal(a, b) {
		t.Fatalf("Canonical() not stable across calls: %x vs %x", a, b)
	}
}

func TestOp_Canonical_DistinguishesFieldBoundaries(t *testing.T) {
	ts := Timestamp{Wall: 1, Counter: 0, Node: "n"}

	// "ab"/"c" and "a"/"bc" concatenate to the same raw string ("abc") if you
	// naively join Entity+Key without a length prefix. Length-prefixing must
	// keep them apart.
	opA := Op{ID: "x", Kind: KindSet, Entity: "ab", Key: "c", Field: "f", TS: ts}
	opB := Op{ID: "x", Kind: KindSet, Entity: "a", Key: "bc", Field: "f", TS: ts}

	if bytes.Equal(opA.Canonical(), opB.Canonical()) {
		t.Fatalf("Canonical() collided across a field boundary: Entity=%q/Key=%q vs Entity=%q/Key=%q both encoded to %x",
			opA.Entity, opA.Key, opB.Entity, opB.Key, opA.Canonical())
	}
}

func TestOp_Canonical_DistinguishesEveryFieldIndependently(t *testing.T) {
	base := Op{
		ID:     "id",
		Kind:   KindSet,
		Entity: "entity",
		Key:    "key",
		Field:  "field",
		Value:  []byte("value"),
		TS:     Timestamp{Wall: 42, Counter: 3, Node: "node"},
	}
	baseBytes := base.Canonical()

	variants := []struct {
		name string
		op   Op
	}{
		{"different ID", func() Op { o := base; o.ID = "id2"; return o }()},
		{"different Kind", func() Op { o := base; o.Kind = KindAdd; o.Field = ""; return o }()},
		{"different Entity", func() Op { o := base; o.Entity = "entity2"; return o }()},
		{"different Key", func() Op { o := base; o.Key = "key2"; return o }()},
		{"different Field", func() Op { o := base; o.Field = "field2"; return o }()},
		{"different Value", func() Op { o := base; o.Value = []byte("value2"); return o }()},
		{"different Wall", func() Op { o := base; o.TS.Wall = 43; return o }()},
		{"different Counter", func() Op { o := base; o.TS.Counter = 4; return o }()},
		{"different Node", func() Op { o := base; o.TS.Node = "node2"; return o }()},
	}

	for _, v := range variants {
		t.Run(v.name, func(t *testing.T) {
			if bytes.Equal(baseBytes, v.op.Canonical()) {
				t.Fatalf("Canonical() did not change for variant %q", v.name)
			}
		})
	}
}
