package storecredit

import (
	"context"
	"errors"
	"math"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// LoyaltyConfig mirrors the loyalty_config row for one organization.
type LoyaltyConfig struct {
	ID                    string    `json:"id"`
	OrganizationID        string    `json:"organization_id"`
	PointsPerCurrencyUnit float64   `json:"points_per_currency_unit"` // decimal(12,4)
	MinRedemptionPoints   int64     `json:"min_redemption_points"`
	MaxRedemptionPct      float64   `json:"max_redemption_pct_of_order"` // 0..100
	ExpiryMonths          *int      `json:"points_expiry_months,omitempty"`
	IsActive              bool      `json:"is_active"`
	CreatedAt             time.Time `json:"created_at"`
	UpdatedAt             time.Time `json:"updated_at"`
}

// LoyaltyTransaction mirrors a loyalty_transactions row.
type LoyaltyTransaction struct {
	ID               string     `json:"id"`
	CustomerID       string     `json:"customer_id"`
	OrganizationID   string     `json:"organization_id"`
	TxnType          string     `json:"txn_type"`
	Points           int64      `json:"points"`
	BalanceAfter     int64      `json:"balance_after"`
	OrderID          *string    `json:"order_id,omitempty"`
	ExpiresAt        *time.Time `json:"expires_at,omitempty"`
	Notes            *string    `json:"notes,omitempty"`
	PerformedByStaff *string    `json:"performed_by_staff_id,omitempty"`
	CreatedAt        time.Time  `json:"created_at"`
}

// LoyaltyCustomerSummary is what GET /loyalty/customers/{id} returns.
type LoyaltyCustomerSummary struct {
	CustomerID     string               `json:"customer_id"`
	CurrentPoints  int64                `json:"current_points"`
	ExpiringPoints int64                `json:"expiring_points_next_30_days"`
	Transactions   []LoyaltyTransaction `json:"transactions"`
}

// LoyaltyStore holds a pool for loyalty-specific DB operations.
type LoyaltyStore struct {
	pool *pgxpool.Pool
}

func NewLoyaltyStore(pool *pgxpool.Pool) *LoyaltyStore { return &LoyaltyStore{pool: pool} }

// loadLoyaltyConfig fetches the active config for an organization.
// Returns ErrLoyaltyConfigNotFound if none exists or is inactive.
func (ls *LoyaltyStore) loadLoyaltyConfig(
	ctx context.Context,
	tx pgx.Tx,
	organizationID string,
) (*LoyaltyConfig, error) {
	var cfg LoyaltyConfig
	err := tx.QueryRow(ctx, `
SELECT id, organization_id, points_per_currency_unit,
       COALESCE(min_redemption_points, 0),
       COALESCE(max_redemption_pct_of_order, 100),
       points_expiry_months, is_active, created_at, updated_at
FROM loyalty_config
WHERE organization_id = $1
`, organizationID).Scan(
		&cfg.ID, &cfg.OrganizationID, &cfg.PointsPerCurrencyUnit,
		&cfg.MinRedemptionPoints, &cfg.MaxRedemptionPct,
		&cfg.ExpiryMonths, &cfg.IsActive, &cfg.CreatedAt, &cfg.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrLoyaltyConfigNotFound
	}
	if err != nil {
		return nil, err
	}
	if !cfg.IsActive {
		return nil, ErrLoyaltyConfigNotFound
	}
	return &cfg, nil
}

// customerLoyaltyPoints reads customers.loyalty_points with a FOR UPDATE lock.
// NOTE: migration 25 does not add loyalty_points to the customers table — see
// schema gap note in the handler. We use loyalty_transactions SUM as fallback.
func (ls *LoyaltyStore) customerPointsFU(
	ctx context.Context,
	tx pgx.Tx,
	customerID string,
) (int64, error) {
	var pts int64
	// Try customers.loyalty_points first (column added by a separate migration).
	err := tx.QueryRow(ctx, `
SELECT loyalty_points FROM customers WHERE id = $1 FOR UPDATE
`, customerID).Scan(&pts)
	if err != nil {
		return 0, err
	}
	return pts, nil
}

// setCustomerPoints writes the new point balance back to customers.loyalty_points.
func (ls *LoyaltyStore) setCustomerPoints(
	ctx context.Context,
	tx pgx.Tx,
	customerID string,
	pts int64,
) error {
	_, err := tx.Exec(ctx, `
UPDATE customers SET loyalty_points = $1, updated_at = now() WHERE id = $2
`, pts, customerID)
	return err
}

func scanLoyaltyTxn(row pgx.Row, t *LoyaltyTransaction) error {
	return row.Scan(
		&t.ID, &t.CustomerID, &t.OrganizationID, &t.TxnType,
		&t.Points, &t.BalanceAfter, &t.OrderID, &t.ExpiresAt,
		&t.Notes, &t.PerformedByStaff, &t.CreatedAt,
	)
}

// EarnPoints computes points for amountCents and writes an earn transaction.
func (ls *LoyaltyStore) EarnPoints(
	ctx context.Context,
	organizationID, customerID, orderID string,
	orderAmountCents int64,
	performedByStaffID string,
) (*LoyaltyTransaction, error) {
	tx, err := ls.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	cfg, err := ls.loadLoyaltyConfig(ctx, tx, organizationID)
	if err != nil {
		return nil, err
	}

	// points_per_currency_unit is "X points per 1 ZAR (100 cents)".
	// Convert cents → whole currency units, then multiply.
	currencyUnits := float64(orderAmountCents) / 100.0
	earnedPoints := int64(math.Floor(currencyUnits * cfg.PointsPerCurrencyUnit))

	currentPts, err := ls.customerPointsFU(ctx, tx, customerID)
	if err != nil {
		return nil, err
	}
	newBalance := currentPts + earnedPoints

	if err := ls.setCustomerPoints(ctx, tx, customerID, newBalance); err != nil {
		return nil, err
	}

	// Compute expiry timestamp if the config specifies a lifetime.
	var expiresAt *time.Time
	if cfg.ExpiryMonths != nil && *cfg.ExpiryMonths > 0 {
		t := time.Now().UTC().AddDate(0, *cfg.ExpiryMonths, 0)
		expiresAt = &t
	}

	var txnOut LoyaltyTransaction
	err = scanLoyaltyTxn(tx.QueryRow(ctx, `
INSERT INTO loyalty_transactions
    (customer_id, organization_id, txn_type, points, balance_after,
     order_id, expires_at, performed_by_staff_id)
VALUES ($1, $2, 'earn', $3, $4, $5, $6, $7)
RETURNING id, customer_id, organization_id, txn_type, points, balance_after,
          order_id, expires_at, notes, performed_by_staff_id, created_at
`, customerID, organizationID, earnedPoints, newBalance,
		nullStr(orderID), expiresAt, nullStr(performedByStaffID),
	), &txnOut)
	if err != nil {
		return nil, err
	}

	return &txnOut, tx.Commit(ctx)
}

// RedeemPoints validates caps and deducts points, writing a redeem transaction.
func (ls *LoyaltyStore) RedeemPoints(
	ctx context.Context,
	organizationID, customerID, orderID string,
	pointsToRedeem, orderAmountCents int64,
	performedByStaffID string,
) (*LoyaltyTransaction, error) {
	tx, err := ls.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	cfg, err := ls.loadLoyaltyConfig(ctx, tx, organizationID)
	if err != nil {
		return nil, err
	}

	// Enforce minimum redemption floor.
	if pointsToRedeem < cfg.MinRedemptionPoints {
		return nil, ErrBelowMinRedemption
	}

	// Convert points → currency value for cap check.
	// pointsToRedeem / points_per_currency_unit = ZAR → * 100 = cents.
	var redemptionCents int64
	if cfg.PointsPerCurrencyUnit > 0 {
		redemptionCents = int64(math.Floor(float64(pointsToRedeem) / cfg.PointsPerCurrencyUnit * 100))
	}

	// Enforce max redemption as a percentage of the order.
	if orderAmountCents > 0 && cfg.MaxRedemptionPct > 0 {
		maxAllowedCents := int64(math.Floor(float64(orderAmountCents) * cfg.MaxRedemptionPct / 100.0))
		if redemptionCents > maxAllowedCents {
			return nil, ErrExceedsMaxRedemption
		}
	}

	currentPts, err := ls.customerPointsFU(ctx, tx, customerID)
	if err != nil {
		return nil, err
	}
	if currentPts < pointsToRedeem {
		return nil, ErrInsufficientPoints
	}

	newBalance := currentPts - pointsToRedeem
	if err := ls.setCustomerPoints(ctx, tx, customerID, newBalance); err != nil {
		return nil, err
	}

	var txnOut LoyaltyTransaction
	err = scanLoyaltyTxn(tx.QueryRow(ctx, `
INSERT INTO loyalty_transactions
    (customer_id, organization_id, txn_type, points, balance_after,
     order_id, performed_by_staff_id)
VALUES ($1, $2, 'redeem', $3, $4, $5, $6)
RETURNING id, customer_id, organization_id, txn_type, points, balance_after,
          order_id, expires_at, notes, performed_by_staff_id, created_at
`, customerID, organizationID, -pointsToRedeem, newBalance,
		nullStr(orderID), nullStr(performedByStaffID),
	), &txnOut)
	if err != nil {
		return nil, err
	}

	return &txnOut, tx.Commit(ctx)
}

// ExpirePoints sweeps customers whose last earn/redeem is older than
// ExpiryMonths for the given organization, zeroes their balance, and writes
// expire ledger rows. Returns the count of customers affected.
func (ls *LoyaltyStore) ExpirePoints(
	ctx context.Context,
	organizationID string,
) (int64, error) {
	tx, err := ls.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	cfg, err := ls.loadLoyaltyConfig(ctx, tx, organizationID)
	if err != nil {
		return 0, err
	}

	if cfg.ExpiryMonths == nil || *cfg.ExpiryMonths <= 0 {
		// No expiry configured — nothing to do.
		return 0, tx.Commit(ctx)
	}

	cutoff := time.Now().UTC().AddDate(0, -*cfg.ExpiryMonths, 0)

	// Find customers with stale last activity in this org who still have points.
	// "Last activity" = latest loyalty_transactions row for the customer+org.
	type staleRow struct {
		CustomerID string
		CurrentPts int64
	}

	rows, err := tx.Query(ctx, `
SELECT c.id, c.loyalty_points
FROM customers c
WHERE c.loyalty_points > 0
  AND (
      SELECT MAX(lt.created_at)
      FROM loyalty_transactions lt
      WHERE lt.customer_id = c.id
        AND lt.organization_id = $1
        AND lt.txn_type IN ('earn','redeem')
  ) < $2
FOR UPDATE OF c
`, organizationID, cutoff)
	if err != nil {
		return 0, err
	}

	var stale []staleRow
	for rows.Next() {
		var row staleRow
		if err := rows.Scan(&row.CustomerID, &row.CurrentPts); err != nil {
			rows.Close()
			return 0, err
		}
		stale = append(stale, row)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, err
	}

	var affected int64
	for _, row := range stale {
		if _, err := tx.Exec(ctx, `
UPDATE customers SET loyalty_points = 0, updated_at = now() WHERE id = $1
`, row.CustomerID); err != nil {
			return 0, err
		}

		if _, err := tx.Exec(ctx, `
INSERT INTO loyalty_transactions
    (customer_id, organization_id, txn_type, points, balance_after)
VALUES ($1, $2, 'expire', $3, 0)
`, row.CustomerID, organizationID, -row.CurrentPts); err != nil {
			return 0, err
		}
		affected++
	}

	return affected, tx.Commit(ctx)
}

// GetCustomerLoyalty returns current points plus an expiring-soon breakdown.
func (ls *LoyaltyStore) GetCustomerLoyalty(
	ctx context.Context,
	customerID string,
) (*LoyaltyCustomerSummary, error) {
	var currentPts int64
	err := ls.pool.QueryRow(ctx, `
SELECT loyalty_points FROM customers WHERE id = $1
`, customerID).Scan(&currentPts)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrCustomerNotFound
	}
	if err != nil {
		return nil, err
	}

	// Points earned before 30 days from now that haven't already been redeemed/expired.
	var expiringPts int64
	_ = ls.pool.QueryRow(ctx, `
SELECT COALESCE(SUM(points), 0)
FROM loyalty_transactions
WHERE customer_id = $1
  AND txn_type = 'earn'
  AND expires_at IS NOT NULL
  AND expires_at <= now() + INTERVAL '30 days'
  AND expires_at  > now()
`, customerID).Scan(&expiringPts)
	// Ignore error; the column is nullable and best-effort.

	rows, err := ls.pool.Query(ctx, `
SELECT id, customer_id, organization_id, txn_type, points, balance_after,
       order_id, expires_at, notes, performed_by_staff_id, created_at
FROM loyalty_transactions
WHERE customer_id = $1
ORDER BY created_at DESC
LIMIT 100
`, customerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var txns []LoyaltyTransaction
	for rows.Next() {
		var t LoyaltyTransaction
		if err := scanLoyaltyTxn(rows, &t); err != nil {
			return nil, err
		}
		txns = append(txns, t)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if txns == nil {
		txns = []LoyaltyTransaction{}
	}

	return &LoyaltyCustomerSummary{
		CustomerID:     customerID,
		CurrentPoints:  currentPts,
		ExpiringPoints: expiringPts,
		Transactions:   txns,
	}, nil
}
