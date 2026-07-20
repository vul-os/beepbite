// status-colors.js — shared status/priority → badge colour maps.
//
// The same underlying concept (e.g. a "confirmed" reservation, a "matched"
// invoice line, "simple" recipe complexity) should read with the same colour
// wherever it shows up in the app, and each individual map should use one
// consistent shade pairing (never mix e.g. green-100/text-green-700 with
// green-100/text-green-800 in the same list). This file is the single source
// of truth for the handful of status vocabularies used across inventory,
// house accounts, reservations and menu recipes.

// Reusable shade-100/700 tone pairings.
export const TONE = {
  neutral: 'bg-muted text-muted-foreground',
  info: 'bg-blue-100 text-blue-700',
  success: 'bg-green-100 text-green-700',
  warning: 'bg-amber-100 text-amber-700',
  danger: 'bg-red-100 text-red-700',
  orange: 'bg-orange-100 text-orange-700',
};

// Purchase order status (inventory/purchase-orders.jsx)
export const PO_STATUS_COLORS = {
  draft: TONE.neutral,
  sent: TONE.info,
  partially_received: TONE.warning,
  received: TONE.success,
  cancelled: TONE.danger,
  closed: TONE.neutral,
};

// Supplier invoice status (inventory/invoice-match.jsx)
export const INVOICE_STATUS_COLORS = {
  pending: TONE.neutral,
  matched: TONE.success,
  disputed: TONE.danger,
  approved: TONE.info,
  paid: TONE.success,
  cancelled: TONE.neutral,
};

// 3-way match status, shared by invoice-match.jsx (list view) and
// inventory/components/match-modal.jsx (modal detail view).
export const MATCH_STATUS_COLORS = {
  unmatched: TONE.neutral,
  matched: TONE.success,
  price_variance: TONE.warning,
  qty_variance: TONE.orange,
};

// Reservation status. "confirmed" intentionally shares the same blue as the
// reservations index page's "Confirmed" stat tile.
export const RESERVATION_STATUS_COLORS = {
  pending: TONE.warning,
  confirmed: TONE.info,
  seated: TONE.success,
  completed: TONE.neutral,
  cancelled: TONE.danger,
  no_show: TONE.danger,
};

// House-account invoice payment status
export const HOUSE_ACCOUNT_INVOICE_STATUS_COLORS = {
  paid: TONE.success,
  partial: TONE.warning,
  open: TONE.info,
};

// Recipe complexity — shared by menu/recipe-breakdown.jsx and
// menu/recipe-builder.jsx so both use the same background+text pairing.
export const COMPLEXITY_COLORS = {
  simple: TONE.success,
  moderate: TONE.warning,
  complex: TONE.danger,
};
