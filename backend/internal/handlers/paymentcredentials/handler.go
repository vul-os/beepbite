package paymentcredentials

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/internal/secretbox"
)

// Handler manages BYO payment-provider credentials for locations.
type Handler struct {
	store  *Store
	box    *secretbox.Box
	appURL string
}

// NewHandler constructs a Handler. appURL is the base URL used to build
// webhook URLs (e.g. "https://api.beepbite.io"). If empty it falls back to
// APP_URL env, then the first entry in CORS_ORIGINS.
func NewHandler(pool *pgxpool.Pool, box *secretbox.Box, appURL string) *Handler {
	if appURL == "" {
		appURL = resolveAppURL()
	}
	return &Handler{
		store:  NewStore(pool),
		box:    box,
		appURL: strings.TrimRight(appURL, "/"),
	}
}

// resolveAppURL reads APP_URL or falls back to the first CORS_ORIGINS entry.
func resolveAppURL() string {
	if v := os.Getenv("APP_URL"); v != "" {
		return strings.TrimRight(v, "/")
	}
	origins := os.Getenv("CORS_ORIGINS")
	if origins != "" {
		parts := strings.Split(origins, ",")
		if len(parts) > 0 && strings.TrimSpace(parts[0]) != "" {
			return strings.TrimRight(strings.TrimSpace(parts[0]), "/")
		}
	}
	return ""
}

// webhookURL returns the per-provider/location webhook URL.
func (h *Handler) webhookURL(providerCode, locationID string) string {
	return fmt.Sprintf("%s/webhooks/%s/%s", h.appURL, providerCode, locationID)
}

// Mount attaches routes to an existing authenticated chi.Router.
func (h *Handler) Mount(r chi.Router) {
	r.Route("/payment-credentials", func(r chi.Router) {
		r.Post("/", h.create)
		r.Get("/", h.list)
		r.Delete("/{id}", h.softDelete)
		r.Post("/{id}/test", h.testKeys)
	})
}

// Routes is a standalone router convenience — prefer Mount when composing.
func (h *Handler) Routes() chi.Router {
	r := chi.NewRouter()
	r.Post("/", h.create)
	r.Get("/", h.list)
	r.Delete("/{id}", h.softDelete)
	r.Post("/{id}/test", h.testKeys)
	return r
}

// ---- request / response types -----------------------------------------------

type createReq struct {
	LocationID    string  `json:"location_id"`
	ProviderCode  string  `json:"provider_code"`
	SecretKey     string  `json:"secret_key"`
	PublicKey     *string `json:"public_key"`
	WebhookSecret string  `json:"webhook_secret"`
}

type credResponse struct {
	ID           string    `json:"id"`
	LocationID   string    `json:"location_id"`
	ProviderCode string    `json:"provider_code"`
	PublicKey    *string   `json:"public_key"`
	IsActive     bool      `json:"is_active"`
	ConfiguredAt time.Time `json:"configured_at"`
	WebhookURL   string    `json:"webhook_url"`
}

type testResult struct {
	OK      bool   `json:"ok"`
	Message string `json:"message"`
}

// ---- handlers ---------------------------------------------------------------

// create handles POST /payment-credentials.
// Encrypts secret_key and webhook_secret with AES-GCM before persisting.
// Returns the row plus the computed webhook URL.
func (h *Handler) create(w http.ResponseWriter, r *http.Request) {
	var req createReq
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}

	switch {
	case strings.TrimSpace(req.LocationID) == "":
		writeErr(w, http.StatusBadRequest, "location_id is required")
		return
	case strings.TrimSpace(req.ProviderCode) == "":
		writeErr(w, http.StatusBadRequest, "provider_code is required")
		return
	case strings.TrimSpace(req.SecretKey) == "":
		writeErr(w, http.StatusBadRequest, "secret_key is required")
		return
	}

	// Encrypt sensitive fields. Empty webhook_secret → empty ciphertext (Box
	// already handles empty → empty, so no special-case needed).
	secretCT, err := h.box.Encrypt(req.SecretKey)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "failed to encrypt secret_key")
		return
	}
	webhookCT, err := h.box.Encrypt(req.WebhookSecret)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "failed to encrypt webhook_secret")
		return
	}

	row, err := h.store.Upsert(r.Context(), upsertParams{
		LocationID:              req.LocationID,
		ProviderCode:            req.ProviderCode,
		PublicKey:               req.PublicKey,
		SecretKeyCiphertext:     secretCT,
		WebhookSecretCiphertext: webhookCT,
	})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "failed to save credentials: "+err.Error())
		return
	}

	writeJSON(w, http.StatusOK, toResponse(row, h.webhookURL(row.ProviderCode, row.LocationID)))
}

