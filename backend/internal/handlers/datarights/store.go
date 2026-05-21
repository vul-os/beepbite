// Package datarights provides store (DB) helpers for data-rights operations:
//   - Org soft-delete / restore
//   - Data export job enqueueing and archive building
//   - Customer right-to-be-forgotten (PII redaction)
package datarights

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/internal/db"
)

// Sentinel errors for HTTP status-code mapping.
var (
	ErrOrgNotFound       = errors.New("organization not found")
	ErrOrgAlreadyDeleted = errors.New("organization is already soft-deleted")
	ErrOrgNotDeleted     = errors.New("organization is not soft-deleted")
	ErrCustomerNotFound  = errors.New("customer not found")
	ErrAlreadyForgotten  = errors.New("customer PII has already been purged")
)

// Store wraps pgxpool for all data-rights DB queries.
type Store struct {
	pool *pgxpool.Pool
}

// NewStore constructs a Store.
func NewStore(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

// ---------------------------------------------------------------------------
// Org soft-delete
// ---------------------------------------------------------------------------

// SoftDeleteOrg sets deleted_at = now() and scheduled_purge_at = now()+30d
// for the caller's org, then writes an audit_log row.
// Returns ErrOrgNotFound if the org row does not exist.
// Returns ErrOrgAlreadyDeleted if deleted_at is already set.
func (s *Store) SoftDeleteOrg(ctx context.Context, orgID, actorID string) error {
	return db.Scoped(ctx, s.pool, db.ScopeFromContext(ctx), func(tx pgx.Tx) error {
		// Check current state.
		var deletedAt *time.Time
		err := tx.QueryRow(ctx,
			`SELECT deleted_at FROM organizations WHERE id = $1`, orgID,
		).Scan(&deletedAt)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrOrgNotFound
		}
		if err != nil {
			return err
		}
		if deletedAt != nil {
			return ErrOrgAlreadyDeleted
		}

		// Apply soft-delete.
		_, err = tx.Exec(ctx, `
UPDATE organizations
SET deleted_at         = now(),
    scheduled_purge_at = now() + INTERVAL '30 days',
    updated_at         = now()
WHERE id = $1
`, orgID)
		if err != nil {
			return err
		}

		return insertAuditLogForOrg(ctx, tx, orgID, actorID, "org.soft_delete", "organizations", orgID,
			map[string]any{"deleted_at": nil},
			map[string]any{"deleted_at": "now()", "scheduled_purge_at": "now()+30d"},
		)
	})
}

// RestoreOrg clears deleted_at and scheduled_purge_at, reversing a soft-delete.
// Returns ErrOrgNotDeleted if the org is not currently soft-deleted.
func (s *Store) RestoreOrg(ctx context.Context, orgID, actorID string) error {
	return db.Scoped(ctx, s.pool, db.ScopeFromContext(ctx), func(tx pgx.Tx) error {
		var deletedAt *time.Time
		err := tx.QueryRow(ctx,
			`SELECT deleted_at FROM organizations WHERE id = $1`, orgID,
		).Scan(&deletedAt)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrOrgNotFound
		}
		if err != nil {
			return err
		}
		if deletedAt == nil {
			return ErrOrgNotDeleted
		}

		_, err = tx.Exec(ctx, `
UPDATE organizations
SET deleted_at         = NULL,
    scheduled_purge_at = NULL,
    updated_at         = now()
WHERE id = $1
`, orgID)
		if err != nil {
			return err
		}

		return insertAuditLogForOrg(ctx, tx, orgID, actorID, "org.restore", "organizations", orgID,
			map[string]any{"deleted_at": deletedAt},
			map[string]any{"deleted_at": nil, "scheduled_purge_at": nil},
		)
	})
}

// ---------------------------------------------------------------------------
// Data export
// ---------------------------------------------------------------------------

// ExportJobRow represents a data_export_jobs row returned to callers.
type ExportJobRow struct {
	ID          string     `json:"id"`
	OrgID       string     `json:"org_id"`
	Status      string     `json:"status"`
	StorageKey  *string    `json:"storage_key,omitempty"`
	RequestedBy *string    `json:"requested_by,omitempty"`
	CreatedAt   time.Time  `json:"created_at"`
	CompletedAt *time.Time `json:"completed_at,omitempty"`
}

