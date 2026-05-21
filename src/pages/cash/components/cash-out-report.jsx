import React, { useEffect, useState } from 'react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, AlertCircle, TrendingUp, TrendingDown, CheckCircle2, User } from 'lucide-react';
import { fetchCashOut } from '@/services/cashout';
import { formatPrice } from '@/lib/currency';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CURRENCY = 'ZAR';

function fmt(cents) {
  return formatPrice(cents ?? 0, CURRENCY);
}

function fmtSigned(cents) {
  if (cents == null) return '—';
  const sign = cents >= 0 ? '+' : '';
  return `${sign}${formatPrice(cents, CURRENCY)}`;
}

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function movementLabel(type) {
  const MAP = {
    paid_in:    'Paid In',
    paid_out:   'Paid Out',
    petty_cash: 'Petty Cash',
    tip_out:    'Tip Out',
    no_sale:    'No Sale',
    drop:       'Drop',
    pickup:     'Pickup',
  };
  return MAP[type] ?? type;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ReportRow({ label, value, sub, highlight }) {
  return (
    <div
      className={`flex items-center justify-between py-2 border-b last:border-0 ${
        highlight ? 'font-semibold' : ''
      }`}
    >
      <div>
        <span className="text-sm">{label}</span>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </div>
      <span className={`text-sm tabular-nums ${highlight ? 'text-base' : ''}`}>{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

/**
 * CashOutReport
 *
 * Props:
 *   sessionId {string}  — UUID of the cash_drawer_session
 */
export function CashOutReport({ sessionId }) {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState(null);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;

    setLoading(true);
    setError(null);

    fetchCashOut(sessionId).then(({ data, error: apiErr }) => {
      if (cancelled) return;
      if (apiErr) {
        setError(apiErr.message ?? 'Failed to load cash-out report');
      } else {
        setReport(data);
      }
      setLoading(false);
    });

    return () => { cancelled = true; };
  }, [sessionId]);

  // --- Loading ---
  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-8 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Loading cash-out report…</span>
        </CardContent>
      </Card>
    );
  }

  // --- Error ---
  if (error) {
    return (
      <Card className="border-destructive">
        <CardContent className="flex items-center gap-2 py-6 text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span className="text-sm">{error}</span>
        </CardContent>
      </Card>
    );
  }

  if (!report) return null;

  // --- Over/Short display ---
  const variance     = report.variance_cents ?? null;
  const isUncounted  = variance === null;
  const isOver       = variance !== null && variance > 0;
  const isShort      = variance !== null && variance < 0;
  const isBalanced   = variance !== null && variance === 0;

  const varianceColor = isUncounted
    ? 'text-muted-foreground'
    : isShort
    ? 'text-red-600'
    : 'text-green-600';

  const varianceBadge = isUncounted
    ? <Badge variant="outline">Not counted yet</Badge>
    : isBalanced
    ? <Badge className="bg-green-100 text-green-700 border-green-200">Balanced</Badge>
    : isOver
    ? <Badge className="bg-green-50 text-green-700 border-green-200">Over</Badge>
    : <Badge className="bg-red-50 text-red-700 border-red-200">Short</Badge>;

  // Movements breakdown: split positives from negatives
  const paidIn  = report.movements.filter((m) => m.amount_cents > 0);
  const paidOut = report.movements.filter((m) => m.amount_cents < 0);
  const noSale  = report.movements.filter((m) => m.amount_cents === 0);

  return (
    <div className="space-y-4">
      {/* Header card */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <CardTitle className="text-lg">Cash-Out Report</CardTitle>
            <div className="flex items-center gap-2">
              {varianceBadge}
              <Badge
                variant="outline"
                className={
                  report.status === 'open'
                    ? 'text-orange-700 border-orange-300 bg-orange-50'
                    : 'text-slate-600 border-slate-300 bg-slate-50'
                }
              >
                {report.status}
              </Badge>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Opened {fmtDate(report.opened_at)}
            {report.closed_at && ` · Closed ${fmtDate(report.closed_at)}`}
          </p>
        </CardHeader>

        {/* Optional staff section */}
        {report.staff && (
          <CardContent className="pt-0">
            <div className="rounded-md border bg-muted/30 px-3 py-2 flex items-center gap-2 text-sm">
              <User className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="text-muted-foreground">Staff shift ID:</span>
              <span className="font-mono text-xs">{report.staff.staff_id}</span>
              {report.staff.closed_at == null && (
                <Badge variant="outline" className="ml-auto text-orange-600 border-orange-300 bg-orange-50">
                  Shift open
                </Badge>
              )}
            </div>
          </CardContent>
        )}
      </Card>

      {/* Reconciliation card */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Reconciliation
          </CardTitle>
        </CardHeader>
        <CardContent className="divide-y divide-border px-4 pb-4">
          <ReportRow
            label="Opening float"
            sub="Cash counted when drawer was opened"
            value={fmt(report.opening_float_cents)}
          />
          <ReportRow
            label="Cash sales"
            sub="Payments taken in cash during this session"
            value={fmt(report.cash_sales_cents)}
          />
          <ReportRow
            label="Movements net"
            sub="Paid-in, paid-out, petty cash, drops, pickups"
            value={fmtSigned(report.movements_net_cents)}
          />
          <ReportRow
            label="Expected in drawer"
            sub="Opening float + cash sales + movements"
            value={fmt(report.expected_cash_cents)}
            highlight
          />
          <ReportRow
            label="Counted cash"
            sub={
              report.is_blind_close
                ? 'Staff count (blind close — expected hidden at count time)'
                : 'Staff count recorded at close'
            }
            value={report.counted_cash_cents != null ? fmt(report.counted_cash_cents) : '—'}
            highlight
          />
        </CardContent>
      </Card>

      {/* Variance hero card */}
      <Card
        className={
          isUncounted
            ? 'border-muted'
            : isShort
            ? 'border-red-300'
            : 'border-green-300'
        }
      >
        <CardContent className="py-6 flex flex-col items-center gap-1">
          <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">
            {isUncounted ? 'Variance' : isShort ? 'Short' : isBalanced ? 'Balanced' : 'Over'}
          </p>
          <div className={`text-4xl font-bold tabular-nums ${varianceColor}`}>
            {isUncounted
              ? '—'
              : isBalanced
              ? fmt(0)
              : `${isShort ? '' : '+'}${formatPrice(variance, CURRENCY)}`}
          </div>
          {!isUncounted && (
            <div className="flex items-center gap-1 mt-1">
              {isShort && <TrendingDown className="h-4 w-4 text-red-500" />}
              {isOver   && <TrendingUp  className="h-4 w-4 text-green-500" />}
              {isBalanced && <CheckCircle2 className="h-4 w-4 text-green-500" />}
              <span className={`text-sm ${varianceColor}`}>
                {isShort
                  ? `Drawer is R ${(Math.abs(variance) / 100).toFixed(2)} short of expected`
                  : isOver
                  ? `Drawer is R ${(Math.abs(variance) / 100).toFixed(2)} over expected`
                  : 'Drawer is exactly balanced'}
              </span>
            </div>
          )}

          {/* Show server-computed declared / over_short if present (already reconciled) */}
          {report.declared_closing_cents != null && (
            <p className="text-xs text-muted-foreground mt-2">
              Declared: {fmt(report.declared_closing_cents)}
              {report.over_short_cents != null && (
                <> · Recorded variance: {fmtSigned(report.over_short_cents)}</>
              )}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Movements breakdown */}
      {report.movements.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Movements ({report.movements.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-1">
            {report.movements.map((m) => (
              <div
                key={m.id}
                className="flex items-center justify-between text-sm py-1.5 border-b last:border-0"
              >
                <div className="flex flex-col">
                  <span className="font-medium">{movementLabel(m.movement_type)}</span>
                  {m.reason && (
                    <span className="text-xs text-muted-foreground">{m.reason}</span>
                  )}
                  <span className="text-xs text-muted-foreground">{fmtDate(m.created_at)}</span>
                </div>
                <span
                  className={`tabular-nums font-medium ${
                    m.amount_cents > 0
                      ? 'text-green-600'
                      : m.amount_cents < 0
                      ? 'text-red-600'
                      : 'text-muted-foreground'
                  }`}
                >
                  {m.amount_cents === 0 ? 'No Sale' : fmtSigned(m.amount_cents)}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
