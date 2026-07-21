// receipt-view.jsx — Reprint receipt view for a past order (Wave 24).
//
// Usage:
//   import ReceiptView from '@/pages/orders/receipt-view';
//   <ReceiptView orderId="<uuid>" />
//
// The component fetches the receipt from the backend, renders a print-friendly
// layout, and provides a "Print" button that calls window.print(). Styling is
// intentionally minimal and monochrome so it renders well on receipt paper.

/* eslint-disable react/prop-types */
import { useEffect, useState } from 'react';
import { Printer, Loader2, AlertCircle } from 'lucide-react';

import { fetchReceipt } from '@/services/receipts';
import { formatPrice } from '@/lib/currency';
import { useLocale } from '@/context/locale-context';

// ---------------------------------------------------------------------------
// Helpers
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
// Sub-components
// ---------------------------------------------------------------------------

function Divider() {
  return (
    <div className="border-t border-dashed border-gray-400 my-2 print:border-gray-600" />
  );
}

function Row({ label, value, bold = false, indent = false }) {
  return (
    <div
      className={`flex justify-between text-sm gap-2 ${indent ? 'pl-4' : ''} ${
        bold ? 'font-semibold' : ''
      }`}
    >
      <span className="text-gray-700 print:text-black">{label}</span>
      <span className="text-gray-900 print:text-black tabular-nums">{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

/**
 * ReceiptView — fetches and renders a printable receipt for the given orderId.
 *
 * @param {{ orderId: string, onClose?: () => void }} props
 */
export default function ReceiptView({ orderId, onClose }) {
  const { currency: activeCurrency } = useLocale();
  const [receipt, setReceipt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!orderId) {
      setLoading(false);
      setError('No order ID provided.');
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

    return () => { cancelled = true; };
  }, [orderId]);

  // --- Loading state ---
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3 text-gray-500">
        <Loader2 className="w-8 h-8 animate-spin" />
        <p className="text-sm">Loading receipt…</p>
      </div>
    );
  }

  // --- Error state ---
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3 text-red-600">
        <AlertCircle className="w-8 h-8" />
        <p className="text-sm font-medium">{error}</p>
      </div>
    );
  }

  if (!receipt) return null;

  // The order's own currency wins; the active location is only a fallback
  // for older receipts that predate the currency_code column.
  const currency = receipt.currency_code || activeCurrency || '';
  const fmt = (cents) => formatPrice(cents, currency);

  return (
    <div className="receipt-view-root">
      {/* ---- Toolbar (hidden when printing) ---- */}
      <div className="flex items-center justify-between mb-4 print:hidden">
        <h2 className="text-lg font-semibold text-gray-900">Receipt Reprint</h2>
        <div className="flex gap-2">
          <button
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white shadow hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-500 transition-colors"
          >
            <Printer className="w-4 h-4" />
            Print
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="inline-flex items-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-400 transition-colors"
            >
              Close
            </button>
          )}
        </div>
      </div>

      {/* ---- Receipt paper ---- */}
      {/* Screen: card-like; Print: full-width, no shadow */}
      <div
        id="receipt-printable"
        className="
          mx-auto max-w-sm
          bg-white rounded-xl shadow-md border border-gray-200
          p-6 font-mono text-xs leading-relaxed
          print:shadow-none print:border-none print:rounded-none print:max-w-full print:p-4
        "
      >
        {/* Store header */}
        <div className="text-center mb-3">
          <p className="text-base font-bold text-gray-900 print:text-black">
            {receipt.store_name}
          </p>
          {receipt.store_address && (
            <p className="text-gray-500 print:text-gray-800 text-xs">
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
        <div className="mb-2 space-y-1">
          {(receipt.line_items || []).map((item) => (
            <div key={item.order_item_id}>
              <div className="flex justify-between font-medium text-gray-900 print:text-black">
                <span className="flex-1 pr-2">
                  {item.quantity > 1 && (
                    <span className="text-gray-500 print:text-gray-700 mr-1">
                      {item.quantity}×
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
                  className="flex justify-between pl-4 text-gray-500 print:text-gray-700"
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

        <Row label="TOTAL" value={fmt(receipt.total_cents)} bold />

        <Divider />

        {/* Payments */}
        {(receipt.payments || []).length > 0 && (
          <div className="mb-2 space-y-1">
            <p className="font-semibold text-gray-700 print:text-black mb-0.5">
              Payment
            </p>
            {receipt.payments.map((p) => (
              <div key={p.payment_id}>
                <Row
                  label={humaniseMethod(p.method)}
                  value={fmt(p.amount_paid_cents)}
                  indent
                />
                {p.change_given_cents > 0 && (
                  <Row
                    label="Change"
                    value={fmt(p.change_given_cents)}
                    indent
                  />
                )}
                {p.payment_reference && (
                  <div className="pl-4 text-gray-400 print:text-gray-600">
                    Ref: {p.payment_reference}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Footer */}
        <Divider />
        <p className="text-center text-gray-400 print:text-gray-600 text-xs">
          Thank you for your business
        </p>
      </div>

      {/* Print-only styles injected inline to ensure they always apply */}
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #receipt-printable,
          #receipt-printable * { visibility: visible !important; }
          #receipt-printable { position: absolute; left: 0; top: 0; }
        }
      `}</style>
    </div>
  );
}
