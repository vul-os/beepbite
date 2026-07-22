// src/pages/work/index.jsx — Unified Workspace (Wave 35 / Now-27)
//
// A single page with TWO top-level tabs: POS and Kitchen.
//
// POS views:     Quick | Full | Floor
// (an "Orders" POS view was removed — it rendered the raw Home orders-section
//  component with none of the state/props it needs, which crashed. The
//  Home page's Live Orders panel is the supported place for that list.)
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
import {
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
import { Button } from '@/components/ui/button';
import { SyncStatusBadge } from '@/components/ui/sync-status';

// ---------------------------------------------------------------------------
// Lazy view imports — read-only; do NOT modify these files.
// ---------------------------------------------------------------------------

// POS views
const PosWorkspace = lazy(() => import('@/pages/pos/workspace'));
const QuickPOS = lazy(() => import('@/pages/quick-pos'));
const FloorLive = lazy(() => import('@/pages/floor'));

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
        .eq('is_active', true)
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
    <Button
      type="button"
      variant="ghost"
      onClick={onClick}
      aria-selected={active}
      role="tab"
      className={cn(
        // font-display: this is the "which screen am I on" label — read at a
        // glance while reaching for the tab, same job as a KDS ticket header.
        'h-auto rounded-none px-5 py-3 font-display text-sm tracking-wide border-b-2 hover:bg-transparent',
        active
          ? 'border-primary text-primary'
          : 'border-transparent text-muted-foreground hover:text-foreground hover:border-muted',
      )}
    >
      {children}
    </Button>
  );
}

// ---------------------------------------------------------------------------
// View pill (sub-tab)
// ---------------------------------------------------------------------------

function ViewPill({ active, onClick, children }) {
  return (
    <Button
      type="button"
      variant={active ? 'default' : 'outline'}
      onClick={onClick}
      aria-pressed={active}
      className="h-auto rounded-full px-3.5 py-1.5 text-xs font-semibold"
    >
      {children}
    </Button>
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

  const needsStation = kdsView === 'station' || kdsView === 'bumpbar';

  // The whole Kitchen tab is scoped `dark` — station.jsx/expo.jsx (owned
  // elsewhere) render their own permanently-charcoal chrome (bg-gray-950/900,
  // no light-mode variant; it's a wall-mounted kitchen screen, not something
  // that follows the app's light/dark toggle). Scoping the *tokens* dark here
  // — rather than hardcoding gray-9xx of our own — means our station picker,
  // empty-state and loading fallback pick up the same charcoal/orange
  // pairing (bg-card/border-border/bg-primary resolve to the .dark values in
  // index.css, which were tuned to sit next to those literal grays) instead
  // of flashing light before the KDS view mounts.
  return (
    <div className="dark flex flex-col h-full bg-background">
      {stationsLoading ? (
        <ViewLoader />
      ) : (
        <>
          {/* Station picker (shown when view needs a station) */}
          {needsStation && stations.length > 1 && (
            <div className="flex gap-2 px-4 py-2 border-b border-border bg-card/60 overflow-x-auto">
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
        </>
      )}
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
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Workspace page
// ---------------------------------------------------------------------------

export default function WorkspacePage() {
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
      // 'orders' was a removed POS view (see POS_VIEWS above) — coerce any
      // previously-persisted preference back to a view that still exists.
      const posView = POS_VIEWS.some((v) => v.id === lastViewPOS) ? lastViewPOS : 'full';
      setPosView(posView);
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
      {/*                                                                   */}
      {/* Scoped `dark` on purpose, independent of the app's own light/dark */}
      {/* toggle: this bar is the one piece of chrome that's ALWAYS on      */}
      {/* screen no matter which half a small operation is looking at, and  */}
      {/* the Kitchen half underneath it (station.jsx/expo.jsx) is a        */}
      {/* permanently-charcoal kitchen display that never goes light. A     */}
      {/* light bar sitting over a black KDS board every time staff tap     */}
      {/* over to Kitchen would read as two products bolted together; a     */}
      {/* charcoal bar that also sits fine over the (light, "warm paper")   */}
      {/* POS half reads as one deliberate till bezel instead. index.css's  */}
      {/* .dark tokens were tuned to match the KDS's literal grays/orange   */}
      {/* for exactly this reason.                                         */}
      {/* ----------------------------------------------------------------- */}
      <div className="dark flex items-center gap-0 border-b border-border bg-card shrink-0 shadow-sm">
        {/* Tab buttons */}
        <div className="flex items-center border-r border-border pr-4">
          <div className="flex items-center gap-2.5 pl-4 pr-3" aria-hidden="true">
            <span className="h-6 w-1 rounded-full bg-primary" />
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

        {/* Sync status — this is the one chrome-bearing screen in the app
            (unlike the chrome-less POS/KDS, which use the full-width
            OfflineBanner instead), so the compact top-bar badge belongs here
            rather than a banner. */}
        <div className="ml-auto flex items-center px-4 shrink-0">
          <SyncStatusBadge className="hidden sm:inline-flex" />
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
