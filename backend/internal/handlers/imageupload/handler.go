// Package imageupload handles POST /uploads/image.
//
// The endpoint is org-scoped (RequireOrgScope must run before Mount).
// It returns a presigned PUT URL so the client can stream the file directly to
// object storage without routing raw bytes through the API server.
//
// Wiring snippet for main.go (add after RequireOrgScope group opens):
//
//	import "github.com/beepbite/backend/internal/handlers/imageupload"
//
//	imgHandler := imageupload.NewHandler(nil) // nil → StubStorer; pass real Storer when available
//	imgHandler.Mount(authedRouter)
package imageupload

import (
	"encoding/json"
	"fmt"
	"net/http"
	"path"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/beepbite/backend/internal/auth"
	"github.com/beepbite/backend/internal/db"
)

// Handler exposes the presign endpoint.
type Handler struct {
	store Storer
}

// NewHandler creates a Handler. Pass nil for store to use the StubStorer.
// Replace with a real Storer (e.g. R2Storer) once R2 env vars are available.
func NewHandler(store Storer) *Handler {
	if store == nil {
		store = &StubStorer{}
	}
	return &Handler{store: store}
}

func (h *Handler) Mount(r chi.Router) {
	r.Post("/uploads/image", h.presign)
}

// presignReq is the JSON body for POST /uploads/image.
type presignReq struct {
	// Filename is used to derive the object key and set a sane Content-Type.
	// Must be a non-empty base name with an image extension (jpg, jpeg, png, gif, webp).
	Filename string `json:"filename"`
	// Folder is an optional sub-path within the org bucket prefix (e.g. "menu-items").
	// Defaults to "uploads" when empty. Path separators are stripped from each component.
	Folder string `json:"folder"`
}

var allowedExts = map[string]struct{}{
	".jpg": {}, ".jpeg": {}, ".png": {}, ".gif": {}, ".webp": {},
}

func (h *Handler) presign(w http.ResponseWriter, r *http.Request) {
	// Resolve org from scope injected by RequireOrgScope.
	scope := db.ScopeFromContext(r.Context())
	orgScope := auth.OrgScopeFrom(r.Context())

	orgID := scope.OrgID
	if orgID == "" && len(orgScope.Memberships) > 0 {
		orgID = orgScope.Memberships[0].OrgID
	}
	if orgID == "" {
		writeErr(w, http.StatusForbidden, "no org scope")
		return
	}

	var req presignReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}

	filename := path.Base(req.Filename)
	if filename == "" || filename == "." {
		writeErr(w, http.StatusBadRequest, "filename required")
		return
	}
	ext := strings.ToLower(path.Ext(filename))
	if _, ok := allowedExts[ext]; !ok {
		writeErr(w, http.StatusBadRequest, "unsupported image extension; use jpg, png, gif, or webp")
		return
	}

	folder := "uploads"
	if f := strings.Trim(path.Clean("/"+req.Folder), "/"); f != "" && f != "." {
		folder = f
	}

	// Build a collision-resistant key: <folder>/<unix_ms>_<sanitised_filename>
	ts := fmt.Sprintf("%d", time.Now().UnixMilli())
	safeName := sanitiseFilename(filename)
	key := folder + "/" + ts + "_" + safeName

	target, err := h.store.Presign(r.Context(), orgID, key)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "failed to generate upload URL: "+err.Error())
		return
	}

	writeJSON(w, http.StatusOK, target)
}

// sanitiseFilename strips characters that are problematic in object-storage keys.
func sanitiseFilename(name string) string {
	var b strings.Builder
	for _, ch := range name {
		if (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') ||
			(ch >= '0' && ch <= '9') || ch == '.' || ch == '-' || ch == '_' {
			b.WriteRune(ch)
		} else {
			b.WriteRune('_')
		}
	}
	return b.String()
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}
