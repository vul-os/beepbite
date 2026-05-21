// Package warouting provides read-only helpers for mapping WhatsApp phone
// numbers to their BeepBite registry rows.
//
// All queries run under db.ServiceRoleScope — whatsapp_phone_numbers is a
// platform-owned table with no tenant RLS; only the service role may read it.
//
// Public surface:
//
//	Resolve(ctx, pool, metaPhoneNumberID) (*Number, error)
//	    Maps an inbound webhook's Metadata.PhoneNumberID to the registry row.
//	    Returns ErrNotFound when no active row matches the ID.
//
//	PickOutbound(ctx, pool, lastNumberID, country) (*Number, error)
//	    Selects the number to use for an outbound message.
//	    Priority: (1) last-used number if it is still active,
//	              (2) the oldest active number for the given country,
//	              (3) ErrNoNumberForCountry when none is configured.
package warouting

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/internal/db"
)

// ---------------------------------------------------------------------------
// Sentinel errors
// ---------------------------------------------------------------------------

// ErrNotFound is returned by Resolve when metaPhoneNumberID is not in the
// registry or the matching row is inactive.
var ErrNotFound = errors.New("warouting: phone number not found")

// ErrNoNumberForCountry is returned by PickOutbound when there is no active
// number configured for the requested country and no last-used number is
// available or active.
var ErrNoNumberForCountry = errors.New("warouting: no active number for country")

// ---------------------------------------------------------------------------
// Number DTO
// ---------------------------------------------------------------------------

// Number is the read-only view of a whatsapp_phone_numbers row used by callers
// for routing decisions and conversation tagging.
type Number struct {
	ID                string    `json:"id"`
	MetaPhoneNumberID string    `json:"meta_phone_number_id"`
	DisplayPhone      string    `json:"display_phone"`
	Country           string    `json:"country"`
	Regions           []string  `json:"regions"`
	Active            bool      `json:"active"`
	ConfiguredAt      time.Time `json:"configured_at"`
}

// ---------------------------------------------------------------------------
// Resolve
// ---------------------------------------------------------------------------

// Resolve maps an inbound webhook's Metadata.PhoneNumberID to the BeepBite
// registry row. It is called by the whatsappwebhook handler (or a resolver
// layered between the handler and the chatbot service) to tag the conversation
// with country/region metadata.
//
// Only active rows are returned. If the phone number is present but inactive,
// ErrNotFound is returned so the caller can decide whether to silently drop or
// process the message without routing metadata.
func Resolve(ctx context.Context, pool *pgxpool.Pool, metaPhoneNumberID string) (*Number, error) {
	var n Number
	err := db.Scoped(ctx, pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
SELECT id, meta_phone_number_id, display_phone, country, regions, active, configured_at
FROM   whatsapp_phone_numbers
WHERE  meta_phone_number_id = $1
  AND  active = true
`, metaPhoneNumberID).Scan(
			&n.ID,
			&n.MetaPhoneNumberID,
			&n.DisplayPhone,
			&n.Country,
			&n.Regions,
			&n.Active,
			&n.ConfiguredAt,
		)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &n, nil
}

// ---------------------------------------------------------------------------
// PickOutbound
// ---------------------------------------------------------------------------

// PickOutbound selects the number to use when sending an outbound WhatsApp
// message to a customer.
//
// Selection priority:
//  1. The number identified by customerLastNumberID (the meta_phone_number_id
//     used in the most recent conversation with this customer), if it is still
//     active. Pass an empty string to skip this step.
//  2. The oldest active number for the given country (configured_at ASC).
//
// Returns ErrNoNumberForCountry when neither criterion yields an active row.
// Returns ErrNotFound when customerLastNumberID is non-empty but does not
// match any active row AND country fallback also yields nothing — callers
// should treat this equivalently to ErrNoNumberForCountry.
func PickOutbound(ctx context.Context, pool *pgxpool.Pool, customerLastNumberID, country string) (*Number, error) {
	// Fast path: try the last-used number.
	if customerLastNumberID != "" {
		n, err := Resolve(ctx, pool, customerLastNumberID)
		if err == nil {
			return n, nil
		}
		// ErrNotFound → last-used number is inactive or gone; fall through to country lookup.
		if !errors.Is(err, ErrNotFound) {
			return nil, err
		}
	}

	// Country-primary fallback: oldest active number for the country.
	var n Number
	err := db.Scoped(ctx, pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
SELECT id, meta_phone_number_id, display_phone, country, regions, active, configured_at
FROM   whatsapp_phone_numbers
WHERE  country = $1
  AND  active  = true
ORDER BY configured_at ASC
LIMIT  1
`, country).Scan(
			&n.ID,
			&n.MetaPhoneNumberID,
			&n.DisplayPhone,
			&n.Country,
			&n.Regions,
			&n.Active,
			&n.ConfiguredAt,
		)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNoNumberForCountry
	}
	if err != nil {
		return nil, err
	}
	return &n, nil
}
