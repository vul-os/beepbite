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
import { Clock } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
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

const URGENCY_HEADER = {
  green: 'bg-emerald-50 border-b border-emerald-100',
  amber: 'bg-amber-50  border-b border-amber-100',
  red:   'bg-red-50    border-b border-red-100',
};

const URGENCY_TIMER = {
  green: 'text-emerald-700',
  amber: 'text-amber-700',
  red:   'text-red-700 font-bold',
};

const URGENCY_BORDER = {
  green: 'border-emerald-200',
  amber: 'border-amber-300',
  red:   'border-red-400 ring-2 ring-red-200',
};

const URGENCY_DOT = {
  green: 'bg-emerald-500',
  amber: 'bg-amber-400',
  red:   'bg-red-500',
};

// ---- Station status ---------------------------------------------------------
const STATION_STATUS = {
  fired:       { label: 'Fired',       cls: 'bg-orange-100  text-orange-800  border border-orange-200'   },
  in_progress: { label: 'In Progress', cls: 'bg-sky-100     text-sky-800     border border-sky-200'      },
  ready:       { label: 'Ready',       cls: 'bg-emerald-100 text-emerald-800 border border-emerald-200'  },
  bumped:      { label: 'Bumped',      cls: 'bg-zinc-100    text-zinc-600    border border-zinc-200'     },
  cancelled:   { label: 'Cancelled',   cls: 'bg-red-100     text-red-700     border border-red-200'      },
};

const ITEM_STATUS_DOT = {
  fired:       'bg-orange-400',
  in_progress: 'bg-sky-400',
  ready:       'bg-emerald-500',
};

// ---- Order type label -------------------------------------------------------
const ORDER_TYPE_BADGE = {
  dine_in:    { label: 'Dine-In',    cls: 'bg-orange-500 text-white border-orange-500'  },
  collection: { label: 'Collection', cls: 'bg-blue-500   text-white border-blue-500'    },
  delivery:   { label: 'Delivery',   cls: 'bg-purple-500 text-white border-purple-500'  },
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

  // Aggregate station states.
  const anyDone  = stations.some((s) => s.status === 'bumped' || s.status === 'ready');
  const anyOpen  = stations.some((s) => s.status === 'fired'  || s.status === 'in_progress');
  const blocked  = anyDone && anyOpen;
  const allReady = stations.length > 0 && stations.every((s) => s.status === 'ready' || s.status === 'bumped');

  // Order number: prefer human-readable, fall back to short UUID prefix.
  const displayId = order.order_number || order.order_id?.slice(0, 8) || '—';

  const typeMeta = ORDER_TYPE_BADGE[order.order_type] || null;

  return (
    <Card className={cn(
      'flex flex-col overflow-hidden rounded-xl shadow-sm transition-shadow hover:shadow-md',
      URGENCY_BORDER[bucket],
    )}>
      {/* ---- Card Header -------------------------------------------------- */}
      <CardHeader className={cn('p-0')}>
        {/* Orange top accent stripe */}
        <div className="h-1 w-full bg-orange-500 rounded-t-xl" />

        <div className={cn('flex items-start justify-between gap-3 px-4 py-3', URGENCY_HEADER[bucket])}>
          {/* Order number + type */}
          <div className="flex flex-col gap-1 min-w-0">
            <span className="text-2xl font-extrabold tracking-tight text-gray-900 leading-none">
              {displayId}
            </span>
            <div className="flex items-center gap-1.5 flex-wrap">
              {typeMeta && (
                <span className={cn(
                  'inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold',
                  typeMeta.cls,
                )}>
                  {typeMeta.label}
                </span>
              )}
              {order.max_priority > 0 && (
                <Badge variant="destructive" className="text-xs px-2 py-0.5">
                  Rush
                </Badge>
              )}
              {blocked && (
                <span className="inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold bg-amber-500 text-white border-amber-500">
                  Waiting
                </span>
              )}
              {allReady && !blocked && (
                <span className="inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold bg-emerald-600 text-white border-emerald-600">
                  Ready
                </span>
              )}
            </div>
          </div>

          {/* Timer */}
          {elapsed && (
            <div className={cn('flex items-center gap-1 shrink-0 font-mono text-lg font-bold tabular-nums', URGENCY_TIMER[bucket])}>
              <span className={cn('inline-block size-2 rounded-full shrink-0', URGENCY_DOT[bucket])} />
              <Clock className="size-4 opacity-70" />
              {elapsed}
            </div>
          )}
        </div>
      </CardHeader>

      {/* ---- Card Body (station tickets) ---------------------------------- */}
      <CardContent className="flex-1 p-4 pt-3 space-y-3">
        {stations.length === 0 ? (
          <p className="text-sm italic text-muted-foreground text-center py-4">
            No station tickets yet.
          </p>
        ) : (
          stations.map((st) => {
            const statusMeta = STATION_STATUS[st.status] || { label: st.status, cls: 'bg-muted text-muted-foreground border border-muted' };
            const items = Array.isArray(st.items) ? st.items : [];

            return (
              <div
                key={st.ticket_id}
                className="rounded-lg border border-gray-100 bg-gray-50/60 overflow-hidden"
              >
                {/* Station header */}
                <div className="flex items-center justify-between gap-2 px-3 py-2 bg-white border-b border-gray-100">
                  <span className="text-sm font-semibold text-gray-800 truncate">
                    {st.station_name || 'Station'}
                  </span>
                  <span className={cn(
                    'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold shrink-0',
                    statusMeta.cls,
                  )}>
                    {statusMeta.label}
                  </span>
                </div>

                {/* Items */}
                {items.length > 0 && (
                  <ul className="divide-y divide-gray-100">
                    {items.map((it, idx) => {
                      const dotCls = ITEM_STATUS_DOT[it.item_status] || 'bg-gray-300';
                      const qty = Number(it.quantity ?? 1);
                      return (
                        <li
                          key={it.order_item_id || idx}
                          className="flex items-start gap-2 px-3 py-1.5"
                        >
                          <span className={cn('mt-1.5 size-2 rounded-full shrink-0', dotCls)} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-baseline justify-between gap-2">
                              <span className="text-sm font-medium text-gray-800">
                                {qty > 1 && (
                                  <span className="font-bold text-orange-600 mr-1">{qty}×</span>
                                )}
                                {it.name || it.item_name || 'Item'}
                              </span>
                              <span className="text-xs text-muted-foreground capitalize shrink-0">
                                {it.item_status?.replace('_', ' ') || ''}
                              </span>
                            </div>
                            {it.notes && (
                              <p className="text-xs italic text-amber-700 mt-0.5 leading-snug">
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
      </CardContent>
    </Card>
  );
}

export default ExpoOrderCard;
