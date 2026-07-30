package ownership_test

// schema_test.go — the registry against a real migrated Postgres.
//
// A registry of table names is worth exactly as much as its agreement with the
// schema, and nothing keeps them in agreement except a test that fails when
// they diverge. This one fails CLOSED in both directions:
//
//	a table in the schema that the registry has never heard of  -> fail
//	a table in the registry that the schema does not have       -> fail
//	a column named in an entry that the table does not have     -> fail
//	a credential-shaped column on a replicated table            -> fail
//
// The first of those is the important one, and it is the reason this test
// exists rather than a code review checklist. Somebody adding migration 005
// with a new table gets a red build naming their table and telling them to
// decide who owns it — instead of a new table that silently replicates every
// column, or silently replicates none, depending on which default the emit
// path happened to pick.
//
// Run:
//
//	cd backend && go test ./internal/sync/ownership/ -v

import (
	"context"
	"fmt"
	"os"
	"sort"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/cmd/tests/testenv"
	"github.com/beepbite/backend/internal/sync/ownership"
)

var testPool *pgxpool.Pool

func TestMain(m *testing.M) {
	pool, cleanup := testenv.MustStartPostgres(context.Background())
	defer cleanup()
	testPool = pool
	os.Exit(m.Run())
}

// schema maps a table name to its column set.
type schema map[string]map[string]bool

func loadSchema(t *testing.T) schema {
	t.Helper()
	ctx := context.Background()
	rows, err := testPool.Query(ctx, `
SELECT c.table_name, c.column_name
FROM   information_schema.columns c
JOIN   information_schema.tables  t
       ON t.table_schema = c.table_schema AND t.table_name = c.table_name
WHERE  c.table_schema = 'public'
  AND  t.table_type   = 'BASE TABLE'
ORDER  BY c.table_name, c.column_name
`)
	if err != nil {
		t.Fatalf("read information_schema: %v", err)
	}
	defer rows.Close()

	out := make(schema)
	for rows.Next() {
		var table, column string
		if err := rows.Scan(&table, &column); err != nil {
			t.Fatalf("scan: %v", err)
		}
		if out[table] == nil {
			out[table] = make(map[string]bool)
		}
		out[table][column] = true
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("rows: %v", err)
	}
	if len(out) == 0 {
		t.Fatal("information_schema returned no public base tables — the migrations did not apply, " +
			"and every assertion below would pass vacuously")
	}
	return out
}

// schemaMigrations is Postgres-side bookkeeping created by the migration
// runner rather than by a migration, so it is not shop data and has no owner.
// It is the one name excluded from the totality check, and it is excluded here,
// in the test, rather than smuggled into the registry as a Local entry that
// would look like a decision somebody made.
var notShopData = map[string]bool{
	"schema_migrations": true,
}

// TestRegistryCoversTheSchema is the fail-closed gate. Every base table in
// public is classified, and every classification names a table that exists.
func TestRegistryCoversTheSchema(t *testing.T) {
	sch := loadSchema(t)

	var unclassified []string
	for table := range sch {
		if notShopData[table] {
			continue
		}
		if _, ok := ownership.Lookup(table); !ok {
			unclassified = append(unclassified, table)
		}
	}
	sort.Strings(unclassified)
	if len(unclassified) > 0 {
		t.Errorf(`%d table(s) exist in the schema and are not in internal/sync/ownership/tables.go:

    %s

Add an entry for each. The decision is: does this table have exactly one writer
(Branch), is it edited centrally and read everywhere (Group), is it a fact that
happened and is summed at read time (Ledger), or does it never leave this node
(Local)? Write down which, and why. A table with no entry cannot be emitted and
cannot be knowingly skipped either, which is why this fails rather than
defaults.`,
			len(unclassified), strings.Join(unclassified, "\n    "))
	}

	var stale []string
	for _, name := range ownership.Names() {
		if _, ok := sch[name]; !ok {
			stale = append(stale, name)
		}
	}
	sort.Strings(stale)
	if len(stale) > 0 {
		t.Errorf("%d registry entries name tables that no longer exist: %s",
			len(stale), strings.Join(stale, ", "))
	}

	t.Logf("registry covers %d tables: %d local, %d branch-owned, %d group-owned, %d ledgers",
		len(ownership.Names()),
		len(ownership.OfClass(ownership.Local)),
		len(ownership.OfClass(ownership.Branch)),
		len(ownership.OfClass(ownership.Group)),
		len(ownership.OfClass(ownership.Ledger)))
}

