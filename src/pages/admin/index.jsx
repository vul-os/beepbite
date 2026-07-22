import { useState, useEffect, useCallback, useRef } from 'react';
import { Shield, Search, Loader2, AlertTriangle, X, Pause, Play, ArrowLeft, Bell, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { PageHeader, PageContainer } from '@/components/ui/page-header';

import {
  searchTenants,
  getTenant,
  pauseTenant,
  unpauseTenant,
} from '@/services/admin.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function StatusBadge({ status }) {
  const s = (status || '').toLowerCase();
  if (s === 'active') {
    return <Badge className="bg-success/15 text-success border-success/30 hover:bg-success/15">{status}</Badge>;
  }
  if (s === 'paused') {
    return <Badge variant="secondary" className="bg-warning/15 text-warning border-warning/30 hover:bg-warning/15">{status}</Badge>;
  }
  if (s === 'suspended' || s === 'banned') {
    return <Badge variant="destructive">{status}</Badge>;
  }
  return <Badge variant="outline">{status || 'unknown'}</Badge>;
}

// ---------------------------------------------------------------------------
// Confirm Dialog (reusable)
// ---------------------------------------------------------------------------

function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel, confirmVariant = 'destructive', onConfirm, loading }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button variant={confirmVariant} onClick={onConfirm} disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Tenant Detail Panel
// ---------------------------------------------------------------------------

