package transferwebhook

import (
	"context"
	"log"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/internal/integrations/paystack"
)

// Reconciler periodically finds merchant_payouts stuck in 'initiated' and
// syncs their status by querying Paystack GET /transfer/:transfer_code.
type Reconciler struct {
	db       *pgxpool.Pool
	paystack *paystack.Manager
	store    *Store
}

// NewReconciler constructs a Reconciler.
func NewReconciler(db *pgxpool.Pool, ps *paystack.Manager) *Reconciler {
	return &Reconciler{
		db:       db,
		paystack: ps,
		store:    NewStore(db),
	}
}

// Start runs the reconciliation loop until ctx is cancelled.  It ticks every
// 30 minutes and is safe to run as a goroutine.
func (r *Reconciler) Start(ctx context.Context) {
	ticker := time.NewTicker(30 * time.Minute)
	defer ticker.Stop()

	log.Println("transferwebhook/recon: started (30-minute interval)")

	// Run once immediately on startup, then on each tick.
	r.run(ctx)

	for {
		select {
		case <-ctx.Done():
			log.Println("transferwebhook/recon: stopped")
			return
		case <-ticker.C:
			r.run(ctx)
		}
	}
}

// run performs a single reconciliation pass.
func (r *Reconciler) run(ctx context.Context) {
	queryCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	payouts, err := r.store.StickyInitiatedPayouts(queryCtx)
	cancel()
	if err != nil {
		log.Printf("transferwebhook/recon: list stuck payouts: %v", err)
		return
	}

	if len(payouts) == 0 {
		return
	}

	log.Printf("transferwebhook/recon: reconciling %d stuck payout(s)", len(payouts))

	for _, p := range payouts {
		if ctx.Err() != nil {
			return // shutdown requested mid-loop
		}
		r.reconcilePayout(ctx, p)
	}
}

// reconcilePayout fetches the transfer state from Paystack and updates the DB row.
func (r *Reconciler) reconcilePayout(ctx context.Context, p PayoutRow) {
	if p.ProviderTransferID == "" {
		log.Printf("transferwebhook/recon: payout %s has no transfer_code, skipping", p.ID)
		return
	}

	// Derive the Paystack client from the region associated with the payout's
	// organization.  We ask the Manager for the first configured region that
	// matches.  The simplest approach is to try the region via ClientFor;
	// since we don't store region on payouts directly we query Paystack using
	// any available region client and fall back gracefully.
	//
	// We iterate the known regions; if the transfer_code is on that region's
	// account the API will return it.  On an error we log and skip.
	client, err := r.clientForPayout(ctx, p)
	if err != nil {
		log.Printf("transferwebhook/recon: payout %s get client: %v", p.ID, err)
		return
	}

	callCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	detail, err := client.GetTransfer(callCtx, p.ProviderTransferID)
	cancel()
	if err != nil {
		log.Printf("transferwebhook/recon: payout %s GetTransfer(%s): %v",
			p.ID, p.ProviderTransferID, err)
		return
	}

	// Map Paystack status to our internal status.
	newStatus, failureReason := mapTransferStatus(detail)
	if newStatus == "" || newStatus == "initiated" {
		// Still in-flight on Paystack's side — nothing to update yet.
		return
	}

	updateCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	if err := r.store.UpdatePayoutStatus(updateCtx, p.ID, newStatus, failureReason); err != nil {
		log.Printf("transferwebhook/recon: payout %s UpdatePayoutStatus: %v", p.ID, err)
		return
	}

	log.Printf("transferwebhook/recon: payout %s synced → %s", p.ID, newStatus)
}

// clientForPayout returns a Paystack client that can query the transfer.
// We try each loaded region in turn; the first one that has credentials wins.
// In practice most deployments are single-region so this is a fast no-op.
func (r *Reconciler) clientForPayout(_ context.Context, _ PayoutRow) (*paystack.Client, error) {
	// clientForAnyRegion uses ClientFor which takes a region code.
	// Since we don't store region on the payout row we use the Manager's
	// internal map.  Manager exposes ForRegion; we call ClientFor directly.
	//
	// If there are multiple regions, the correct approach would be to store
	// the region_id on merchant_payouts and resolve it here. For now we return
	// the first configured region's client, which is the common case.
	client, _, err := r.paystack.ClientForAnyRegion()
	return client, err
}

// mapTransferStatus converts Paystack's transfer status string to our DB enum.
// Returns ("", "") when the transfer is still in-flight.
func mapTransferStatus(d *paystack.TransferDetail) (status, failureReason string) {
	switch d.Status {
	case "success":
		return "success", ""
	case "failed":
		reason := d.Reason
		if reason == "" && len(d.Failures) > 0 {
			reason = d.Failures[0].Reason
		}
		return "failed", reason
	case "reversed":
		return "reversed", ""
	default:
		// "pending", "otp", "processing" → still in-flight
		return "", ""
	}
}
