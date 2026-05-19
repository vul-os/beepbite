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
import React from 'react';
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatRand(cents) {
  const n = (cents || 0) / 100;
  return `R ${n.toFixed(2)}`;
}

function shortOrderNum(order) {
  return order?.order_number ?? (order?.id ? `#${String(order.id).slice(0, 6)}` : '?');
}

// ---------------------------------------------------------------------------
// Header — the "who/where" line for the active ticket
// ---------------------------------------------------------------------------

function TicketHeader({ ticket, onAdjustGuests }) {
  if (!ticket) {
    return (
      <div className="px-4 py-3 border-b border-orange-100 bg-white">
        <p className="text-sm text-gray-500">No ticket selected</p>
        <p className="text-xs text-gray-400 mt-0.5">Tap a table or add a walk-in to start.</p>
      </div>
    );
  }

  if (ticket.kind === 'walkin') {
    return (
      <div className="px-4 py-3 border-b border-orange-100 bg-white flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-wide text-gray-500 font-semibold">Walk-in</p>
          <p className="text-base font-bold text-gray-900">{ticket.label || `Walk-in #${ticket.id}`}</p>
        </div>
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-amber-700 text-[11px] font-semibold">
          <Receipt className="w-3 h-3" />
          Counter
        </span>
      </div>
    );
  }

  // table-bound ticket
  return (
    <div className="px-4 py-3 border-b border-orange-100 bg-white flex items-center justify-between">
      <div>
        <p className="text-xs uppercase tracking-wide text-gray-500 font-semibold">
          {ticket.section_name ? `${ticket.section_name} · ` : ''}Table
        </p>
        <p className="text-base font-bold text-gray-900">Table {ticket.table_number ?? '?'}</p>
      </div>
      <button
        type="button"
        onClick={onAdjustGuests}
        className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-orange-50 border border-orange-200 text-orange-700 text-xs font-semibold hover:bg-orange-100 transition"
        title="Adjust guest count"
      >
        <Users className="w-3 h-3" />
        {ticket.party_size || 1} {ticket.party_size === 1 ? 'guest' : 'guests'}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sent section — fired orders, read-only
// ---------------------------------------------------------------------------

function SentItemRow({ item }) {
  const status = item.item_status || 'fired';
  const statusColor =
    status === 'ready' ? 'text-green-600 bg-green-50 border-green-200'
    : status === 'in_progress' ? 'text-amber-700 bg-amber-50 border-amber-200'
    : 'text-gray-500 bg-gray-50 border-gray-200';

  return (
    <div className="flex items-start gap-2 px-3 py-2">
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold text-gray-700 tabular-nums shrink-0">
            {item.quantity}×
          </span>
          <span className="text-sm text-gray-700 truncate">{item.item_name || item.name}</span>
        </div>
        {item.notes && (
          <p className="mt-0.5 text-[11px] text-gray-500 truncate flex items-center gap-1">
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
      <span className="text-sm font-medium text-gray-700 tabular-nums shrink-0">
        {formatRand(item.total_cents ?? Math.round((parseFloat(item.unit_price || 0) * (item.quantity || 0)) * 100))}
      </span>
    </div>
  );
}

function SentOrderGroup({ order }) {
  const items = Array.isArray(order.items) ? order.items : [];
  if (items.length === 0) return null;

  const firedAt = order.created_at || order.fired_at;
  const firedDisplay = firedAt
    ? new Date(firedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '';

  return (
    <div className="rounded-md border border-gray-200 bg-white overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 bg-gray-50/80 border-b border-gray-100">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-600">
          <CheckCircle2 className="w-3 h-3 text-green-500" />
          Sent · {shortOrderNum(order)}
        </div>
        {firedDisplay && (
          <span className="text-[10px] text-gray-400 inline-flex items-center gap-0.5">
            <Clock className="w-2.5 h-2.5" />
            {firedDisplay}
          </span>
        )}
      </div>
      <div className="divide-y divide-gray-100">
        {items.map((it, idx) => (
          <SentItemRow key={it.order_item_id || it.id || idx} item={it} />
        ))}
      </div>
    </div>
  );
}

function SentSection({ sentOrders }) {
  if (!sentOrders || sentOrders.length === 0) return null;
  return (
    <div className="px-3 py-2 space-y-2">
      <div className="flex items-center gap-1.5 px-1 text-[10px] uppercase tracking-wider font-bold text-gray-400">
        <ChefHat className="w-3 h-3" />
        Already sent
        <span className="ml-1 text-gray-300">·</span>
        <span>{sentOrders.length} {sentOrders.length === 1 ? 'round' : 'rounds'}</span>
      </div>
      <div className="space-y-2">
        {sentOrders.map((order) => (
          <SentOrderGroup key={order.id} order={order} />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// New section — items not yet sent, editable
// ---------------------------------------------------------------------------

function NewItemRow({ item, onBumpQty, onRemove }) {
  const lineCents = Math.round((parseFloat(item.price || 0) * (item.qty || 0)) * 100);
  return (
    <div className="flex items-start gap-2 px-3 py-2 bg-white">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-900 truncate">{item.name}</p>
        <p className="text-xs text-gray-500 tabular-nums mt-0.5">
          {formatRand(Math.round(parseFloat(item.price || 0) * 100))} each
        </p>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <Button
          size="sm"
          variant="outline"
          onClick={() => onBumpQty(item.id, -1)}
          className="h-7 w-7 p-0 rounded-full border-orange-200"
          aria-label="Decrease quantity"
        >
          <Minus className="w-3 h-3" />
        </Button>
        <span className="w-7 text-center text-sm font-bold tabular-nums">{item.qty}</span>
        <Button
          size="sm"
          onClick={() => onBumpQty(item.id, +1)}
          className="h-7 w-7 p-0 rounded-full bg-orange-500 hover:bg-orange-600"
          aria-label="Increase quantity"
        >
          <Plus className="w-3 h-3" />
        </Button>
        <span className="ml-1.5 w-16 text-right text-sm font-bold text-gray-900 tabular-nums">
          {formatRand(lineCents)}
        </span>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onRemove(item.id)}
          className="h-7 w-7 p-0 ml-0.5 text-gray-400 hover:text-red-600"
          aria-label="Remove"
        >
          <Trash2 className="w-3 h-3" />
        </Button>
      </div>
    </div>
  );
}

function NewSection({ newItems, onBumpQty, onRemove }) {
  if (!newItems || newItems.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center px-6 py-10 text-center text-gray-400">
        <ShoppingCart className="w-10 h-10 mb-2 opacity-40" />
        <p className="text-sm font-medium">No new items</p>
        <p className="text-xs mt-1">Tap a menu item on the right to add it.</p>
      </div>
    );
  }
  return (
    <div className="px-3 py-2">
      <div className="flex items-center gap-1.5 px-1 mb-1.5 text-[10px] uppercase tracking-wider font-bold text-orange-600">
        <Utensils className="w-3 h-3" />
        New — not yet sent
      </div>
      <div className="rounded-md border border-orange-200 bg-orange-50/30 overflow-hidden divide-y divide-orange-100">
        {newItems.map((it) => (
          <NewItemRow key={it.id} item={it} onBumpQty={onBumpQty} onRemove={onRemove} />
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
  const canSend = newItemsCount > 0 && !sending && Boolean(ticket);
  const canCharge = hasUnpaidOrders && !sending && Boolean(ticket);

  return (
    <div className="border-t border-orange-200 bg-white px-4 py-3 space-y-2">
      {/* Subtotal breakdown */}
      <div className="text-xs space-y-1">
        {sentSubtotalCents > 0 && (
          <div className="flex justify-between text-gray-500">
            <span>Already sent</span>
            <span className="tabular-nums">{formatRand(sentSubtotalCents)}</span>
          </div>
        )}
        {newSubtotalCents > 0 && (
          <div className="flex justify-between text-orange-700 font-medium">
            <span>New items</span>
            <span className="tabular-nums">{formatRand(newSubtotalCents)}</span>
          </div>
        )}
      </div>

      {/* Grand total */}
      <div className="flex items-center justify-between pt-1 border-t border-gray-100">
        <span className="text-sm font-semibold text-gray-700">Total</span>
        <span className="text-2xl font-bold text-gray-900 tabular-nums">{formatRand(totalCents)}</span>
      </div>

      {/* Send / Charge */}
      <div className="grid grid-cols-2 gap-2 pt-1">
        <Button
          onClick={onSend}
          disabled={!canSend}
          className={cn(
            'h-12 font-bold shadow-md transition',
            canSend
              ? 'bg-orange-500 hover:bg-orange-600 text-white'
              : 'bg-gray-100 text-gray-400 cursor-not-allowed',
          )}
          title={canSend ? 'Fire new items to the kitchen' : 'Add items first'}
        >
          {sending ? (
            <>
              <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
              Sending…
            </>
          ) : (
            <>
              <ChefHat className="w-4 h-4 mr-1.5" />
              Send {newItemsCount > 0 && <span className="ml-1 px-1.5 py-0.5 rounded-full bg-white/20 text-[10px]">{newItemsCount}</span>}
            </>
          )}
        </Button>
        <Button
          onClick={onCharge}
          disabled={!canCharge}
          className={cn(
            'h-12 font-bold shadow-md transition border-2',
            canCharge
              ? 'bg-green-600 hover:bg-green-700 text-white border-green-600'
              : 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed',
          )}
          title={canCharge ? 'Take payment and close the tab' : 'Send items first'}
        >
          <CreditCard className="w-4 h-4 mr-1.5" />
          Charge
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
  newItems = [],         // unsent items: [{ id, item_id, name, price, qty, ... }]
  sentOrders = [],       // sent rounds: [{ id, order_number, items: [...], created_at }]
  onBumpQty,             // (clientLineId, delta) => void
  onRemoveItem,          // (clientLineId) => void
  onSend,                // () => void
  onCharge,              // () => void
  onAdjustGuests,        // optional () => void
  sending = false,
}) {
  const newSubtotalCents = newItems.reduce(
    (sum, it) => sum + Math.round((parseFloat(it.price || 0) * (it.qty || 0)) * 100),
    0,
  );
  const sentSubtotalCents = sentOrders.reduce((orderSum, order) => {
    if (typeof order.total_cents === 'number') return orderSum + order.total_cents;
    const items = Array.isArray(order.items) ? order.items : [];
    return orderSum + items.reduce((lineSum, it) => {
      if (typeof it.total_cents === 'number') return lineSum + it.total_cents;
      return lineSum + Math.round((parseFloat(it.unit_price || 0) * (it.quantity || 0)) * 100);
    }, 0);
  }, 0);
  const totalCents = newSubtotalCents + sentSubtotalCents;

  const hasUnpaidOrders = sentOrders.some((o) => o.payment_status !== 'paid');

  return (
    <aside className="w-full max-w-[420px] flex flex-col bg-gray-50 border-l border-orange-100 h-full">
      <TicketHeader ticket={ticket} onAdjustGuests={onAdjustGuests} />

      {/* Scrollable middle (Sent + New) */}
      <div className="flex-1 overflow-y-auto">
        <SentSection sentOrders={sentOrders} />
        <NewSection
          newItems={newItems}
          onBumpQty={onBumpQty}
          onRemove={onRemoveItem}
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
