package data

// audit.go — per-table audit-log hook for the generic data handler.
//
// When a row is inserted, updated, or deleted via the generic REST layer and
// the table appears in auditActions, an audit_log row is written inside the
// same transaction as the mutation.
//
// Design:
//   - allowlist: only tables in auditActions are audited; all others are
//     silently skipped. This avoids noise from high-volume tables (messages,
//     notifications, etc.) while ensuring every sensitive mutation is captured.
//   - before-state: the generic handler does not fetch the old row for UPDATEs,
//     so before_state is always NULL for updates coming through this path.
//     Dedicated handlers (cashdrawer, bankaccounts) fetch before/after
//     explicitly and pass them directly.
//   - actor: extracted from context key "actor_id" (same convention as
//     bankaccounts handler); falls back to NULL so the row is still written.

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/jackc/pgx/v5"
)

// auditOp is the CRUD operation that triggered the audit row.
type auditOp string

const (
	opInsert auditOp = "insert"
	opUpdate auditOp = "update"
	opDelete auditOp = "delete"
)

// tableAuditCfg maps a table name to the action strings used for each op.
// Only tables listed here generate audit rows.
type tableAuditCfg struct {
	entityType string
	// action strings per op; empty string means skip that op for this table.
	insert string
	update string
	delete string
}

var auditActions = map[string]tableAuditCfg{
	// Item pricing
	"items": {
		entityType: "item",
		update:     "item.price_changed",
	},

	// Staff role / permission changes
	"staff": {
		entityType: "staff",
		update:     "staff.role_changed",
	},

	// Menu schedule mutations (migration 24)
	"menu_schedules": {
		entityType: "menu_schedule",
		insert:     "menu_schedule.created",
		update:     "menu_schedule.updated",
		delete:     "menu_schedule.deleted",
	},
	"menu_schedule_slots": {
		entityType: "menu_schedule_slot",
		insert:     "menu_schedule.created",
		update:     "menu_schedule.updated",
		delete:     "menu_schedule.deleted",
	},
	"item_menu_schedules": {
		entityType: "item_menu_schedule",
		insert:     "menu_schedule.created",
		delete:     "menu_schedule.deleted",
	},
	"item_price_schedules": {
		entityType: "item_price_schedule",
		insert:     "menu_schedule.created",
		update:     "menu_schedule.updated",
		delete:     "menu_schedule.deleted",
	},

	// Promotions / coupons (migration 19)
	"promotions": {
		entityType: "promotion",
		insert:     "promotion.created",
		update:     "promotion.updated",
		delete:     "promotion.deleted",
	},
	"coupon_codes": {
		entityType: "coupon_code",
		insert:     "promotion.created",
		update:     "promotion.updated",
		delete:     "promotion.deleted",
	},

	// Subscription plans (migration 27) — only updates matter (rate changes)
	"subscription_plans": {
		entityType: "subscription_plan",
		update:     "subscription_plan.rate_changed",
	},

	// Bank accounts — update path (create + delete handled by dedicated store)
	"bank_accounts": {
		entityType: "bank_account",
		update:     "bank_account.updated",
	},
}

// dqTx is the subset of pgx.Tx the audit helper needs, so it can be used with
// both real transactions and test doubles.
type dqTx interface {
	Exec(ctx context.Context, sql string, args ...any) (interface{ RowsAffected() int64 }, error)
}

// auditMutation writes a single audit_log row inside tx.
//
//   - table:    the table that was mutated (e.g. "items")
//   - op:       opInsert / opUpdate / opDelete
//   - entityID: the UUID of the affected row (may be empty string → NULL)
//   - before:   nil or a map to store as before_state jsonb
//   - after:    nil or a map to store as after_state jsonb
//
// The function is a no-op when:
//   - the table is not in the auditActions allowlist, or
//   - the action string for the given op is empty.
//
// Errors from the INSERT are returned to the caller so the outer transaction
// can be rolled back.
func auditMutation(
	ctx context.Context,
	tx pgx.Tx,
	table string,
	op auditOp,
	entityID string,
	before, after map[string]any,
) error {
	cfg, ok := auditActions[table]
	if !ok {
		return nil
	}

	var action string
	switch op {
	case opInsert:
		action = cfg.insert
	case opUpdate:
		action = cfg.update
	case opDelete:
		action = cfg.delete
	}
	if action == "" {
		return nil
	}

	var beforeJSON, afterJSON []byte
	var err error
	if before != nil {
		if beforeJSON, err = json.Marshal(before); err != nil {
			return fmt.Errorf("audit: marshal before_state: %w", err)
		}
	}
	if after != nil {
		if afterJSON, err = json.Marshal(after); err != nil {
			return fmt.Errorf("audit: marshal after_state: %w", err)
		}
	}

	// actor_id from context — same key as bankaccounts handler.
	actorID := actorIDFromCtx(ctx)

	var entityIDVal any
	if entityID != "" {
		entityIDVal = entityID
	}

	_, execErr := tx.Exec(ctx, `
INSERT INTO audit_log
    (actor_type, actor_id, action, entity_type, entity_id, before_state, after_state)
VALUES
    ('member', $1, $2, $3, $4, $5, $6)
`,
		actorID,
		action,
		cfg.entityType,
		entityIDVal,
		nullJSONB(beforeJSON),
		nullJSONB(afterJSON),
	)
	return execErr
}

// nullJSONB returns nil (→ SQL NULL) for an empty slice, otherwise the raw
// JSON bytes so pgx stores them as jsonb.
func nullJSONB(b []byte) any {
	if len(b) == 0 {
		return nil
	}
	return b
}

// actorIDFromCtx extracts the actor UUID string from the request context.
// Returns nil when not present so audit rows still record a NULL actor_id.
// The context key must match the one set by the auth middleware.
func actorIDFromCtx(ctx context.Context) *string {
	type ctxKey string
	v := ctx.Value(ctxKey("actor_id"))
	if v == nil {
		return nil
	}
	s, ok := v.(string)
	if !ok || s == "" {
		return nil
	}
	return &s
}
