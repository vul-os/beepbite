// Package whatsapplink provides the data layer for the WhatsApp number ↔
// account binding flow (Wave 17 / Now-8).
//
// Tables used:
//
//	whatsapp_account_links  (migration 035) — canonical binding rows.
//	whatsapp_link_tokens    (migration 002) — short-lived tokens with intent='bind'.
//
// Both tables are service-role only for writes; reads on
// whatsapp_account_links are additionally gated by profile_id = current_user_id().
package whatsapplink

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/internal/db"
	"github.com/beepbite/backend/internal/locations"
	"github.com/beepbite/backend/internal/phone"
)

// ---------------------------------------------------------------------------
// Sentinel errors
// ---------------------------------------------------------------------------

var (
	// ErrTokenNotFound is returned when the token does not exist.
	ErrTokenNotFound = errors.New("token not found")
	// ErrTokenExpired is returned when the token has passed its expires_at.
	ErrTokenExpired = errors.New("token expired")
	// ErrTokenConsumed is returned when the token has already been used.
	ErrTokenConsumed = errors.New("token already consumed")
	// ErrAtCap is returned when the profile already has 3 linked numbers.
	ErrAtCap = errors.New("profile already has 3 linked WhatsApp numbers")
	// ErrDuplicatePhone is returned when the phone is already bound to
	// another profile (unique index violation on phone_e164).
	ErrDuplicatePhone = errors.New("phone number already linked to another account")
	// ErrInvalidPhone is returned when the supplied number cannot be resolved
	// to E.164 — malformed, or national-format with no country code available.
	// It wraps the underlying internal/phone error, so callers can use
	// errors.Is against phone.ErrNoCountry to tell "the operator must configure
	// a dial code" apart from "the customer mistyped".
	ErrInvalidPhone = errors.New("invalid phone number")
)

// ---------------------------------------------------------------------------
// Wire types
// ---------------------------------------------------------------------------

// LinkToken is the DTO returned by IssueLinkToken and GetPendingPhone.
type LinkToken struct {
	Token     string    `json:"token"`
	PhoneE164 string    `json:"phone_e164"`
	ExpiresAt time.Time `json:"expires_at"`
}

