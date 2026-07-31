// Package data exposes a small PostgREST-like REST layer the frontend uses in
// place of supabase-js. The surface is intentionally narrow (see allowlist.go)
// and every request requires an authenticated user — authorization over
// organization/location scoping is expected to be done by the caller (the
// frontend) via explicit filter predicates on the relevant columns.
package data

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/internal/auth"
	"github.com/beepbite/backend/internal/db"
	"github.com/beepbite/backend/internal/sync/emit"
)

// formatUUIDBytes renders pgx's default uuid representation ([16]byte) as the
// canonical 8-4-4-4-12 hyphenated hex string. Without this, JSON marshalling
// emits `[91, 142, ...]` integer arrays — which the frontend then can't use
// as a UUID in follow-up inserts (e.g. organization_id in locations).
func formatUUIDBytes(b [16]byte) string {
	h := hex.EncodeToString(b[:]) // 32 chars
	var dst [36]byte
	copy(dst[0:8], h[0:8])
	dst[8] = '-'
	copy(dst[9:13], h[8:12])
	dst[13] = '-'
	copy(dst[14:18], h[12:16])
	dst[18] = '-'
	copy(dst[19:23], h[16:20])
	dst[23] = '-'
	copy(dst[24:36], h[20:32])
	return string(dst[:])
}

// entityIDFromRow extracts the "id" field (as a string) from the first
// returned row. Used to populate audit_log.entity_id. Returns "" when the
// row has no "id" key or the value is not a string/fmt.Stringer.
func entityIDFromRow(rows []map[string]any) string {
	if len(rows) == 0 {
		return ""
	}
	v, ok := rows[0]["id"]
	if !ok || v == nil {
		return ""
	}
	switch s := v.(type) {
	case string:
		return s
	case fmt.Stringer:
		return s.String()
	default:
		return fmt.Sprintf("%v", v)
	}
}

type Handler struct {
	pool *pgxpool.Pool

	// emitter turns the rows this layer writes into replication operations,
	// inside the same transaction as the write. It is nil unless a deployment
	// has configured multi-branch sync, and a nil *emit.Emitter runs every
	// transaction exactly as it ran before this field existed.
	//
	// Nil is also what keeps the engine out of the server binary: reaching
	// internal/sync/substrate requires constructing an internal/sync/opsink
	// Sink, and nothing in cmd/server's graph does. See
	// internal/sync/emit/wiring_test.go, which fails if that stops being true.
	emitter *emit.Emitter
}

func NewHandler(pool *pgxpool.Pool) *Handler { return &Handler{pool: pool} }

// WithEmitter returns a copy of h that replicates the rows it writes.
//
// It is a copy rather than a setter so that a handler already mounted on a
// router cannot acquire replication halfway through its life — a request that
// wrote without emitting and a request that emitted are two different
// behaviours, and which one a given write got should not depend on when it
// arrived.
func (h *Handler) WithEmitter(e *emit.Emitter) *Handler {
	out := *h
	out.emitter = e
	return &out
}

func (h *Handler) Mount(r chi.Router) {
	r.Route("/data/{table}", func(r chi.Router) {
		r.Get("/", h.list)
		r.Post("/", h.insert)
		r.Patch("/", h.update)
		r.Delete("/", h.delete)
	})
	r.Post("/rpc/{fn}", h.rpc)
}

// ---- list (GET /data/:table) ----
//
// Query params mirror supabase-js shape:
//
//	select=col1,col2,...            columns to return (default *)
//	eq=col,val                      repeat for multiple equality filters
//	neq=col,val, gt=col,val, gte=, lt=, lte=, like=, ilike=
//	in=col,v1,v2,...                repeat; treated as col IN (…)
//	is=col,null|true|false          null/bool IS filter
//	order=col.asc or col.desc       repeat for multi-sort
//	limit=N
//	single=true                     return one object (404 if no rows)
//	count=exact                     include {count} header

// reportViews is the set of aggregate / analytics views that require the
// can_view_reports capability. Plain transactional tables are not gated here.
var reportViews = map[string]struct{}{
	"daily_sales_summary":        {},
	"hourly_sales_heatmap":       {},
	"menu_engineering":           {},
	"labor_hours_daily":          {},
	"theoretical_vs_actual_cogs": {},
	"revenue_by_payment_method":  {},
}

