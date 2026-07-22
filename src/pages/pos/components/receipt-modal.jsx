// receipt-modal.jsx — After-payment receipt modal for the POS.
//
// Component contract (other agents wire this in):
//
//   <ReceiptModal
//     orderId={string}      // when set + open, fetches & shows that order's receipt
//     open={bool}
//     onClose={fn}          // closes the modal
//     onNewOrder={fn}       // optional: clears the POS for the next order
//   />
//
// Print approach: scoped @media print rules injected via a <style> tag so only
// the receipt paper element is visible when the browser prints. The rest of the
// page — including the Dialog chrome — is hidden. This mirrors the approach
// used in receipt-view.jsx (Wave 24).
//
// Email / WhatsApp: no dedicated "send receipt" backend endpoint exists, so
// both buttons are rendered in a disabled/coming-soon state with a tooltip.
//
/* eslint-disable react/prop-types */
import { useCallback, useEffect, useId, useState } from 'react';
import {
  CheckCircle2,
  Loader2,
  Mail,
  MessageCircle,
  Printer,
  ReceiptText,
  RotateCcw,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { formatMoney } from '@/lib/currency';
import { fetchReceipt } from '@/services/receipts';

// ---------------------------------------------------------------------------
// Helpers (shared with receipt-view.jsx style)
// ---------------------------------------------------------------------------

function formatDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function humaniseMethod(code) {
  return (code || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// Receipt paper sub-components
// ---------------------------------------------------------------------------

function Divider() {
  // The dashed rule between receipt sections is the same "torn ticket"
  // motif used between sent rounds on the POS ticket — see .ticket-perforation
  // in index.css. Decorative only, never load-bearing for meaning.
  return <hr className="ticket-perforation my-2 print:border-muted-foreground" />;
}

function Row({ label, value, bold = false, indent = false, accent = false }) {
  return (
    <div
      className={cn(
        'flex justify-between text-sm gap-2',
        indent && 'pl-4',
        bold && 'font-semibold',
        // accent marks the grand total only — the one place on a calm,
        // customer-facing receipt worth a touch of brand kitchen-orange.
        accent && 'text-primary',
      )}
    >
      <span className={cn('text-muted-foreground print:text-foreground', bold && 'text-foreground')}>
        {label}
      </span>
      <span className="tabular-nums text-foreground print:text-foreground">{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Receipt paper — pure rendering, no fetch logic
// ---------------------------------------------------------------------------

function ReceiptPaper({ receipt, printId }) {
  // The RECEIPT's own currency, not the operator's current one. A receipt is a
  // record of a completed sale: reprinting one from a branch that trades in a
  // different currency — or after the operator changed theirs — must show the
  // money that was actually taken.
  //
  // There is deliberately no fallback. This was `|| 'ZAR'`, which stamped rand
  // onto any receipt whose order predated currency_code being populated. A
  // receipt is a customer-facing financial document; printing a currency nobody
  // verified onto one is worse than printing a bare number, which is what
  // formatMoney does when the code is empty.
  const currency = receipt.currency_code || '';
  const locale = receipt.locale || '';
  const fmt = (cents) => formatMoney(cents ?? 0, { currency, locale });

  return (
    <div
      id={printId}
      className={cn(
        'mx-auto w-full max-w-sm',
        'bg-card rounded-xl border border-border shadow-sm',
        'p-5 font-mono text-xs leading-relaxed',
        // print overrides
        'print:shadow-none print:border-none print:rounded-none print:max-w-full print:p-4',
      )}
    >
      {/* Store header — condensed-black display face reads like a letterhead
          without shouting; everything below it stays quiet and monospaced. */}
      <div className="text-center mb-3">
        <div className="flex items-center justify-center gap-1.5 mb-1">
          <ReceiptText className="w-4 h-4 text-primary print:hidden" />
          <p className="font-display text-sm text-foreground print:text-foreground">
            {receipt.store_name}
          </p>
        </div>
        {receipt.store_address && (
          <p className="text-muted-foreground print:text-foreground text-xs">
            {receipt.store_address}
          </p>
        )}
      </div>

      <Divider />

      {/* Order meta */}
      <div className="mb-2 space-y-0.5">
        <Row label="Order #" value={receipt.order_number} bold />
        <Row label="Date" value={formatDate(receipt.created_at)} />
        {receipt.fiscal_receipt_number && (
          <Row label="Fiscal #" value={receipt.fiscal_receipt_number} />
        )}
      </div>

      <Divider />

      {/* Line items */}
      <div className="mb-2 space-y-1.5">
        {(receipt.line_items || []).map((item) => (
          <div key={item.order_item_id}>
            <div className="flex justify-between font-medium text-foreground print:text-foreground">
              <span className="flex-1 pr-2">
                {item.quantity > 1 && (
                  <span className="text-muted-foreground print:text-foreground mr-1 tabular-nums">
                    {item.quantity}&times;
                  </span>
                )}
                {item.item_name}
              </span>
              <span className="tabular-nums">{fmt(item.total_price_cents)}</span>
            </div>
            {/* Modifiers */}
            {(item.modifiers || []).map((mod, mi) => (
              <div
                key={mi}
                className="flex justify-between pl-4 text-muted-foreground print:text-foreground"
              >
                <span>{mod.name}</span>
                {mod.price_cents_snapshot !== 0 && (
                  <span className="tabular-nums">
                    {mod.price_cents_snapshot > 0 ? '+' : ''}
                    {fmt(mod.price_cents_snapshot)}
                  </span>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>

      <Divider />

      {/* Financial summary */}
      <div className="mb-2 space-y-0.5">
        <Row label="Subtotal" value={fmt(receipt.subtotal_cents)} />
        <Row label="Tax" value={fmt(receipt.tax_cents)} />
        {receipt.tip_cents > 0 && (
          <Row label="Tip / Gratuity" value={fmt(receipt.tip_cents)} />
        )}
      </div>

      <Divider />

      <Row label="TOTAL" value={fmt(receipt.total_cents)} bold accent />

      <Divider />

      {/* Payments */}
      {(receipt.payments || []).length > 0 && (
        <div className="mb-2 space-y-1">
          <p className="font-semibold text-foreground print:text-foreground mb-0.5">Payment</p>
          {receipt.payments.map((p) => (
            <div key={p.payment_id}>
              <Row
                label={humaniseMethod(p.method)}
                value={fmt(p.amount_paid_cents)}
                indent
              />
              {p.change_given_cents > 0 && (
                <Row label="Change" value={fmt(p.change_given_cents)} indent />
              )}
              {p.payment_reference && (
                <div className="pl-4 text-muted-foreground print:text-foreground">
                  Ref: {p.payment_reference}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Footer */}
      <Divider />
      <p className="text-center text-muted-foreground print:text-foreground text-xs">
        Thank you for your business
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main exported component
// ---------------------------------------------------------------------------

/**
 * ReceiptModal — after-payment receipt dialog for the POS.
 *
 * @param {{
 *   orderId: string,
 *   open: boolean,
 *   onClose: () => void,
 *   onNewOrder?: () => void,
 * }} props
 */
export default function ReceiptModal({ orderId, open, onClose, onNewOrder }) {
  const [receipt, setReceipt] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Stable ID used to scope print CSS to this specific receipt element.
  // useId gives a unique value per component instance.
  const uid = useId().replace(/:/g, '');
  const printId = `receipt-print-${uid}`;

  // Fetch whenever orderId or open changes (and both are set).
  useEffect(() => {
    if (!open || !orderId) {
      // Reset state so stale data does not flash on next open.
      if (!open) {
        setReceipt(null);
        setError(null);
      }
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setReceipt(null);

    fetchReceipt(orderId).then(({ data, error: err }) => {
      if (cancelled) return;
      if (err) {
        setError(err.message || 'Failed to load receipt.');
      } else {
        setReceipt(data);
      }
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [orderId, open]);

  const handlePrint = useCallback(() => {
    window.print();
  }, []);

  const handleNewOrder = useCallback(() => {
    onNewOrder?.();
    onClose?.();
  }, [onNewOrder, onClose]);

  const handleOpenChange = useCallback(
    (isOpen) => {
      if (!isOpen) onClose?.();
    },
    [onClose],
  );

  const handleRetry = useCallback(() => {
    setError(null);
    setLoading(true);
    fetchReceipt(orderId).then(({ data, error: err }) => {
      setLoading(false);
      if (err) setError(err.message || 'Failed to load receipt.');
      else setReceipt(data);
    });
  }, [orderId]);

  return (
    <TooltipProvider delayDuration={200}>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          className={cn(
            'max-w-md w-full p-0 overflow-hidden',
            'sm:rounded-2xl',
            'max-h-[90dvh] flex flex-col',
          )}
        >
          {/* ---- Header ---- */}
          <DialogHeader className="px-5 pt-5 pb-3 border-b shrink-0">
            <DialogTitle className="flex items-center gap-2 text-base font-semibold">
              {/* Confirms a completed, paid transaction — the --success signal,
                  not brand orange. This screen is the calm "it's done" moment,
                  not a till action, so it earns the paid/confirmed colour. */}
              <CheckCircle2 className="w-5 h-5 text-success shrink-0" />
              Payment Complete
            </DialogTitle>
            <DialogDescription className="sr-only">
              Receipt for the completed order.
            </DialogDescription>
          </DialogHeader>

          {/* ---- Scrollable body ---- */}
          <div className="overflow-y-auto flex-1 px-5 py-4">
            {/* Loading */}
            {loading && (
              <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
                <p className="text-sm">Loading receipt&hellip;</p>
              </div>
            )}

            {/* Error */}
            {!loading && error && (
              <div className="flex flex-col items-center justify-center py-12 gap-3 text-destructive">
                <ReceiptText className="w-8 h-8 opacity-60" />
                <p className="text-sm font-medium text-center">{error}</p>
                <Button variant="outline" size="sm" onClick={handleRetry}>
                  Retry
                </Button>
              </div>
            )}

            {/* Receipt paper */}
            {!loading && !error && receipt && (
              <ReceiptPaper receipt={receipt} printId={printId} />
            )}
          </div>

          {/* ---- Action bar ---- */}
          <div
            className={cn(
              'shrink-0 border-t px-5 py-4',
              'flex flex-wrap items-center gap-2',
              'print:hidden',
            )}
          >
            {/* Print — available once receipt is loaded */}
            <Button
              variant="outline"
              size="sm"
              disabled={!receipt}
              onClick={handlePrint}
              className="gap-1.5"
            >
              <Printer className="w-4 h-4" />
              Print
            </Button>

            {/* Email — stubbed: no dedicated send-receipt endpoint exists */}
            <Tooltip>
              <TooltipTrigger asChild>
                {/* Wrapper span so tooltip works on a disabled button */}
                <span tabIndex={0} className="inline-flex">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled
                    className="gap-1.5 cursor-not-allowed"
                    aria-disabled="true"
                  >
                    <Mail className="w-4 h-4" />
                    Email
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent side="top">Email receipts not yet available</TooltipContent>
            </Tooltip>

            {/* WhatsApp — stubbed: no dedicated send-receipt endpoint exists */}
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={0} className="inline-flex">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled
                    className="gap-1.5 cursor-not-allowed"
                    aria-disabled="true"
                  >
                    <MessageCircle className="w-4 h-4" />
                    WhatsApp
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent side="top">WhatsApp receipts not yet available</TooltipContent>
            </Tooltip>

            {/* Spacer pushes primary action to the right */}
            <span className="flex-1" />

            {/* Done / New Order — default Button variant already carries
                primary/kitchen-orange + its own focus ring; the previous
                literal orange classes here were a redundant hand-rolled copy
                of that (and could drift out of sync with it). */}
            <Button size="sm" onClick={handleNewOrder} className="gap-1.5">
              <RotateCcw className="w-4 h-4" />
              {onNewOrder ? 'New Order' : 'Done'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/*
        Scoped print styles: only the receipt element is visible during print.
        Uses the unique printId so if multiple instances exist they do not
        conflict. Mirrors the approach in receipt-view.jsx (Wave 24).
      */}
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #${printId},
          #${printId} * { visibility: visible !important; }
          #${printId} {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
          }
        }
      `}</style>
    </TooltipProvider>
  );
}
