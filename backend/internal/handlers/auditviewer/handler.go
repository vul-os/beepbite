// Package auditviewer provides a manager-scoped audit log viewer endpoint.
//
// Route:
//
//	GET /manager/audit — returns org-scoped audit_log rows for the caller's org.
//
// Access is restricted to JWT-authenticated members with a valid OrgScope.
// The DB query runs under db.Scoped with the caller's org scope so Postgres
// RLS (current_org_id() = organization_id) further enforces tenant isolation.
//
// Query parameters (all optional):
//
//	actor    — filter by actor_id (UUID string)
//	action   — filter by action text (substring match via ILIKE)
//	from     — ISO 8601 start timestamp (inclusive)
//	to       — ISO 8601 end timestamp (inclusive)
//	page     — 1-based page number (default 1)
//	per_page — rows per page (default 50, max 200)
package auditviewer

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/internal/auth"
	"github.com/beepbite/backend/internal/db"
)

// Handler exposes the audit viewer endpoint.
type Handler struct {
	pool *pgxpool.Pool
}

// NewHandler constructs an auditviewer Handler.
func NewHandler(pool *pgxpool.Pool) *Handler {
	return &Handler{pool: pool}
}

// Mount registers the audit viewer route on r.
// Wire after auth.Middleware + auth.RequireOrgScope.
//
//	r.Mount("/manager/audit", auditviewer.NewHandler(pool).Mount)
func (h *Handler) Mount(r chi.Router) {
	r.Get("/", h.listAuditLog)
}

// AuditEntry mirrors a subset of the audit_log columns returned to the client.
type AuditEntry struct {
	ID             string          `json:"id"`
	OrganizationID *string         `json:"organization_id"`
	LocationID     *string         `json:"location_id"`
	ActorType      string          `json:"actor_type"`
	ActorID        *string         `json:"actor_id"`
	ActorLabel     *string         `json:"actor_label"`
	Action         string          `json:"action"`
	EntityType     string          `json:"entity_type"`
	EntityID       *string         `json:"entity_id"`
	BeforeState    json.RawMessage `json:"before_state"`
	AfterState     json.RawMessage `json:"after_state"`
	CreatedAt      time.Time       `json:"created_at"`
}

// listAuditLogResponse wraps the paginated result.
type listAuditLogResponse struct {
	Data    []AuditEntry `json:"data"`
	Total   int          `json:"total"`
	Page    int          `json:"page"`
	PerPage int          `json:"per_page"`
}

// GET /manager/audit
func (h *Handler) listAuditLog(w http.ResponseWriter, r *http.Request) {
	// Resolve org scope — RequireOrgScope must be wired upstream.
	orgScope := auth.OrgScopeFrom(r.Context())
	if len(orgScope.Memberships) == 0 {
		http.Error(w, "no organisation membership", http.StatusForbidden)
		return
	}
	// Use the first membership's org (consistent with db.ContextWithScope).
	orgID := orgScope.Memberships[0].OrgID

	// Parse filters from query params.
	q := r.URL.Query()
	actor := q.Get("actor")
	action := q.Get("action")
	fromStr := q.Get("from")
	toStr := q.Get("to")

	page := 1
	if p := q.Get("page"); p != "" {
		if v, err := strconv.Atoi(p); err == nil && v > 0 {
			page = v
		}
	}
	perPage := 50
	if pp := q.Get("per_page"); pp != "" {
		if v, err := strconv.Atoi(pp); err == nil && v > 0 && v <= 200 {
			perPage = v
		}
	}
	offset := (page - 1) * perPage

	var fromTime, toTime *time.Time
	if fromStr != "" {
		if t, err := time.Parse(time.RFC3339, fromStr); err == nil {
			fromTime = &t
		}
	}
	if toStr != "" {
		if t, err := time.Parse(time.RFC3339, toStr); err == nil {
			toTime = &t
		}
	}

	// Build WHERE clause with positional args.
	// organization_id = $1 is the primary app-layer guard; RLS also enforces this.
	where := `WHERE al.organization_id = $1`
	args := []any{orgID}
	n := 2

	if actor != "" {
		where += " AND al.actor_id = $" + strconv.Itoa(n) + "::uuid"
		args = append(args, actor)
		n++
	}
	if action != "" {
		where += " AND al.action ILIKE $" + strconv.Itoa(n)
		args = append(args, "%"+action+"%")
		n++
	}
	if fromTime != nil {
		where += " AND al.created_at >= $" + strconv.Itoa(n)
		args = append(args, *fromTime)
		n++
	}
	if toTime != nil {
		where += " AND al.created_at <= $" + strconv.Itoa(n)
		args = append(args, *toTime)
		n++
	}

	countSQL := `SELECT COUNT(*) FROM audit_log al ` + where

	dataSQL := `
SELECT al.id, al.organization_id, al.location_id,
       al.actor_type, al.actor_id, al.actor_label,
       al.action, al.entity_type, al.entity_id,
       al.before_state, al.after_state, al.created_at
  FROM audit_log al
` + where + `
 ORDER BY al.created_at DESC
 LIMIT $` + strconv.Itoa(n) + ` OFFSET $` + strconv.Itoa(n+1)

	dataArgs := make([]any, len(args)+2)
	copy(dataArgs, args)
	dataArgs[len(args)] = perPage
	dataArgs[len(args)+1] = offset

	// Use the caller's db.Scope from context (set by RequireOrgScope).
	dbScope := db.ScopeFromContext(r.Context())
	if dbScope.OrgID == "" {
		dbScope.OrgID = orgID
	}

	var total int
	var entries []AuditEntry

	err := db.Scoped(r.Context(), h.pool, dbScope, func(tx pgx.Tx) error {
		ctx := r.Context()

		// Count.
		if err := tx.QueryRow(ctx, countSQL, args...).Scan(&total); err != nil {
			return err
		}

		// Data.
		rows, err := tx.Query(ctx, dataSQL, dataArgs...)
		if err != nil {
			return err
		}
		defer rows.Close()

		for rows.Next() {
			var e AuditEntry
			var bs, as []byte
			if err := rows.Scan(
				&e.ID, &e.OrganizationID, &e.LocationID,
				&e.ActorType, &e.ActorID, &e.ActorLabel,
				&e.Action, &e.EntityType, &e.EntityID,
				&bs, &as, &e.CreatedAt,
			); err != nil {
				return err
			}
			if bs != nil {
				e.BeforeState = json.RawMessage(bs)
			}
			if as != nil {
				e.AfterState = json.RawMessage(as)
			}
			entries = append(entries, e)
		}
		return rows.Err()
	})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	if entries == nil {
		entries = []AuditEntry{}
	}
	writeJSON(w, http.StatusOK, listAuditLogResponse{
		Data:    entries,
		Total:   total,
		Page:    page,
		PerPage: perPage,
	})
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}
