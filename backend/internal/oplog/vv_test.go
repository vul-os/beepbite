package oplog

import (
	"reflect"
	"testing"
)

func TestVersionVector_ObserveTracksHighestPerNode(t *testing.T) {
	vv := NewVersionVector()

	vv.Observe(Op{Kind: KindAdd, Entity: "e", Key: "k", TS: Timestamp{Wall: 100, Counter: 0, Node: "a"}})
	vv.Observe(Op{Kind: KindAdd, Entity: "e", Key: "k", TS: Timestamp{Wall: 50, Counter: 9, Node: "a"}}) // older, must not regress
	vv.Observe(Op{Kind: KindAdd, Entity: "e", Key: "k", TS: Timestamp{Wall: 200, Counter: 0, Node: "b"}})

	if got := vv["a"]; got.Wall != 100 {
		t.Fatalf("node a = %+v, want Wall 100 (the older observation must not overwrite it)", got)
	}
	if got := vv["b"]; got.Wall != 200 {
		t.Fatalf("node b = %+v, want Wall 200", got)
	}
}

func TestVersionVector_Dominates(t *testing.T) {
	vv := VersionVector{
		"a": {Wall: 100, Node: "a"},
		"b": {Wall: 200, Node: "b"},
	}

	subset := VersionVector{
		"a": {Wall: 50, Node: "a"},
	}
	if !vv.Dominates(subset) {
		t.Fatalf("expected vv to dominate a strict subset with older timestamps")
	}

	ahead := VersionVector{
		"a": {Wall: 150, Node: "a"},
	}
	if vv.Dominates(ahead) {
		t.Fatalf("expected vv NOT to dominate a vector with a newer timestamp for a known node")
	}

	unknownNode := VersionVector{
		"c": {Wall: 1, Node: "c"},
	}
	if vv.Dominates(unknownNode) {
		t.Fatalf("expected vv NOT to dominate a vector referencing a node it has never observed")
	}

	empty := NewVersionVector()
	if !vv.Dominates(empty) {
		t.Fatalf("expected any vector to dominate the empty vector")
	}
}

func TestVersionVector_Missing(t *testing.T) {
	vv := VersionVector{
		"a": {Wall: 100, Node: "a"},
		"b": {Wall: 200, Node: "b"},
	}
	other := VersionVector{
		"a": {Wall: 100, Node: "a"}, // equal, not missing
		"b": {Wall: 250, Node: "b"}, // other is ahead
		"c": {Wall: 1, Node: "c"},   // vv has never heard of c at all
	}

	got := vv.Missing(other)
	want := []string{"b", "c"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("Missing() = %v, want %v", got, want)
	}
}

func TestVersionVector_MissingEmptyWhenUpToDate(t *testing.T) {
	vv := VersionVector{"a": {Wall: 100, Node: "a"}}
	other := VersionVector{"a": {Wall: 50, Node: "a"}}

	got := vv.Missing(other)
	if len(got) != 0 {
		t.Fatalf("Missing() = %v, want empty (vv is already ahead of other)", got)
	}
}
