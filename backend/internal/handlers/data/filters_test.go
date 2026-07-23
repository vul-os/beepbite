package data

import (
	"net/url"
	"reflect"
	"testing"
)

// isColumnIdent is the identifier gate that keeps attacker-controlled column
// names out of the SQL string. Everything that isn't a bare lowercase
// identifier must be rejected.
func TestIsColumnIdent(t *testing.T) {
	valid := []string{"status", "order_id", "_col", "col123", "a"}
	invalid := []string{
		"", "Status", "1col", "col;drop", "col x", "col-x", "*",
		"col.sub", `col"`, "col'", "col)", "drop table", "col=1",
	}
	for _, s := range valid {
		if !isColumnIdent(s) {
			t.Errorf("isColumnIdent(%q) = false, want true", s)
		}
	}
	for _, s := range invalid {
		if isColumnIdent(s) {
			t.Errorf("isColumnIdent(%q) = true, want false (injection surface)", s)
		}
	}
}

func TestLooksLikeColumnList(t *testing.T) {
	valid := []string{"*", "a", "a,b,c", "order_id,status"}
	invalid := []string{"", "a,*", "a, b", "a;drop", "a,,b", "*,a", "a,DROP"}
	for _, s := range valid {
		if !looksLikeColumnList(s) {
			t.Errorf("looksLikeColumnList(%q) = false, want true", s)
		}
	}
	for _, s := range invalid {
		if looksLikeColumnList(s) {
			t.Errorf("looksLikeColumnList(%q) = true, want false", s)
		}
	}
}

func TestBuildWhere_ScalarFilterIsParameterized(t *testing.T) {
	where, args, err := buildWhere(url.Values{"eq": {"status,pending"}}, 0)
	if err != nil {
		t.Fatal(err)
	}
	if where != `"status" = $1` {
		t.Errorf("where = %q, want \"status\" = $1", where)
	}
	if len(args) != 1 || args[0] != "pending" {
		t.Errorf("args = %#v, want [pending]", args)
	}
}

func TestBuildWhere_MultipleFiltersAreANDed(t *testing.T) {
	// buildWhere processes operators in a fixed order (eq before gt), so this is
	// deterministic despite url.Values being a map.
	where, args, err := buildWhere(url.Values{"eq": {"status,paid"}, "gt": {"total,10"}}, 0)
	if err != nil {
		t.Fatal(err)
	}
	if where != `"status" = $1 AND "total" > $2` {
		t.Errorf("where = %q", where)
	}
	if !reflect.DeepEqual(args, []any{"paid", float64(10)}) {
		t.Errorf("args = %#v, want [paid 10]", args)
	}
}

// A malicious COLUMN name must be rejected outright — never interpolated.
func TestBuildWhere_RejectsColumnInjection(t *testing.T) {
	bad := []url.Values{
		{"eq": {"status;drop,x"}},
		{"eq": {"1=1,x"}},
		{"gt": {"total) OR (1=1,x"}},
		{"in": {"status);drop,a"}},
		{"is": {"col OR 1=1,null"}},
	}
	for _, q := range bad {
		if _, _, err := buildWhere(q, 0); err == nil {
			t.Errorf("buildWhere(%v) = nil error, want rejection", q)
		}
	}
}

// A malicious VALUE must survive only as a bound $N argument, never in the SQL.
func TestBuildWhere_MaliciousValueStaysParameterized(t *testing.T) {
	payload := "' OR 1=1; DROP TABLE orders;--"
	where, args, err := buildWhere(url.Values{"eq": {"status," + payload}}, 0)
	if err != nil {
		t.Fatal(err)
	}
	if where != `"status" = $1` {
		t.Fatalf("where = %q — payload leaked into SQL", where)
	}
	if len(args) != 1 || args[0] != payload {
		t.Errorf("args = %#v, want the payload as a single bound arg", args)
	}
}

