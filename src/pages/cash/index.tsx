import { useState, useEffect, useCallback } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/context/auth-context';
import { api } from '@/lib/api-client';
import { OpenSessionForm } from './components/open-session-form';
import { SessionCard } from './components/session-card';
import { EodReportCard } from './components/eod-report-card';
import { PageHeader, PageContainer } from '@/components/ui/page-header';
import { Loader2, AlertCircle, Vault } from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// Mirrors backend/migrations/001_baseline.sql `cash_drawers` table.
export interface CashDrawer {
  id: string;
  location_id: string;
  name: string;
  is_active: boolean;
}

// Mirrors backend/migrations/001_baseline.sql `cash_drawer_movements` table.
export interface CashMovement {
  id: string;
  cash_drawer_session_id: string;
  movement_type: 'paid_in' | 'paid_out' | 'petty_cash' | 'tip_out' | 'no_sale' | 'drop' | 'pickup';
  amount_cents: number;
  reason?: string | null;
  reference_type?: string | null;
  reference_id?: string | null;
  performed_by?: string | null;
  approved_by?: string | null;
  created_at: string;
}

// Mirrors backend/migrations/001_baseline.sql `cash_drawer_sessions` table,
// with `movements` attached client-side by GET /cash-drawers/sessions/{id}.
export interface CashSession {
  id: string;
  cash_drawer_id: string;
  opened_by?: string | null;
  closed_by?: string | null;
  opening_float_cents: number;
  declared_closing_cents?: number | null;
  expected_closing_cents?: number | null;
  over_short_cents?: number | null;
  is_blind_close: boolean;
  status: 'open' | 'closed' | 'reconciled';
  opened_at: string;
  closed_at?: string | null;
  notes?: string | null;
  cashier_label?: string | null;
  movements?: CashMovement[];
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function useDrawers(locationId: string | undefined) {
  const [drawers, setDrawers] = useState<CashDrawer[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!locationId) { setDrawers([]); return; }
    setLoading(true);
    api
      .request<CashDrawer[]>('GET', `/data/cash_drawers?eq=location_id,${locationId}&eq=is_active,true`)
      .then(({ data }) => setDrawers(Array.isArray(data) ? data : []))
      .catch(() => setDrawers([]))
      .finally(() => setLoading(false));
  }, [locationId]);

  return { drawers, loading };
}

function useOpenSession(drawerId: string) {
  const [session, setSession] = useState<CashSession | null | undefined>(undefined); // undefined = not-yet-loaded
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    if (!drawerId) { setSession(null); return; }
    setLoading(true);
    setError(null);
    api
      .request<CashSession[] | CashSession>('GET', `/cash-drawers/${drawerId}/sessions?status=open`)
      .then(({ data, error: apiErr }) => {
        if (apiErr) throw new Error(apiErr.message);
        const sessions = Array.isArray(data) ? data : data ? [data] : [];
        setSession(sessions[0] || null); // null = no open session
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
        setSession(null);
      })
      .finally(() => setLoading(false));
  }, [drawerId]);

  useEffect(() => { reload(); }, [reload]);

  return { session, loading, error, reload };
}

// Fetch full session detail (includes movements array)
function useSessionDetail(sessionId: string | null) {
  const [detail, setDetail] = useState<CashSession | null>(null);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(() => {
    if (!sessionId) { setDetail(null); return; }
    setLoading(true);
    api
      .request<CashSession>('GET', `/cash-drawers/sessions/${sessionId}`)
      .then(({ data }) => setDetail(data || null))
      .catch(() => setDetail(null))
      .finally(() => setLoading(false));
  }, [sessionId]);

  useEffect(() => { reload(); }, [reload]);

  return { detail, loading, reload };
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function CashPage() {
  const { activeLocation, user } = useAuth();
  const locationId = activeLocation?.id;

  // The staff id to pass to the API. Fall back to user id if needed.
  const staffId = user?.id || '';

  const { drawers, loading: drawersLoading } = useDrawers(locationId);
  const [drawerId, setDrawerId] = useState('');

  // Auto-select the first drawer when drawers load
  useEffect(() => {
    if (drawers.length > 0 && !drawerId) {
      setDrawerId(drawers[0].id);
    }
  }, [drawers, drawerId]);

  // Open session query (lightweight, just to know if one exists)
  const { session: openSession, loading: sessionLoading, error: sessionError, reload: reloadSession } =
    useOpenSession(drawerId);

  // Full detail (with movements) — fetched once we have a session id
  const { detail, loading: detailLoading, reload: reloadDetail } =
    useSessionDetail(openSession?.id ?? null);

  // After close we show the EOD report
  const [closedSession, setClosedSession] = useState<CashSession | null>(null);

  // When drawer changes, clear closed report
  useEffect(() => { setClosedSession(null); }, [drawerId]);

  const handleSessionOpened = () => {
    setClosedSession(null);
    reloadSession();
  };

  const handleMovementAdded = () => {
    reloadDetail();
  };

  const handleSessionClosed = (sess: CashSession) => {
    setClosedSession(sess);
    reloadSession();
  };

  // Merge open session with detail (detail has movements)
  const sessionWithMovements =
    detail && openSession && detail.id === openSession.id
      ? { ...openSession, ...detail }
      : openSession;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (!locationId) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3">
        <AlertCircle className="h-12 w-12 text-muted-foreground" />
        <p className="text-muted-foreground">Please select a location to manage cash drawers.</p>
      </div>
    );
  }

  return (
    <PageContainer className="max-w-3xl mx-auto">
      <PageHeader icon={Vault} title="Cash Drawer" />

      {/* Drawer selector */}
      <div className="space-y-1 max-w-xs">
        <Label htmlFor="drawer-select">Drawer</Label>
        {drawersLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading drawers…
          </div>
        ) : drawers.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No active drawers for this location.
          </p>
        ) : (
          <Select value={drawerId} onValueChange={setDrawerId}>
            <SelectTrigger id="drawer-select">
              <SelectValue placeholder="Select a drawer" />
            </SelectTrigger>
            <SelectContent>
              {drawers.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Main content — only show when a drawer is selected */}
      {drawerId && (
        <>
          {/* Loading state */}
          {sessionLoading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Checking session status…
            </div>
          )}

          {/* Error */}
          {sessionError && !sessionLoading && (
            <div className="flex items-center gap-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4" />
              {sessionError}
            </div>
          )}

          {/* EOD report after a close (shown until drawer changes) */}
          {closedSession && !sessionLoading && (
            <EodReportCard session={closedSession} />
          )}

          {/* No open session + not just closed */}
          {!sessionLoading && openSession === null && !closedSession && (
            <OpenSessionForm
              drawerId={drawerId}
              staffId={staffId}
              onOpened={handleSessionOpened}
            />
          )}

          {/* Open session card */}
          {!sessionLoading && openSession && !closedSession && (
            <>
              {detailLoading && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading movements…
                </div>
              )}
              <SessionCard
                session={sessionWithMovements || openSession}
                staffId={staffId}
                onMovementAdded={handleMovementAdded}
                onSessionClosed={handleSessionClosed}
              />
            </>
          )}
        </>
      )}
    </PageContainer>
  );
}
