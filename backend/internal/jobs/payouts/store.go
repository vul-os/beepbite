// Package payouts contains the fee-capture helper (synchronous, called by the
// payment-webhook handler) and the weekly merchant-payout runner (background
// goroutine).
package payouts

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// DB is the minimal interface required by this package so callers can pass
// either a *pgxpool.Pool or a pgx transaction.
type DB interface {
	QueryRow(ctx context.Context, sql string, args ...any) interface {
		Scan(dest ...any) error
	}
	Exec(ctx context.Context, sql string, args ...any) (interface{ RowsAffected() int64 }, error)
}

// pgxDB wraps *pgxpool.Pool to satisfy the DB interface.
// Internally we use *pgxpool.Pool directly in RunOnce; this wrapper is only
// used in CaptureTransactionFee where the caller may inject a test double.
type pgxDB struct{ p *pgxpool.Pool }

func (d *pgxDB) QueryRow(ctx context.Context, sql string, args ...any) interface {
	Scan(dest ...any) error
} {
	return d.p.QueryRow(ctx, sql, args...)
}

func (d *pgxDB) Exec(ctx context.Context, sql string, args ...any) (interface{ RowsAffected() int64 }, error) {
	return d.p.Exec(ctx, sql, args...)
}

// PoolDB wraps a *pgxpool.Pool so it satisfies the DB interface accepted by
// CaptureTransactionFee.
func PoolDB(p *pgxpool.Pool) DB { return &pgxDB{p: p} }

// ---- query result structs --------------------------------------------------

type paymentRow struct {
	PaymentID       string
	OrderID         string
	AmountPaidCents int64
	PaymentStatus   string
}

type orgPlanRow struct {
	OrganizationID      string
	SubscriptionPlanID  string
	TransactionFeePct   float64 // e.g. 2.900
	TransactionFeeFixed int64   // cents
	PayoutFeePct        float64
	PayoutFeeFixed      int64
}

type payoutScheduleRow struct {
	ID                 string
	OrganizationID     string
	LocationID         *string
	Cadence            string
	DayOfWeek          *int
	DayOfMonth         *int
	RunAtHour          int
	MinimumPayoutCents int64
	HoldPeriodHours    int
	LastRunAt          *time.Time
	NextRunAt          *time.Time
}

type bankAccountRow struct {
	ID                  string
	OrganizationID      string
	LocationID          *string
	ProviderRecipientID *string
}

type merchantPayoutInsert struct {
	OrganizationID     string
	LocationID         *string
	PeriodStart        time.Time
	PeriodEnd          time.Time
	TotalSalesCents    int64
	TotalFeesCents     int64
	NetPayoutCents     int64
	PayoutFeeCents     int64
	BankAccountID      string
	SubscriptionPlanID string
	Provider           string
}
