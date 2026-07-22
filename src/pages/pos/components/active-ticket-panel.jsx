// active-ticket-panel.jsx — the left-hand "current ticket" panel.
//
// Renders the active ticket — either a table-bound tab (with a table_session)
// or a walk-in/takeaway ticket. Has two distinct sections:
//
//   1. "Sent" — items already fired to the kitchen (read-only). Grouped by
//      "round" (each Send creates a new order with its own number). The
//      cashier can't edit these — they're in the kitchen.
//
//   2. "New" — items being built up but not yet sent. Editable: qty +/-,
//      remove. These become a new `order` row + KDS tickets when the cashier
//      hits Send.
//
// Footer carries the two primary actions:
//
//   - **Send to Kitchen**: POSTs only the New items as an additional order on
//     this ticket. After success, those items move into Sent and clear the
//     New section.
//   - **Charge Customer**: opens the payment flow. Disabled until there's
//     something to charge (at least one sent order, or new items the cashier
//     wants to send-and-charge in one go — TBD by parent).
//
// Pure presentational. Parent owns all state.

/* eslint-disable react/prop-types */
import {
  ChefHat,
  CreditCard,
  Loader2,
  Minus,
  Plus,
  Trash2,
  Users,
  Utensils,
  Receipt,
  ShoppingCart,
  CheckCircle2,
  Clock,
  StickyNote,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useMoney } from '@/context/locale-context';
import { hasCapability } from '@/services/pos';
import AdjustmentMenu from './adjustment-menu';
import CourseSelect from './course-select';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function shortOrderNum(order) {
  return order?.order_number ?? (order?.id ? `#${String(order.id).slice(0, 6)}` : '?');
}

// ---------------------------------------------------------------------------
// Header — the "who/where" line for the active ticket
// ---------------------------------------------------------------------------

