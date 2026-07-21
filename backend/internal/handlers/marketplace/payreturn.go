package marketplace

// payreturn.go — GET /stores/{slug}/orders/{order_id}/pay/return
//
// This is the settlement endpoint for the online-gateway checkout path (see
// checkout.go). beepbite has no inbound webhook (internal/payments/
// provider.go's own doc comment) and deliberately does not poll on a timer
// either: instead, beepbite builds this exact URL itself at Charge time
// (CheckoutStore.buildReturnURL, a signed ?ott= token binding it to one
// order — see payments.SignReturnToken) and hands it to the gateway as the
// hosted pay page's return/callback target.
//
// The customer's OWN browser is the courier for the settlement event, exactly
// as it was the courier for placing the order in the first place: when the
// processor redirects it back here after the pay page, that hit triggers
// exactly ONE authoritative payments.SettleOnlinePayment call (a GetStatus /
// patala verify, fail-closed) and renders a plain confirmation page. No
// webhook, no publicly-reachable-for-the-PROVIDER requirement (only the
// customer's browser needs to reach beepbite, and it already does), and no
// background poll loop.

import (
	"context"
	"errors"
	"fmt"
	"html"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	"github.com/beepbite/backend/internal/payments"
)

// payReturn handles GET /stores/{slug}/orders/{order_id}/pay/return.
func (h *Handler) payReturn(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	orderID := chi.URLParam(r, "order_id")
	token := r.URL.Query().Get("ott")

	tokenOrderID, ok := payments.VerifyReturnToken(h.checkoutStore.returnSecret, token)
	if !ok || tokenOrderID != orderID {
		renderPayReturnPage(w, http.StatusBadRequest, payReturnView{
			Slug:    slug,
			Heading: "Payment link invalid or expired",
			Body:    "This payment link is no longer valid. If you already paid, please contact the store directly with your order number.",
		})
		return
	}

	if h.checkoutStore.gateway == nil {
		// Online payments are not (or no longer) configured on this
		// deployment. Fail closed: never claim a payment happened.
		renderPayReturnPage(w, http.StatusServiceUnavailable, payReturnView{
			Slug:    slug,
			Heading: "Online payments unavailable",
			Body:    "This store is not currently able to confirm online payments. Please contact the store directly.",
		})
		return
	}

	orderNumber, status, err := h.checkoutStore.SettlePaymentReturn(r.Context(), slug, orderID)
	if errors.Is(err, ErrNotFound) {
		renderPayReturnPage(w, http.StatusNotFound, payReturnView{
			Slug:    slug,
			Heading: "Order not found",
			Body:    "We could not find this order for this store.",
		})
		return
	}
	if err != nil {
		// Fail closed: an error from the verify call (network, provider
		// outage, decode failure) is NEVER rendered as settled, regardless
		// of what status came back alongside it.
		renderPayReturnPage(w, http.StatusOK, payReturnView{
			Slug:        slug,
			OrderNumber: orderNumber,
			Heading:     "We couldn't confirm your payment yet",
			Body:        "This can take a minute. If you already paid, hold onto your order number below — the store can look it up, and beepbite will keep checking.",
		})
		return
	}

	switch status {
	case payments.StatusSettled:
		renderPayReturnPage(w, http.StatusOK, payReturnView{
			Slug:        slug,
			OrderNumber: orderNumber,
			Heading:     "Payment received — thank you!",
			Body:        "Your order has been confirmed and the store is getting it ready.",
		})
	case payments.StatusFailed:
		renderPayReturnPage(w, http.StatusOK, payReturnView{
			Slug:        slug,
			OrderNumber: orderNumber,
			Heading:     "Payment was not successful",
			Body:        "Your payment did not go through. Please return to the store and try again, or contact the store directly.",
		})
	default: // payments.StatusPending, or any other non-terminal value
		renderPayReturnPage(w, http.StatusOK, payReturnView{
			Slug:        slug,
			OrderNumber: orderNumber,
			Heading:     "Payment pending",
			Body:        "We haven't heard back from the payment provider yet. If you completed payment, this will confirm shortly.",
		})
	}
}

// SettlePaymentReturn resolves orderID's location by slug (defence in depth:
// an order id from the wrong store's URL is rejected, matching the 404 shape
// every other marketplace lookup uses) and then settles it through
// payments.SettleOnlinePayment inside one transaction.
func (cs *CheckoutStore) SettlePaymentReturn(ctx context.Context, slug, orderID string) (orderNumber string, status payments.Status, err error) {
	tx, err := cs.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return "", "", err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	err = tx.QueryRow(ctx, `
		SELECT o.order_number
		FROM orders o
		JOIN locations l ON l.id = o.location_id
		WHERE o.id = $1 AND l.slug = $2
	`, orderID, slug).Scan(&orderNumber)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", "", ErrNotFound
	}
	if err != nil {
		return "", "", err
	}

	status, err = payments.SettleOnlinePayment(ctx, tx, cs.gateway, orderID)
	if err != nil {
		// Still return orderNumber (useful for the confirmation page) even
		// on a verify error — but the caller must not treat this as settled.
		return orderNumber, status, err
	}
	if err := tx.Commit(ctx); err != nil {
		return orderNumber, status, err
	}
	return orderNumber, status, nil
}

// ---------------------------------------------------------------------------
// Confirmation page (plain, self-contained HTML — no SPA route, no build
// step: the customer already left the React app for the gateway's own hosted
// pay page, so a small server-rendered page here is simpler and more robust
// than trying to rehydrate SPA state after an external redirect)
// ---------------------------------------------------------------------------

type payReturnView struct {
	Slug        string
	OrderNumber string
	Heading     string
	Body        string
}

const payReturnHTMLTemplate = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>%s</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
         margin: 0; padding: 2.5rem 1.25rem; background: Canvas; color: CanvasText;
         display: flex; justify-content: center; }
  main { max-width: 26rem; text-align: center; }
  h1 { font-size: 1.375rem; margin-bottom: 0.75rem; }
  p { line-height: 1.5; opacity: 0.85; }
  .order-number { font-family: ui-monospace, SFMono-Regular, monospace; font-size: 0.875rem;
                  opacity: 0.6; margin-top: 1.5rem; }
  a { color: inherit; }
</style>
</head>
<body>
<main>
  <h1>%s</h1>
  <p>%s</p>
  %s
  <p><a href="/store/%s">Back to store</a></p>
</main>
</body>
</html>
`

func renderPayReturnPage(w http.ResponseWriter, statusCode int, v payReturnView) {
	orderNumberHTML := ""
	if v.OrderNumber != "" {
		orderNumberHTML = fmt.Sprintf(`<p class="order-number">Order %s</p>`, html.EscapeString(v.OrderNumber))
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(statusCode)
	fmt.Fprintf(w, payReturnHTMLTemplate,
		html.EscapeString(v.Heading),
		html.EscapeString(v.Heading),
		html.EscapeString(v.Body),
		orderNumberHTML,
		html.EscapeString(v.Slug),
	)
}