func TestBuildWhere_In(t *testing.T) {
	where, args, err := buildWhere(url.Values{"in": {"status,pending,paid"}}, 0)
	if err != nil {
		t.Fatal(err)
	}
	if where != `"status"::text = ANY($1)` {
		t.Errorf("where = %q", where)
	}
	if !reflect.DeepEqual(args, []any{[]string{"pending", "paid"}}) {
		t.Errorf("args = %#v, want [[pending paid]]", args)
	}
}

func TestBuildWhere_Is(t *testing.T) {
	cases := map[string]string{
		"deleted_at,null":     `"deleted_at" IS NULL`,
		"deleted_at,not.null": `"deleted_at" IS NOT NULL`,
		"active,true":         `"active" IS TRUE`,
		"active,false":        `"active" IS FALSE`,
	}
	for in, want := range cases {
		where, args, err := buildWhere(url.Values{"is": {in}}, 0)
		if err != nil {
			t.Fatalf("is=%q: %v", in, err)
		}
		if where != want || len(args) != 0 {
			t.Errorf("is=%q -> %q args=%v, want %q no args", in, where, args, want)
		}
	}
	if _, _, err := buildWhere(url.Values{"is": {"col,garbage"}}, 0); err == nil {
		t.Error("is=col,garbage should be rejected")
	}
}

func TestBuildWhere_OffsetShiftsPlaceholders(t *testing.T) {
	where, _, err := buildWhere(url.Values{"eq": {"status,x"}}, 2)
	if err != nil {
		t.Fatal(err)
	}
	if where != `"status" = $3` {
		t.Errorf("where = %q, want $3 (1 + offset 2)", where)
	}
}

func TestBuildWhere_Empty(t *testing.T) {
	where, args, err := buildWhere(url.Values{}, 0)
	if where != "" || len(args) != 0 || err != nil {
		t.Errorf("empty -> where=%q args=%v err=%v", where, args, err)
	}
}

func TestParseOrder(t *testing.T) {
	cases := map[string][2]string{
		"status.asc":   {"status", "ASC"},
		"status.desc":  {"status", "DESC"},
		"status":       {"status", "ASC"}, // default asc
		"Status.asc":   {"", ""},          // uppercase ident rejected
		"status.up":    {"", ""},          // bad direction
		"col;drop.asc": {"", ""},          // injection rejected
	}
	for raw, want := range cases {
		col, dir := parseOrder(raw)
		if col != want[0] || dir != want[1] {
			t.Errorf("parseOrder(%q) = (%q,%q), want (%q,%q)", raw, col, dir, want[0], want[1])
		}
	}
}

func TestParseScalar(t *testing.T) {
	if got := parseScalar("10"); got != float64(10) {
		t.Errorf("parseScalar(10) = %#v, want float64(10)", got)
	}
	if got := parseScalar("true"); got != true {
		t.Errorf("parseScalar(true) = %#v, want true", got)
	}
	if got := parseScalar("null"); got != nil {
		t.Errorf("parseScalar(null) = %#v, want nil", got)
	}
	if got := parseScalar("hello"); got != "hello" {
		t.Errorf("parseScalar(hello) = %#v, want \"hello\"", got)
	}
	if got := parseScalar(""); got != "" {
		t.Errorf("parseScalar(\"\") = %#v, want \"\"", got)
	}
}

// The table/RPC allowlists are the outer access boundary — only listed names
// are reachable, everything else is closed.
func TestAllowlist(t *testing.T) {
	for _, tbl := range []string{"orders", "customers", "items"} {
		if _, ok := allowed(tbl); !ok {
			t.Errorf("allowed(%q) = false, want true", tbl)
		}
	}
	for _, tbl := range []string{"pg_class", "users", "subscription_tiers", ""} {
		if _, ok := allowed(tbl); ok {
			t.Errorf("allowed(%q) = true, want false (not on the allowlist)", tbl)
		}
	}
	if !rpcAllowed("check_invites") {
		t.Error("rpcAllowed(check_invites) = false, want true")
	}
	for _, fn := range []string{"evil_fn", "pg_sleep", ""} {
		if rpcAllowed(fn) {
			t.Errorf("rpcAllowed(%q) = true, want false", fn)
		}
	}
}
