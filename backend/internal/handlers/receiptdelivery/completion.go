package receiptdelivery

import (
	"context"
	"fmt"
	"log"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/internal/db"
	"github.com/beepbite/backend/internal/email"
	"github.com/beepbite/backend/internal/handlers/receipts"
	"github.com/beepbite/backend/internal/integrations/whatsapp"
	"github.com/beepbite/backend/internal/locations"
	"github.com/beepbite/backend/internal/money"
	"github.com/beepbite/backend/internal/receiptpdf"
)

// SendReceiptOnCompletion is the hook the order-complete orchestrator calls
// immediately after an order transitions to the "completed" state.
//
// It generates the PDF and attempts delivery to any contact channels known for
// the order (email and/or WhatsApp). Errors are logged but never propagated —
// receipt delivery is best-effort and must not abort the completion path.
//
// Usage (caller does NOT need to import the email/wa packages directly):
//
//	receiptdelivery.SendReceiptOnCompletion(ctx, pool, orderID, emailReg, waClient)
//
// Pass nil for emailReg or waClient to skip the respective channel silently.
// The function runs under service-role for all DB access so it is safe to call
// from background goroutines that do not carry a tenant JWT context.
func SendReceiptOnCompletion(
	ctx context.Context,
	pool *pgxpool.Pool,
	orderID string,
	emailReg email.Registry,
	waClient *whatsapp.Client,
) {
	store := NewStore(pool)

	// ── 1. Fetch the receipt ────────────────────────────────────────────────

	// Inject service-role scope so reads succeed in non-request contexts.
	srCtx := db.ContextWithScope(ctx, db.ServiceRoleScope())

	receipt, err := store.GetReceipt(srCtx, orderID)
	if err != nil {
		log.Printf("receiptdelivery: SendReceiptOnCompletion: fetch receipt for order %s: %v", orderID, err)
		return
	}

	// ── 2. Resolve org_id + location_id ────────────────────────────────────

	// Resolved before rendering, not after: the location is what tells us how
	// to print the amounts, so the PDF cannot be built until we have it.
	orgID, locID, err := queryOrderOrgAndLocation(srCtx, pool, orderID)
	if err != nil {
		log.Printf("receiptdelivery: SendReceiptOnCompletion: resolve org for order %s: %v", orderID, err)
		return
	}

	// ── 3. Render PDF ───────────────────────────────────────────────────────

	// The location's currency exponent and locale drive every amount on the
	// receipt. A failed lookup means we do not know whether "1250" is 12.50 or
	// 1250, so we abandon delivery rather than send a customer a receipt that
	// is off by a factor of a hundred. Delivery is best-effort; a wrong total
	// is not.
	set, err := locations.SettingsFor(srCtx, pool, locID)
	if err != nil {
		log.Printf("receiptdelivery: SendReceiptOnCompletion: settings for location %s: %v", locID, err)
		return
	}

	pdfBytes, err := receiptpdf.Render(receipt, receiptpdf.Opts{
		Decimals: set.Decimals(),
		Locale:   set.Locale,
	})
	if err != nil {
		log.Printf("receiptdelivery: SendReceiptOnCompletion: render pdf for order %s: %v", orderID, err)
		return
	}
	_ = pdfBytes // rendered; future wave uploads to object storage

	// Record the PDF generation regardless of channel delivery.
	if rErr := store.RecordDelivery(srCtx, orderID, orgID,
		fmt.Sprintf("auto:order:%s", orderID), "pdf"); rErr != nil {
		log.Printf("receiptdelivery: SendReceiptOnCompletion: record pdf delivery for order %s: %v", orderID, rErr)
	}

	// ── 4. Fetch customer contact ───────────────────────────────────────────

	contact, err := store.GetOrderContact(srCtx, orderID)
	if err != nil {
		// Walk-in / anonymous order — no contact info.
		log.Printf("receiptdelivery: SendReceiptOnCompletion: no contact for order %s: %v", orderID, err)
		return
	}

	// ── 5. Email ──────────────────────────────────────────────────────────────

	if emailReg != nil && contact.Email != "" {
		provider, _, pErr := emailReg.For(ctx, locID)
		if pErr != nil {
			log.Printf("receiptdelivery: SendReceiptOnCompletion: email provider for order %s: %v", orderID, pErr)
		} else {
			msg := email.Message{
				To:      contact.Email,
				Subject: "Your receipt from " + receipt.StoreName,
				Text:    formatReceiptText(receipt, set),
				HTML:    formatReceiptHTML(receipt, set),
			}
			if sErr := provider.Send(ctx, msg); sErr != nil {
				log.Printf("receiptdelivery: SendReceiptOnCompletion: email send for order %s: %v", orderID, sErr)
			} else {
				if rErr := store.RecordDelivery(srCtx, orderID, orgID,
					"email:"+contact.Email, "email"); rErr != nil {
					log.Printf("receiptdelivery: SendReceiptOnCompletion: record email delivery for order %s: %v", orderID, rErr)
				}
			}
		}
	}

	// ── 6. WhatsApp ───────────────────────────────────────────────────────────

	if waClient != nil && contact.WhatsAppNumber != "" {
		body := formatReceiptText(receipt, set)
		if _, wErr := waClient.SendText(contact.WhatsAppNumber, body, false); wErr != nil {
			log.Printf("receiptdelivery: SendReceiptOnCompletion: whatsapp send for order %s: %v", orderID, wErr)
		} else {
			if rErr := store.RecordDelivery(srCtx, orderID, orgID,
				"whatsapp:"+contact.WhatsAppNumber, "whatsapp"); rErr != nil {
				log.Printf("receiptdelivery: SendReceiptOnCompletion: record wa delivery for order %s: %v", orderID, rErr)
			}
		}
	}
}

