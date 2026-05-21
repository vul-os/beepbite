// Package apikeys exposes API-key management REST endpoints (Wave 22).
//
// Mount under an already-authenticated + org-scoped chi.Router group:
//
//	h := apikeys.NewHandler(pool)
//	h.Mount(r)
//
// Routes:
//
//	POST   /api-keys              — create a key (owner/manager only)
//	GET    /api-keys              — list org's keys (no hash, no full key)
//	POST   /api-keys/{id}/revoke  — revoke a key (owner/manager only)
//
// Key format: bb_<env>_<32 url-safe random chars>
// Example:    bb_live_aB3kQr7mPxN2vY9wTd4sUcFoZeHiLj1R
//
// The full plaintext key is returned ONCE at creation time (json field "key").
// Only the bcrypt hash and a short visible prefix are persisted.
package apikeys

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"

	"github.com/beepbite/backend/internal/auth"
)

// ---------------------------------------------------------------------------
// Scope allowlist
// ---------------------------------------------------------------------------

// validScopes is the authoritative set of scope strings accepted at key
// creation time. Any scope string not in this set is rejected with 400.
var validScopes = map[string]struct{}{
	"read:menu":       {},
	"write:menu":      {},
	"read:orders":     {},
	"write:orders":    {},
	"read:reports":    {},
	"read:customers":  {},
	"write:webhooks":  {},
	"write:items":     {},
	"read:staff":      {},
	"write:staff":     {},
	"read:inventory":  {},
	"write:inventory": {},
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

// Handler wires HTTP routes to the Store.
type Handler struct {
	store *Store
}

// NewHandler constructs a Handler backed by pool.
func NewHandler(pool *pgxpool.Pool) *Handler {
	return &Handler{store: NewStore(pool)}
}

// Mount registers API-key management routes on r.
func (h *Handler) Mount(r chi.Router) {
	r.Route("/api-keys", func(r chi.Router) {
		r.Post("/", h.createKey)
		r.Get("/", h.listKeys)
		r.Post("/{id}/revoke", h.revokeKey)
	})
}

// ---------------------------------------------------------------------------
// Request / response DTOs
// ---------------------------------------------------------------------------

type createKeyReq struct {
	Name        string     `json:"name"`
	Scopes      []string   `json:"scopes"`
	Environment string     `json:"environment"`
	ExpiresAt   *time.Time `json:"expires_at"`
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

// POST /api-keys
//
// Body: {"name":"...","scopes":["read:menu"],"environment":"live","expires_at":"..."}
// Requires: owner or manager role.
// Returns: the api_keys row PLUS the full plaintext key (one-time only).
func (h *Handler) createKey(w http.ResponseWriter, r *http.Request) {
	if !callerIsOwnerOrManager(r) {
		writeErr(w, http.StatusForbidden, "requires owner or manager role")
		return
	}

	var req createKeyReq
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}

	// --- validate name ---
	if req.Name == "" {
		writeErr(w, http.StatusBadRequest, "name is required")
		return
	}

	// --- validate environment ---
	env := req.Environment
	if env == "" {
		env = "live"
	}
	if env != "live" && env != "test" {
		writeErr(w, http.StatusBadRequest, "environment must be 'live' or 'test'")
		return
	}

	// --- validate scopes ---
	if len(req.Scopes) == 0 {
		writeErr(w, http.StatusBadRequest, "at least one scope is required")
		return
	}
	seen := make(map[string]struct{}, len(req.Scopes))
	for _, sc := range req.Scopes {
		if _, ok := validScopes[sc]; !ok {
			writeErr(w, http.StatusBadRequest, fmt.Sprintf("unknown scope: %q", sc))
			return
		}
		seen[sc] = struct{}{}
	}
	// deduplicate
	unique := make([]string, 0, len(seen))
	for sc := range seen {
		unique = append(unique, sc)
	}

	// --- resolve org ---
	orgScope := auth.OrgScopeFrom(r.Context())
	orgID := ""
	for _, m := range orgScope.Memberships {
		orgID = m.OrgID
		break
	}
	if orgID == "" {
		writeErr(w, http.StatusForbidden, "no organization scope")
		return
	}

	// --- generate key ---
	// Shape: bb_<env>_<32 url-safe-base64 chars (no padding)>
	// 24 random bytes → 32 base64url chars (24 * 4/3 = 32).
	rawBytes := make([]byte, 24)
	if _, err := rand.Read(rawBytes); err != nil {
		writeErr(w, http.StatusInternalServerError, "failed to generate key")
		return
	}
	randomPart := base64.RawURLEncoding.EncodeToString(rawBytes) // exactly 32 chars

	plaintext := fmt.Sprintf("bb_%s_%s", env, randomPart)

	// Visible prefix: "bb_<env>_" + first 8 random chars → e.g. "bb_live_aB3kQr7m"
	prefixVisible := plaintext[:len(fmt.Sprintf("bb_%s_", env))+8]

	// --- bcrypt hash ---
	hashBytes, err := bcrypt.GenerateFromPassword([]byte(plaintext), bcrypt.DefaultCost)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "failed to hash key")
		return
	}

	// --- created_by: user ID from org scope ---
	createdBy := orgScope.UserID

	// --- persist ---
	key, err := h.store.InsertKey(
		r.Context(),
		orgID, req.Name, prefixVisible, string(hashBytes), env,
		unique, req.ExpiresAt, createdBy,
	)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	result := CreateResult{
		APIKey:       *key,
		PlaintextKey: plaintext,
	}
	writeJSON(w, http.StatusCreated, result)
}

// GET /api-keys
//
// Returns all api_keys rows for the caller's org — never the hash or full key.
func (h *Handler) listKeys(w http.ResponseWriter, r *http.Request) {
	orgID := resolveOrgID(r)
	if orgID == "" {
		writeErr(w, http.StatusForbidden, "no organization scope")
		return
	}

	keys, err := h.store.ListKeys(r.Context(), orgID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, keys)
}

// POST /api-keys/{id}/revoke
//
// Sets revoked_at = now() for the identified key.
// Requires: owner or manager role.
func (h *Handler) revokeKey(w http.ResponseWriter, r *http.Request) {
	if !callerIsOwnerOrManager(r) {
		writeErr(w, http.StatusForbidden, "requires owner or manager role")
		return
	}

	keyID := chi.URLParam(r, "id")
	if keyID == "" {
		writeErr(w, http.StatusBadRequest, "id is required")
		return
	}

	orgID := resolveOrgID(r)
	if orgID == "" {
		writeErr(w, http.StatusForbidden, "no organization scope")
		return
	}

	if err := h.store.RevokeKey(r.Context(), orgID, keyID); err != nil {
		if errors.Is(err, ErrKeyNotFound) {
			writeErr(w, http.StatusNotFound, "api key not found or already revoked")
			return
		}
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ---------------------------------------------------------------------------
// Authorization + org helpers
// ---------------------------------------------------------------------------

// callerIsOwnerOrManager returns true when the OrgScope in context contains at
// least one membership with role 'owner' or 'manager'.
func callerIsOwnerOrManager(r *http.Request) bool {
	scope := auth.OrgScopeFrom(r.Context())
	for _, m := range scope.Memberships {
		if m.Role == "owner" || m.Role == "manager" {
			return true
		}
	}
	return false
}

// resolveOrgID returns the first org ID from the request's OrgScope, or "".
func resolveOrgID(r *http.Request) string {
	scope := auth.OrgScopeFrom(r.Context())
	for _, m := range scope.Memberships {
		return m.OrgID
	}
	return ""
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

func decodeJSON(r *http.Request, v any) error {
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	return dec.Decode(v)
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}
