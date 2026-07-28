package oplog

import (
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

// The Canonical() tests that used to live here — stable across calls, field
// boundaries distinguished, every field independently distinguished — moved to
// internal/sync/substrate's TestOpAddressDistinguishesEveryField when op
// encoding and addressing moved to the shared engine. They were deleted here
// rather than kept, because there is no second encoder left to assert about;
// what they were really testing is now a property of the substrate's §4.1 CBOR,
// which the frozen conformance vectors also cover.
