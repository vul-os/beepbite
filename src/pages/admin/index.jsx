import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Shield, Search, Loader2, AlertTriangle, X, Pause, Play, Sliders, ArrowLeft, Wallet, Bell, RefreshCw } from 'lucide-react';

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';

import {
  searchTenants,
  getTenant,
  pauseTenant,
  unpauseTenant,
  overrideQuota,
} from '@/services/admin.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatCents(cents) {
  if (cents == null) return '—';
  const n = typeof cents === 'number' ? cents : Number(cents) || 0;
  return `$${(n / 100).toFixed(2)}`;
}

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

const TIER_COLORS = {
  free: 'secondary',
  starter: 'outline',
  growth: 'default',
  pro: 'default',
  enterprise: 'default',
};

function TierBadge({ tier }) {
  const t = (tier || 'free').toLowerCase();
  const isHighValue = ['pro', 'enterprise', 'growth'].includes(t);
  return (
    <Badge
      variant={TIER_COLORS[t] || 'outline'}
      className={isHighValue ? 'bg-orange-100 text-orange-800 border-orange-200 hover:bg-orange-100' : ''}
    >
      {tier || 'free'}
    </Badge>
  );
}

function StatusBadge({ status }) {
  const s = (status || '').toLowerCase();
  if (s === 'active') {
    return <Badge className="bg-green-100 text-green-800 border-green-200 hover:bg-green-100">{status}</Badge>;
  }
  if (s === 'paused') {
    return <Badge variant="secondary" className="bg-yellow-100 text-yellow-800 border-yellow-200 hover:bg-yellow-100">{status}</Badge>;
  }
  if (s === 'suspended' || s === 'banned') {
    return <Badge variant="destructive">{status}</Badge>;
  }
  return <Badge variant="outline">{status || 'unknown'}</Badge>;
}

// Quota resource options
const QUOTA_RESOURCES = [
  { value: 'menu_items', label: 'Menu Items' },
  { value: 'locations', label: 'Locations' },
  { value: 'staff_members', label: 'Staff Members' },
  { value: 'api_calls_monthly', label: 'API Calls (monthly)' },
  { value: 'orders_monthly', label: 'Orders (monthly)' },
  { value: 'integrations', label: 'Integrations' },
  { value: 'storage_gb', label: 'Storage (GB)' },
];

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
// Quota Override Form Dialog
// ---------------------------------------------------------------------------