// EnqueueExport inserts a data_export_jobs row (status='processing') and
// immediately builds a JSON archive of org-scoped data, updating the row to
// status='complete' with the archive as the storage_key.
//
// The archive is a JSON object keyed by table name (orders, customers, menu,
// staff, audit_log). For orgs with large datasets, a future iteration can
// offload this to an async job; the synchronous path is correct and safe for
// now because archive sizes for SMEs are small.
func (s *Store) EnqueueExport(ctx context.Context, orgID, requestedBy string) (*ExportJobRow, []byte, error) {
	var job ExportJobRow

	// Insert the job row under tenant scope.
	err := db.Scoped(ctx, s.pool, db.ScopeFromContext(ctx), func(tx pgx.Tx) error {
		var reqBy *string
		if requestedBy != "" {
			reqBy = &requestedBy
		}
		return tx.QueryRow(ctx, `
INSERT INTO data_export_jobs (org_id, status, requested_by)
VALUES ($1, 'processing', $2)
RETURNING id, org_id, status, storage_key, requested_by, created_at, completed_at
`, orgID, reqBy).Scan(
			&job.ID, &job.OrgID, &job.Status, &job.StorageKey,
			&job.RequestedBy, &job.CreatedAt, &job.CompletedAt,
		)
	})
	if err != nil {
		return nil, nil, err
	}

	// Build the archive under service-role scope so cross-table reads satisfy RLS.
	archive, err := s.buildArchive(ctx, orgID)
	if err != nil {
		// Mark the job as failed and return the error.
		_ = s.markJobFailed(ctx, job.ID)
		return nil, nil, err
	}

	// Mark the job complete and store the inline archive key.
	// For a real object-store integration, upload archive bytes to R2 and store
	// the resulting key. Here we store a sentinel key so the handler can return
	// the raw bytes in the response.
	storageKey := "inline:" + job.ID
	if err := s.markJobComplete(ctx, job.ID, storageKey); err != nil {
		return nil, nil, err
	}

	job.Status = "complete"
	job.StorageKey = &storageKey
	now := time.Now().UTC()
	job.CompletedAt = &now

	// Audit the export action — run inside service-role scope with orgID passed
	// directly because ServiceRoleScope has no current_org_id() session var.
	_ = db.Scoped(ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return insertAuditLogForOrg(ctx, tx, orgID, requestedBy, "org.data_export", "data_export_jobs", job.ID,
			nil,
			map[string]any{"org_id": orgID, "status": "complete"},
		)
	})

	return &job, archive, nil
}

// buildArchive collects org-scoped rows from key tables and returns a JSON document.
func (s *Store) buildArchive(ctx context.Context, orgID string) ([]byte, error) {
	type archiveDoc struct {
		ExportedAt time.Time        `json:"exported_at"`
		OrgID      string           `json:"org_id"`
		Orders     []map[string]any `json:"orders"`
		Customers  []map[string]any `json:"customers"`
		Staff      []map[string]any `json:"staff"`
		AuditLog   []map[string]any `json:"audit_log"`
	}

	doc := archiveDoc{
		ExportedAt: time.Now().UTC(),
		OrgID:      orgID,
	}

	err := db.Scoped(ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		var scanErr error

		// Orders (via locations JOIN).
		doc.Orders, scanErr = queryRows(ctx, tx, `
SELECT o.id, o.order_number, o.status, o.fulfillment_type,
       o.total_cents, o.created_at
FROM orders o
JOIN locations l ON l.id = o.location_id
WHERE l.organization_id = $1
ORDER BY o.created_at DESC
LIMIT 10000
`, orgID)
		if scanErr != nil {
			return scanErr
		}

		// Customers (direct org column).
		doc.Customers, scanErr = queryRows(ctx, tx, `
SELECT id, first_name, last_name, email, whatsapp_number,
       total_orders, total_spent, created_at, pii_purged_at
FROM customers
WHERE organization_id = $1
ORDER BY created_at DESC
LIMIT 10000
`, orgID)
		if scanErr != nil {
			return scanErr
		}

		// Staff.
		doc.Staff, scanErr = queryRows(ctx, tx, `
SELECT s.id, s.name, s.role, s.email, s.is_active, s.created_at
FROM staff s
JOIN locations l ON l.id = s.location_id
WHERE l.organization_id = $1
ORDER BY s.created_at DESC
LIMIT 1000
`, orgID)
		if scanErr != nil {
			return scanErr
		}

		// Audit log (last 90 days).
		doc.AuditLog, scanErr = queryRows(ctx, tx, `
SELECT id, actor_type, actor_id, action, entity_type, entity_id, created_at
FROM audit_log
WHERE organization_id = $1
  AND created_at > now() - INTERVAL '90 days'
ORDER BY created_at DESC
LIMIT 10000
`, orgID)
		return scanErr
	})
	if err != nil {
		return nil, err
	}

	return json.Marshal(doc)
}

// markJobComplete updates a data_export_jobs row to status='complete'.
func (s *Store) markJobComplete(ctx context.Context, jobID, storageKey string) error {
	return db.Scoped(ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
UPDATE data_export_jobs
SET status = 'complete', storage_key = $2, completed_at = now()
WHERE id = $1
`, jobID, storageKey)
		return err
	})
}

// markJobFailed updates a data_export_jobs row to status='failed'.
func (s *Store) markJobFailed(ctx context.Context, jobID string) error {
	return db.Scoped(ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
UPDATE data_export_jobs
SET status = 'failed', completed_at = now()
WHERE id = $1
`, jobID)
		return err
	})
}

