/**
 * Manager Audit Log viewer — Wave 39.
 *
 * Full-page filterable audit log for the caller's organisation.
 * Filters: actor (UUID), action text (substring), date range, pagination.
 *
 * Route: wired externally; this file is the default export.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  ClipboardList,
  RefreshCw,
  Filter,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
} from 'lucide-react';
import { listAuditLog } from '@/services/auditviewer';

// ── Constants ─────────────────────────────────────────────────────────────────

const PER_PAGE = 50;

const ACTOR_COLORS = {
  member:   'bg-blue-100 text-blue-800 border-blue-200',
  staff:    'bg-purple-100 text-purple-800 border-purple-200',
  system:   'bg-gray-100 text-gray-700 border-gray-200',
  customer: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  webhook:  'bg-orange-100 text-orange-800 border-orange-200',
  api_key:  'bg-teal-100 text-teal-800 border-teal-200',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function ActorBadge({ type, label }) {
  return (
    <div className="flex items-center gap-1.5">
      <span
        className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium border ${
          ACTOR_COLORS[type] || 'bg-gray-100 text-gray-700 border-gray-200'
        }`}
      >
        {type}
      </span>
      {label && (
        <span className="text-xs text-muted-foreground truncate max-w-[140px]" title={label}>
          {label}
        </span>
      )}
    </div>
  );
}

// ── Filter panel ──────────────────────────────────────────────────────────────

function FilterPanel({ filters, onChange, onApply, onReset }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 p-4 bg-muted/40 rounded-lg border">
      <div className="space-y-1">
        <Label className="text-xs" htmlFor="f-actor">Actor ID</Label>
        <Input
          id="f-actor"
          placeholder="UUID"
          value={filters.actor}
          onChange={(e) => onChange('actor', e.target.value)}
          className="h-8 text-xs font-mono"
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs" htmlFor="f-action">Action</Label>
        <Input
          id="f-action"
          placeholder="e.g. order.void"
          value={filters.action}
          onChange={(e) => onChange('action', e.target.value)}
          className="h-8 text-xs"
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs" htmlFor="f-from">From</Label>
        <Input
          id="f-from"
          type="datetime-local"
          value={filters.from}
          onChange={(e) => onChange('from', e.target.value)}
          className="h-8 text-xs"
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs" htmlFor="f-to">To</Label>
        <Input
          id="f-to"
          type="datetime-local"
          value={filters.to}
          onChange={(e) => onChange('to', e.target.value)}
          className="h-8 text-xs"
        />
      </div>
      <div className="sm:col-span-2 lg:col-span-4 flex gap-2">
        <Button size="sm" onClick={onApply} className="gap-1.5">
          <Filter className="h-3.5 w-3.5" />
          Apply filters
        </Button>
        <Button size="sm" variant="ghost" onClick={onReset}>
          Reset
        </Button>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function AuditViewer() {
  const [entries, setEntries] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  const emptyFilters = { actor: '', action: '', from: '', to: '' };
  const [filters, setFilters] = useState(emptyFilters);
  const [appliedFilters, setAppliedFilters] = useState(emptyFilters);

  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  const fetchLog = useCallback(async (currentPage, applied) => {
    setLoading(true);
    setError('');

    const params = {
      page: currentPage,
      per_page: PER_PAGE,
    };
    if (applied.actor)  params.actor  = applied.actor;
    if (applied.action) params.action = applied.action;
    if (applied.from)   params.from   = new Date(applied.from).toISOString();
    if (applied.to)     params.to     = new Date(applied.to).toISOString();

    const { data, error: err } = await listAuditLog(params);
    setLoading(false);

    if (err) {
      setError(err.message || 'Failed to load audit log');
      return;
    }
    setEntries(data.data ?? []);
    setTotal(data.total ?? 0);
  }, []);

  useEffect(() => {
    fetchLog(page, appliedFilters);
  }, [page, appliedFilters, fetchLog]);

  const handleFilterChange = (key, val) => {
    setFilters((f) => ({ ...f, [key]: val }));
  };

  const handleApplyFilters = () => {
    setAppliedFilters({ ...filters });
    setPage(1);
  };

  const handleResetFilters = () => {
    setFilters(emptyFilters);
    setAppliedFilters(emptyFilters);
    setPage(1);
  };

  const hasActiveFilters = Object.values(appliedFilters).some(Boolean);

  return (
    <div className="flex flex-col min-h-full">
      {/* Page header */}
      <div className="px-6 py-4 border-b bg-background flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ClipboardList className="h-6 w-6 text-orange-500" />
            Audit Log
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            All activity for your organisation — newest first.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowFilters((v) => !v)}
            className={`gap-1.5 ${hasActiveFilters ? 'border-orange-300 text-orange-700' : ''}`}
          >
            <Filter className="h-3.5 w-3.5" />
            Filters
            {hasActiveFilters && (
              <Badge className="ml-1 bg-orange-100 text-orange-700 border-orange-300 text-xs px-1 py-0">
                on
              </Badge>
            )}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchLog(page, appliedFilters)}
            disabled={loading}
            className="gap-1.5"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      <div className="flex-1 p-6 space-y-4">
        {/* Filter panel */}
        {showFilters && (
          <FilterPanel
            filters={filters}
            onChange={handleFilterChange}
            onApply={handleApplyFilters}
            onReset={handleResetFilters}
          />
        )}

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {/* Table card */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">
                  {loading ? 'Loading…' : `${total.toLocaleString()} entries`}
                </CardTitle>
                {hasActiveFilters && !loading && (
                  <CardDescription className="text-xs mt-0.5">
                    Filters active — showing filtered results
                  </CardDescription>
                )}
              </div>
              {/* Pagination controls */}
              {!loading && total > 0 && (
                <div className="flex items-center gap-1 text-sm text-muted-foreground">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="px-1 text-xs">
                    {page} / {totalPages}
                  </span>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>
          </CardHeader>

          <CardContent className="p-0">
            {loading ? (
              <div className="space-y-2 p-4">
                {Array.from({ length: 8 }).map((_, i) => (
                  <Skeleton key={i} className="h-9 w-full" />
                ))}
              </div>
            ) : entries.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
                <ClipboardList className="h-10 w-10 opacity-30" />
                <p className="text-sm">No audit log entries found</p>
                {hasActiveFilters && (
                  <Button size="sm" variant="ghost" onClick={handleResetFilters}>
                    Clear filters
                  </Button>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/30 text-xs text-muted-foreground text-left">
                      <th className="px-4 py-2.5 font-medium">Actor</th>
                      <th className="px-4 py-2.5 font-medium">Action</th>
                      <th className="px-4 py-2.5 font-medium">Entity</th>
                      <th className="px-4 py-2.5 font-medium">Entity ID</th>
                      <th className="px-4 py-2.5 font-medium text-right">When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((entry) => (
                      <tr
                        key={entry.id}
                        className="border-b last:border-0 hover:bg-muted/20 transition-colors"
                      >
                        <td className="px-4 py-2.5">
                          <ActorBadge
                            type={entry.actor_type}
                            label={entry.actor_label}
                          />
                        </td>
                        <td className="px-4 py-2.5">
                          <code className="text-xs bg-muted rounded px-1.5 py-0.5 whitespace-nowrap">
                            {entry.action}
                          </code>
                        </td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground">
                          {entry.entity_type}
                        </td>
                        <td className="px-4 py-2.5 text-xs font-mono text-muted-foreground">
                          {entry.entity_id
                            ? entry.entity_id.slice(0, 8) + '…'
                            : '—'}
                        </td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground text-right whitespace-nowrap">
                          {fmtDate(entry.created_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Bottom pagination */}
        {!loading && total > PER_PAGE && (
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>
              Showing {(page - 1) * PER_PAGE + 1}–{Math.min(page * PER_PAGE, total)} of {total.toLocaleString()}
            </span>
            <div className="flex gap-1">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                className="gap-1"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="gap-1"
              >
                Next
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
