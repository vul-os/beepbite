import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/api-client';
import { useMoney } from '@/context/locale-context';
import { BarChart2, Loader2 } from 'lucide-react';

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function OverShortBadge({ cents }) {
  // "Over"/"Short" already carry the sign, so the amount is rendered absolute.
  const { format } = useMoney();
  if (cents == null) return null;
  if (cents === 0)
    return <Badge className="bg-green-100 text-green-800 border-green-200">Balanced</Badge>;
  if (cents > 0)
    return (
      <Badge className="bg-blue-100 text-blue-800 border-blue-200">
        Over {format(cents)}
      </Badge>
    );
  return (
    <Badge className="bg-red-100 text-red-800 border-red-200">
      Short {format(Math.abs(cents))}
    </Badge>
  );
}

/**
 * EodReportCard
 *
 * Fetches the cash_drawer_eod_report view rows for a given session and
 * renders a per-payment-method breakdown with over/short for cash.
 *
 * Props:
 *   session: closed session object (must have .id and .over_short_cents)
 *
 * Requires LocaleProvider above it.
 */
export function EodReportCard({ session }) {
  const { format } = useMoney();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!session?.id) return;
    setLoading(true);
    api
      .request('GET', `/data/cash_drawer_eod_report?eq=session_id,${session.id}`)
      .then(({ data, error: apiErr }) => {
        if (apiErr) throw new Error(apiErr.message);
        setRows(Array.isArray(data) ? data : data ? [data] : []);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [session?.id]);

  return (
    <Card className="border-orange-200">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BarChart2 className="h-5 w-5 text-orange-500" />
          End-of-Day Report
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Session summary */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
          <div>
            <p className="text-muted-foreground">Opened</p>
            <p className="font-medium">{fmtDate(session.opened_at)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Closed</p>
            <p className="font-medium">{fmtDate(session.closed_at)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Cash over/short</p>
            <OverShortBadge cents={session.over_short_cents} />
          </div>
        </div>

        {/* Per-method breakdown */}
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading report…
          </div>
        ) : error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No payment data found for this session.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-muted-foreground text-left">
                  <th className="pb-2 font-medium">Method</th>
                  <th className="pb-2 font-medium text-right">Expected</th>
                  <th className="pb-2 font-medium text-right">Declared</th>
                  <th className="pb-2 font-medium text-right">Cash In</th>
                  <th className="pb-2 font-medium text-right">Cash Out</th>
                  <th className="pb-2 font-medium text-right">Over/Short</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="py-2 font-medium capitalize">
                      {r.payment_method_name || r.payment_method_code || '—'}
                    </td>
                    <td className="py-2 text-right">
                      {format(r.expected_cents || 0)}
                    </td>
                    <td className="py-2 text-right">
                      {r.declared_cents != null
                        ? format(r.declared_cents)
                        : '—'}
                    </td>
                    <td className="py-2 text-right text-green-700">
                      {r.cash_movements_in_cents > 0
                        ? `+${format(r.cash_movements_in_cents)}`
                        : '—'}
                    </td>
                    <td className="py-2 text-right text-red-700">
                      {r.cash_movements_out_cents > 0
                        ? `-${format(r.cash_movements_out_cents)}`
                        : '—'}
                    </td>
                    <td className="py-2 text-right">
                      {r.over_short_cents != null ? (
                        <OverShortBadge cents={r.over_short_cents} />
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {session.notes && (
          <div className="rounded-md bg-muted px-3 py-2 text-sm">
            <span className="text-muted-foreground">Notes: </span>
            {session.notes}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
