// expo.jsx — expediter view, mounted at /kds/expo.
//
// Read-only summary across stations. Lists open orders; each card shows
// per-station ticket status. Highlights orders blocked on one station while
// the others are done.
//
// Data source: we don't currently have a "list all open expo orders" endpoint —
// only GET /kds/orders/{order_id}/expo for a single order. So this page:
//   1. Polls the data layer (`orders` table via api.from) for open orders in
//      this org/location.
//   2. For each open order, fetches /kds/orders/{order_id}/expo and merges.
// Refreshes every 10s and on the manual refresh button. SSE not required.
//
// NOTE for orchestrator: a future backend endpoint like
//   GET /kds/expo  (all open orders for the current location)
// would let us drop step (1) entirely. Filed as TODO below.

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, Loader2, RefreshCw } from 'lucide-react';

import { api } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { ExpoOrderCard } from './components/expo-order-card';
import { useTick } from './hooks/use-tick';

const POLL_MS = 10_000;
// Must match the orders.status CHECK constraint
// (migrations/20240101000002_init_schema.sql):
//   pending | confirmed | preparing | ready | out_for_delivery
//   | delivered | completed | cancelled
// We show all in-flight statuses on the expo board.
const OPEN_ORDER_STATUSES = ['pending', 'confirmed', 'preparing', 'ready', 'out_for_delivery'];

export default function ExpoPage() {
  const [orders, setOrders] = useState([]); // merged: order + station_tickets[]
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const now = useTick();
  const mountedRef = useRef(true);

  useEffect(() => () => { mountedRef.current = false; }, []);

  const load = useCallback(async ({ background = false } = {}) => {
    if (background) setRefreshing(true); else setLoading(true);
    setError(null);

    try {
      // 1. Find open orders. We try a few common status values; the data
      // service ignores filters it doesn't know.
      const { data: rawOrders, error: ordersErr } = await api
        .from('orders')
        .select('id, order_number, order_type, table_number, status, created_at')
        .in('status', OPEN_ORDER_STATUSES)
        .order('created_at', { ascending: true })
        .limit(100);

      if (ordersErr) throw new Error(ordersErr.message || 'failed to list orders');
      const openOrders = Array.isArray(rawOrders) ? rawOrders : [];

      // 2. Hydrate each with the kds expo view. Failures per-order are
      // tolerated — the order just shows up without station data.
      const results = await Promise.all(openOrders.map(async (o) => {
        const { data, error: expoErr } = await api.request('GET', `/kds/orders/${encodeURIComponent(o.id)}/expo`);
        if (expoErr || !data) {
          return {
            order_id: o.id,
            order_number: o.order_number,
            order_type: o.order_type,
            table_number: o.table_number,
            earliest_fired_at: o.created_at,
            station_tickets: [],
            max_priority: 0,
          };
        }
        // station_tickets arrives as a JSONB string from the DB driver
        // (see ExpoRow.StationTickets). Decode if necessary.
        let stations = data.station_tickets;
        if (typeof stations === 'string') {
          try { stations = JSON.parse(stations); } catch { stations = []; }
        }
        return {
          order_id: data.order_id || o.id,
          order_number: o.order_number,
          order_type: o.order_type,
          table_number: o.table_number,
          earliest_fired_at: data.earliest_fired_at,
          station_tickets: Array.isArray(stations) ? stations : [],
          max_priority: data.max_priority || 0,
          all_ready: data.all_ready,
          any_in_progress: data.any_in_progress,
        };
      }));

      if (!mountedRef.current) return;
      setOrders(results);
    } catch (e) {
      if (mountedRef.current) setError(e.message || 'failed to load expo data');
    } finally {
      if (mountedRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  // initial fetch
  useEffect(() => { load(); }, [load]);

  // 10s polling
  useEffect(() => {
    const id = setInterval(() => load({ background: true }), POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  return (
    <div className="flex h-screen flex-col bg-background">
      <header className="flex items-center justify-between border-b px-4 py-3">
        <div>
          <h1 className="text-xl font-bold">Expo</h1>
          <p className="text-xs text-muted-foreground">
            {orders.length} open order{orders.length === 1 ? '' : 's'}
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => load({ background: true })} disabled={refreshing || loading}>
          <RefreshCw className={refreshing ? 'size-4 animate-spin' : 'size-4'} />
          Refresh
        </Button>
      </header>

      <main className="flex-1 overflow-auto p-3">
        {loading ? (
          <div className="flex h-full items-center justify-center gap-2 text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
            Loading orders…
          </div>
        ) : error ? (
          <Alert variant="destructive" className="mx-auto max-w-md">
            <AlertCircle className="size-4" />
            <AlertTitle>Could not load expo</AlertTitle>
            <AlertDescription className="flex flex-col gap-2">
              <span>{error}</span>
              <Button size="sm" variant="outline" onClick={() => load()}>Retry</Button>
            </AlertDescription>
          </Alert>
        ) : orders.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center text-muted-foreground">
            <p className="text-lg">No open orders.</p>
            <p className="text-sm">New orders will appear here on the next refresh.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {orders.map((o) => (
              <ExpoOrderCard key={o.order_id} order={o} now={now} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
