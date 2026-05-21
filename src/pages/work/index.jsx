// src/pages/work/index.jsx — Unified Workspace (Wave 35 / Now-27)
//
// A single page with TWO top-level tabs: POS and Kitchen.
//
// POS views:     Quick | Full | Floor | Orders
// Kitchen views: Station | Expo | Bump-bar
//
// Role-aware tab visibility:
//   - members with ONLY can_kitchen see only the Kitchen tab
//   - members with can_pos (or owners / managers) see both tabs
//   - owner / manager see both tabs regardless of capability flags
//
// Capabilities are read from the Go backend's auth/me scope by querying
// organization_members for the current user's membership row.
//
// Last view per tab is persisted via userprefs service (falls back to
// localStorage). This means preferences sync across devices when connected.
//
// The chrome-less deep links (/kds/expo etc.) are untouched — do NOT modify.
//
// IMPORTANT: view components are imported READ-ONLY. Do NOT modify them.
// The KDS Station view uses useParams() so it is wrapped in a MemoryRouter
// with the selected station id injected.

/* eslint-disable react/prop-types */
import React, {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ChefHat, Loader2, Monitor } from 'lucide-react';

import { useAuth } from '@/context/auth-context';
import { api } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { fetchPrefs, savePOSView, saveKDSView } from '@/services/userprefs';

// ---------------------------------------------------------------------------
// Lazy view imports — read-only; do NOT modify these files.
// ---------------------------------------------------------------------------

// POS views
const PosWorkspace = lazy(() => import('@/pages/pos/workspace'));
const QuickPOS = lazy(() => import('@/pages/quick-pos'));
const FloorLive = lazy(() => import('@/pages/floor'));

// Orders list (from home section, read-only)
const OrdersSection = lazy(() =>
  import('@/pages/home/components/orders-section'),
);

// Kitchen views
const StationPage = lazy(() => import('@/pages/kds/station'));
const ExpoPage = lazy(() => import('@/pages/kds/expo'));

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const POS_VIEWS = [
  { id: 'full', label: 'Full POS' },
  { id: 'quick', label: 'Quick' },
  { id: 'floor', label: 'Floor' },
  { id: 'orders', label: 'Orders' },
];

const KDS_VIEWS = [
  { id: 'station', label: 'Station' },
  { id: 'expo', label: 'Expo' },
  { id: 'bumpbar', label: 'Bump-bar' },
];

// ---------------------------------------------------------------------------
// Role helpers
// ---------------------------------------------------------------------------

/**
 * Determine which top-level tabs the user can access.
 *
 * Logic (from migration 019_owner_default_capabilities.sql):
 *   - role owner/manager → both tabs
 *   - can_pos capability → both tabs
 *   - can_kitchen only  → Kitchen tab only
 *   - no capabilities   → Kitchen only (safe default)
 *
 * @param {string[]} roles    — role strings from membership rows
 * @param {object}   caps     — merged capability flags { can_pos, can_kitchen, … }
 */
function resolveTabAccess(roles, caps) {
  const isOwnerManager = roles.some((r) => r === 'owner' || r === 'manager');
  const hasPos = Boolean(caps.can_pos);
  const hasKitchen = Boolean(caps.can_kitchen);

  return {
    showPOS: isOwnerManager || hasPos,
    showKitchen: isOwnerManager || hasKitchen || !hasPos,
  };
}

// ---------------------------------------------------------------------------
// useMembership — fetch roles + capabilities for the current user
// ---------------------------------------------------------------------------

function useMembership() {
  const { user, activeOrganization } = useAuth();
  const [state, setState] = useState({ roles: [], caps: {}, loading: true });

  useEffect(() => {
    if (!user?.id || !activeOrganization?.id) {
      // No org yet → treat as owner so workspace isn't empty on first login.
      setState({ roles: ['owner'], caps: { can_pos: true, can_kitchen: true }, loading: false });
      return;
    }

    let cancelled = false;

    (async () => {
      const { data, error } = await api
        .from('organization_members')
        .select('role,capabilities')
        .eq('profile_id', user.id)
        .eq('organization_id', activeOrganization.id);

      if (cancelled) return;

      if (error || !data?.length) {
        // Fallback: open access.
        setState({ roles: ['owner'], caps: { can_pos: true, can_kitchen: true }, loading: false });
        return;
      }

      const roles = data.map((m) => m.role).filter(Boolean);
      const caps = {};
      for (const m of data) {
        let parsed = m.capabilities;
        if (typeof parsed === 'string') {
          try { parsed = JSON.parse(parsed); } catch { parsed = {}; }
        }
        Object.assign(caps, parsed || {});
      }
      setState({ roles, caps, loading: false });
    })();

    return () => { cancelled = true; };
  }, [user?.id, activeOrganization?.id]);

  return state;
}

