import React from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Inbox } from 'lucide-react';

function centsToMajor(cents) {
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

const STATUS_VARIANT = {
  pending: 'secondary',
  initiated: 'outline',
  processing: 'secondary',
  completed: 'default',
  paid: 'default',
  failed: 'destructive',
  reversed: 'destructive',
  cancelled: 'secondary',
};

const SUCCESS_STATUSES = new Set(['completed', 'paid']);

function StatusBadge({ status }) {
  const variant = STATUS_VARIANT[status] ?? 'outline';
  const label = status ? status.charAt(0).toUpperCase() + status.slice(1) : '—';
  return (
    <Badge
      variant={variant}
      className={SUCCESS_STATUSES.has(status) ? 'bg-green-600 text-white' : undefined}
    >
      {label}
    </Badge>
  );
}

export function RecentPayouts({ payouts, loading }) {
  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-base font-semibold">Recent payouts</h2>
        <p className="text-sm text-muted-foreground">Your last 12 payouts.</p>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-11 w-full rounded-md" />
          ))}
        </div>
      ) : payouts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 border rounded-lg text-center">
          <Inbox className="h-8 w-8 text-muted-foreground mb-2" />
          <p className="text-sm font-medium">No payouts yet</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Payouts will appear here once they are initiated.
          </p>
        </div>
      ) : (
        <div className="rounded-md border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Gross</TableHead>
                <TableHead className="text-right">Fees</TableHead>
                <TableHead className="text-right">Net</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payouts.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="text-sm whitespace-nowrap">
                    {formatDate(p.initiated_at ?? p.created_at)}
                  </TableCell>
                  <TableCell className="text-right text-sm font-mono">
                    {centsToMajor(p.gross_cents)}
                  </TableCell>
                  <TableCell className="text-right text-sm font-mono text-muted-foreground">
                    {p.fees_cents != null ? `-${centsToMajor(p.fees_cents)}` : '—'}
                  </TableCell>
                  <TableCell className="text-right text-sm font-mono font-medium">
                    {centsToMajor(p.net_cents)}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={p.payout_status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
