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
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
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
}

func NewHandler(pool *pgxpool.Pool) *Handler { return &Handler{pool: pool} }

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

func (h *Handler) list(w http.ResponseWriter, r *http.Request) {
	table := chi.URLParam(r, "table")
	ops, ok := allowed(table)
	if !ok || !ops.Select {
		writeErr(w, http.StatusNotFound, "table not exposed")
		return
	}

	q := r.URL.Query()
	cols := q.Get("select")
	if cols == "" {
		cols = "*"
	}
	if !looksLikeColumnList(cols) {
		writeErr(w, http.StatusBadRequest, "invalid select")
		return
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

	rows, err := h.pool.Query(r.Context(), sb.String(), args...)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	defer rows.Close()

	out, err := rowsToMaps(rows)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}

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
	tx, err := h.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer tx.Rollback(ctx)

	dbRows, err := tx.Query(ctx, sb.String(), args...)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	out, err := rowsToMaps(dbRows)
	dbRows.Close()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	if err := auditMutation(ctx, tx, table, opInsert, entityIDFromRow(out), nil, nil); err != nil {
		writeErr(w, http.StatusInternalServerError, "audit: "+err.Error())
		return
	}

	if err := tx.Commit(ctx); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
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

	var changes map[string]any
	if err := json.NewDecoder(r.Body).Decode(&changes); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid body")
		return
	}
	if len(changes) == 0 {
		writeErr(w, http.StatusBadRequest, "empty body")
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
	tx, err := h.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer tx.Rollback(ctx)

	rows, err := tx.Query(ctx, sb.String(), args...)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	out, err := rowsToMaps(rows)
	rows.Close()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	// after_state carries the changed fields so the audit log captures what was set.
	if err := auditMutation(ctx, tx, table, opUpdate, entityIDFromRow(out), nil, changes); err != nil {
		writeErr(w, http.StatusInternalServerError, "audit: "+err.Error())
		return
	}

	if err := tx.Commit(ctx); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
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

	tx, err := h.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer tx.Rollback(ctx)

	delRows, err := tx.Query(ctx, deleteSql, args...)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	deleted, err := rowsToMaps(delRows)
	delRows.Close()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	if err := auditMutation(ctx, tx, table, opDelete, entityIDFromRow(deleted), nil, nil); err != nil {
		writeErr(w, http.StatusInternalServerError, "audit: "+err.Error())
		return
	}

	if err := tx.Commit(ctx); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
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

	rows, err := h.pool.Query(r.Context(), sql, args...)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	defer rows.Close()

	// RPCs that return a scalar json / table get returned as an array; the
	// frontend treats rpc() as returning `data` directly so we mirror supabase-js
	// by unwrapping a single-row scalar.
	out, err := rowsToMaps(rows)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
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
			default:
				m[string(f.Name)] = v
			}
		}
		out = append(out, m)
	}
	return out, rows.Err()
}