// ---------------------------------------------------------------------------
// useKdsStations — fetch the station list for the active location
// ---------------------------------------------------------------------------

function useKdsStations() {
  const { activeLocation } = useAuth();
  const [stations, setStations] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!activeLocation?.id) {
      setStations([]);
      setLoading(false);
      return;
    }

    let cancelled = false;

    (async () => {
      const { data, error } = await api
        .from('kitchen_stations')
        .select('id,name,location_id')
        .eq('location_id', activeLocation.id)
        .order('name', { ascending: true });

      if (cancelled) return;
      setStations(error ? [] : (data || []));
      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [activeLocation?.id]);

  return { stations, loading };
}

// ---------------------------------------------------------------------------
// Loading fallback
// ---------------------------------------------------------------------------

function ViewLoader() {
  return (
    <div className="flex h-full items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab button
// ---------------------------------------------------------------------------

function TabButton({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'px-5 py-2.5 text-sm font-medium border-b-2 transition-colors focus:outline-none',
        active
          ? 'border-primary text-primary'
          : 'border-transparent text-muted-foreground hover:text-foreground hover:border-muted',
      )}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// View pill (sub-tab)
// ---------------------------------------------------------------------------

function ViewPill({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'px-3 py-1 text-xs rounded-full border transition-colors focus:outline-none',
        active
          ? 'bg-primary text-primary-foreground border-primary'
          : 'border-input text-muted-foreground hover:bg-muted',
      )}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// KDS Station view wrapper
// ---------------------------------------------------------------------------

// StationPage uses useParams() — we wrap it in a MemoryRouter so we can
// inject the chosen station ID without altering station.jsx.
function StationView({ stationId }) {
  if (!stationId) return null;
  return (
    <MemoryRouter initialEntries={[`/kds/${stationId}`]}>
      <Routes>
        <Route
          path="/kds/:stationId"
          element={
            <Suspense fallback={<ViewLoader />}>
              <StationPage />
            </Suspense>
          }
        />
      </Routes>
    </MemoryRouter>
  );
}

// ---------------------------------------------------------------------------
// Bump-bar view — link to /kds/:stationId for bump-bar usage
// BumpPage doesn't exist as a separate component; we re-use StationPage
// (same data, same hotkeys — the "bump-bar" label is a UX concept,
//  not a different backend view).
// ---------------------------------------------------------------------------

function BumpBarView({ stationId }) {
  if (!stationId) return null;
  return <StationView stationId={stationId} />;
}

// ---------------------------------------------------------------------------
// KDS Panel — station picker + view
// ---------------------------------------------------------------------------

function KitchenPanel({ kdsView, onKdsView }) {
  const { stations, loading: stationsLoading } = useKdsStations();
  const [selectedStation, setSelectedStation] = useState(null);

  // Auto-select the first station when list loads.
  useEffect(() => {
    if (stations.length && !selectedStation) {
      setSelectedStation(stations[0].id);
    }
  }, [stations, selectedStation]);

  if (stationsLoading) return <ViewLoader />;

  const needsStation = kdsView === 'station' || kdsView === 'bumpbar';

  return (
    <div className="flex flex-col h-full">
      {/* Station picker (shown when view needs a station) */}
      {needsStation && stations.length > 1 && (
        <div className="flex gap-2 px-4 py-2 border-b bg-muted/30 overflow-x-auto">
          {stations.map((s) => (
            <ViewPill
              key={s.id}
              active={selectedStation === s.id}
              onClick={() => setSelectedStation(s.id)}
            >
              {s.name}
            </ViewPill>
          ))}
        </div>
      )}

      {/* No stations configured */}
      {needsStation && stations.length === 0 && (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-muted-foreground">
          <ChefHat className="h-10 w-10" />
          <p className="text-sm">No KDS stations configured for this location.</p>
          <p className="text-xs">Add stations under Settings → Kitchen.</p>
        </div>
      )}

      {/* View content */}
      <div className="flex-1 overflow-auto">
        {kdsView === 'station' && selectedStation && (
          <StationView stationId={selectedStation} />
        )}
        {kdsView === 'expo' && (
          <Suspense fallback={<ViewLoader />}>
            <ExpoPage />
          </Suspense>
        )}
        {kdsView === 'bumpbar' && selectedStation && (
          <BumpBarView stationId={selectedStation} />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// POS Panel
// ---------------------------------------------------------------------------

function POSPanel({ posView }) {
  return (
    <div className="flex-1 overflow-auto">
      {posView === 'full' && (
        <Suspense fallback={<ViewLoader />}>
          <PosWorkspace />
        </Suspense>
      )}
      {posView === 'quick' && (
        <Suspense fallback={<ViewLoader />}>
          <QuickPOS />
        </Suspense>
      )}
      {posView === 'floor' && (
        <Suspense fallback={<ViewLoader />}>
          <FloorLive />
        </Suspense>
      )}
      {posView === 'orders' && (
        <Suspense fallback={<ViewLoader />}>
          <OrdersSection />
        </Suspense>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Workspace page
// ---------------------------------------------------------------------------

export default function WorkspacePage() {
  const { membership: _m } = useAuth(); // not used directly — we query directly
  const { roles, caps, loading: memberLoading } = useMembership();

  const { showPOS, showKitchen } = useMemo(
    () => resolveTabAccess(roles, caps),
    [roles, caps],
  );

  // Top-level tab: 'pos' | 'kitchen'
  const [activeTab, setActiveTab] = useState(null);
  // POS sub-view
  const [posView, setPosView] = useState('full');
  // KDS sub-view
  const [kdsView, setKdsView] = useState('station');
  // Preferences loaded flag
  const [prefsLoaded, setPrefsLoaded] = useState(false);

  // Load persisted preferences once on mount.
  useEffect(() => {
    fetchPrefs().then(({ lastViewPOS, lastViewKDS }) => {
      setPosView(lastViewPOS || 'full');
      setKdsView(lastViewKDS || 'station');
      setPrefsLoaded(true);
    });
  }, []);

  // Set initial active tab based on role access (once membership resolves).
  useEffect(() => {
    if (memberLoading || activeTab !== null) return;
    setActiveTab(showPOS ? 'pos' : 'kitchen');
  }, [memberLoading, showPOS, activeTab]);

  // Handlers with preference persistence.
  const handlePosView = useCallback(
    (view) => {
      setPosView(view);
      savePOSView(view);
    },
    [],
  );

  const handleKdsView = useCallback(
    (view) => {
      setKdsView(view);
      saveKDSView(view);
    },
    [],
  );

  const handleTab = useCallback(
    (tab) => setActiveTab(tab),
    [],
  );

  // Show loader while membership resolves or prefs are loading.
  if (memberLoading || !prefsLoaded || activeTab === null) {
    return <ViewLoader />;
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-background">
      {/* ----------------------------------------------------------------- */}
      {/* Top bar: tab switcher + view picker                               */}
      {/* ----------------------------------------------------------------- */}
      <div className="flex items-center gap-0 border-b bg-background shrink-0">
        {/* Tab buttons */}
        <div className="flex items-center border-r pr-4">
          <div className="flex items-center gap-1 px-2">
            <Monitor className="h-4 w-4 text-muted-foreground" />
          </div>
          {showPOS && (
            <TabButton
              active={activeTab === 'pos'}
              onClick={() => handleTab('pos')}
            >
              POS
            </TabButton>
          )}
          {showKitchen && (
            <TabButton
              active={activeTab === 'kitchen'}
              onClick={() => handleTab('kitchen')}
            >
              Kitchen
            </TabButton>
          )}
        </div>

        {/* View pills */}
        <div className="flex items-center gap-2 px-4 overflow-x-auto">
          {activeTab === 'pos' &&
            POS_VIEWS.map((v) => (
              <ViewPill
                key={v.id}
                active={posView === v.id}
                onClick={() => handlePosView(v.id)}
              >
                {v.label}
              </ViewPill>
            ))}
          {activeTab === 'kitchen' &&
            KDS_VIEWS.map((v) => (
              <ViewPill
                key={v.id}
                active={kdsView === v.id}
                onClick={() => handleKdsView(v.id)}
              >
                {v.label}
              </ViewPill>
            ))}
        </div>
      </div>

      {/* ----------------------------------------------------------------- */}
      {/* View content area                                                 */}
      {/* ----------------------------------------------------------------- */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'pos' && <POSPanel posView={posView} />}
        {activeTab === 'kitchen' && (
          <KitchenPanel kdsView={kdsView} onKdsView={handleKdsView} />
        )}
      </div>
    </div>
  );
}