// sensitiveColumns lists columns that must never leave this generic REST
// layer, in either the HTTP response or the sync/webhook emitter, even
// though the table itself is otherwise selectable/insertable/updatable.
//
// staff.pin_hash and staff.password_hash are bcrypt hashes of the POS PIN
// and portal password. The frontend never renders or edits them directly,
// but nothing enforced that at the API: the "staff" table carries only the
// blanket Select/Insert/Update/Delete allowlist entry (allowlist.go) with no
// capability gate and no column allowlist, so any authenticated org member —
// down to a bare cashier account with no capabilities — could call
// GET /data/staff (or GET /data/staff?select=id,pin_hash,password_hash) and
// recover bcrypt hashes for every staff member in the org, including
// managers/owners. POS PINs are 4-6 digit numeric, so bcrypt cost 10 is a
// small offline search — a straightforward privilege-escalation path from a
// low-privilege session to a manager's PIN. Redact instead of relying on a
// capability check because the UI has no legitimate use for these values at
// all, from any role.
var sensitiveColumns = map[string]map[string]struct{}{
	"staff": {"pin_hash": {}, "password_hash": {}},
}

// credentialWriteColumns lists per-table columns that must never be settable
// through the generic POST/PATCH REST layer, because a dedicated,
// capability-gated endpoint exists to mutate them (internal/staffauth's
// managerSetPIN / managerSetPassword / setPassword) and it bcrypt-hashes the
// caller's PIN/password server-side, restricted to org owner/manager roles.
// /data has no per-table capability gate (see package doc) — without this
// block, any authenticated org member, including a bare cashier account
// with zero capabilities, could POST/PATCH /data/staff with a
// self-chosen pin_hash/password_hash value (a hash of a PIN/password they
// already know the plaintext of) and silently take over — or create — any
// staff credential in the org, bypassing managerSetPIN's authorization
// entirely.
var credentialWriteColumns = map[string][]string{
	"staff": {"pin_hash", "password_hash"},
}

// rejectCredentialColumn writes a 403 and returns true if any column in
// credentialWriteColumns[table] is present in keys.
func rejectCredentialColumn(w http.ResponseWriter, table string, has func(col string) bool) bool {
	for _, col := range credentialWriteColumns[table] {
		if has(col) {
			writeErr(w, http.StatusForbidden, "column "+col+" cannot be set via this endpoint")
			return true
		}
	}
	return false
}

// redactSensitive deletes columns listed in sensitiveColumns[table] from
// every row, in place. A no-op for tables with no entry. Applied to
// SELECT/INSERT/UPDATE results before they reach either the HTTP response
// or the sync/webhook emitter (record), so a hash can't leak through
// select=*, an explicit select=pin_hash, or an INSERT/UPDATE ... RETURNING *
// echo.
func redactSensitive(table string, rows []map[string]any) {
	deny, ok := sensitiveColumns[table]
	if !ok {
		return
	}
	for _, row := range rows {
		for col := range deny {
			delete(row, col)
		}
	}
}

// tablesWithOrgID is the set of tables that have an organization_id column.
// When a caller omits organization_id from an INSERT payload and the request
// scope has a resolved OrgID, the handler auto-injects it so that RLS INSERT
// WITH CHECK (organization_id = current_org_id()) passes without requiring the
// frontend to echo back the org ID on every request.
//
// ONLY tables in this set get the injection — tables without the column are
// unaffected. Derived from inspecting the CREATE TABLE DDL in the migration
// files (look for: organization_id uuid NOT NULL REFERENCES organizations(id)).
var tablesWithOrgID = map[string]struct{}{
	"allergens":            {},
	"bank_accounts":        {},
	"categories":           {},
	"customers":            {},
	"dietary_tags":         {},
	"gift_cards":           {},
	"house_accounts":       {},
	"locations":            {},
	"loyalty_config":       {},
	"orders":               {},
	"organization_invites": {},
	"organization_members": {},
	"payout_schedules":     {},
	"promotions":           {},
	"suppliers":            {},
}

