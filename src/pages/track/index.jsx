/**
 * TrackOrderPage — live order tracking for customers.
 * Route: /track/:token  (added by orchestrator in routes.jsx)
 *
 * Behaviour:
 * - Calls GET /track/{token} (public, no bearer) on mount.
 * - Polls every 10 s while order is active (not delivered / canceled).
 * - Cleans up interval on unmount or when polling should stop.
 * - Shows Leaflet map with store + delivery-address markers; adds driver
 *   marker ONLY when the backend sends coordinates (privacy-gated).
 * - Handles 404 (invalid/expired token) and generic network errors.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { AlertCircle, Package } from 'lucide-react';

import { fetchTracking } from '@/services/tracking';
import { cn } from '@/lib/utils';

import OrderStatusSteps from './components/OrderStatusSteps';
import EtaCard         from './components/EtaCard';

// Lazy-load the map to avoid SSR/build issues with Leaflet's DOM dependency.
const TrackingMap = React.lazy(() => import('./components/TrackingMap'));

// ---- constants --------------------------------------------------------------

const POLL_INTERVAL_MS = 10_000;

const TERMINAL_STATUSES = new Set(['delivered', 'canceled']);

// ---- helpers ----------------------------------------------------------------

function isTerminal(status) {
  return TERMINAL_STATUSES.has(status);
}

// ---- skeleton ---------------------------------------------------------------

function MapSkeleton() {
  return (
    <div className="h-full w-full animate-pulse bg-muted rounded-xl flex items-center justify-center">
      <span className="text-3xl" role="img" aria-label="Map loading">🗺️</span>
    </div>
  );
}

// ---- error / not-found view -------------------------------------------------

function ErrorView({ status, message }) {
  const notFound = status === 404;
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-6 py-12">
      <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-orange-50 border-2 border-orange-100">
        <AlertCircle className="h-9 w-9 text-orange-500" aria-hidden="true" />
      </div>
      <h1 className="text-xl font-bold mb-2">
        {notFound ? 'Tracking link not found' : 'Could not load tracking'}
      </h1>
      <p className="text-sm text-muted-foreground max-w-xs leading-relaxed">
        {notFound
          ? 'This link may have expired or is invalid. Check your order confirmation for the correct link.'
          : (message || 'An unexpected error occurred. Please try refreshing the page.')}
      </p>
    </div>
  );
}

// ---- loading skeleton -------------------------------------------------------

function LoadingSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-20 rounded-2xl bg-muted" />
      <div className="h-[300px] sm:h-[360px] rounded-2xl bg-muted" />
      <div className="h-16 rounded-2xl bg-muted" />
      <div className="h-28 rounded-2xl bg-muted" />
    </div>
  );
}

// ---- main page --------------------------------------------------------------

export default function TrackOrderPage() {
  const { token } = useParams();

  const [tracking, setTracking]     = useState(null);   // TrackingPayload
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState(null);   // { message, status }
  const [lastUpdated, setLastUpdated] = useState(null); // timestamp ms

  const intervalRef = useRef(null);
  const mountedRef  = useRef(true);

  const load = useCallback(async () => {
    if (!token) return;
    const { data, error: err } = await fetchTracking(token);
    if (!mountedRef.current) return;

    if (err) {
      setError(err);
      setLoading(false);
      return;
    }

    setTracking(data);
    setLastUpdated(Date.now());
    setError(null);
    setLoading(false);

    // Stop polling once the order reaches a terminal state.
    if (data && isTerminal(data.status)) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }
  }, [token]);

  useEffect(() => {
    mountedRef.current = true;
    load();

    // Start polling — load() will clear the interval itself when terminal.
    intervalRef.current = setInterval(() => {
      load();
    }, POLL_INTERVAL_MS);

    return () => {
      mountedRef.current = false;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [load]);

  // ---- render states ----

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="mx-auto max-w-lg px-4 py-6">
          <LoadingSkeleton />
        </main>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="mx-auto max-w-lg px-4">
          <ErrorView status={error.status} message={error.message} />
        </main>
      </div>
    );
  }

  if (!tracking) return null;

  const { status, store, delivery_address, eta_minutes, driver } = tracking;
  const hasMap = store?.lat != null && delivery_address?.lat != null;
  const hasDriver = driver?.lat != null && driver?.lng != null;
  const terminal = isTerminal(status);

  return (
    <div className="min-h-screen bg-muted/30">
      <Header storeName={store?.name} />

      <main className="mx-auto max-w-lg px-4 pb-12 pt-4 space-y-4">

        {/* ETA card — promoted to top on mobile for maximum impact */}
        <EtaCard
          etaMinutes={eta_minutes}
          status={status}
          lastUpdated={lastUpdated}
        />

        {/* Map or fallback */}
        <div
          className={cn(
            'rounded-2xl overflow-hidden border border-border/60 shadow-md',
            hasMap ? 'h-[300px] sm:h-[360px]' : 'hidden',
          )}
        >
          {hasMap && (
            <React.Suspense fallback={<MapSkeleton />}>
              <TrackingMap
                store={store}
                delivery={delivery_address}
                driver={hasDriver ? driver : null}
              />
            </React.Suspense>
          )}
        </div>

        {/* Driver location note when not yet visible */}
        {!hasDriver && !terminal && (
          <p className="text-xs text-center text-muted-foreground px-4">
            Driver location will appear on the map once your order is on the way.
          </p>
        )}

        {/* Store + address summary */}
        <AddressSummary
          store={store}
          deliveryAddress={delivery_address}
          status={status}
        />

        {/* Status steps */}
        <div className="rounded-2xl border border-border/60 bg-card shadow-sm px-5 py-5">
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-5">
            Order progress
          </p>
          <OrderStatusSteps status={status} />
        </div>

        {/* Delivered celebration */}
        {status === 'delivered' && (
          <div className="rounded-2xl border border-green-200 bg-gradient-to-br from-green-50 to-emerald-50 px-5 py-5 text-center shadow-sm">
            <p className="text-2xl mb-2" role="img" aria-label="Celebration">🎉</p>
            <p className="text-base font-bold text-green-700">Your order has arrived!</p>
            <p className="text-sm text-green-600 mt-1">Enjoy your meal.</p>
          </div>
        )}
      </main>
    </div>
  );
}

