// Package geocode exposes a public proxy endpoint for Mapbox address
// autocomplete so that the Mapbox token is never sent to the browser.
//
// Endpoint:
//
//	GET /geocode/suggest?q=<query>
//
// The handler is intentionally defensive:
//   - If the mapbox.Client is nil (token missing from environment) it returns
//     HTTP 200 with {"suggestions":[]} — guest checkout degrades gracefully.
//   - Queries shorter than 3 characters return the same empty response to
//     bound Mapbox API usage before the user has typed enough.
//   - Results are capped at 6 (enforced inside mapbox.Client.Suggest).
//
// Mount:
//
//	geocodeH := geocode.NewHandler(mbClient) // mbClient may be nil
//	geocodeH.Mount(r)                        // r is the root public router
package geocode

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/beepbite/backend/internal/integrations/mapbox"
)

// Handler serves the public geocode-suggest endpoint.
type Handler struct {
	mb *mapbox.Client // may be nil when MAPBOX_TOKEN is unset
}

// NewHandler constructs a Handler.  mb may be nil; the handler degrades
// gracefully by returning empty suggestions instead of erroring.
func NewHandler(mb *mapbox.Client) *Handler {
	return &Handler{mb: mb}
}

// Mount registers GET /geocode/suggest on r.
// r should be the root public router (no auth middleware in scope).
func (h *Handler) Mount(r chi.Router) {
	r.Get("/geocode/suggest", h.suggest)
}

// suggest handles GET /geocode/suggest?q=<query>.
func (h *Handler) suggest(w http.ResponseWriter, r *http.Request) {
	type response struct {
		Suggestions []mapbox.Suggestion `json:"suggestions"`
	}

	empty := response{Suggestions: []mapbox.Suggestion{}}

	q := r.URL.Query().Get("q")

	// Guard: client nil (token unset) or query too short — return empty, never 500.
	if h.mb == nil || len([]rune(q)) < 3 {
		writeJSON(w, http.StatusOK, empty)
		return
	}

	suggestions, err := h.mb.Suggest(q)
	if err != nil {
		// ErrNoToken or any Mapbox error — degrade gracefully.
		writeJSON(w, http.StatusOK, empty)
		return
	}

	if suggestions == nil {
		suggestions = []mapbox.Suggestion{}
	}

	w.Header().Set("Cache-Control", "public, max-age=60, s-maxage=120")
	writeJSON(w, http.StatusOK, response{Suggestions: suggestions})
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}
