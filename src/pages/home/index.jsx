import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { AlertCircle, RefreshCw, MapPin, LayoutDashboard } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/context/auth-context';
import { supabase } from '@/services/supabase-client';

// Stats API
import { fetchStatsSummary, fetchStatsHeatmap } from '@/services/stats';

// Layout helpers
import { PageHeader, PageContainer } from '@/components/ui/page-header';
import { Reveal } from '@/components/ui/motion';

// Dashboard sub-components
import PeriodFilter from './components/period-filter';
import KpiCards from './components/kpi-cards';
import SalesTrendChart from './components/sales-trend-chart';
import BusyHeatmap from './components/busy-heatmap';
import LiveOrdersPanel from './components/live-orders-panel';
import OnboardingChecklist from './components/onboarding-checklist';

// ── Full-screen guard states ────────────────────────────────────────────────

function GuardScreen({ icon: Icon, iconClass, title, subtitle }) {
  return (
    <div
      className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-orange-50 to-orange-100 px-4"
      role="status"
      aria-live="polite"
    >
      <div className="bg-white rounded-2xl shadow-lg p-8 flex flex-col items-center max-w-sm w-full text-center">
        <div className="w-16 h-16 rounded-full bg-orange-50 flex items-center justify-center mb-4">
          <Icon className={`w-8 h-8 ${iconClass}`} />
        </div>
        {title && <h2 className="text-lg font-semibold text-gray-900 mb-1">{title}</h2>}
        {subtitle && <p className="text-sm text-gray-500 leading-relaxed">{subtitle}</p>}
      </div>
    </div>
  );
}