// ---- sub-components ---------------------------------------------------------

function Header({ storeName }) {
  return (
    <header className="sticky top-0 z-10 border-b border-border/60 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="mx-auto max-w-lg px-4 h-14 flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-orange-500 shadow-sm shadow-orange-200">
          <Package className="h-4.5 w-4.5 text-white" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-bold leading-tight truncate">
            {storeName ? `Order from ${storeName}` : 'Order tracking'}
          </p>
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
            Live updates
          </p>
        </div>
      </div>
    </header>
  );
}

function AddressSummary({ store, deliveryAddress, status }) {
  if (!store && !deliveryAddress) return null;

  return (
    <div className="rounded-2xl border border-border/60 bg-card shadow-sm px-5 py-4 space-y-3">
      {store?.address && (
        <AddressRow icon="🏪" label="From" value={store.address} />
      )}
      {deliveryAddress?.label && (
        <>
          {store?.address && <div className="border-l-2 border-orange-200 ml-3 h-3" />}
          <AddressRow icon="📍" label="Delivering to" value={deliveryAddress.label} />
        </>
      )}
      {!store?.address && !deliveryAddress?.label && (
        <p className="text-sm text-muted-foreground">
          {STATUS_DISPLAY[status] || 'Tracking your order…'}
        </p>
      )}
    </div>
  );
}

function AddressRow({ icon, label, value }) {
  return (
    <div className="flex items-start gap-3">
      <span className="text-lg shrink-0 leading-tight mt-0.5" role="img" aria-hidden="true">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{label}</p>
        <p className="text-sm font-medium leading-snug mt-0.5">{value}</p>
      </div>
    </div>
  );
}

const STATUS_DISPLAY = {
  placed:           'Your order has been placed.',
  preparing:        'The kitchen is preparing your order.',
  out_for_delivery: 'Your order is on the way!',
  delivered:        'Your order has been delivered.',
  canceled:         'This order was canceled.',
};