func (h *Handler) list(w http.ResponseWriter, r *http.Request) {
	table := chi.URLParam(r, "table")
	ops, ok := allowed(table)
	if !ok || !ops.Select {
		writeErr(w, http.StatusNotFound, "table not exposed")
		return
	}

	// Semicolon guard: Go 1.17+ silently returns an empty url.Values when the
	// raw query string contains a semicolon (it treats it as a parse error).
	// An attacker can exploit this to smuggle filter bypass payloads like
	// ?eq=id';DROP TABLE items;--,x that produce no WHERE predicate. Reject
	// any request whose raw query contains a semicolon before parsing.
	if strings.Contains(r.URL.RawQuery, ";") {
		writeErr(w, http.StatusBadRequest, "invalid query string")
		return
	}

	// Report views require can_view_reports.
	if _, isReport := reportViews[table]; isReport {
		if !auth.HasCapability(r.Context(), "can_view_reports") {
			writeErr(w, http.StatusForbidden, "missing capability: can_view_reports")
			return
		}
	}

	q := r.URL.Query()
	cols := q.Get("select")
	if cols == "" {
		cols = "*"
	}
	// supabase-js style clients send the select list with spaces after commas
	// ("id, order_number, status"). Normalise by trimming each column before
	// validating, so the spacing doesn't trip the strict ident regex. Each
	// trimmed token must still be a bare column ident (SQL-injection guard).
	if cols != "*" {
		rawCols := strings.Split(cols, ",")
		trimmed := make([]string, 0, len(rawCols))
		for _, c := range rawCols {
			c = strings.TrimSpace(c)
			if !isColumnIdent(c) {
				writeErr(w, http.StatusBadRequest, "invalid select")
				return
			}
			trimmed = append(trimmed, c)
		}
		cols = strings.Join(trimmed, ", ")
	}

	sb := &strings.Builder{}
	fmt.Fprintf(sb, "SELECT %s FROM %s", cols, quoteIdent(table))

	where, args, err := buildWhere(q, 0)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if where != "" {
		sb.WriteString(" WHERE ")
		sb.WriteString(where)
	}

	orderClauses := q["order"]
	if len(orderClauses) > 0 {
		sb.WriteString(" ORDER BY ")
		for i, ord := range orderClauses {
			col, dir := parseOrder(ord)
			if col == "" {
				writeErr(w, http.StatusBadRequest, "invalid order")
				return
			}
			if i > 0 {
				sb.WriteString(", ")
			}
			fmt.Fprintf(sb, "%s %s", quoteIdent(col), dir)
		}
	}

	if l := q.Get("limit"); l != "" {
		n, err := strconv.Atoi(l)
		if err != nil || n < 0 {
			writeErr(w, http.StatusBadRequest, "invalid limit")
			return
		}
		fmt.Fprintf(sb, " LIMIT %d", n)
	}

	var out []map[string]any
	err = h.runScoped(r.Context(), r, func(tx pgx.Tx) error {
		rows, qerr := tx.Query(r.Context(), sb.String(), args...)
		if qerr != nil {
			return qerr
		}
		defer rows.Close()
		out, qerr = rowsToMaps(rows)
		return qerr
	})
	if err != nil {
		log.Printf("data list %s: %v", table, err)
		writeErr(w, http.StatusBadRequest, "request could not be completed")
		return
	}
	redactSensitive(table, out)

	if q.Get("single") == "true" {
		if len(out) == 0 {
			writeErr(w, http.StatusNotFound, "no rows")
			return
		}
		writeJSON(w, http.StatusOK, out[0])
		return
	}
	writeJSON(w, http.StatusOK, out)
}

// ---- insert (POST /data/:table) ----
//
// Body: single object OR array of objects.
// Returns the inserted row(s).

