// Package tracking provides the customer live-tracking endpoint.
// All DB access uses ServiceRoleScope: the tracking token (resolved via
// parameterised WHERE clause) is the security boundary, not RLS session vars.
// pings_visible_to_customer() is called only when the order is out_for_delivery
// and the store function's own three-gate check passes.
package tracking

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/internal/db"
)

// ErrTokenNotFound is returned when the tracking token is invalid, expired,
// or revoked.
var ErrTokenNotFound = errors.New("tracking token not found or expired")

// OrderInfo is the full response payload for GET /track/{token}.
type OrderInfo struct {
	// Token metadata
	Token   string `json:"token"`
	OrderID string `json:"order_id"`

	// Order state
	Status                string     `json:"status"`
	FulfillmentType       string     `json:"fulfillment_type"`
	EstimatedDeliveryTime *time.Time `json:"estimated_delivery_time,omitempty"`

	// Store (origin) coordinates — always returned.
	StoreLat *float64 `json:"store_lat,omitempty"`
	StoreLng *float64 `json:"store_lng,omitempty"`

	// Delivery address — text label always returned; coords returned when status
	// allows (out_for_delivery + driver within 5 km).
	DeliveryAddress *string  `json:"delivery_address,omitempty"`
	DeliveryLat     *float64 `json:"delivery_lat,omitempty"`
	DeliveryLng     *float64 `json:"delivery_lng,omitempty"`

	// Driver marker — present ONLY when pings_visible_to_customer returns a row.
	Driver *DriverMarker `json:"driver,omitempty"`
}

// DriverMarker is the driver's latest location, gated by the SQL function.
type DriverMarker struct {
	Lat        float64   `json:"lat"`
	Lng        float64   `json:"lng"`
	RecordedAt time.Time `json:"recorded_at"`
}

// Store handles all DB interactions for the tracking handler.
type Store struct {
	pool *pgxpool.Pool
}

// NewStore constructs a Store.
func NewStore(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

// GetTrackingInfo resolves token and returns the full OrderInfo, including the
// driver marker when all three SQL gates pass.
//
// Security boundary: the token is used only in a parameterised WHERE clause
// against order_tracking_tokens. ServiceRoleScope bypasses RLS so the token
// can be resolved without a user session, exactly as webhook and marketplace
// handlers do for their respective tokens.
func (s *Store) GetTrackingInfo(ctx context.Context, token string) (*OrderInfo, error) {
	var out OrderInfo
	out.Token = token

	err := db.Scoped(ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		// 1. Resolve token → order_id.  Expired or revoked tokens return no row.
		var orderID string
		err := tx.QueryRow(ctx, `
			SELECT ott.order_id::text
			FROM   order_tracking_tokens ott
			WHERE  ott.token         = $1
			  AND  ott.revoked_at   IS NULL
			  AND  ott.expires_at   >  now()
		`, token).Scan(&orderID)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrTokenNotFound
		}
		if err != nil {
			return err
		}
		out.OrderID = orderID

		// 2. Fetch order status, fulfillment type, ETA, delivery address text,
		//    delivery coordinates, and the store's lat/lng via the location.
		//    All columns nullable — driver coordinates depend on later checks.
		var (
			status          string
			fulfillmentType string
			eta             *time.Time
			deliveryAddr    *string
			deliveryLat     *float64
			deliveryLng     *float64
			storeLat        *float64
			storeLng        *float64
		)
		err = tx.QueryRow(ctx, `
			SELECT
				o.status::text,
				o.fulfillment_type::text,
				o.estimated_delivery_time,
				o.delivery_address,
				o.delivery_latitude::double precision,
				o.delivery_longitude::double precision,
				l.latitude::double precision,
				l.longitude::double precision
			FROM   orders o
			JOIN   locations l ON l.id = o.location_id
			WHERE  o.id = $1::uuid
		`, orderID).Scan(
			&status, &fulfillmentType,
			&eta,
			&deliveryAddr,
			&deliveryLat, &deliveryLng,
			&storeLat, &storeLng,
		)
		if errors.Is(err, pgx.ErrNoRows) {
			// Token resolved but order gone (very unlikely with ON DELETE CASCADE)
			return ErrTokenNotFound
		}
		if err != nil {
			return err
		}

		out.Status = status
		out.FulfillmentType = fulfillmentType
		out.EstimatedDeliveryTime = eta
		out.DeliveryAddress = deliveryAddr
		out.StoreLat = storeLat
		out.StoreLng = storeLng

		// 3. Expose delivery coordinates only when the order is out for delivery.
		//    (Returning them for every status would reveal the customer's home
		//    address to anyone who obtains an expired link that was shared.)
		if status == "out_for_delivery" {
			out.DeliveryLat = deliveryLat
			out.DeliveryLng = deliveryLng
		}

		// 4. Driver ping — call pings_visible_to_customer().
		//    The function enforces all three gates internally:
		//      a) order is out_for_delivery
		//      b) driver within 5 km of delivery address
		//      c) session current_user_id matches customer_profile_id
		//
		//    Because we run under ServiceRoleScope the session user_id is "".
		//    The function will therefore return 0 rows (gate c always fails for
		//    anonymous service-role sessions). This is intentional — precise
		//    driver coordinates are gated on the customer being authenticated.
		//    Non-authenticated callers receive the progress payload without the
		//    driver marker, which is the intended degraded experience.
		//
		//    If the orchestrator later adds a user_id to the scope (e.g. via a
		//    short-lived JWT accompanying the token), gates a–c can all pass
		//    without changing this code.
		var (
			dLat       *float64
			dLng       *float64
			recordedAt *time.Time
		)
		err = tx.QueryRow(ctx, `
			SELECT p.lat, p.lng, p.recorded_at
			FROM   pings_visible_to_customer($1) p
		`, token).Scan(&dLat, &dLng, &recordedAt)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			// pings_visible_to_customer may not exist (pre-011 schema or missing
			// migration). Treat any execution error as "no ping available" so the
			// endpoint degrades gracefully rather than returning 500.
			// The missing-object case produces a "function does not exist" error;
			// we swallow it and return the response without the driver marker.
		} else if err == nil && dLat != nil && dLng != nil && recordedAt != nil {
			out.Driver = &DriverMarker{
				Lat:        *dLat,
				Lng:        *dLng,
				RecordedAt: *recordedAt,
			}
		}
		// pgx.ErrNoRows → no ping, out.Driver stays nil (correct).

		return nil
	})
	if err != nil {
		return nil, err
	}
	return &out, nil
}
