package marketplace_test

// Unit tests for POST /stores/{slug}/orders (marketplace checkout).
//
// These tests exercise the HTTP layer without a live database. They confirm
// that validation and routing work correctly before the DB call is attempted.
//
// For integration coverage see store_test.go (which skips without TEST_DATABASE_URL).

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/beepbite/backend/internal/handlers/marketplace"
)

// buildCheckoutRouter wires a marketplace.Handler under /stores so we can
// target /stores/{slug}/orders in tests.
func buildCheckoutRouter() http.Handler {
	h := marketplace.NewHandler(nil) // nil pool — validation tests don't hit DB
	r := chi.NewRouter()
	// Recover panics from nil pool so tests get 500 not a crash.
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			defer func() {
				if rec := recover(); rec != nil {
					w.WriteHeader(http.StatusInternalServerError)
				}
			}()
			next.ServeHTTP(w, r)
		})
	})
	r.Route("/stores", h.Mount)
	return r
}

func TestCheckout_EmptyItems_Returns400(t *testing.T) {
	body := bytes.NewBufferString(`{"fulfillment_type":"delivery","items":[]}`)
	req := httptest.NewRequest(http.MethodPost, "/stores/test-store/orders", body)
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	buildCheckoutRouter().ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for empty items, got %d — body: %s", rr.Code, rr.Body.String())
	}
}

func TestCheckout_InvalidFulfillmentType_Returns400(t *testing.T) {
	body := bytes.NewBufferString(`{"fulfillment_type":"teleportation","items":[{"item_id":"x","quantity":1}]}`)
	req := httptest.NewRequest(http.MethodPost, "/stores/test-store/orders", body)
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	buildCheckoutRouter().ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for invalid fulfillment_type, got %d", rr.Code)
	}
}

func TestCheckout_ValidRequest_PassesValidation(t *testing.T) {
	// A well-formed request should pass HTTP validation and proceed to the DB
	// layer (which panics with nil pool → 500). The test asserts NOT 400.
	payload := marketplace.CheckoutReq{
		FulfillmentType:  "delivery",
		OnDeliveryMethod: "cash",
		Items:            []marketplace.CheckoutLineInput{{ItemID: "item-1", Quantity: 2}},
	}
	b, _ := json.Marshal(payload)
	req := httptest.NewRequest(http.MethodPost, "/stores/my-store/orders", bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	buildCheckoutRouter().ServeHTTP(rr, req)

	if rr.Code == http.StatusBadRequest {
		t.Errorf("valid request must not return 400 — body: %s", rr.Body.String())
	}
	// With nil pool the DB call panics → recovered to 500. Accept 404 or 5xx.
	if rr.Code == http.StatusOK || rr.Code == http.StatusCreated {
		// Unexpected success without DB; log for awareness.
		t.Logf("unexpected 2xx without DB: %d — body: %s", rr.Code, rr.Body.String())
	}
}