// TestEveryNamedColumnExists catches the other half of the rot: an entry that
// still names a column a later migration renamed or dropped. A Group column
// that does not exist would address every ledger member at "table/", and a
// Derived column that does not exist would suppress nothing while looking like
// it suppressed a counter.
func TestEveryNamedColumnExists(t *testing.T) {
	sch := loadSchema(t)

	check := func(table, role, column string) {
		if column == "" {
			return
		}
		cols, ok := sch[table]
		if !ok {
			return // reported by TestRegistryCoversTheSchema
		}
		if !cols[column] {
			t.Errorf("%s: %s column %q does not exist on that table", table, role, column)
		}
	}

	for _, name := range ownership.Names() {
		tbl, _ := ownership.Lookup(name)
		if !tbl.Class.Replicated() {
			continue
		}
		check(name, "key", tbl.Key)
		check(name, "owning-branch", tbl.Owner)
		check(name, "grouping", tbl.Group)
		check(name, "quantity", tbl.Qty)
		for col := range tbl.Derived {
			check(name, "derived", col)
		}
		for _, col := range tbl.Secret {
			check(name, "secret", col)
		}
		for col := range tbl.Exclude {
			check(name, "excluded", col)
		}
	}
}

// TestLedgerQuantityColumnsAreIntegers is non-negotiable rule 3 — money is
// minor units, never floats — checked where it is easy to break. A ledger
// whose Qty is a double precision column would make SUM(qty) a floating-point
// sum, and a shop's cash position computed by adding IEEE-754 values across a
// partition is a shop that reconciles to within a cent and not to the cent.
//
// numeric is allowed alongside the integer types: Postgres numeric is exact,
// and the two quantity columns that use it (stock_movements.quantity,
// tip_distributions.hours_worked) measure ingredients and hours rather than
// money.
func TestLedgerQuantityColumnsAreExact(t *testing.T) {
	ctx := context.Background()
	for _, tbl := range ownership.OfClass(ownership.Ledger) {
		if tbl.Qty == "" {
			continue
		}
		var dataType string
		err := testPool.QueryRow(ctx, `
SELECT data_type FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
`, tbl.Name, tbl.Qty).Scan(&dataType)
		if err != nil {
			t.Errorf("%s.%s: %v", tbl.Name, tbl.Qty, err)
			continue
		}
		switch dataType {
		case "smallint", "integer", "bigint", "numeric":
		default:
			t.Errorf("%s.%s is %s; a ledger quantity that is summed at read time must be an exact "+
				"type, and money must be minor units", tbl.Name, tbl.Qty, dataType)
		}
	}
}

// TestNoMoneyColumnIsAFloat is non-negotiable rule 3 — money is minor units,
// never floats — checked in the only place it can actually be broken.
//
// internal/sync/emit CAN encode a float, because this schema has five genuine
// floating-point columns and all five are GPS. So the guard cannot live in the
// encoder without refusing the driver trail along with the money. It lives
// here instead, against the schema, where a money-shaped column of a floating
// type is the actual mistake: once one exists, every SUM over it — including
// the read-time SUM a ledger's whole model rests on — is a floating-point sum,
// and a drawer that reconciles to within a cent is a drawer that does not
// reconcile.
func TestNoMoneyColumnIsAFloat(t *testing.T) {
	moneyish := []string{"cents", "amount", "price", "total", "subtotal", "fee", "cost", "balance", "tax"}
	ctx := context.Background()

	rows, err := testPool.Query(ctx, `
SELECT table_name, column_name, data_type
FROM   information_schema.columns
WHERE  table_schema = 'public' AND data_type IN ('double precision', 'real')
ORDER  BY table_name, column_name
`)
	if err != nil {
		t.Fatalf("query float columns: %v", err)
	}
	defer rows.Close()

	var checked int
	for rows.Next() {
		var table, column, dataType string
		if err := rows.Scan(&table, &column, &dataType); err != nil {
			t.Fatalf("scan: %v", err)
		}
		tbl, ok := ownership.Lookup(table)
		if !ok || !tbl.Class.Replicated() || !tbl.Emits(column) {
			continue
		}
		checked++
		for _, m := range moneyish {
			if strings.Contains(column, m) {
				t.Errorf("%s.%s is %s and looks like money. Money is minor units in an integer "+
					"column, never a float: a SUM over a floating column does not reconcile to "+
					"the cent, and every quantity in this product is a SUM over a ledger.",
					table, column, dataType)
			}
		}
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("rows: %v", err)
	}
	t.Logf("checked %d replicated floating-point columns (the GPS trail is the intended set)", checked)
}