func (h *Handler) insert(w http.ResponseWriter, r *http.Request) {
	table := chi.URLParam(r, "table")
	ops, ok := allowed(table)
	if !ok || !ops.Insert {
		writeErr(w, http.StatusNotFound, "insert not allowed")
		return
	}

	rows, err := decodeRows(r)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if len(rows) == 0 {
		writeErr(w, http.StatusBadRequest, "empty body")
		return
	}
	for _, row := range rows {
		if rejectCredentialColumn(w, table, func(col string) bool { _, found := row[col]; return found }) {
			return
		}
	}

	// Auto-inject organization_id when the table has that column and the
	// caller omitted it. The scope's OrgID is set by RequireOrgScope
	// middleware (via db.ScopeFromContext). Skip injection when OrgID is
	// empty (fresh-signup / onboarding path creating the first org).
	if _, needsOrg := tablesWithOrgID[table]; needsOrg {
		scope := db.ScopeFromContext(r.Context())
		if scope.OrgID != "" {
			for _, row := range rows {
				if _, already := row["organization_id"]; !already {
					row["organization_id"] = scope.OrgID
				}
			}
		}
	}

	cols := collectCols(rows)
	sb := &strings.Builder{}
	fmt.Fprintf(sb, "INSERT INTO %s (", quoteIdent(table))
	for i, c := range cols {
		if i > 0 {
			sb.WriteString(", ")
		}
		sb.WriteString(quoteIdent(c))
	}
	sb.WriteString(") VALUES ")
	args := []any{}
	for i, row := range rows {
		if i > 0 {
			sb.WriteString(", ")
		}
		sb.WriteString("(")
		for j, c := range cols {
			if j > 0 {
				sb.WriteString(", ")
			}
			args = append(args, row[c])
			fmt.Fprintf(sb, "$%d", len(args))
		}
		sb.WriteString(")")
	}
	sb.WriteString(" RETURNING *")

	ctx := r.Context()
	var out []map[string]any
	if err := h.runScopedEmitting(ctx, r, func(tx pgx.Tx, rec *emit.Recorder) error {
		dbRows, qerr := tx.Query(ctx, sb.String(), args...)
		if qerr != nil {
			return qerr
		}
		out, qerr = rowsToMaps(dbRows)
		dbRows.Close()
		if qerr != nil {
			return qerr
		}
		redactSensitive(table, out)
		// An insert asserts the whole row, so no column list.
		record(rec, table, emit.Insert, out, nil)
		return auditMutation(ctx, tx, table, opInsert, entityIDFromRow(out), nil, nil)
	}); err != nil {
		log.Printf("data insert %s: %v", table, err)
		writeErr(w, http.StatusBadRequest, "request could not be completed")
		return
	}
	writeJSON(w, http.StatusCreated, out)
}

// ---- update (PATCH /data/:table?eq=…) ----

func (h *Handler) update(w http.ResponseWriter, r *http.Request) {
	table := chi.URLParam(r, "table")
	ops, ok := allowed(table)
	if !ok || !ops.Update {
		writeErr(w, http.StatusNotFound, "update not allowed")
		return
	}

	if strings.Contains(r.URL.RawQuery, ";") {
		writeErr(w, http.StatusBadRequest, "invalid query string")
		return
	}

	var changes map[string]any
	if err := json.NewDecoder(r.Body).Decode(&changes); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid body")
		return
	}
	if len(changes) == 0 {
		writeErr(w, http.StatusBadRequest, "empty body")
		return
	}

	// Block subscription_tier (and related billing/plan columns) from being
	// mutated via the generic data layer. A free-tier tenant must not be able
	// to self-upgrade by PATCHing organizations with subscription_tier=pro.
	// Legitimate plan changes go through the admin/billing flow only.
	if table == "organizations" {
		blockedCols := []string{"subscription_tier", "subscription_plan_id", "billing_status", "trial_ends_at"}
		for _, col := range blockedCols {
			if _, found := changes[col]; found {
				writeErr(w, http.StatusForbidden, "subscription tier cannot be changed via this endpoint")
				return
			}
		}
	}
	if rejectCredentialColumn(w, table, func(col string) bool { _, found := changes[col]; return found }) {
		return
	}

	where, whereArgs, err := buildWhere(r.URL.Query(), 0)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if where == "" {
		writeErr(w, http.StatusBadRequest, "update requires at least one filter")
		return
	}

	sb := &strings.Builder{}
	fmt.Fprintf(sb, "UPDATE %s SET ", quoteIdent(table))
	args := []any{}
	first := true
	for col, v := range changes {
		if !isColumnIdent(col) {
			writeErr(w, http.StatusBadRequest, "invalid column: "+col)
			return
		}
		if !first {
			sb.WriteString(", ")
		}
		first = false
		args = append(args, v)
		fmt.Fprintf(sb, "%s = $%d", quoteIdent(col), len(args))
	}
	// Bump $N placeholders in the WHERE clause past the SET args.
	whereShifted := shiftPlaceholders(where, len(args))
	args = append(args, whereArgs...)
	sb.WriteString(" WHERE ")
	sb.WriteString(whereShifted)
	sb.WriteString(" RETURNING *")

	ctx := r.Context()
	var out []map[string]any
	if err := h.runScopedEmitting(ctx, r, func(tx pgx.Tx, rec *emit.Recorder) error {
		rows, qerr := tx.Query(ctx, sb.String(), args...)
		if qerr != nil {
			return qerr
		}
		out, qerr = rowsToMaps(rows)
		rows.Close()
		if qerr != nil {
			return qerr
		}
		redactSensitive(table, out)
		// Only the columns this PATCH named. The values come from the returned
		// row rather than from the request body, so a default, a cast or a
		// trigger is what gets replicated rather than what was asked for.
		record(rec, table, emit.Update, out, keysOf(changes))
		return auditMutation(ctx, tx, table, opUpdate, entityIDFromRow(out), nil, changes)
	}); err != nil {
		log.Printf("data update %s: %v", table, err)
		writeErr(w, http.StatusBadRequest, "request could not be completed")
		return
	}
	writeJSON(w, http.StatusOK, out)
}

