import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DateRangePicker } from '@/components/ui/date-range-picker';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { ExternalLink, RefreshCw, Inbox } from 'lucide-react';
import { api } from '@/lib/api-client';
import { useToast } from '@/hooks/use-toast';

const PAYSTACK_TRANSFER_URL = 'https://dashboard.paystack.com/#/transfers';
const PAGE_LIMIT = 50;

function formatCents(cents) {
  if (cents == null) return '—';
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

function formatDate(isoString) {
  if (!isoString) return '—';
  return new Intl.DateTimeFormat('en-ZA', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(isoString));
}

const STATUS_STYLES = {
  initiated: 'outline',
  processing: 'secondary',
  pending: 'secondary',
  completed: 'default',
  paid: 'default',
  success: 'default',
  failed: 'destructive',
  reversed: 'destructive',
  cancelled: 'secondary',
};

function statusBadge(status) {
  const variant = STATUS_STYLES[status] ?? 'outline';
  const label = status ? status.charAt(0).toUpperCase() + status.slice(1) : '—';
  return (
    <Badge
      variant={variant}
      className={
        variant === 'default' && (status === 'completed' || status === 'paid' || status === 'success')
          ? 'bg-green-600 text-white'
          : undefined
      }
    >
      {label}
    </Badge>
  );
}

export function PayoutHistoryTab({ orgId }) {
  const { toast } = useToast();
  const [payouts, setPayouts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState({ from: undefined, to: undefined });
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);

  const fetchPayouts = useCallback(
    async (currentOffset = 0) => {
      if (!orgId) return;
      setLoading(true);
      try {
        const params = new URLSearchParams({
          org_id: orgId,
          order: 'initiated_at.desc',
          limit: String(PAGE_LIMIT),
        });
        if (currentOffset > 0) params.set('offset', String(currentOffset));
        if (dateRange.from) {
          params.set('gte', `initiated_at,${dateRange.from.toISOString()}`);
        }
        if (dateRange.to) {
          // end of day
          const to = new Date(dateRange.to);
          to.setHours(23, 59, 59, 999);
          params.set('lte', `initiated_at,${to.toISOString()}`);
        }

        const { data, error } = await api.request(
          'GET',
          `/data/merchant_payouts?${params.toString()}`
        );
        if (error) {
          toast({
            variant: 'destructive',
            title: 'Failed to load payouts',
            description: error.message,
          });
          return;
        }
        const rows = Array.isArray(data) ? data : [];
        if (currentOffset === 0) {
          setPayouts(rows);
        } else {
          setPayouts((prev) => [...prev, ...rows]);
        }
        setHasMore(rows.length === PAGE_LIMIT);
        setOffset(currentOffset);
      } finally {
        setLoading(false);
      }
    },
    [orgId, dateRange]
  );

  useEffect(() => {
    setOffset(0);
    fetchPayouts(0);
  }, [orgId, dateRange]);

  function handleLoadMore() {
    const nextOffset = offset + PAGE_LIMIT;
    fetchPayouts(nextOffset);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">Payout history</h3>
          <p className="text-sm text-muted-foreground">
            All payouts initiated for your account.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <DateRangePicker
            className="w-64"
            date={dateRange}
            setDate={setDateRange}
            placeholder="Filter by date range"
          />
          <Button
            variant="outline"
            size="icon"
            onClick={() => fetchPayouts(0)}
            disabled={loading}
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            <span className="sr-only">Refresh</span>
          </Button>
        </div>
      </div>

      {loading && payouts.length === 0 ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-12 w-full rounded-md" />
          ))}
        </div>
      ) : payouts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-14 text-center border rounded-lg">
          <Inbox className="h-10 w-10 text-muted-foreground mb-3" />
          <p className="text-sm font-medium">No payouts found</p>
          <p className="text-xs text-muted-foreground mt-1">
            {dateRange.from || dateRange.to
              ? 'Try adjusting the date range filter.'
              : 'Payouts will appear here once they are initiated.'}
          </p>
        </div>
      ) : (
        <>
          <div className="rounded-md border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Initiated</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead className="text-right">Gross</TableHead>
                  <TableHead className="text-right">Fees</TableHead>
                  <TableHead className="text-right">Net</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Transfer ref</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payouts.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="whitespace-nowrap text-sm">
                      {formatDate(p.initiated_at)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {p.period_start && p.period_end
                        ? `${formatDate(p.period_start)} – ${formatDate(p.period_end)}`
                        : '—'}
                    </TableCell>
                    <TableCell className="text-right text-sm font-mono">
                      {formatCents(p.gross_cents)}
                    </TableCell>
                    <TableCell className="text-right text-sm font-mono text-muted-foreground">
                      {p.fees_cents != null ? `-${formatCents(p.fees_cents)}` : '—'}
                    </TableCell>
                    <TableCell className="text-right text-sm font-mono font-medium">
                      {formatCents(p.net_cents)}
                    </TableCell>
                    <TableCell>{statusBadge(p.payout_status)}</TableCell>
                    <TableCell>
                      {p.provider_transfer_id ? (
                        <a
                          href={`${PAYSTACK_TRANSFER_URL}/${p.provider_transfer_id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-primary hover:underline font-mono"
                        >
                          {p.provider_transfer_id.slice(0, 16)}
                          {p.provider_transfer_id.length > 16 && '…'}
                          <ExternalLink className="h-3 w-3 flex-shrink-0" />
                        </a>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {hasMore && (
            <div className="flex justify-center pt-2">
              <Button variant="outline" size="sm" onClick={handleLoadMore} disabled={loading}>
                {loading ? (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    Loading…
                  </>
                ) : (
                  'Load more'
                )}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
