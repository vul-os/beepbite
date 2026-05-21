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
import { AlertCircle, ChefHat, Loader2, RefreshCw } from 'lucide-react';

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

// ---------------------------------------------------------------------------
// base64 + JSON decode helper
// station_tickets arrives as a base64-encoded JSONB string from the Go
// backend (ExpoRow.StationTickets is []byte which json.Encoder emits as
// base64). Decode with atob() first; fall back to direct JSON.parse in case
// the format ever changes (e.g. a future endpoint that returns raw JSON).
// ---------------------------------------------------------------------------
function decodeStationTickets(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== 'string') return [];
  // Try base64 → JSON first (current backend behaviour).
  try { return JSON.parse(atob(raw)); } catch { /* fall through */ }
  // Fallback: maybe it's already plain JSON.
  try { return JSON.parse(raw); } catch { return []; }
}

export default function ExpoPage() {
  const [orders, setOrders] = useState([]); // merged: order + station_tickets[]
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const now = useTick();
  const mountedRef = useRef(true);

  // Set true on every mount (React 18 StrictMode mounts → unmounts → remounts;
  // without resetting here, the cleanup's `false` from the first unmount sticks
  // and load() bails before setOrders/setLoading → stuck on "Loading…" forever).
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const load = useCallback(async ({ background = false } = {}) => {
    if (background) setRefreshing(true); else setLoading(true);
    setError(null);

    try {
      // 1. Find open orders. We try a few common status values; the data
      // service ignores filters it doesn't know.
      const { data: rawOrders, error: ordersErr } = await api
        .from('orders')
        .select('id, order_number, order_type, status, created_at')
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

        // station_tickets arrives as a base64-encoded JSONB string from the
        // Go backend (ExpoRow.StationTickets is []byte → json.Encoder → base64).
        // Each decoded station object has:
        //   { ticket_id, station_name, status, fired_at, ready_at,
        //     course_number, items: [{ order_item_id, quantity, item_status, notes }] }
        const stations = decodeStationTickets(data.station_tickets);

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
    <div className="flex h-screen flex-col bg-gray-50">
      {/* ------------------------------------------------------------------ */}
      {/* Header                                                              */}
      {/* ------------------------------------------------------------------ */}
      <header className="relative flex items-center justify-between gap-4 border-b border-orange-100 bg-white px-5 py-4 shadow-sm">
        {/* Orange left accent bar */}
        <div className="absolute left-0 inset-y-0 w-1 bg-orange-500 rounded-r" />

        <div className="flex items-center gap-3 pl-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-orange-50">
            <ChefHat className="size-5 text-orange-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold leading-tight text-gray-900">Expo</h1>
            <p className="text-xs text-gray-500">
              {loading ? 'Loading…' : `${orders.length} open order${orders.length === 1 ? '' : 's'}`}
            </p>
          </div>
        </div>

        <Button
          size="sm"
          variant="outline"
          onClick={() => load({ background: true })}
          disabled={refreshing || loading}
          className="gap-1.5 border-orange-200 text-orange-700 hover:bg-orange-50 hover:text-orange-800"
        >
          <RefreshCw className={refreshing ? 'size-4 animate-spin' : 'size-4'} />
          Refresh
        </Button>
      </header>

      {/* ------------------------------------------------------------------ */}
      {/* Main content                                                        */}
      {/* ------------------------------------------------------------------ */}
      <main className="flex-1 overflow-auto p-4">
        {loading ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
            <Loader2 className="size-8 animate-spin text-orange-500" />
            <p className="text-sm">Loading orders…</p>
          </div>

        ) : error ? (
          <Alert variant="destructive" className="mx-auto max-w-md mt-8">
            <AlertCircle className="size-4" />
            <AlertTitle>Could not load expo</AlertTitle>
            <AlertDescription className="flex flex-col gap-3 mt-1">
              <span>{error}</span>
              <Button size="sm" variant="outline" onClick={() => load()} className="self-start">
                Retry
              </Button>
            </AlertDescription>
          </Alert>

        ) : orders.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <ChefHat className="size-12 text-orange-200" />
            <p className="text-lg font-semibold text-gray-500">All caught up!</p>
            <p className="text-sm text-gray-400">No open orders right now. New tickets will appear here.</p>
          </div>

        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {orders.map((o) => (
              <ExpoOrderCard key={o.order_id} order={o} now={now} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