function TenantDetail({ orgId, onBack }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [pauseDialogOpen, setPauseDialogOpen] = useState(false);
  const [unpauseDialogOpen, setUnpauseDialogOpen] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: apiErr } = await getTenant(orgId);
    setLoading(false);
    if (apiErr) { setError(apiErr.message || 'Failed to load tenant.'); return; }
    setDetail(data);
  }, [orgId]);

  useEffect(() => { load(); }, [load]);

  async function handlePause() {
    setActionLoading(true);
    setActionError(null);
    const { error: apiErr } = await pauseTenant(orgId);
    setActionLoading(false);
    if (apiErr) { setActionError(apiErr.message || 'Failed to pause tenant.'); return; }
    setPauseDialogOpen(false);
    await load();
  }

  async function handleUnpause() {
    setActionLoading(true);
    setActionError(null);
    const { error: apiErr } = await unpauseTenant(orgId);
    setActionLoading(false);
    if (apiErr) { setActionError(apiErr.message || 'Failed to unpause tenant.'); return; }
    setUnpauseDialogOpen(false);
    await load();
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-muted-foreground gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <span className="text-sm">Loading tenant…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={onBack} className="gap-1">
          <ArrowLeft className="h-4 w-4" /> Back to list
        </Button>
        <Card className="border-destructive">
          <CardContent className="p-4 text-destructive text-sm flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            {error}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!detail) return null;

  const { org, alarms = [] } = detail;
  const isPaused = (org?.status || '').toLowerCase() === 'paused';

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <Button variant="ghost" size="sm" onClick={onBack} className="gap-1 -ml-2">
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={load}
            className="gap-1"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </Button>
          {isPaused ? (
            <Button
              size="sm"
              variant="success"
              className="gap-1"
              onClick={() => setUnpauseDialogOpen(true)}
            >
              <Play className="h-3.5 w-3.5" />
              Unpause
            </Button>
          ) : (
            <Button
              size="sm"
              variant="destructive"
              className="gap-1"
              onClick={() => setPauseDialogOpen(true)}
            >
              <Pause className="h-3.5 w-3.5" />
              Pause Tenant
            </Button>
          )}
        </div>
      </div>

      {actionError && (
        <Card className="border-destructive">
          <CardContent className="p-3 text-destructive text-sm flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            {actionError}
          </CardContent>
        </Card>
      )}

      {/* Org Info */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <CardTitle className="text-lg">{org?.name || '—'}</CardTitle>
              <CardDescription className="mt-1">{org?.owner_email || '—'}</CardDescription>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <StatusBadge status={org?.status} />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3 text-sm">
            <div>
              <dt className="text-muted-foreground">Slug</dt>
              <dd className="font-mono font-medium mt-0.5">{org?.slug || '—'}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Org ID</dt>
              <dd className="font-mono text-xs mt-0.5 truncate">{org?.org_id || org?.id || '—'}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Created</dt>
              <dd className="mt-0.5">{formatDate(org?.created_at)}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      {/* Alarms */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Bell className="h-4 w-4 text-primary" />
            Active Alarms
            {alarms.length > 0 && (
              <Badge variant="destructive" className="ml-1">{alarms.length}</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {alarms.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">No active alarms.</p>
          ) : (
            <ul className="space-y-2">
              {alarms.map((alarm, i) => (
                <li
                  key={alarm.id || i}
                  className="flex items-start gap-3 p-3 rounded-lg bg-destructive/5 border border-destructive/20"
                >
                  <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-destructive">{alarm.name || alarm.type || 'Alarm'}</p>
                    {alarm.message && <p className="text-xs text-destructive/80 mt-0.5">{alarm.message}</p>}
                    {alarm.triggered_at && (
                      <p className="text-xs text-destructive/70 mt-1">{formatDateTime(alarm.triggered_at)}</p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Dialogs */}
      <ConfirmDialog
        open={pauseDialogOpen}
        onOpenChange={setPauseDialogOpen}
        title="Pause this tenant?"
        description={`This will suspend all activity for "${org?.name}". They will not be able to accept orders or access the dashboard until unpaused.`}
        confirmLabel="Yes, pause tenant"
        confirmVariant="destructive"
        onConfirm={handlePause}
        loading={actionLoading}
      />

      <ConfirmDialog
        open={unpauseDialogOpen}
        onOpenChange={setUnpauseDialogOpen}
        title="Unpause this tenant?"
        description={`This will restore full access for "${org?.name}".`}
        confirmLabel="Yes, unpause tenant"
        confirmVariant="default"
        onConfirm={handleUnpause}
        loading={actionLoading}
      />

    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Admin Dashboard Page
// ---------------------------------------------------------------------------

export default function AdminDashboardPage() {
  const [query, setQuery] = useState('');
  const [tenants, setTenants] = useState([]);
  const [loadingList, setLoadingList] = useState(false);
  const [listError, setListError] = useState(null);
  const [is403, setIs403] = useState(false);
  const [selectedOrgId, setSelectedOrgId] = useState(null);

  // Debounce ref
  const debounceRef = useRef(null);

  const fetchTenants = useCallback(async (q) => {
    setLoadingList(true);
    setListError(null);
    setIs403(false);
    const { data, error } = await searchTenants(q);
    setLoadingList(false);
    if (error) {
      if (error.status === 403) {
        setIs403(true);
      } else {
        setListError(error.message || 'Failed to load tenants.');
      }
      return;
    }
    setTenants(Array.isArray(data) ? data : []);
  }, []);

  // Initial load
  useEffect(() => {
    fetchTenants('');
  }, [fetchTenants]);

  // Debounced search on query change
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchTenants(query);
    }, 350);
    return () => clearTimeout(debounceRef.current);
  }, [query, fetchTenants]);

  // If viewing a tenant detail
  if (selectedOrgId) {
    return (
      <PageContainer className="max-w-4xl mx-auto px-4 py-6">
        <PageHeader
          title="Platform Admin"
          description="Tenant detail"
          icon={Shield}
        />
        <TenantDetail orgId={selectedOrgId} onBack={() => setSelectedOrgId(null)} />
      </PageContainer>
    );
  }

  return (
    <PageContainer className="max-w-6xl mx-auto px-4 py-6">
      <PageHeader
        title="Platform Admin"
        description="Manage tenants and platform health."
        icon={Shield}
      />

      {/* 403 Guard */}
      {is403 && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="p-6 flex flex-col items-center text-center gap-3">
            <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
              <Shield className="h-6 w-6 text-primary" />
            </div>
            <h2 className="text-base font-semibold text-foreground">Not a Platform Admin</h2>
            <p className="text-sm text-muted-foreground max-w-sm">
              Your account does not have platform-admin privileges. Contact the system administrator to request access.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Search + Tenant List */}
      {!is403 && (
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-base">Tenants</CardTitle>
            <div className="mt-3 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                className="pl-9 pr-9"
                placeholder="Search by name, slug, or email…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {query && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setQuery('')}
                  className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label="Clear search"
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          </CardHeader>

          <CardContent className="p-0">
            {/* Loading */}
            {loadingList && (
              <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
                <span className="text-sm">Searching tenants…</span>
              </div>
            )}

            {/* Error */}
            {!loadingList && listError && (
              <div className="p-4 m-4 rounded-lg border border-destructive/30 bg-destructive/5 flex items-start gap-3">
                <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium text-destructive">Error loading tenants</p>
                  <p className="text-xs text-destructive/80 mt-0.5">{listError}</p>
                </div>
              </div>
            )}

            {/* Empty */}
            {!loadingList && !listError && tenants.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
                <Search className="h-8 w-8 opacity-30" />
                <p className="text-sm">
                  {query ? `No tenants match "${query}"` : 'No tenants found.'}
                </p>
              </div>
            )}

            {/* Results Table */}
            {!loadingList && !listError && tenants.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Slug</TableHead>
                    <TableHead>Owner Email</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tenants.map((t) => (
                    <TableRow
                      key={t.org_id}
                      className="cursor-pointer hover:bg-primary/5 transition-colors"
                      onClick={() => setSelectedOrgId(t.org_id)}
                    >
                      <TableCell className="font-medium">{t.name || '—'}</TableCell>
                      <TableCell>
                        <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">{t.slug || '—'}</span>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">{t.owner_email || '—'}</TableCell>
                      <TableCell><StatusBadge status={t.status} /></TableCell>
                      <TableCell className="text-muted-foreground text-xs">{formatDate(t.created_at)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
    </PageContainer>
  );
}