// ---------------------------------------------------------------------------
// Right-to-be-forgotten
// ---------------------------------------------------------------------------

// ForgetCustomer redacts PII columns for the given customer within the caller's
// org, then writes an audit_log row. Order rows are retained (anonymised by
// virtue of having no customer PII in the orders table itself). Returns
// ErrCustomerNotFound or ErrAlreadyForgotten as appropriate.
func (s *Store) ForgetCustomer(ctx context.Context, customerID, actorID string) error {
	return db.Scoped(ctx, s.pool, db.ScopeFromContext(ctx), func(tx pgx.Tx) error {
		// Verify customer exists under caller's org (RLS enforces org boundary).
		var purgedAt *time.Time
		err := tx.QueryRow(ctx,
			`SELECT pii_purged_at FROM customers WHERE id = $1`, customerID,
		).Scan(&purgedAt)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrCustomerNotFound
		}
		if err != nil {
			return err
		}
		if purgedAt != nil {
			return ErrAlreadyForgotten
		}

		// Redact PII columns; keep anonymised order rows untouched.
		_, err = tx.Exec(ctx, `
UPDATE customers
SET first_name      = NULL,
    last_name       = NULL,
    email           = NULL,
    whatsapp_number = NULL,
    notes           = NULL,
    pii_purged_at   = now(),
    updated_at      = now()
WHERE id = $1
`, customerID)
		if err != nil {
			return err
		}

		// Audit — insertAuditLog handles the service-role elevation internally.
		return insertAuditLog(ctx, tx, actorID, "customer.forget", "customers", customerID,
			map[string]any{"pii_purged_at": nil},
			map[string]any{"pii_purged_at": "now()", "fields_redacted": []string{
				"first_name", "last_name", "email", "whatsapp_number", "notes",
			}},
		)
	})
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

// insertAuditLog writes a single audit_log row inside a tenant-scoped tx.
// It resolves the org via current_org_id() (set by db.Scoped from context).
// Elevates to service-role just for the INSERT (audit_log is service_role-only).
func insertAuditLog(
	ctx context.Context,
	tx pgx.Tx,
	actorID, action, entityType, entityID string,
	before, after any,
) error {
	bJSON, _ := json.Marshal(before)
	aJSON, _ := json.Marshal(after)

	return db.WithTxServiceRole(ctx, tx, func() error {
		_, err := tx.Exec(ctx, `
INSERT INTO audit_log (
    organization_id,
    actor_type, actor_id,
    action, entity_type, entity_id,
    before_state, after_state
)
SELECT id,
       'member', $1::uuid, $2, $3, $4::uuid, $5, $6
FROM organizations
WHERE id = current_org_id()
LIMIT 1
`,
			nullStr(actorID), action, entityType, nullStr(entityID),
			bJSON, aJSON,
		)
		return err
	})
}

// insertAuditLogForOrg is like insertAuditLog but uses an explicit orgID
// instead of current_org_id(). Use this when the surrounding scope is
// ServiceRoleScope (where current_org_id() returns NULL).
func insertAuditLogForOrg(
	ctx context.Context,
	tx pgx.Tx,
	orgID, actorID, action, entityType, entityID string,
	before, after any,
) error {
	bJSON, _ := json.Marshal(before)
	aJSON, _ := json.Marshal(after)

	return db.WithTxServiceRole(ctx, tx, func() error {
		_, err := tx.Exec(ctx, `
INSERT INTO audit_log (
    organization_id,
    actor_type, actor_id,
    action, entity_type, entity_id,
    before_state, after_state
)
VALUES (
    $1::uuid,
    'member', $2::uuid, $3, $4, $5::uuid, $6, $7
)
`,
			nullStr(orgID), nullStr(actorID), action, entityType, nullStr(entityID),
			bJSON, aJSON,
		)
		return err
	})
}

// queryRows executes a query and returns each row as a map[string]any.
// Column names are used as map keys. Nil values are preserved as JSON null.
func queryRows(ctx context.Context, tx pgx.Tx, sql string, args ...any) ([]map[string]any, error) {
	rows, err := tx.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	fields := rows.FieldDescriptions()
	var out []map[string]any
	for rows.Next() {
		vals, err := rows.Values()
		if err != nil {
			return nil, err
		}
		row := make(map[string]any, len(fields))
		for i, f := range fields {
			row[string(f.Name)] = vals[i]
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

// nullStr converts an empty string to nil so Postgres stores SQL NULL.
func nullStr(s string) any {
	if s == "" {
		return nil
	}
	return s
}