// ---- delete (DELETE /data/:table?eq=…) ----

func (h *Handler) delete(w http.ResponseWriter, r *http.Request) {
	table := chi.URLParam(r, "table")
	ops, ok := allowed(table)
	if !ok || !ops.Delete {
		writeErr(w, http.StatusNotFound, "delete not allowed")
		return
	}

	if strings.Contains(r.URL.RawQuery, ";") {
		writeErr(w, http.StatusBadRequest, "invalid query string")
		return
	}

	where, args, err := buildWhere(r.URL.Query(), 0)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if where == "" {
		writeErr(w, http.StatusBadRequest, "delete requires at least one filter")
		return
	}
	ctx := r.Context()

	// Use RETURNING * so we can capture the entity ID for the audit row.
	deleteSql := fmt.Sprintf("DELETE FROM %s WHERE %s RETURNING *", quoteIdent(table), where)

	if err := h.runScopedEmitting(ctx, r, func(tx pgx.Tx, rec *emit.Recorder) error {
		delRows, qerr := tx.Query(ctx, deleteSql, args...)
		if qerr != nil {
			return qerr
		}
		deleted, qerr := rowsToMaps(delRows)
		delRows.Close()
		if qerr != nil {
			return qerr
		}
		// A delete asserts only that the row is gone: one last-writer-wins
		// write to the reserved tombstone field, addressed by the key. No
		// column list, because a deleted row's other columns are not a claim
		// anybody should be replicating.
		record(rec, table, emit.Delete, deleted, []string{})
		return auditMutation(ctx, tx, table, opDelete, entityIDFromRow(deleted), nil, nil)
	}); err != nil {
		log.Printf("data delete %s: %v", table, err)
		writeErr(w, http.StatusBadRequest, "request could not be completed")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ---- rpc (POST /rpc/:fn) ----
//
// Body is the JSON object of named args. We dispatch to a hand-written switch
// per function so argument order is explicit — there's no way to infer it
// safely from the DB alone.

func (h *Handler) rpc(w http.ResponseWriter, r *http.Request) {
	fn := chi.URLParam(r, "fn")
	if !rpcAllowed(fn) {
		writeErr(w, http.StatusNotFound, "rpc not exposed")
		return
	}

	var body map[string]any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil && !errors.Is(err, http.ErrBodyReadAfterClose) {
		// empty body is fine; treat as no args
		body = map[string]any{}
	}

	sql, args, err := buildRPC(r.Context(), fn, body)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}

	var out []map[string]any
	if err := h.runScoped(r.Context(), r, func(tx pgx.Tx) error {
		rows, qerr := tx.Query(r.Context(), sql, args...)
		if qerr != nil {
			return qerr
		}
		defer rows.Close()
		out, qerr = rowsToMaps(rows)
		return qerr
	}); err != nil {
		log.Printf("data rpc %s: %v", fn, err)
		writeErr(w, http.StatusBadRequest, "request could not be completed")
		return
	}
	// Scalar single-column RETURNS → unwrap.
	if len(out) == 1 && len(out[0]) == 1 {
		for _, v := range out[0] {
			writeJSON(w, http.StatusOK, v)
			return
		}
	}
	writeJSON(w, http.StatusOK, out)
}

func buildRPC(_ context.Context, fn string, body map[string]any) (string, []any, error) {
	pick := func(keys ...string) []any {
		out := make([]any, 0, len(keys))
		for _, k := range keys {
			out = append(out, body[k])
		}
		return out
	}
	switch fn {
	case "check_invites":
		return "SELECT * FROM check_invites($1)", pick("p_user_id"), nil
	case "respond_invitation":
		return "SELECT * FROM respond_invitation($1, $2, $3)", pick("p_user_id", "p_invite_id", "p_accept"), nil
	case "send_invitation":
		return "SELECT * FROM send_invitation($1, $2, $3, $4)", pick("p_user_id", "p_organization_id", "p_email", "p_role"), nil
	case "cancel_invitation":
		return "SELECT * FROM cancel_invitation($1, $2)", pick("p_user_id", "p_invite_id"), nil
	case "list_organization_invitations":
		return "SELECT * FROM list_organization_invitations($1, $2)", pick("p_user_id", "p_organization_id"), nil
	case "calculate_recipe_cost":
		return "SELECT * FROM calculate_recipe_cost($1)", pick("item_uuid"), nil
	case "update_recipe_metadata":
		return "SELECT * FROM update_recipe_metadata($1)", pick("item_uuid"), nil
	case "lookup_customer_details":
		return "SELECT * FROM lookup_customer_details($1)", pick("input_whatsapp_number"), nil
	}
	return "", nil, fmt.Errorf("unknown rpc: %s", fn)
}

// ---- helpers ----

func decodeRows(r *http.Request) ([]map[string]any, error) {
	// Accept object or array of objects.
	raw, err := readAll(r)
	if err != nil {
		return nil, err
	}
	var one map[string]any
	if err := json.Unmarshal(raw, &one); err == nil {
		return []map[string]any{one}, nil
	}
	var many []map[string]any
	if err := json.Unmarshal(raw, &many); err == nil {
		return many, nil
	}
	return nil, errors.New("body must be a JSON object or array of objects")
}

func readAll(r *http.Request) ([]byte, error) {
	dec := json.NewDecoder(r.Body)
	dec.UseNumber()
	var v json.RawMessage
	if err := dec.Decode(&v); err != nil {
		return nil, err
	}
	return v, nil
}

func collectCols(rows []map[string]any) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, r := range rows {
		for k := range r {
			if !seen[k] {
				seen[k] = true
				out = append(out, k)
			}
		}
	}
	return out
}

