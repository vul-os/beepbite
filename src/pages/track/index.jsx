/**
 * TrackOrderPage — live order tracking for customers.
 * Route: /track/:token  (added by orchestrator in routes.jsx)
 *
 * Behaviour:
 * - Calls GET /track/{token} (public, no bearer) on mount.
 * - Polls every 10 s while order is active (not delivered / cancelled).
 * - Cleans up interval on unmount or when polling should stop.
 * - Shows Leaflet map with store + delivery-address markers; adds driver
 *   marker ONLY when the backend sends coordinates (privacy-gated).
 * - Handles 404 (invalid/expired token) and generic network errors.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { AlertCircle, Package } from 'lucide-react';

import { fetchTracking } from '@/services/tracking';

import OrderStatusSteps from './components/OrderStatusSteps';
import EtaCard         from './components/EtaCard';

// Lazy-load the map to avoid SSR/build issues with Leaflet's DOM dependency.
const TrackingMap = React.lazy(() => import('./components/TrackingMap'));

// ---- constants --------------------------------------------------------------

const POLL_INTERVAL_MS = 10_000;

// Real backend statuses (orders.status CHECK constraint) — 'delivered' and
// 'completed' are both end-of-life for a delivery order (the latter marks
// post-delivery settlement), and 'cancelled' is the failure terminal.
const TERMINAL_STATUSES = new Set(['delivered', 'completed', 'cancelled']);

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
      <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-primary/10 border-2 border-primary/20">
        <AlertCircle className="h-9 w-9 text-primary" aria-hidden="true" />
      </div>
      <h1 className="text-xl font-display mb-2">
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

        {/* Map — only renders once the backend has both store + delivery
            coordinates (delivery coordinates are withheld until the order
            is out for delivery, for customer-address privacy). Everywhere
            else gets a real empty state instead of a blank/hidden box. */}
        {hasMap ? (
          <div className="rounded-2xl overflow-hidden border border-border/60 shadow-md h-[300px] sm:h-[360px]">
            <React.Suspense fallback={<MapSkeleton />}>
              <TrackingMap
                store={store}
                delivery={delivery_address}
                driver={hasDriver ? driver : null}
              />
            </React.Suspense>
          </div>
        ) : (
          !terminal && (
            <div className="rounded-2xl border border-dashed border-border/60 bg-muted/40 px-5 py-8 text-center">
              <span className="text-2xl" role="img" aria-label="Map">🗺️</span>
              <p className="text-sm font-medium text-foreground mt-2">Map isn't available yet</p>
              <p className="text-xs text-muted-foreground mt-1 max-w-xs mx-auto">
                The live map appears once your order is out for delivery.
              </p>
            </div>
          )
        )}

        {/* Driver location note — only relevant once the map itself is showing */}
        {hasMap && !hasDriver && !terminal && (
          <p className="text-xs text-center text-muted-foreground px-4">
            Driver location will appear on the map once available.
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
        {(status === 'delivered' || status === 'completed') && (
          <div className="rounded-2xl border border-success/30 bg-success/10 px-5 py-5 text-center shadow-sm">
            <p className="text-2xl mb-2" role="img" aria-label="Celebration">🎉</p>
            <p className="text-base font-display text-success">Your order has arrived!</p>
            <p className="text-sm text-success/80 mt-1">Enjoy your meal.</p>
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
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary shadow-sm shadow-primary/20">
          <Package className="h-4.5 w-4.5 text-primary-foreground" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-display leading-tight truncate">
            {storeName ? `Order from ${storeName}` : 'Order tracking'}
          </p>
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
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
          {store?.address && <div className="border-l-2 border-primary/25 ml-3 h-3" />}
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
  pending:          'Your order has been placed.',
  confirmed:        'Your order has been confirmed.',
  preparing:        'The kitchen is preparing your order.',
  ready:            'Your order is ready.',
  out_for_delivery: 'Your order is on the way!',
  delivered:        'Your order has been delivered.',
  completed:        'Your order has been delivered.',
  cancelled:        'This order was cancelled.',
};