// sensitivePatterns are the substrings that mark a column as credential
// material. A column matching one of these on a REPLICATED table must be listed
// in that table's Secret, or the table must be Local.
//
// The list is deliberately broad and the check is deliberately annoying,
// because the failure it prevents is the quiet one: a migration adds
// staff.recovery_secret, nobody thinks about replication, and from that release
// onward every branch ships every other branch a credential. The cost of a
// false positive is one line in Secret with a reason; the cost of a false
// negative is unbounded.
var sensitivePatterns = []string{
	"password", "passwd", "secret", "ciphertext", "encrypted", "totp",
	"_hash", "hash_", "private_key", "signing", "credential",
}

func TestNoCredentialColumnReplicates(t *testing.T) {
	sch := loadSchema(t)

	for _, name := range ownership.Names() {
		tbl, _ := ownership.Lookup(name)
		if !tbl.Class.Replicated() {
			continue
		}
		cols := make([]string, 0, len(sch[name]))
		for c := range sch[name] {
			cols = append(cols, c)
		}
		sort.Strings(cols)

		for _, col := range cols {
			if !looksSensitive(col) || !tbl.Emits(col) {
				continue
			}
			t.Errorf(`%s.%s looks like credential material and IS EMITTED by a %s table.

Stop emitting it: list it in that table's Secret if it is the material itself,
in Exclude with a reason if it is a flag or timestamp that merely sits beside
the material, or make the whole table Local. Replication has to be safe on the
open internet, and a hash on the wire is a hash to attack offline.`,
				name, col, tbl.Class)
		}
	}
}

func looksSensitive(column string) bool {
	for _, p := range sensitivePatterns {
		if strings.Contains(column, p) {
			return true
		}
	}
	return false
}

// TestDeletedFieldCollidesWithNoColumn. A delete is an ordinary last-writer-wins
// write to a reserved register field (there is no §4.5 death certificate in
// this mapping — see internal/sync/substrate). If a replicated table ever grew
// a column with that name, the column's register and the tombstone would be the
// same address, and writing one would silently resurrect or bury the row.
func TestDeletedFieldCollidesWithNoColumn(t *testing.T) {
	sch := loadSchema(t)
	for _, name := range ownership.Names() {
		tbl, _ := ownership.Lookup(name)
		if !tbl.Class.Replicated() {
			continue
		}
		if sch[name][ownership.DeletedField] {
			t.Errorf("%s has a column named %q, which is the reserved tombstone field",
				name, ownership.DeletedField)
		}
	}
}

// TestSuppressionIsReported prints the full set of columns that do not
// replicate, so a reviewer can read the consequence of the registry rather than
// reconstruct it. It asserts only that the set is non-empty — the individual
// entries are argued for in tables.go — but a run of this suite leaves the list
// in the log, which is where somebody arguing about a specific column will look.
func TestSuppressionIsReported(t *testing.T) {
	var lines []string
	for _, name := range ownership.Names() {
		tbl, _ := ownership.Lookup(name)
		sup := tbl.Suppressed()
		for _, col := range sortedKeys(sup) {
			lines = append(lines, fmt.Sprintf("  %s.%s — %s", name, col, sup[col]))
		}
	}
	if len(lines) == 0 {
		t.Fatal("no column anywhere is suppressed; the stored counters and credential columns " +
			"in this schema have not gone away, so this means the registry stopped describing them")
	}
	t.Logf("columns that never leave this node (%d):\n%s", len(lines), strings.Join(lines, "\n"))
}

func sortedKeys(m map[string]string) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}
