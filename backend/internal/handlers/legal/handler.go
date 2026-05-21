// Package legal provides REST endpoints for legal documents and acceptance recording.
//
// Public endpoints (no auth):
//
//	GET /legal/{kind}/current   — returns the latest effective document for
//	                              kind=terms or kind=privacy.
//
// Authenticated endpoints (JWT required):
//
//	POST /legal/accept          — records the caller's acceptance of a document
//	                              version, identified by document_id.
//
// Mount in main.go:
//
//	// Public (outside auth group):
//	legalH := legal.NewHandler(database.Pool)
//	r.Route("/legal", legalH.MountPublic)
//
//	// Authenticated (inside auth.Middleware group, after RequireOrgScope):
//	legalH.MountAuthed(r)
//
// The handler reads the client IP from r.RemoteAddr (set by chi's
// middleware.RealIP) for acceptance records. IP is stored for audit purposes
// only.
package legal

import (
	"encoding/json"
	"errors"
	"net"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/internal/auth"
	"github.com/beepbite/backend/internal/db"
)

// Handler wires the store and chi routes.
type Handler struct {
	store *Store
}

// NewHandler constructs a Handler backed by pool.
func NewHandler(pool *pgxpool.Pool) *Handler {
	return &Handler{store: NewStore(pool)}
}

// MountPublic registers unauthenticated routes on r.
// r is expected to be the /legal sub-router.
func (h *Handler) MountPublic(r chi.Router) {
	// GET /legal/{kind}/current — kind must be "terms" or "privacy".
	r.Get("/{kind}/current", h.getCurrentDocument)
}

// MountAuthed registers JWT-protected routes.
// Call inside the auth.Middleware + RequireOrgScope group.
func (h *Handler) MountAuthed(r chi.Router) {
	r.Post("/legal/accept", h.acceptDocument)
}

// --- acceptReq is the POST /legal/accept body ---

type acceptReq struct {
	DocumentID string `json:"document_id"`
}

// --- Handlers ---

// GET /legal/{kind}/current
//
// Returns the latest effective legal document for the given kind.
// No authentication required.
func (h *Handler) getCurrentDocument(w http.ResponseWriter, r *http.Request) {
	kind := chi.URLParam(r, "kind")
	if kind != "terms" && kind != "privacy" {
		writeErr(w, http.StatusBadRequest, "kind must be 'terms' or 'privacy'")
		return
	}

	doc, err := h.store.GetCurrentDocument(r.Context(), kind)
	switch {
	case errors.Is(err, ErrDocumentNotFound):
		writeErr(w, http.StatusNotFound, "no current document found for kind: "+kind)
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
	default:
		w.Header().Set("Cache-Control", "public, max-age=300") // 5 min cache
		writeJSON(w, http.StatusOK, doc)
	}
}

// POST /legal/accept
//
// Records the authenticated caller's acceptance of a specific document version.
// Body: { "document_id": "<uuid>" }
// Returns 201 Created with the acceptance record, or 200 OK if already accepted.
func (h *Handler) acceptDocument(w http.ResponseWriter, r *http.Request) {
	claims, ok := auth.ClaimsFrom(r.Context())
	if !ok || claims == nil || claims.UserID == "" {
		writeErr(w, http.StatusUnauthorized, "authentication required")
		return
	}

	var req acceptReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.DocumentID == "" {
		writeErr(w, http.StatusBadRequest, "document_id is required")
		return
	}

	// Build a profile-scoped db.Scope from the JWT claims.
	// We only need UserID for the RLS INSERT policy
	// (profile_id = current_user_id()).
	scope := db.Scope{UserID: claims.UserID}

	ip := clientIP(r)

	acc, err := h.store.RecordAcceptance(r.Context(), scope, claims.UserID, req.DocumentID, ip)
	switch {
	case errors.Is(err, ErrAlreadyAccepted):
		// Idempotent: already accepted — return 200 with a stable body.
		writeJSON(w, http.StatusOK, map[string]any{
			"already_accepted": true,
			"profile_id":       claims.UserID,
			"document_id":      req.DocumentID,
		})
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
	default:
		writeJSON(w, http.StatusCreated, acc)
	}
}

// --- helpers ---

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}

// clientIP extracts the client IP from r.RemoteAddr. chi's middleware.RealIP
// is applied globally and rewrites RemoteAddr to the real client IP, so we do
// not read the spoofable X-Forwarded-For header directly here. Returns an
// empty string if the host portion cannot be extracted.
func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return ""
	}
	return host
}
