package tables

import "time"

// TableSession mirrors a table_sessions row.
type TableSession struct {
	ID                     string     `json:"id"`
	TableID                string     `json:"table_id"`
	LocationID             string     `json:"location_id"`
	OpenedBy               *string    `json:"opened_by"`
	PartySize              int        `json:"party_size"`
	Status                 string     `json:"status"`
	OpenedAt               time.Time  `json:"opened_at"`
	ClosedAt               *time.Time `json:"closed_at"`
	TransferredToSessionID *string    `json:"transferred_to_session_id"`
	Notes                  *string    `json:"notes"`
	CreatedAt              time.Time  `json:"created_at"`
	UpdatedAt              time.Time  `json:"updated_at"`
}

// SessionDetail is returned by GET /sessions/{id}.
type SessionDetail struct {
	TableSession
	Seats  []Seat  `json:"seats"`
	Orders []Order `json:"orders"`
}

// Seat mirrors a seats row.
type Seat struct {
	ID             string    `json:"id"`
	TableSessionID string    `json:"table_session_id"`
	SeatNumber     int       `json:"seat_number"`
	GuestName      *string   `json:"guest_name"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}

// Order is a lightweight view of orders linked to a session.
type Order struct {
	ID           string    `json:"id"`
	OrderType    string    `json:"order_type"`
	Status       string    `json:"status"`
	CourseNumber *int      `json:"course_number"`
	CreatedAt    time.Time `json:"created_at"`
}

// CheckSplit mirrors a check_splits row.
type CheckSplit struct {
	ID             string    `json:"id"`
	TableSessionID string    `json:"table_session_id"`
	SplitLabel     string    `json:"split_label"`
	CreatedBy      *string   `json:"created_by"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}

// CheckSplitItem mirrors a check_split_items row.
type CheckSplitItem struct {
	ID           string  `json:"id"`
	CheckSplitID string  `json:"check_split_id"`
	OrderItemID  string  `json:"order_item_id"`
	Quantity     float64 `json:"quantity"`
}

// SplitCheckResult is returned by POST /sessions/{id}/split-check.
type SplitCheckResult struct {
	Splits []CheckSplit     `json:"splits"`
	Items  []CheckSplitItem `json:"items"`
}

// --- Request DTOs ---

type openSessionReq struct {
	LocationID string `json:"location_id"`
	OpenedBy   string `json:"opened_by"`
	PartySize  int    `json:"party_size"`
	Notes      string `json:"notes"`
}

type closeSessionReq struct {
	PartySize int    `json:"party_size"`
	Notes     string `json:"notes"`
}

type transferSessionReq struct {
	ToTableID string `json:"to_table_id"`
	OpenedBy  string `json:"opened_by"`
	PartySize int    `json:"party_size"`
	Notes     string `json:"notes"`
}

type splitCheckReq struct {
	CreatedBy string      `json:"created_by"`
	Splits    []splitSpec `json:"splits"`
}

type splitSpec struct {
	Label string          `json:"label"`
	Items []splitItemSpec `json:"items"`
}

type splitItemSpec struct {
	OrderItemID string  `json:"order_item_id"`
	Quantity    float64 `json:"quantity"`
}

type createSeatReq struct {
	SeatNumber int    `json:"seat_number"`
	GuestName  string `json:"guest_name"`
}

type updateSeatReq struct {
	SeatNumber int    `json:"seat_number"`
	GuestName  string `json:"guest_name"`
}