// AccountLink is the DTO returned after a successful binding.
type AccountLink struct {
	ID        string    `json:"id"`
	ProfileID string    `json:"profile_id"`
	PhoneE164 string    `json:"phone_e164"`
	BoundAt   time.Time `json:"bound_at"`
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

// Store handles all DB access for the whatsapplink package.
type Store struct {
	pool *pgxpool.Pool
}

// NewStore constructs a Store backed by pool.
func NewStore(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

// ---------------------------------------------------------------------------
// IssueLinkToken — exported so the whatsapp webhook can call it later.
// ---------------------------------------------------------------------------

// IssueLinkToken generates a 16-byte random hex token valid for 15 minutes,
// inserts it into whatsapp_link_tokens with intent='bind', and returns the
// token along with the phone and expiry.
//
// rawPhone is normalised to E.164 before storage. defaultCountryCode is the
// dial code (no "+") to read a national-format number against; pass "" when
// there is no location context, which restricts input to numbers that already
// carry their own country code.
//
// Normalising here rather than at the read side is load-bearing: phone_e164 is
// the identity key for the binding, enforced by a unique index. If "0821234567"
// and "+27821234567" reach the column as written, they are two different
// identities, the unique index does not catch the collision, and one person
// ends up with two accounts bound to the same physical handset. The column name
// has always promised E.164; this makes the promise true.
//
// Runs under ServiceRoleScope because the token table is service-role only.
func (s *Store) IssueLinkToken(ctx context.Context, rawPhone, defaultCountryCode string) (*LinkToken, error) {
	phoneE164, err := phone.Normalize(rawPhone, defaultCountryCode)
	if err != nil {
		return nil, fmt.Errorf("%w: %w", ErrInvalidPhone, err)
	}

	token, err := generateToken()
	if err != nil {
		return nil, err
	}

	expiresAt := time.Now().UTC().Add(15 * time.Minute)

	err = db.Scoped(ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
			INSERT INTO whatsapp_link_tokens (token, phone_e164, intent, expires_at)
			VALUES ($1, $2, 'bind', $3)
		`, token, phoneE164, expiresAt)
		return err
	})
	if err != nil {
		return nil, err
	}

	return &LinkToken{
		Token:     token,
		PhoneE164: phoneE164,
		ExpiresAt: expiresAt,
	}, nil
}

// IssueLinkTokenForLocation is IssueLinkToken with the default country code
// taken from the location's configured settings.
//
// This is the call the WhatsApp webhook should make once it knows which
// location the conversation belongs to: an operator who has set their location's
// phone_country_code can then accept numbers as their customers actually type
// them, while an operator who has not set one still gets strict E.164 input
// rather than numbers attributed to a country nobody chose.
func (s *Store) IssueLinkTokenForLocation(ctx context.Context, rawPhone, locationID string) (*LinkToken, error) {
	settings, err := locations.SettingsFor(ctx, s.pool, locationID)
	if err != nil {
		return nil, err
	}
	return s.IssueLinkToken(ctx, rawPhone, settings.PhoneCountryCode)
}

// ---------------------------------------------------------------------------
// GetPendingPhone — public lookup by token (no auth required).
// ---------------------------------------------------------------------------

// GetPendingPhone returns the phone number associated with a token.
// Returns ErrTokenNotFound, ErrTokenExpired, or ErrTokenConsumed as
// appropriate so the handler can map them to the right HTTP status codes.
//
// Runs under ServiceRoleScope because whatsapp_link_tokens is service-role only.
func (s *Store) GetPendingPhone(ctx context.Context, token string) (*LinkToken, error) {
	var out LinkToken

	err := db.Scoped(ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		var expiresAt time.Time
		var usedAt *time.Time

		err := tx.QueryRow(ctx, `
			SELECT phone_e164, expires_at, used_at
			FROM whatsapp_link_tokens
			WHERE token = $1
			  AND intent = 'bind'
		`, token).Scan(&out.PhoneE164, &expiresAt, &usedAt)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrTokenNotFound
		}
		if err != nil {
			return err
		}

		if usedAt != nil {
			return ErrTokenConsumed
		}
		if time.Now().UTC().After(expiresAt) {
			return ErrTokenExpired
		}

		out.Token = token
		out.ExpiresAt = expiresAt
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &out, nil
}

// ---------------------------------------------------------------------------
// BindPhone — authenticated binding (requires JWT caller profile).
// ---------------------------------------------------------------------------

// BindPhone atomically:
//  1. Fetches and validates the token (not expired, not consumed, intent='bind').
//  2. Counts existing bindings for profileID — returns ErrAtCap if >= 3.
//  3. Inserts the binding row into whatsapp_account_links.
//  4. Marks the token as consumed (sets used_at = now()).
//
// Returns ErrAtCap (409), ErrTokenExpired / ErrTokenConsumed (410), or
// ErrDuplicatePhone (409) to signal the caller's HTTP response code.
//
// Runs entirely under ServiceRoleScope so both tables pass their RLS policies
// (token table: service-role only; link table INSERT: service-role only).
func (s *Store) BindPhone(ctx context.Context, token, profileID string) (*AccountLink, error) {
	var out AccountLink

	err := db.Scoped(ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		// 1. Validate the token.
		var phoneE164 string
		var expiresAt time.Time
		var usedAt *time.Time

		err := tx.QueryRow(ctx, `
			SELECT phone_e164, expires_at, used_at
			FROM whatsapp_link_tokens
			WHERE token = $1
			  AND intent = 'bind'
		`, token).Scan(&phoneE164, &expiresAt, &usedAt)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrTokenNotFound
		}
		if err != nil {
			return err
		}
		if usedAt != nil {
			return ErrTokenConsumed
		}
		if time.Now().UTC().After(expiresAt) {
			return ErrTokenExpired
		}

		// 2. Check the 3-number cap.
		var count int
		err = tx.QueryRow(ctx, `
			SELECT count(*) FROM whatsapp_account_links WHERE profile_id = $1
		`, profileID).Scan(&count)
		if err != nil {
			return err
		}
		if count >= 3 {
			return ErrAtCap
		}

		// 3. Insert the binding.
		err = tx.QueryRow(ctx, `
			INSERT INTO whatsapp_account_links (profile_id, phone_e164)
			VALUES ($1, $2)
			RETURNING id, profile_id, phone_e164, bound_at
		`, profileID, phoneE164).Scan(
			&out.ID, &out.ProfileID, &out.PhoneE164, &out.BoundAt,
		)
		if err != nil {
			var pgErr *pgconn.PgError
			if errors.As(err, &pgErr) && pgErr.Code == "23505" {
				return ErrDuplicatePhone
			}
			return err
		}

		// 4. Mark the token consumed.
		_, err = tx.Exec(ctx, `
			UPDATE whatsapp_link_tokens SET used_at = now() WHERE token = $1
		`, token)
		return err
	})
	if err != nil {
		return nil, err
	}
	return &out, nil
}

// ---------------------------------------------------------------------------
// ListLinks — returns all bindings for the calling profile.
// ---------------------------------------------------------------------------

// ListLinks returns all whatsapp_account_links rows for profileID.
// Runs under a user-scoped Scope so the SELECT RLS policy
// (profile_id = current_user_id()) is satisfied automatically.
func (s *Store) ListLinks(ctx context.Context, profileID string) ([]AccountLink, error) {
	var out []AccountLink

	userScope := db.Scope{UserID: profileID}
	err := db.Scoped(ctx, s.pool, userScope, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
			SELECT id, profile_id, phone_e164, bound_at
			FROM whatsapp_account_links
			WHERE profile_id = $1
			ORDER BY bound_at ASC
		`, profileID)
		if err != nil {
			return err
		}
		defer rows.Close()

		for rows.Next() {
			var link AccountLink
			if err := rows.Scan(&link.ID, &link.ProfileID, &link.PhoneE164, &link.BoundAt); err != nil {
				return err
			}
			out = append(out, link)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, err
	}
	if out == nil {
		out = []AccountLink{}
	}
	return out, nil
}

// ---------------------------------------------------------------------------
// generateToken — 16-byte random hex string (32 hex chars).
// ---------------------------------------------------------------------------

func generateToken() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}
