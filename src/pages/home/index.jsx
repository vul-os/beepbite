import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/context/auth-context';
import { supabase } from '@/services/supabase-client';

// Stats API
import { fetchStatsSummary, fetchStatsHeatmap } from '@/services/stats';

// Dashboard sub-components
import PeriodFilter from './components/period-filter';
import KpiCards from './components/kpi-cards';
import SalesTrendChart from './components/sales-trend-chart';
import BusyHeatmap from './components/busy-heatmap';
import LiveOrdersPanel from './components/live-orders-panel';
import OnboardingChecklist from './components/onboarding-checklist';

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
          ),
          order_details (
            delivery_address,
            notes,
            kitchen_notes
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
      <div className="flex flex-col items-center justify-center h-screen bg-gradient-to-br from-orange-50 to-orange-100">
        <AlertCircle className="w-16 h-16 text-orange-400 mb-4" />
        <h2 className="text-xl font-semibold text-gray-900 mb-2">No Organization Selected</h2>
        <p className="text-gray-600">Please select an organization to view your dashboard.</p>
      </div>
    );
  }

  // ── Guard: locations still loading → avoid flashing onboarding ──────────
  // Until the auth context has finished loading this org's locations we cannot
  // know whether the user genuinely has no location. Show a light loading
  // state instead of the onboarding checklist (which would mask real data).
  if (!resolvedLocation && !hasLoadedLocations) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-gradient-to-br from-orange-50 to-orange-100">
        <RefreshCw className="w-8 h-8 text-orange-400 mb-3 animate-spin" />
        <p className="text-gray-600">Loading your dashboard…</p>
      </div>
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

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 to-orange-100">
      {/* Top bar */}
      <div className="bg-white border-b border-orange-100 shadow-sm px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-bold text-gray-900">Dashboard</h1>
          <p className="text-xs text-gray-500">{resolvedLocation?.name || 'All locations'}</p>
        </div>
        <div className="flex items-center gap-2">
          <PeriodFilter value={period} onChange={setPeriod} />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { loadSummary(); loadHeatmap(); fetchOrders(); }}
            className="h-8 w-8 p-0 text-gray-400 hover:text-orange-600 hover:bg-orange-50"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Main content */}
      <div className="px-4 sm:px-6 py-4 space-y-4 max-w-[1600px] mx-auto">

        {/* Summary error banner */}
        {summaryError && !summaryLoading && (
          <div className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>Analytics unavailable: {summaryError}</span>
          </div>
        )}

        {/* KPI row */}
        <KpiCards
          kpis={kpis}
          previous={previous}
          currency={orgCurrency}
          loading={summaryLoading}
        />

        {/* Charts row + Live Orders */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Left column: trend + heatmap */}
          <div className="lg:col-span-2 space-y-4">
            <SalesTrendChart
              series={series}
              period={period}
              currency={orgCurrency}
              loading={summaryLoading}
            />
            <BusyHeatmap
              cells={heatmapCells}
              currency={orgCurrency}
              loading={heatmapLoading}
            />
          </div>

          {/* Right column: live orders */}
          <div className="lg:col-span-1" style={{ minHeight: 520 }}>
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
          </div>
        </div>
      </div>
    </div>
  );
};

export default Home;
