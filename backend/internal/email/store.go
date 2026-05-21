// store.go — DB queries used by the Registry to resolve email credentials.
//
// Queries against migration-024 tables:
//
//	email_providers(code PK, name, is_active)
//	location_email_credentials(id, location_id, provider_code,
//	                            encrypted_keys, sender_domain,
//	                            sender_email, is_active)
package email

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// locationEmailCred is the raw row returned by queryLocationCredentials.
type locationEmailCred struct {
	providerCode  string
	encryptedKeys string  // base64(AES-GCM ciphertext) of a JSON credentials blob
	senderDomain  *string // nullable
	senderEmail   *string // nullable
}

// queryLocationCredentials returns the active email credential row for
// locationID, or pgx.ErrNoRows when none exists.
func queryLocationCredentials(ctx context.Context, pool *pgxpool.Pool, locationID string) (locationEmailCred, error) {
	const q = `
SELECT
    lec.provider_code,
    lec.encrypted_keys,
    lec.sender_domain,
    lec.sender_email
FROM location_email_credentials lec
WHERE lec.location_id = $1
  AND lec.is_active   = true
ORDER BY lec.id DESC
LIMIT 1`

	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	var row locationEmailCred
	err := pool.QueryRow(ctx, q, locationID).Scan(
		&row.providerCode,
		&row.encryptedKeys,
		&row.senderDomain,
		&row.senderEmail,
	)
	if err != nil {
		return locationEmailCred{}, err // includes pgx.ErrNoRows
	}
	return row, nil
}

// isProviderActive returns true when email_providers.is_active = true for code.
// The registry uses this to guard against referencing a disabled provider.
func isProviderActive(ctx context.Context, pool *pgxpool.Pool, code string) (bool, error) {
	const q = `SELECT is_active FROM email_providers WHERE code = $1`

	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()

	var active bool
	err := pool.QueryRow(ctx, q, code).Scan(&active)
	if err != nil {
		if err == pgx.ErrNoRows {
			return false, nil
		}
		return false, err
	}
	return active, nil
}