// ─── internal helpers ─────────────────────────────────────────────────────────

// queryOrderOrgAndLocation resolves organization_id and location_id for an
// order under service-role.
func queryOrderOrgAndLocation(ctx context.Context, pool *pgxpool.Pool, orderID string) (orgID, locID string, err error) {
	err = db.Scoped(ctx, pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx,
			`SELECT organization_id, location_id FROM orders WHERE id = $1`,
			orderID,
		).Scan(&orgID, &locID)
	})
	return
}

// formatReceiptText returns a plain-text summary suitable for an email body or
// WhatsApp message.
//
// set supplies the currency exponent and locale; see formatCentsSimple.
func formatReceiptText(r *receipts.Receipt, set locations.Settings) string {
	fiscal := ""
	if r.FiscalReceiptNumber != nil {
		fiscal = " | Receipt #: " + *r.FiscalReceiptNumber
	}
	return fmt.Sprintf(
		"Receipt from %s\nOrder #%s%s\nTotal: %s\nThank you for your business!",
		r.StoreName,
		r.OrderNumber,
		fiscal,
		formatCentsSimple(r.TotalCents, r.CurrencyCode, set),
	)
}

// formatReceiptHTML returns a minimal HTML email body.
func formatReceiptHTML(r *receipts.Receipt, set locations.Settings) string {
	fiscal := ""
	if r.FiscalReceiptNumber != nil {
		fiscal = "<br>Receipt #: " + *r.FiscalReceiptNumber
	}
	return fmt.Sprintf(
		"<p><strong>Receipt from %s</strong><br>Order #%s%s<br>Total: %s</p><p>Thank you for your business!</p>",
		r.StoreName,
		r.OrderNumber,
		fiscal,
		formatCentsSimple(r.TotalCents, r.CurrencyCode, set),
	)
}

// formatCentsSimple renders a minor-unit amount for an email or WhatsApp body.
//
// The exponent and locale come from the order's location, never from a
// constant. The four-case switch this replaced defaulted to two decimal places
// for every currency on earth, which reads a ¥1000 total as "JPY 10.00" and a
// KD 1.234 total as "KWD 123.40".
//
// r.CurrencyCode remains the authority on *which* currency this is; set only
// says how to draw it. They are separate on purpose: a store that changed its
// configured currency last month must not retroactively relabel old receipts.
// Unlike the PDF path there is no Latin-1 constraint here — email and WhatsApp
// are UTF-8 — so the real symbol is always used.
func formatCentsSimple(cents int64, currencyCode string, set locations.Settings) string {
	return money.Format(cents, currencyCode, set.Decimals(), set.Locale)
}