// list handles GET /payment-credentials?location_id=X.
// Returns safe fields only — ciphertexts are never included.
func (h *Handler) list(w http.ResponseWriter, r *http.Request) {
	locationID := r.URL.Query().Get("location_id")
	if strings.TrimSpace(locationID) == "" {
		writeErr(w, http.StatusBadRequest, "location_id query parameter is required")
		return
	}

	rows, err := h.store.GetByLocation(r.Context(), locationID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	out := make([]credResponse, 0, len(rows))
	for i := range rows {
		out = append(out, toResponse(&rows[i], h.webhookURL(rows[i].ProviderCode, rows[i].LocationID)))
	}
	writeJSON(w, http.StatusOK, out)
}

// softDelete handles DELETE /payment-credentials/{id}.
// Sets is_active=false (never hard-deletes).
func (h *Handler) softDelete(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		writeErr(w, http.StatusBadRequest, "id is required")
		return
	}

	if err := h.store.SoftDelete(r.Context(), id); errors.Is(err, ErrNotFound) {
		writeErr(w, http.StatusNotFound, "credential not found or already inactive")
		return
	} else if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// testKeys handles POST /payment-credentials/{id}/test.
// Decrypts the secret_key and fires a lightweight noop request against the
// provider (currently Paystack GET /balance) to verify the key is valid.
func (h *Handler) testKeys(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		writeErr(w, http.StatusBadRequest, "id is required")
		return
	}

	full, err := h.store.GetByIDFull(r.Context(), id)
	if errors.Is(err, ErrNotFound) {
		writeErr(w, http.StatusNotFound, "credential not found")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	plainSecret, err := h.box.Decrypt(full.SecretKeyCiphertext)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "failed to decrypt secret_key")
		return
	}

	ok, msg := fireProviderNoop(r.Context(), full.ProviderCode, plainSecret)
	writeJSON(w, http.StatusOK, testResult{OK: ok, Message: msg})
}

// fireProviderNoop calls a lightweight read-only endpoint on the named provider
// to verify the key is accepted. Only paystack is wired today; unknown providers
// get a "provider not supported" failure.
func fireProviderNoop(ctx context.Context, providerCode, secretKey string) (bool, string) {
	switch strings.ToLower(providerCode) {
	case "paystack":
		return paystackCheckBalance(ctx, secretKey)
	default:
		return false, fmt.Sprintf("key test not implemented for provider %q", providerCode)
	}
}

// paystackCheckBalance calls GET https://api.paystack.co/balance.
// A 200 response means the key is valid; a 401 means it is not.
func paystackCheckBalance(ctx context.Context, secretKey string) (bool, string) {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://api.paystack.co/balance", nil)
	if err != nil {
		return false, "failed to build request: " + err.Error()
	}
	req.Header.Set("Authorization", "Bearer "+secretKey)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return false, "request failed: " + err.Error()
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))

	if resp.StatusCode == http.StatusOK {
		return true, "key is valid"
	}

	// Try to surface Paystack's message.
	var p struct {
		Message string `json:"message"`
	}
	if jerr := json.Unmarshal(body, &p); jerr == nil && p.Message != "" {
		return false, p.Message
	}
	return false, fmt.Sprintf("provider returned HTTP %d", resp.StatusCode)
}

// ---- helpers ----------------------------------------------------------------

func toResponse(c *credentialRow, webhookURL string) credResponse {
	return credResponse{
		ID:           c.ID,
		LocationID:   c.LocationID,
		ProviderCode: c.ProviderCode,
		PublicKey:    c.PublicKey,
		IsActive:     c.IsActive,
		ConfiguredAt: c.CreatedAt,
		WebhookURL:   webhookURL,
	}
}

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