function TicketHeader({ ticket, onAdjustGuests }) {
  if (!ticket) {
    return (
      <div className="px-4 py-4 border-b border-border bg-muted/40">
        <p className="text-sm font-medium text-gray-500 dark:text-gray-400">No ticket selected</p>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Tap a table or add a walk-in to start.</p>
      </div>
    );
  }

  if (ticket.kind === 'walkin') {
    return (
      <div className="px-4 py-3 border-b border-border bg-card flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-widest text-primary font-bold mb-0.5">Walk-in</p>
          <p className="text-base font-bold text-gray-900 dark:text-white truncate">{ticket.label || `Walk-in #${ticket.id}`}</p>
        </div>
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400 text-xs font-semibold shrink-0">
          <Receipt className="w-3 h-3" />
          Counter
        </span>
      </div>
    );
  }

  // table-bound ticket
  return (
    <div className="px-4 py-3 border-b border-border bg-card flex items-center justify-between gap-2">
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-widest text-primary font-bold mb-0.5">
          {ticket.section_name ? `${ticket.section_name} · ` : ''}Table
        </p>
        <p className="text-base font-bold text-gray-900 dark:text-white">Table {ticket.table_number ?? '?'}</p>
      </div>
      {onAdjustGuests && (
        <button
          type="button"
          onClick={onAdjustGuests}
          aria-label={`Adjust guest count: ${ticket.party_size || 1} ${(ticket.party_size || 1) === 1 ? 'guest' : 'guests'}`}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary/10 border border-primary/25 text-primary text-xs font-semibold hover:bg-primary/15 active:bg-primary/20 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring shrink-0"
        >
          <Users className="w-3.5 h-3.5" />
          {ticket.party_size || 1} {(ticket.party_size || 1) === 1 ? 'guest' : 'guests'}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sent section — fired orders, read-only
// ---------------------------------------------------------------------------

// SentItemRow — individual fired line item.
// Right-click / long-press opens the AdjustmentMenu for per-item comp/discount.
function SentItemRow({ item, orderId, locationId, onAdjustSuccess }) {
  const { format, scale } = useMoney();
  const status = item.item_status || 'fired';
  const statusColor =
    status === 'ready' ? 'text-success bg-success/10 border-success/30'
    : status === 'in_progress' ? 'text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800'
    : 'text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/60 border-gray-200 dark:border-gray-700';

  const itemId     = item.order_item_id || item.id || null;
  // `unit_price` arrives as a major-unit decimal string; the multiplier that
  // turns it into minor units is the currency's, not 100 (¥500 is 500 minor).
  const priceCents = item.total_cents ?? Math.round(
    (parseFloat(item.unit_price || 0) * (item.quantity || 0)) * scale,
  );
  const canActOnItem = hasCapability('can_comp');

  return (
    <AdjustmentMenu
      orderId={orderId}
      itemId={itemId}
      currentPriceCents={priceCents}
      locationId={locationId}
      onSuccess={onAdjustSuccess}
      disabled={!canActOnItem || !itemId}
      label={item.item_name || item.name}
    >
      <div
        className={cn(
          'flex items-start gap-2 py-2 pl-3 pr-10',
          canActOnItem && itemId && 'hover:bg-muted/60 transition-colors',
        )}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-semibold text-gray-700 dark:text-gray-300 tabular-nums shrink-0">
              {item.quantity}×
            </span>
            <span className="text-sm text-gray-700 dark:text-gray-300 truncate">{item.item_name || item.name}</span>
          </div>
          {item.notes && (
            <p className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400 truncate flex items-center gap-1">
              <StickyNote className="w-2.5 h-2.5" />
              {item.notes}
            </p>
          )}
        </div>
        <span className={cn(
          'text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border',
          statusColor,
        )}>
          {status === 'fired' ? 'Fired' : status === 'in_progress' ? 'Cooking' : status === 'ready' ? 'Ready' : status}
        </span>
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300 tabular-nums shrink-0">
          {format(priceCents)}
        </span>
      </div>
    </AdjustmentMenu>
  );
}

// SentOrderGroup — one round of sent items.
// The group header supports right-click / long-press for order-level void.
function SentOrderGroup({ order, locationId, onAdjustSuccess }) {
  const items = Array.isArray(order.items) ? order.items : [];
  if (items.length === 0) return null;

  const firedAt = order.created_at || order.fired_at;
  const firedDisplay = firedAt
    ? new Date(firedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '';

  const canVoid = hasCapability('can_void');

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-card overflow-hidden shadow-sm">
      {/* Header — the AdjustmentMenu renders its own always-visible "more
          actions" button (top-right of this row) for Void; right-click /
          long-press remain as shortcuts on top of it. */}
      <AdjustmentMenu
        orderId={order.id}
        itemId={null}
        locationId={locationId}
        onSuccess={onAdjustSuccess}
        disabled={!canVoid}
        label={`order ${shortOrderNum(order)}`}
      >
        <div
          className={cn(
            'flex items-center justify-between py-2 pl-3 pr-10 bg-success/10 border-b border-success/20',
            canVoid && 'hover:bg-muted/60 transition-colors',
          )}
        >
          <div className="flex items-center gap-1.5 text-[11px] font-bold text-green-700 dark:text-green-400">
            <CheckCircle2 className="w-3.5 h-3.5 text-green-600 dark:text-green-500" />
            Sent · {shortOrderNum(order)}
          </div>
          {firedDisplay && (
            <span className="text-[10px] text-gray-400 dark:text-gray-500 inline-flex items-center gap-0.5">
              <Clock className="w-2.5 h-2.5" />
              {firedDisplay}
            </span>
          )}
        </div>
      </AdjustmentMenu>

      {/* Item rows — each has its own comp/discount context menu */}
      <div className="divide-y divide-gray-100 dark:divide-gray-800">
        {items.map((it, idx) => (
          <SentItemRow
            key={it.order_item_id || it.id || idx}
            item={it}
            orderId={order.id}
            locationId={locationId}
            onAdjustSuccess={onAdjustSuccess}
          />
        ))}
      </div>
    </div>
  );
}

function SentSection({ sentOrders, locationId, onAdjustSuccess }) {
  if (!sentOrders || sentOrders.length === 0) return null;
  return (
    <div className="px-3 py-2.5 space-y-2">
      <div className="flex items-center gap-1.5 px-1 text-[10px] uppercase tracking-widest font-bold text-gray-400 dark:text-gray-500">
        <ChefHat className="w-3.5 h-3.5" />
        Sent to kitchen
        <span className="ml-1 text-gray-300 dark:text-gray-600">·</span>
        <span>{sentOrders.length} {sentOrders.length === 1 ? 'round' : 'rounds'}</span>
      </div>
      <div className="space-y-2">
        {sentOrders.map((order) => (
          <SentOrderGroup
            key={order.id}
            order={order}
            locationId={locationId}
            onAdjustSuccess={onAdjustSuccess}
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// New section — items not yet sent, editable
// ---------------------------------------------------------------------------

function NewItemRow({ item, onBumpQty, onRemove, courses, onSetCourse }) {
  const { format, scale } = useMoney();
  const lineCents = Math.round((parseFloat(item.price || 0) * (item.qty || 0)) * scale);
  return (
    <div className="flex flex-col px-3 py-2.5 bg-card gap-1.5">
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900 dark:text-white truncate leading-tight">{item.name}</p>
          {item.modifier_names && item.modifier_names.length > 0 && (
            <p className="text-[11px] text-primary truncate mt-0.5">
              {item.modifier_names.join(', ')}
            </p>
          )}
          <p className="text-xs text-gray-400 dark:text-gray-500 tabular-nums mt-0.5">
            {format(Math.round(parseFloat(item.price || 0) * scale))} each
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Qty decrease — min 44px touch target */}
          <Button
            size="sm"
            variant="outline"
            onClick={() => onBumpQty(item.id, -1)}
            aria-label={`Decrease quantity of ${item.name}`}
            className="h-9 w-9 p-0 rounded-full border-primary/25 hover:bg-primary/10 hover:border-primary/50 focus-visible:ring-2 focus-visible:ring-ring transition"
          >
            <Minus className="w-4 h-4" />
          </Button>
          <span className="w-8 text-center text-sm font-bold tabular-nums select-none">{item.qty}</span>
          {/* Qty increase */}
          <Button
            size="sm"
            onClick={() => onBumpQty(item.id, +1)}
            aria-label={`Increase quantity of ${item.name}`}
            className="h-9 w-9 p-0 rounded-full bg-primary hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring transition"
          >
            <Plus className="w-4 h-4" />
          </Button>
        </div>
      </div>
      <div className="flex items-center justify-between pl-0.5">
        {/* Course assignment pill */}
        {courses && courses.length > 0 ? (
          <div className="flex items-center gap-1.5">
            <CourseSelect
              courseId={item.course_id || null}
              courses={courses}
              onChange={(courseId) => onSetCourse && onSetCourse(item.id, courseId)}
            />
          </div>
        ) : <span />}
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-gray-900 dark:text-white tabular-nums">
            {format(lineCents)}
          </span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onRemove(item.id)}
            aria-label={`Remove ${item.name} from order`}
            className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-full focus-visible:ring-2 focus-visible:ring-destructive transition"
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function NewSection({ newItems, onBumpQty, onRemove, courses, onSetCourse }) {
  if (!newItems || newItems.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
        <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-3">
          <ShoppingCart className="w-7 h-7 text-primary/40" />
        </div>
        <p className="text-sm font-semibold text-gray-600 dark:text-gray-400">Cart is empty</p>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1 max-w-[16ch] mx-auto">Tap any menu item to add it here.</p>
      </div>
    );
  }
  return (
    <div className="px-3 py-2.5">
      <div className="flex items-center gap-1.5 px-1 mb-2 text-[10px] uppercase tracking-widest font-bold text-primary">
        <Utensils className="w-3 h-3" />
        New — not yet sent
      </div>
      <div className="rounded-xl border border-primary/25 bg-card overflow-hidden divide-y divide-primary/15 shadow-sm">
        {newItems.map((it) => (
          <NewItemRow
            key={it.id}
            item={it}
            onBumpQty={onBumpQty}
            onRemove={onRemove}
            courses={courses}
            onSetCourse={onSetCourse}
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Footer — totals + Send + Charge
// ---------------------------------------------------------------------------

function TicketFooter({
  ticket,
  newSubtotalCents,
  sentSubtotalCents,
  totalCents,
  onSend,
  onCharge,
  sending,
  hasUnpaidOrders,
  newItemsCount,
}) {
  const { format } = useMoney();
  const canSend = newItemsCount > 0 && !sending && Boolean(ticket);
  const canCharge = hasUnpaidOrders && !sending && Boolean(ticket);

  return (
    <div className="border-t border-border bg-card px-4 py-3 space-y-2.5 shadow-[0_-2px_8px_rgba(0,0,0,0.04)] dark:shadow-[0_-2px_8px_rgba(0,0,0,0.3)]">
      {/* Subtotal breakdown */}
      {(sentSubtotalCents > 0 || newSubtotalCents > 0) && (
        <div className="text-xs space-y-1 rounded-lg bg-gray-50 dark:bg-gray-800/60 px-3 py-2">
          {sentSubtotalCents > 0 && (
            <div className="flex justify-between text-gray-500 dark:text-gray-400">
              <span>Already sent</span>
              <span className="tabular-nums font-medium">{format(sentSubtotalCents)}</span>
            </div>
          )}
          {newSubtotalCents > 0 && (
            <div className="flex justify-between text-primary font-semibold">
              <span>New items</span>
              <span className="tabular-nums">{format(newSubtotalCents)}</span>
            </div>
          )}
        </div>
      )}

      {/* Grand total */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-gray-600 dark:text-gray-400">Total</span>
        <span className="text-2xl font-bold text-gray-900 dark:text-white tabular-nums tracking-tight">{format(totalCents)}</span>
      </div>

      {/* Send / Charge — min-height 56px for thumb-friendly tap targets */}
      <div className="grid grid-cols-2 gap-2">
        <Button
          onClick={onSend}
          disabled={!canSend}
          aria-label={sending ? 'Sending order to kitchen' : `Send ${newItemsCount} item${newItemsCount === 1 ? '' : 's'} to kitchen`}
          aria-busy={sending}
          className={cn(
            'h-14 font-bold text-base shadow-sm transition-all focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
            canSend
              ? 'bg-primary hover:bg-primary/90 active:bg-primary/95 text-primary-foreground'
              : 'bg-muted text-muted-foreground cursor-not-allowed shadow-none',
          )}
        >
          {sending ? (
            <span className="flex items-center gap-1.5">
              <Loader2 className="w-4 h-4 animate-spin" />
              Sending…
            </span>
          ) : (
            <span className="flex items-center gap-1.5">
              <ChefHat className="w-4 h-4" />
              Send
              {newItemsCount > 0 && (
                <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-white/25 text-[11px] font-bold leading-none">
                  {newItemsCount}
                </span>
              )}
            </span>
          )}
        </Button>
        <Button
          onClick={onCharge}
          disabled={!canCharge}
          aria-label="Charge customer and take payment"
          className={cn(
            'h-14 font-bold text-base shadow-sm transition-all focus-visible:ring-2 focus-visible:ring-success focus-visible:ring-offset-1',
            canCharge
              ? 'bg-success hover:bg-success/90 active:bg-success/95 text-success-foreground'
              : 'bg-muted text-muted-foreground cursor-not-allowed shadow-none',
          )}
        >
          <span className="flex items-center gap-1.5">
            <CreditCard className="w-4 h-4" />
            Charge
          </span>
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export default function ActiveTicketPanel({
  ticket,                // active ticket object or null
  newItems = [],         // unsent items: [{ id, item_id, name, price, qty, course_id, ... }]
  sentOrders = [],       // sent rounds: [{ id, order_number, items: [...], created_at }]
  onBumpQty,             // (clientLineId, delta) => void
  onRemoveItem,          // (clientLineId) => void
  onSend,                // () => void
  onCharge,              // () => void
  onAdjustGuests,        // optional () => void
  onAdjust,              // optional ({ orderId, type }) => void — kept for back-compat (workspace modal)
  onAdjustSuccess,       // optional (data) => void — called after inline adjustment success
  locationId = '',       // location_id for scoping adjustment reasons + manager list
  sending = false,
  courses = [],          // [{ id, name, sort_order }] for CourseSelect (Wave 11 T11.3)
  onSetCourse,           // optional (clientLineId, courseId | null) => void
}) {
  const { scale } = useMoney();

  const newSubtotalCents = newItems.reduce(
    (sum, it) => sum + Math.round((parseFloat(it.price || 0) * (it.qty || 0)) * scale),
    0,
  );
  const sentSubtotalCents = sentOrders.reduce((orderSum, order) => {
    if (typeof order.total_cents === 'number') return orderSum + order.total_cents;
    const items = Array.isArray(order.items) ? order.items : [];
    return orderSum + items.reduce((lineSum, it) => {
      if (typeof it.total_cents === 'number') return lineSum + it.total_cents;
      return lineSum + Math.round((parseFloat(it.unit_price || 0) * (it.quantity || 0)) * scale);
    }, 0);
  }, 0);
  const totalCents = newSubtotalCents + sentSubtotalCents;

  const hasUnpaidOrders = sentOrders.some((o) => o.payment_status !== 'paid');

  return (
    <aside
      aria-label="Order ticket"
      className={cn(
        'flex flex-col bg-muted/40 border-l-2 border-border',
        // Desktop: fixed-width sidebar; mobile: full-width drawer fixed to bottom
        'w-full sm:max-w-[380px] md:max-w-[420px]',
        'h-full',
      )}
    >
      <TicketHeader ticket={ticket} onAdjustGuests={onAdjustGuests} />

      {/* Scrollable middle (Sent + New) */}
      <div className="flex-1 overflow-y-auto">
        <SentSection
          sentOrders={sentOrders}
          locationId={locationId}
          onAdjustSuccess={onAdjustSuccess}
        />
        <NewSection
          newItems={newItems}
          onBumpQty={onBumpQty}
          onRemove={onRemoveItem}
          courses={courses}
          onSetCourse={onSetCourse}
        />
      </div>

      <TicketFooter
        ticket={ticket}
        newSubtotalCents={newSubtotalCents}
        sentSubtotalCents={sentSubtotalCents}
        totalCents={totalCents}
        onSend={onSend}
        onCharge={onCharge}
        sending={sending}
        hasUnpaidOrders={hasUnpaidOrders}
        newItemsCount={newItems.reduce((s, it) => s + (it.qty || 0), 0)}
      />
    </aside>
  );
}
