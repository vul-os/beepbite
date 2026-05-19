// Package auditretention provides a background job that archives audit_log rows
// older than a configurable retention window into audit_log_archived.
package auditretention

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// archiveOldAuditLog calls the database function and returns the number of rows moved.
func archiveOldAuditLog(ctx context.Context, db *pgxpool.Pool, retainDays int) (int64, error) {
	var moved int64
	err := db.QueryRow(ctx, `SELECT moved_rows FROM archive_old_audit_log($1)`, retainDays).Scan(&moved)
	if err != nil {
		return 0, fmt.Errorf("auditretention: archive_old_audit_log(%d): %w", retainDays, err)
	}
	return moved, nil
}