// formatPgTime renders a `time without time zone` value (pgx pgtype.Time,
// microseconds since midnight) as "HH:MM:SS". Returns nil when NULL.
func formatPgTime(t pgtype.Time) any {
	if !t.Valid {
		return nil
	}
	totalSec := t.Microseconds / 1_000_000
	h := totalSec / 3600
	m := (totalSec % 3600) / 60
	s := totalSec % 60
	return fmt.Sprintf("%02d:%02d:%02d", h, m, s)
}

// formatPgInterval renders an interval as an ISO-8601-ish duration string.
// Returns nil when NULL.
func formatPgInterval(iv pgtype.Interval) any {
	if !iv.Valid {
		return nil
	}
	totalSec := iv.Microseconds / 1_000_000
	h := totalSec / 3600
	m := (totalSec % 3600) / 60
	s := totalSec % 60
	return fmt.Sprintf("%dmo %dd %02d:%02d:%02d", iv.Months, iv.Days, h, m, s)
}

func rowsToMaps(rows pgx.Rows) ([]map[string]any, error) {
	fields := rows.FieldDescriptions()
	out := []map[string]any{}
	for rows.Next() {
		vals, err := rows.Values()
		if err != nil {
			return nil, err
		}
		m := make(map[string]any, len(fields))
		for i, f := range fields {
			switch v := vals[i].(type) {
			case [16]byte:
				m[string(f.Name)] = formatUUIDBytes(v)
			case pgtype.Time:
				// `time without time zone` has no native Go type, so pgx returns
				// the pgtype.Time struct — which JSON-marshals as
				// {"Microseconds":...,"Valid":true} and breaks the frontend
				// (e.g. menu_schedule_slots start/end times). Render "HH:MM:SS".
				m[string(f.Name)] = formatPgTime(v)
			case pgtype.Interval:
				m[string(f.Name)] = formatPgInterval(v)
			default:
				m[string(f.Name)] = v
			}
		}
		out = append(out, m)
	}
	return out, rows.Err()
}