const Home = () => {
  const { activeOrganization, activeLocation, locations, hasLoadedLocations } = useAuth();
  const orgCurrency =
    activeOrganization?.default_currency_code ||
    activeOrganization?.currency_code ||
    activeOrganization?.currency ||
    'USD';

  // Resolve the location to drive the dashboard. Prefer the explicitly active
  // location; if it is null/stale (e.g. it hasn't hydrated yet after login, or
  // localStorage held a location from a different org), fall back to the org's
  // first loaded location so the dashboard shows REAL data instead of zeros.
  const resolvedLocation = useMemo(() => {
    if (activeLocation?.id) return activeLocation;
    if (locations && locations.length > 0) return locations[0];
    return null;
  }, [activeLocation, locations]);
  const locationId = resolvedLocation?.id;

  // ── Period filter ────────────────────────────────────────────────────────
  const [period, setPeriod] = useState('week');

  // ── Stats summary state ──────────────────────────────────────────────────
  const [summary, setSummary] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState(null);

  // ── Heatmap state ────────────────────────────────────────────────────────
  const [heatmap, setHeatmap] = useState(null);
  const [heatmapLoading, setHeatmapLoading] = useState(false);

  // ── Live orders state ────────────────────────────────────────────────────
  const [orders, setOrders] = useState([]);
  const [loadingOrders, setLoadingOrders] = useState(true);
  const [orderSearchTerm, setOrderSearchTerm] = useState('');
  const [orderStatusFilter, setOrderStatusFilter] = useState('active');

  // ── Fetch stats summary ──────────────────────────────────────────────────
  const loadSummary = useCallback(async () => {
    if (!locationId) return;
    setSummaryLoading(true);
    setSummaryError(null);
    const { data, error } = await fetchStatsSummary(locationId, period);
    if (error) {
      setSummaryError(error.message || 'Failed to load stats');
    } else {
      setSummary(data);
    }
    setSummaryLoading(false);
  }, [locationId, period]);

  // ── Fetch heatmap ────────────────────────────────────────────────────────
  const loadHeatmap = useCallback(async () => {
    if (!locationId) return;
    setHeatmapLoading(true);
    const { data } = await fetchStatsHeatmap(locationId, 12);
    if (data) setHeatmap(data);
    setHeatmapLoading(false);
  }, [locationId]);

  // ── Fetch live orders ────────────────────────────────────────────────────
  const fetchOrders = useCallback(async () => {
    if (!locationId) {
      setOrders([]);
      setLoadingOrders(false);
      return;
    }
    setLoadingOrders(true);
    try {
      let statusFilter;
      if (orderStatusFilter === 'active') {
        statusFilter = [
          'pending', 'confirmed', 'preparing', 'ready',
          'out_for_delivery', 'pending_on_delivery',
        ];
      } else if (orderStatusFilter === 'inactive') {
        statusFilter = ['delivered', 'completed', 'cancelled'];
      } else {
        statusFilter = null;
      }

      let query = supabase
        .from('orders')
        .select(`
          *,
          customers (
            id,
            first_name,
            last_name,
            whatsapp_number,
            email
          )
        `)
        .eq('location_id', locationId)
        .order('created_at', { ascending: false })
        .limit(50);

      if (statusFilter) {
        query = query.in('status', statusFilter);
      }

      const { data, error } = await query;
      if (error) throw error;
      setOrders(data || []);
    } catch (err) {
      console.error('Error fetching orders:', err);
      setOrders([]);
    } finally {
      setLoadingOrders(false);
    }
  }, [locationId, orderStatusFilter]);

  // ── Effects ──────────────────────────────────────────────────────────────
  useEffect(() => { loadSummary(); }, [loadSummary]);
  useEffect(() => { loadHeatmap(); }, [loadHeatmap]);
  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  // ── Order helpers ────────────────────────────────────────────────────────
  const filteredOrders = useMemo(() => {
    if (!orderSearchTerm) return orders;
    const q = orderSearchTerm.toLowerCase();
    return orders.filter(
      (o) =>
        o.order_number?.toLowerCase().includes(q) ||
        o.customers?.whatsapp_number?.includes(q) ||
        o.customers?.first_name?.toLowerCase().includes(q) ||
        o.customers?.last_name?.toLowerCase().includes(q) ||
        o.status?.toLowerCase().includes(q)
    );
  }, [orders, orderSearchTerm]);

  const updateOrderStatus = useCallback(async (orderId, newStatus) => {
    setOrders((prev) =>
      prev.map((o) =>
        o.id === orderId ? { ...o, status: newStatus, updated_at: new Date().toISOString() } : o
      )
    );
    try {
      const { error } = await supabase
        .from('orders')
        .update({ status: newStatus, updated_at: new Date().toISOString() })
        .eq('id', orderId);
      if (error) throw error;
    } catch (err) {
      console.error('Error updating order status:', err);
      fetchOrders();
    }
  }, [fetchOrders]);

  // ── Guard: no org ────────────────────────────────────────────────────────
  if (!activeOrganization) {
    return (
      <GuardScreen
        icon={AlertCircle}
        iconClass="text-orange-400"
        title="No Organization Selected"
        subtitle="Please select an organization to view your dashboard."
      />
    );
  }

  // ── Guard: locations still loading → avoid flashing onboarding ──────────
  if (!resolvedLocation && !hasLoadedLocations) {
    return (
      <GuardScreen
        icon={RefreshCw}
        iconClass="text-orange-400 animate-spin"
        subtitle="Loading your dashboard…"
      />
    );
  }

  // ── Guard: no location → onboarding ─────────────────────────────────────
  if (!resolvedLocation) {
    return <OnboardingChecklist onComplete={() => {}} />;
  }

  // ── Derived data ─────────────────────────────────────────────────────────
  const kpis = summary?.kpis ?? null;
  const previous = summary?.previous ?? null;
  const series = summary?.series ?? [];
  const heatmapCells = heatmap?.cells ?? [];

  const handleRefresh = () => {
    loadSummary();
    loadHeatmap();
    fetchOrders();
  };

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <PageContainer>
      {/* ── Page header ─────────────────────────────────────────────────── */}
      <Reveal delay={0}>
        <PageHeader
          icon={LayoutDashboard}
          title="Dashboard"
          description={
            resolvedLocation?.name
              ? <>
                  <MapPin className="inline-block w-3.5 h-3.5 mr-1 text-primary/70" aria-hidden="true" />
                  {resolvedLocation.name}
                </>
              : 'All locations'
          }
          actions={
            <div className="flex items-center gap-2">
              <PeriodFilter value={period} onChange={setPeriod} />
              <Button
                variant="ghost"
                size="icon"
                onClick={handleRefresh}
                aria-label="Refresh dashboard"
                className="h-9 w-9 rounded-xl text-muted-foreground hover:text-primary hover:bg-primary/10 focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                <RefreshCw className="w-4 h-4" aria-hidden="true" />
              </Button>
            </div>
          }
        />
      </Reveal>

      {/* Summary error banner */}
      {summaryError && !summaryLoading && (
        <Reveal delay={0.05}>
          <div
            role="alert"
            className="flex items-start gap-3 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3"
          >
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5 text-amber-500" aria-hidden="true" />
            <div>
              <p className="font-medium">Analytics unavailable</p>
              <p className="text-amber-700 text-xs mt-0.5">{summaryError}</p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={loadSummary}
              className="ml-auto h-7 px-2 text-xs text-amber-700 hover:bg-amber-100 flex-shrink-0"
            >
              Retry
            </Button>
          </div>
        </Reveal>
      )}

      {/* KPI row */}
      <section aria-label="Key performance indicators">
        <KpiCards
          kpis={kpis}
          previous={previous}
          currency={orgCurrency}
          loading={summaryLoading}
        />
      </section>

      {/* Charts + Live Orders */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 sm:gap-6">
        {/* Left column: trend + heatmap */}
        <section
          aria-label="Sales analytics charts"
          className="lg:col-span-2 space-y-5 sm:space-y-6"
        >
          <Reveal delay={0.1}>
            <SalesTrendChart
              series={series}
              period={period}
              currency={orgCurrency}
              loading={summaryLoading}
            />
          </Reveal>
          <Reveal delay={0.15}>
            <BusyHeatmap
              cells={heatmapCells}
              currency={orgCurrency}
              loading={heatmapLoading}
            />
          </Reveal>
        </section>

        {/* Right column: live orders */}
        <section
          aria-label="Live orders"
          className="lg:col-span-1"
        >
          <Reveal delay={0.12}>
            <LiveOrdersPanel
              orders={orders}
              loadingOrders={loadingOrders}
              orderSearchTerm={orderSearchTerm}
              setOrderSearchTerm={setOrderSearchTerm}
              orderStatusFilter={orderStatusFilter}
              setOrderStatusFilter={setOrderStatusFilter}
              filteredOrders={filteredOrders}
              updateOrderStatus={updateOrderStatus}
            />
          </Reveal>
        </section>
      </div>
    </PageContainer>
  );
};

export default Home;
