import { useEffect, useState } from 'react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, AlertCircle, TrendingUp, TrendingDown, CheckCircle2, User } from 'lucide-react';
import { fetchCashOut } from '@/services/cashout';
import { useMoney } from '@/context/locale-context';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
 *
 * Requires LocaleProvider above it. The report carries a location_id but no
 * currency of its own, so the provider must be scoped to that same location.
 */
export function CashOutReport({ sessionId }) {
  const { format, scale } = useMoney();
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState(null);

  // Inside the component because they need the hook; a negative amount already
  // formats with its own minus sign, so only the '+' has to be added.
  const fmt = (cents) => format(cents ?? 0);
  const fmtSigned = (cents) =>
    cents == null ? '—' : `${cents >= 0 ? '+' : ''}${format(cents)}`;

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
  const absVariance  = variance == null ? 0 : Math.abs(variance);

  // Severity is driven by MAGNITUDE, not just direction: a few units of local
  // currency (5 dollars / 5 yen / 5 rand, via `scale`) is a rounding slip
  // either way; anything bigger needs an explanation before the day closes.
  // Direction (over/short) only changes the label, not how alarming it reads.
  const smallVarianceCents = scale * 5;
  const varianceSeverity = isUncounted
    ? 'muted'
    : isBalanced
    ? 'success'
    : absVariance <= smallVarianceCents
    ? 'warning'
    : 'destructive';

  const varianceColor = {
    muted: 'text-muted-foreground',
    success: 'text-success',
    warning: 'text-warning',
    destructive: 'text-destructive',
  }[varianceSeverity];

  const varianceBadge = isUncounted
    ? <Badge variant="outline">Not counted yet</Badge>
    : (
      <Badge variant={varianceSeverity === 'muted' ? 'outline' : varianceSeverity}>
        {isBalanced ? 'Balanced' : isOver ? 'Over' : 'Short'}
      </Badge>
    );

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
              {report.status === 'open' ? (
                <Badge variant="success">{report.status}</Badge>
              ) : (
                <Badge variant="outline" className="text-muted-foreground border-border bg-muted/50">
                  {report.status}
                </Badge>
              )}
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
                <Badge variant="warning" className="ml-auto">
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

      {/* Variance hero card — the single most important number in this
          report. Border + text colour follow magnitude (severity), so a
          $2 rounding slip reads calm (warning) and a real gap reads
          alarming (destructive) rather than every non-zero variance
          looking equally urgent. */}
      <Card
        className={
          {
            muted: 'border-muted',
            success: 'border-success/30',
            warning: 'border-warning/30',
            destructive: 'border-destructive/30',
          }[varianceSeverity]
        }
      >
        <CardContent className="py-6 flex flex-col items-center gap-1">
          <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">
            {isUncounted ? 'Variance' : isShort ? 'Short' : isBalanced ? 'Balanced' : 'Over'}
          </p>
          <div className={`font-display text-4xl font-bold tabular-nums ${varianceColor}`}>
            {isUncounted
              ? '—'
              : isBalanced
              ? fmt(0)
              : `${isShort ? '' : '+'}${format(variance)}`}
          </div>
          {!isUncounted && (
            <div className="flex items-center gap-1 mt-1">
              {isShort && <TrendingDown className={`h-4 w-4 ${varianceColor}`} />}
              {isOver   && <TrendingUp  className={`h-4 w-4 ${varianceColor}`} />}
              {isBalanced && <CheckCircle2 className="h-4 w-4 text-success" />}
              <span className={`text-sm ${varianceColor}`}>
                {isShort
                  ? `Drawer is ${fmt(Math.abs(variance))} short of expected`
                  : isOver
                  ? `Drawer is ${fmt(Math.abs(variance))} over expected`
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
                      ? 'text-success'
                      : m.amount_cents < 0
                      ? 'text-warning'
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
