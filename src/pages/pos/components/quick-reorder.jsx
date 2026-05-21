// quick-reorder.jsx — "The usual?" / quick re-order panel for the POS.
//
// Given a customerId, fetches the customer's last 3 orders from:
//   GET /customers/{customerId}/recent-orders?limit=3
//
// Renders each order as a tappable card. When staff taps one, the
// `onReorder(items)` callback fires with an array of cloned line items
// ready to be added to the active POS cart.
//
// onReorder payload shape (each element):
//   {
//     item_id:   string,           // UUID — the menu item to add
//     item_name: string,           // display name (for optimistic UI)
//     quantity:  number,           // same qty as the original order
//     modifiers: [                 // may be empty []
//       { modifier_id: string, name: string, price_cents: number }
//     ]
//   }
//
// Props:
//   customerId  {string}    Required. UUID of the customer.
//   onReorder   {function}  Called with the cloned items array on card tap.
//   limit       {number}    How many past orders to show (default 3).
//   className   {string}    Optional wrapper class.

/* eslint-disable react/prop-types */
import React, { useEffect, useState, useCallback } from 'react';
import { RotateCcw, ShoppingCart, Clock } from 'lucide-react';

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { formatPrice } from '@/lib/currency';
import { fetchRecentOrders } from '@/services/reorder';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns a human-readable relative time string, e.g. "3 days ago".
 * Kept simple and dependency-free.
 */
function relativeTime(dateStr) {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  if (Number.isNaN(diffMs)) return '';

  const s = Math.floor(diffMs / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return '1 day ago';
  if (d < 30) return `${d} days ago`;
  const mo = Math.floor(d / 30);
  if (mo === 1) return '1 month ago';
  return `${mo} months ago`;
}

/**
 * Build a compact summary line for an order's items.
 * e.g. "Classic Burger ×2, Fries ×1"
 * Truncates to the first 3 items and appends "+N more" when needed.
 */
function summariseItems(items) {
  if (!items || items.length === 0) return 'No items';
  const MAX_SHOWN = 3;
  const shown = items.slice(0, MAX_SHOWN);
  const parts = shown.map((it) =>
    it.quantity > 1 ? `${it.item_name} ×${it.quantity}` : it.item_name,
  );
  const rest = items.length - shown.length;
  if (rest > 0) parts.push(`+${rest} more`);
  return parts.join(', ');
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function LoadingSkeleton() {
  return (
    <div className="space-y-2">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-20 w-full rounded-xl" />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Single order card
// ---------------------------------------------------------------------------

function ReorderCard({ order, onSelect }) {
  const summary = summariseItems(order.items);
  const price = formatPrice(order.total_cents, 'ZAR');
  const when = relativeTime(order.created_at);

  return (
    <Card
      className={cn(
        'group cursor-pointer border border-border transition-colors',
        'hover:border-primary hover:bg-primary/5 active:bg-primary/10',
      )}
      onClick={() => onSelect(order)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(order);
        }
      }}
    >
      <CardContent className="flex items-start justify-between gap-3 p-4">
        {/* Left: item summary + meta */}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium leading-snug">{summary}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">{price}</span>
            <span className="mx-1.5">·</span>
            <Clock className="mr-0.5 inline-block h-3 w-3 align-text-bottom" />
            {when}
          </p>
        </div>

        {/* Right: re-order button */}
        <Button
          size="sm"
          variant="outline"
          className="shrink-0 gap-1.5 text-xs"
          tabIndex={-1} // card itself is focusable; avoid double tab stop
          aria-label={`Re-order ${summary}`}
          onClick={(e) => {
            // Prevent the card's onClick from firing twice.
            e.stopPropagation();
            onSelect(order);
          }}
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Re-order
        </Button>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

/**
 * QuickReorder — show a customer's last N orders as tappable cards.
 *
 * @param {{ customerId: string, onReorder: function, limit?: number, className?: string }} props
 */
export default function QuickReorder({
  customerId,
  onReorder,
  limit = 3,
  className,
}) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!customerId) {
      setOrders([]);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchRecentOrders(customerId, limit)
      .then((data) => {
        if (!cancelled) setOrders(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || 'Failed to load recent orders');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [customerId, limit]);

  const handleSelect = useCallback(
    (order) => {
      if (!onReorder) return;
      // Clone the line items into the payload shape the POS cart expects.
      const cloned = order.items.map((it) => ({
        item_id:   it.item_id,
        item_name: it.item_name,
        quantity:  it.quantity,
        modifiers: Array.isArray(it.modifiers) ? it.modifiers : [],
      }));
      onReorder(cloned);
    },
    [onReorder],
  );

  // --- Render states ---

  if (!customerId) return null;

  return (
    <div className={cn('space-y-3', className)}>
      {/* Header */}
      <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <ShoppingCart className="h-4 w-4 text-primary" />
        <span>The usual?</span>
      </div>

      {loading && <LoadingSkeleton />}

      {!loading && error && (
        <p className="rounded-lg bg-destructive/10 px-4 py-3 text-xs text-destructive">
          {error}
        </p>
      )}

      {!loading && !error && orders.length === 0 && (
        <p className="rounded-lg bg-muted px-4 py-3 text-xs text-muted-foreground">
          No previous orders found for this customer.
        </p>
      )}

      {!loading && !error && orders.length > 0 && (
        <div className="space-y-2">
          {orders.map((order) => (
            <ReorderCard key={order.id} order={order} onSelect={handleSelect} />
          ))}
        </div>
      )}
    </div>
  );
}