function QuotaOverrideDialog({ open, onOpenChange, orgId, orgName, onSuccess }) {
  const [resource, setResource] = useState('');
  const [includedCount, setIncludedCount] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  function reset() {
    setResource('');
    setIncludedCount('');
    setError(null);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!resource) { setError('Select a resource.'); return; }
    const count = parseInt(includedCount, 10);
    if (isNaN(count) || count < 0) { setError('Enter a valid non-negative number.'); return; }
    setLoading(true);
    setError(null);
    const { error: apiErr } = await overrideQuota(orgId, { resource, includedCount: count });
    setLoading(false);
    if (apiErr) { setError(apiErr.message || 'Failed to apply quota override.'); return; }
    reset();
    onOpenChange(false);
    onSuccess?.();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sliders className="h-4 w-4 text-orange-500" />
            Quota Override
          </DialogTitle>
          <DialogDescription>
            Set a custom quota limit for <strong>{orgName}</strong>.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="quota-resource">Resource</Label>
            <Select value={resource} onValueChange={setResource}>
              <SelectTrigger id="quota-resource">
                <SelectValue placeholder="Select resource…" />
              </SelectTrigger>
              <SelectContent>
                {QUOTA_RESOURCES.map((r) => (
                  <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="quota-count">Included count</Label>
            <Input
              id="quota-count"
              type="number"
              min="0"
              step="1"
              placeholder="e.g. 500"
              value={includedCount}
              onChange={(e) => setIncludedCount(e.target.value)}
            />
          </div>

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => { reset(); onOpenChange(false); }} disabled={loading}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading} className="bg-orange-500 hover:bg-orange-600 text-white">
              {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Apply Override
            </Button>
          </DialogFooter>
        </form>
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
  const [quotaDialogOpen, setQuotaDialogOpen] = useState(false);
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
        <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
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

  const { org, wallet, recent_transactions: txns = [], alarms = [] } = detail;
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
          <Button
            size="sm"
            variant="outline"
            className="gap-1 border-orange-300 text-orange-700 hover:bg-orange-50"
            onClick={() => setQuotaDialogOpen(true)}
          >
            <Sliders className="h-3.5 w-3.5" />
            Quota Override
          </Button>
          {isPaused ? (
            <Button
              size="sm"
              className="gap-1 bg-green-600 hover:bg-green-700 text-white"
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
              <TierBadge tier={org?.tier} />
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

      {/* Wallet */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Wallet className="h-4 w-4 text-orange-500" />
            Wallet
          </CardTitle>
        </CardHeader>
        <CardContent>
          {wallet ? (
            <div className="space-y-3">
              <div className="flex items-center gap-4 flex-wrap">
                <div>
                  <p className="text-xs text-muted-foreground">Balance</p>
                  <p className="text-2xl font-bold text-orange-600">{formatCents(wallet.balance_cents ?? wallet.wallet_balance_cents)}</p>
                </div>
                {wallet.hold_cents != null && (
                  <div>
                    <p className="text-xs text-muted-foreground">On Hold</p>
                    <p className="text-lg font-semibold text-muted-foreground">{formatCents(wallet.hold_cents)}</p>
                  </div>
                )}
                {wallet.currency_code && (
                  <div>
                    <p className="text-xs text-muted-foreground">Currency</p>
                    <p className="text-base font-medium">{wallet.currency_code}</p>
                  </div>
                )}
              </div>

              {txns.length > 0 && (
                <>
                  <Separator />
                  <p className="text-sm font-medium text-muted-foreground">Recent Transactions</p>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Type</TableHead>
                        <TableHead>Amount</TableHead>
                        <TableHead>Balance After</TableHead>
                        <TableHead>Reason</TableHead>
                        <TableHead>Date</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {txns.map((tx, i) => (
                        <TableRow key={tx.id || i}>
                          <TableCell>
                            <Badge variant="outline" className="capitalize text-xs">{tx.kind || tx.type || '—'}</Badge>
                          </TableCell>
                          <TableCell className={`font-medium ${(tx.amount_cents ?? 0) >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                            {(tx.amount_cents ?? 0) >= 0 ? '+' : ''}{formatCents(tx.amount_cents)}
                          </TableCell>
                          <TableCell className="text-muted-foreground">{formatCents(tx.balance_after_cents)}</TableCell>
                          <TableCell className="text-muted-foreground max-w-[160px] truncate">{tx.reason || '—'}</TableCell>
                          <TableCell className="text-muted-foreground text-xs">{formatDateTime(tx.created_at)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </>
              )}

              {txns.length === 0 && (
                <p className="text-sm text-muted-foreground italic">No recent transactions.</p>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground italic">No wallet data.</p>
          )}
        </CardContent>
      </Card>

      {/* Alarms */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Bell className="h-4 w-4 text-orange-500" />
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
                  className="flex items-start gap-3 p-3 rounded-lg bg-red-50 border border-red-200"
                >
                  <AlertTriangle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-red-800">{alarm.name || alarm.type || 'Alarm'}</p>
                    {alarm.message && <p className="text-xs text-red-600 mt-0.5">{alarm.message}</p>}
                    {alarm.triggered_at && (
                      <p className="text-xs text-red-500 mt-1">{formatDateTime(alarm.triggered_at)}</p>
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

      <QuotaOverrideDialog
        open={quotaDialogOpen}
        onOpenChange={setQuotaDialogOpen}
        orgId={orgId}
        orgName={org?.name}
        onSuccess={load}
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
      <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        {/* Header strip stays visible in detail */}
        <div className="flex items-center gap-3 border-b border-border pb-4">
          <div className="h-8 w-8 rounded-lg bg-orange-500 flex items-center justify-center">
            <Shield className="h-4 w-4 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold leading-tight text-foreground">Platform Admin</h1>
            <p className="text-xs text-muted-foreground">Tenant detail</p>
          </div>
        </div>
        <TenantDetail orgId={selectedOrgId} onBack={() => setSelectedOrgId(null)} />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
      {/* Page Header */}
      <div className="flex items-center gap-3 border-b border-border pb-5">
        <div className="h-10 w-10 rounded-xl bg-orange-500 flex items-center justify-center shadow-sm">
          <Shield className="h-5 w-5 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Platform Admin</h1>
          <p className="text-sm text-muted-foreground">Manage tenants, quotas, and platform health.</p>
        </div>
      </div>

      {/* 403 Guard */}
      {is403 && (
        <Card className="border-orange-200 bg-orange-50">
          <CardContent className="p-6 flex flex-col items-center text-center gap-3">
            <div className="h-12 w-12 rounded-full bg-orange-100 flex items-center justify-center">
              <Shield className="h-6 w-6 text-orange-600" />
            </div>
            <h2 className="text-base font-semibold text-orange-900">Not a Platform Admin</h2>
            <p className="text-sm text-orange-700 max-w-sm">
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
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  aria-label="Clear search"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </CardHeader>

          <CardContent className="p-0">
            {/* Loading */}
            {loadingList && (
              <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin text-orange-500" />
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
                    <TableHead>Tier</TableHead>
                    <TableHead>Wallet Balance</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tenants.map((t) => (
                    <TableRow
                      key={t.org_id}
                      className="cursor-pointer hover:bg-orange-50/60 transition-colors"
                      onClick={() => setSelectedOrgId(t.org_id)}
                    >
                      <TableCell className="font-medium">{t.name || '—'}</TableCell>
                      <TableCell>
                        <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">{t.slug || '—'}</span>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">{t.owner_email || '—'}</TableCell>
                      <TableCell><TierBadge tier={t.tier} /></TableCell>
                      <TableCell className="font-medium text-orange-700">{formatCents(t.wallet_balance_cents)}</TableCell>
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
    </div>
  );
}
