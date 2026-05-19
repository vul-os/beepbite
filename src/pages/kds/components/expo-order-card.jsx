// expo-order-card.jsx — read-only card for the expediter view.
//
// Each card represents one order. Multiple station tickets feed in. The order
// is "blocked" when some stations are bumped/ready but at least one is still
// firing — those are highlighted with a yellow border so the expo can chase
// the slow station.

/* eslint-disable react/prop-types */
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const STATUS_COLOR = {
  fired:       'bg-amber-500/15 text-amber-800 dark:text-amber-200',
  in_progress: 'bg-sky-500/15 text-sky-800 dark:text-sky-200',
  ready:       'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  bumped:      'bg-zinc-500/15 text-zinc-700 dark:text-zinc-300',
  cancelled:   'bg-red-500/15 text-red-700 dark:text-red-300',
};

function fmtAgo(ms, now) {
  if (!ms) return '';
  const t = typeof ms === 'string' ? Date.parse(ms) : ms;
  const sec = Math.max(0, Math.floor((now - t) / 1000));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')} ago`;
}

export function ExpoOrderCard({ order, now }) {
  const stations = Array.isArray(order.station_tickets) ? order.station_tickets : [];
  // "Waiting" = at least one bumped/ready AND at least one still firing/in_progress.
  const anyDone   = stations.some((s) => s.status === 'bumped' || s.status === 'ready');
  const anyOpen   = stations.some((s) => s.status === 'fired'  || s.status === 'in_progress');
  const blocked   = anyDone && anyOpen;
  const allReady  = stations.length > 0 && stations.every((s) => s.status === 'ready' || s.status === 'bumped');

  return (
    <Card className={cn(
      'flex flex-col',
      blocked  && 'border-amber-500/80 ring-2 ring-amber-500/30',
      allReady && 'border-emerald-500/70',
    )}>
      <CardHeader className="flex flex-row items-center justify-between p-3">
        <div className="flex flex-col">
          <span className="font-mono text-sm text-muted-foreground">
            {order.order_id?.slice(0, 8) || order.order_id}
          </span>
          {order.earliest_fired_at && (
            <span className="text-xs text-muted-foreground">
              fired {fmtAgo(order.earliest_fired_at, now)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {order.max_priority > 0 && (
            <Badge variant="destructive">Rush</Badge>
          )}
          {blocked && <Badge className="bg-amber-500 text-amber-950 hover:bg-amber-500">Waiting</Badge>}
          {allReady && <Badge className="bg-emerald-600 hover:bg-emerald-600">Ready</Badge>}
        </div>
      </CardHeader>

      <CardContent className="flex-1 p-3 pt-0">
        {stations.length === 0 ? (
          <p className="text-sm italic text-muted-foreground">No station tickets yet.</p>
        ) : (
          <ul className="space-y-1">
            {stations.map((s) => (
              <li
                key={s.station_id || s.ticket_id}
                className="flex items-center justify-between rounded px-2 py-1 text-sm"
              >
                <span className="flex items-center gap-2">
                  <span className={cn('inline-block rounded px-2 py-0.5 text-xs font-medium', STATUS_COLOR[s.status] || 'bg-muted')}>
                    {s.status}
                  </span>
                  <span className="font-medium">{s.station_name || s.station_id?.slice(0, 8)}</span>
                </span>
                <span className="font-mono text-xs tabular-nums text-muted-foreground">
                  {fmtAgo(s.bumped_at || s.ready_at || s.fired_at, now)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export default ExpoOrderCard;
