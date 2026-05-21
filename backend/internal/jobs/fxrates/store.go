package fxrates

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// upsertRate appends a USD→quoteCode rate row into exchange_rates. The table is
// global reference data (no RLS) and append-only HISTORY (unique on
// from_currency,to_currency,fetched_at; latest_exchange_rate() reads the newest
// non-expired row). We write the REAL base columns from_currency/to_currency —
// base_code/quote_code are GENERATED alias columns and cannot be inserted into.
func upsertRate(ctx context.Context, tx pgx.Tx, quoteCode string, rate float64, source string, expiresAt time.Time) error {
	_, err := tx.Exec(ctx, `
INSERT INTO exchange_rates (from_currency, to_currency, rate, source, fetched_at, expires_at)
VALUES ('USD', $1, $2, $3, now(), $4)
ON CONFLICT (from_currency, to_currency, fetched_at) DO NOTHING
`, quoteCode, rate, source, expiresAt)
	if err != nil {
		return fmt.Errorf("fxrates: insert USD→%s: %w", quoteCode, err)
	}
	return nil
}
