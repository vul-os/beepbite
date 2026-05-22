// expo-order-card.jsx — read-only card for the expediter (expo) view.
//
// Each card represents one in-flight order. station_tickets is an array
// decoded from the kds_expo_view jsonb_agg. Each station object has:
//   { ticket_id, station_name, status, fired_at, ready_at, course_number,
//     items: [{ order_item_id, quantity, item_status, notes }] }
//
// The card is "blocked" when some stations are ready/bumped while at least
// one is still firing — the expo needs to chase the slow station.
// Color-coded urgency header: green < 5 min, amber 5-15 min, red > 15 min.

/* eslint-disable react/prop-types */
import { Bell, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

// ---- Urgency thresholds (minutes) ------------------------------------------
const AMBER_MIN = 5;
const RED_MIN   = 15;

function urgencyBucket(firedAtMs, now) {
  if (!firedAtMs) return 'green';
  const mins = (now - firedAtMs) / 60000;
  if (mins >= RED_MIN)   return 'red';
  if (mins >= AMBER_MIN) return 'amber';
  return 'green';
}

// Dark-mode first palette that reads from across a kitchen.
const URGENCY = {
  green: {
    card:       'border-2 border-emerald-700 bg-gray-900',
    header:     'bg-emerald-900',
    headerText: 'text-emerald-50',
    timer:      'text-emerald-300',
    dot:        'bg-emerald-400',
  },
  amber: {
    card:       'border-2 border-amber-600 bg-gray-900',
    header:     'bg-amber-800',
    headerText: 'text-amber-50',
    timer:      'text-amber-200',
    dot:        'bg-amber-300 animate-pulse',
  },
  red: {
    card:       'border-2 border-red-600 bg-gray-900 ring-2 ring-red-500/40',
    header:     'bg-red-800',
    headerText: 'text-red-50',
    timer:      'text-red-200',
    dot:        'bg-red-300 animate-ping',
  },
};

// ---- Station status ---------------------------------------------------------
const STATION_STATUS = {
  fired: {
    label: 'Fired',
    cls:   'bg-orange-900/60 text-orange-300 border border-orange-700/50',
  },
  in_progress: {
    label: 'Cooking',
    cls:   'bg-sky-900/60 text-sky-300 border border-sky-700/50',
  },
  ready: {
    label: 'Ready',
    cls:   'bg-emerald-900/60 text-emerald-300 border border-emerald-700/50',
  },
  bumped: {
    label: 'Bumped',
    cls:   'bg-gray-800 text-gray-400 border border-gray-700',
  },
  cancelled: {
    label: 'Cancelled',
    cls:   'bg-red-950/60 text-red-400 border border-red-800/50',
  },
};

// Per-item dot colors
const ITEM_STATUS_DOT = {
  fired:       'bg-orange-500',
  in_progress: 'bg-sky-400',
  ready:       'bg-emerald-400',
};

// ---- Order type badge -------------------------------------------------------
const ORDER_TYPE_BADGE = {
  dine_in:    { label: 'Dine-In',    cls: 'bg-orange-500/20 text-orange-300 border border-orange-600/40' },
  collection: { label: 'Collection', cls: 'bg-blue-500/20 text-blue-300 border border-blue-600/40'       },
  delivery:   { label: 'Delivery',   cls: 'bg-purple-500/20 text-purple-300 border border-purple-600/40' },
};

// ---- Helpers ----------------------------------------------------------------
function fmtElapsed(ms, now) {
  if (!ms) return '';
  const t = typeof ms === 'string' ? Date.parse(ms) : ms;
  const totalSec = Math.max(0, Math.floor((now - t) / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ---- Component --------------------------------------------------------------
export function ExpoOrderCard({ order, now }) {
  const stations = Array.isArray(order.station_tickets) ? order.station_tickets : [];

  // Urgency from earliest_fired_at (already a JS timestamp or ISO string).
  const firedMs  = order.earliest_fired_at
    ? (typeof order.earliest_fired_at === 'string' ? Date.parse(order.earliest_fired_at) : order.earliest_fired_at)
    : null;
  const bucket   = urgencyBucket(firedMs, now);
  const elapsed  = firedMs ? fmtElapsed(firedMs, now) : null;
  const theme    = URGENCY[bucket];

  // Aggregate station states.
  const anyDone  = stations.some((s) => s.status === 'bumped' || s.status === 'ready');
  const anyOpen  = stations.some((s) => s.status === 'fired'  || s.status === 'in_progress');
  const blocked  = anyDone && anyOpen;
  const allReady = stations.length > 0 && stations.every((s) => s.status === 'ready' || s.status === 'bumped');

  // Order number: prefer human-readable, fall back to short UUID prefix.
  const displayId = order.order_number || order.order_id?.slice(0, 8) || '—';
  const typeMeta = ORDER_TYPE_BADGE[order.order_type] || null;

  return (
    <div
      className={cn(
        'flex flex-col overflow-hidden rounded-xl shadow-xl transition-all duration-200',
        'animate-in fade-in-50 slide-in-from-bottom-2 duration-300',
        theme.card,
      )}
      role="article"
      aria-label={`Order ${displayId}`}
    >
      {/* ------------------------------------------------------------------ */}
      {/* Orange top accent stripe                                            */}
      {/* ------------------------------------------------------------------ */}
      <div className="h-1.5 w-full bg-orange-500 rounded-t-xl" aria-hidden="true" />

      {/* ------------------------------------------------------------------ */}
      {/* Card header — order number, type badge, timer, status flags         */}
      {/* ------------------------------------------------------------------ */}
      <div className={cn('flex items-start justify-between gap-3 px-4 py-3', theme.header)}>
        {/* Left: order number + badges */}
        <div className="flex min-w-0 flex-col gap-1.5">
          <span className={cn('font-mono text-4xl font-black leading-none tabular-nums', theme.headerText)}>
            {displayId}
          </span>
          <div className="flex flex-wrap items-center gap-1.5">
            {typeMeta && (
              <span className={cn(
                'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold',
                typeMeta.cls,
              )}>
                {typeMeta.label}
              </span>
            )}
            {order.max_priority > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-red-600 px-2.5 py-0.5 text-xs font-extrabold text-white">
                <Bell className="size-3" aria-hidden="true" /> Rush
              </span>
            )}
            {blocked && (
              <span className="inline-flex items-center rounded-full bg-amber-500 px-2.5 py-0.5 text-xs font-extrabold text-amber-950">
                Waiting
              </span>
            )}
            {allReady && !blocked && (
              <span className="inline-flex items-center rounded-full bg-emerald-500 px-2.5 py-0.5 text-xs font-extrabold text-emerald-950">
                Ready to plate!
              </span>
            )}
          </div>
        </div>

        {/* Right: elapsed timer */}
        {elapsed && (
          <div className={cn('flex items-center gap-1.5 shrink-0 tabular-nums', theme.timer)}>
            <span className={cn('inline-block size-2.5 rounded-full shrink-0', theme.dot)} aria-hidden="true" />
            <Clock className="size-4 opacity-80" aria-hidden="true" />
            <span className="font-mono text-2xl font-black">{elapsed}</span>
          </div>
        )}
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Station tickets                                                      */}
      {/* ------------------------------------------------------------------ */}
      <div className="flex-1 space-y-2.5 p-4">
        {stations.length === 0 ? (
          <p className="py-4 text-center text-sm italic text-gray-500">
            No station tickets yet.
          </p>
        ) : (
          stations.map((st) => {
            const statusMeta = STATION_STATUS[st.status]
              || { label: st.status, cls: 'bg-gray-800 text-gray-400 border border-gray-700' };
            const items = Array.isArray(st.items) ? st.items : [];

            // Highlight slow stations that are blocking the order.
            const isSlowStation = blocked && (st.status === 'fired' || st.status === 'in_progress');

            return (
              <div
                key={st.ticket_id}
                className={cn(
                  'overflow-hidden rounded-xl border transition-colors',
                  isSlowStation
                    ? 'border-amber-600/60 bg-amber-900/20'
                    : 'border-gray-700 bg-gray-800/50',
                )}
              >
                {/* Station name + status */}
                <div className={cn(
                  'flex items-center justify-between gap-2 px-3 py-2.5',
                  isSlowStation ? 'bg-amber-900/40' : 'bg-gray-800',
                )}>
                  <span className={cn(
                    'text-sm font-extrabold truncate',
                    isSlowStation ? 'text-amber-200' : 'text-gray-100',
                  )}>
                    {st.station_name || 'Station'}
                  </span>
                  <span className={cn(
                    'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold shrink-0',
                    statusMeta.cls,
                  )}>
                    {statusMeta.label}
                  </span>
                </div>

                {/* Items */}
                {items.length > 0 && (
                  <ul className="divide-y divide-gray-700/60">
                    {items.map((it, idx) => {
                      const dotCls = ITEM_STATUS_DOT[it.item_status] || 'bg-gray-600';
                      const qty = Number(it.quantity ?? 1);
                      return (
                        <li
                          key={it.order_item_id || idx}
                          className="flex items-start gap-2.5 px-3 py-2"
                        >
                          <span className={cn('mt-1.5 size-2.5 rounded-full shrink-0', dotCls)} aria-hidden="true" />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-baseline justify-between gap-2">
                              <span className="text-sm font-bold text-gray-100 leading-tight">
                                {qty > 1 && (
                                  <span className="font-black text-orange-400 mr-1.5">{qty}×</span>
                                )}
                                {it.name || it.item_name || 'Item'}
                              </span>
                              <span className="shrink-0 text-xs font-medium capitalize text-gray-400">
                                {it.item_status?.replace('_', ' ') || ''}
                              </span>
                            </div>
                            {it.notes && (
                              <p className="mt-0.5 text-xs italic leading-snug text-amber-400">
                                {it.notes}
                              </p>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export default ExpoOrderCard;
