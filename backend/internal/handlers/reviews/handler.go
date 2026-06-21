// Package reviews exposes two route surfaces:
//
//  1. PUBLIC — mounted inside the /stores router (alongside marketplace routes):
//
//     r.Route("/stores", func(r chi.Router) {
//     marketplaceH.Mount(r)        // existing
//     reviewsH.MountPublic(r)      // add this
//     })
//
//     GET /stores/{slug}/reviews?limit=N
//
//  2. AUTHED — mounted inside the authenticated API router:
//
//     r.Route("/reviews", reviewsH.MountAuthed)
//
//     POST /reviews                — customer submits a review
//     POST /reviews/{id}/reply     — owner/manager sets owner_reply
//
// MountPublic must be called on the /stores sub-router (no auth middleware).
// MountAuthed must be called after auth.Middleware + auth.RequireOrgScope.
package reviews

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/internal/auth"
)

const (
	defaultLimit = 20
	maxLimit     = 100
)

// Handler serves both the public and authed review endpoints.
type Handler struct {
	store *Store
}

// NewHandler constructs a Handler.
func NewHandler(pool *pgxpool.Pool) *Handler {
	return &Handler{store: NewStore(pool)}
}

// ---------------------------------------------------------------------------
// Mount helpers
// ---------------------------------------------------------------------------

// MountPublic registers the PUBLIC read route on the /stores sub-router.
// r is expected to be the chi sub-router already bound to /stores.
//
// Route added:
//
//	GET /stores/{slug}/reviews
func (h *Handler) MountPublic(r chi.Router) {
	r.Get("/{slug}/reviews", h.listReviews)
}

// MountAuthed registers the AUTHENTICATED write routes on r.
// r must be wrapped in auth.Middleware + auth.RequireOrgScope by the caller.
//
// Routes added:
//
//	POST /reviews
//	POST /reviews/{id}/reply
func (h *Handler) MountAuthed(r chi.Router) {
	r.Post("/", h.submitReview)
	r.Post("/{id}/reply", h.ownerReply)
}

// ---------------------------------------------------------------------------
// PUBLIC handler
// ---------------------------------------------------------------------------

// listReviews handles GET /stores/{slug}/reviews?limit=
//
// Surface: PUBLIC (no auth required).
// DB scope: MarketplaceScope — only status='visible' reviews returned.
func (h *Handler) listReviews(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	if slug == "" {
		writeError(w, http.StatusBadRequest, "slug required")
		return
	}

	limit := defaultLimit
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			if n > maxLimit {
				n = maxLimit
			}
			limit = n
		}
	}

	reviews, err := h.store.ListPublicReviews(r.Context(), slug, limit)
	if errors.Is(err, ErrNotFound) {
		writeError(w, http.StatusNotFound, "store not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	w.Header().Set("Cache-Control", "public, max-age=60")
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"data":  reviews,
		"limit": limit,
	})
}

// ---------------------------------------------------------------------------
// AUTHED handlers
// ---------------------------------------------------------------------------

// submitReviewReq is the JSON body for POST /reviews.
type submitReviewReq struct {
	OrderID string   `json:"order_id"`
	Stars   int      `json:"stars"`
	Text    *string  `json:"text"`
	Photos  []string `json:"photos"`
}

// submitReview handles POST /reviews.
//
// Surface: AUTHED customer (requires a valid bearer JWT; uses the UserID from
// Claims as the customer_profile_id).
// DB scope: ServiceRoleScope (customers have no org scope; validation of order
// ownership is enforced in-query).
func (h *Handler) submitReview(w http.ResponseWriter, r *http.Request) {
	claims, ok := auth.ClaimsFrom(r.Context())
	if !ok || claims == nil || claims.UserID == "" {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	var req submitReviewReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.OrderID == "" {
		writeError(w, http.StatusBadRequest, "order_id required")
		return
	}
	if req.Stars < 1 || req.Stars > 5 {
		writeError(w, http.StatusBadRequest, "stars must be between 1 and 5")
		return
	}

	review, err := h.store.SubmitReview(
		r.Context(),
		claims.UserID,
		req.OrderID,
		req.Stars,
		req.Text,
		req.Photos,
	)
	switch {
	case errors.Is(err, ErrOrderNotEligible):
		writeError(w, http.StatusUnprocessableEntity, "order not eligible for review — must be delivered or completed and belong to you")
		return
	case errors.Is(err, ErrDuplicateReview):
		writeError(w, http.StatusConflict, "a review already exists for this order")
		return
	case err != nil:
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	writeJSON(w, http.StatusCreated, review)
}

// replyReq is the JSON body for POST /reviews/{id}/reply.
type replyReq struct {
	Reply string `json:"reply"`
}

// ownerReply handles POST /reviews/{id}/reply.
//
// Surface: AUTHED owner/manager (requires bearer JWT + RequireOrgScope
// middleware; uses LocationIDs from OrgScope for tenant isolation).
// DB scope: ServiceRoleScope (tenant guard enforced via allowedLocationIDs
// passed down to the store layer).
func (h *Handler) ownerReply(w http.ResponseWriter, r *http.Request) {
	reviewID := chi.URLParam(r, "id")
	if reviewID == "" {
		writeError(w, http.StatusBadRequest, "review id required")
		return
	}

	orgScope := auth.OrgScopeFrom(r.Context())

	var req replyReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Reply == "" {
		writeError(w, http.StatusBadRequest, "reply must not be empty")
		return
	}

	review, err := h.store.SetOwnerReply(
		r.Context(),
		reviewID,
		req.Reply,
		orgScope.LocationIDs,
	)
	switch {
	case errors.Is(err, ErrNotFound):
		writeError(w, http.StatusNotFound, "review not found")
		return
	case errors.Is(err, ErrNotOwner):
		// Return 404 to avoid existence leaks (same pattern as cashdrawer).
		writeError(w, http.StatusNotFound, "review not found")
		return
	case err != nil:
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	writeJSON(w, http.StatusOK, review)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}
