package data

import (
	"context"
	"regexp"
	"strings"
	"testing"
)

// Every function on the RPC allowlist (allRPCs) must have a matching buildRPC
// case, and each case's placeholder count ($1..$n) must equal the number of
// args it picks. If the two drift, an allowlisted POST /api/v1/rpc/{fn} call
// either 500s with "unknown rpc" or fails at query time with a Postgres
// argument-count error.
func TestBuildRPC_CoversAllowlistWithMatchingArity(t *testing.T) {
	phRx := regexp.MustCompile(`\$\d+`)
	for fn := range allRPCs {
		sql, args, err := buildRPC(context.Background(), fn, map[string]any{})
		if err != nil {
			t.Errorf("allowlisted rpc %q has no buildRPC case: %v", fn, err)
			continue
		}
		distinct := map[string]struct{}{}
		for _, m := range phRx.FindAllString(sql, -1) {
			distinct[m] = struct{}{}
		}
		if len(distinct) != len(args) {
			t.Errorf("rpc %q: %d distinct placeholders but %d args (%q)", fn, len(distinct), len(args), sql)
		}
		if !strings.HasPrefix(sql, "SELECT * FROM "+fn+"(") {
			t.Errorf("rpc %q: SQL does not call the named function: %q", fn, sql)
		}
	}
}

func TestBuildRPC_UnknownFnErrors(t *testing.T) {
	for _, fn := range []string{"definitely_not_an_rpc", "", "orders; DROP TABLE users", "pg_sleep"} {
		if _, _, err := buildRPC(context.Background(), fn, nil); err == nil {
			t.Errorf("buildRPC accepted a non-allowlisted fn %q", fn)
		}
	}
}

// Args are picked from the body by fixed key names, in order; the SQL is a
// constant per function (no body value is ever interpolated into it).
func TestBuildRPC_ArgsPickedByKeyInOrder(t *testing.T) {
	sql, args, err := buildRPC(context.Background(), "respond_invitation", map[string]any{
		"p_user_id":   "u1",
		"p_invite_id": "i1",
		"p_accept":    true,
		"ignored":     "should not appear",
	})
	if err != nil {
		t.Fatal(err)
	}
	if sql != "SELECT * FROM respond_invitation($1, $2, $3)" {
		t.Errorf("sql = %q", sql)
	}
	if len(args) != 3 || args[0] != "u1" || args[1] != "i1" || args[2] != true {
		t.Errorf("args = %#v, want [u1 i1 true]", args)
	}

	// A missing key yields a nil arg (not an error) — the DB function validates.
	_, args2, err := buildRPC(context.Background(), "check_invites", map[string]any{})
	if err != nil {
		t.Fatal(err)
	}
	if len(args2) != 1 || args2[0] != nil {
		t.Errorf("missing key should yield [<nil>], got %#v", args2)
	}
}
