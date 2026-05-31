import React, { useMemo } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatPrice } from '@/lib/currency';
import { TrendingUp } from 'lucide-react';

function bucketLabel(bucket, period) {
  if (!bucket) return '';
  // bucket is an ISO string like "2024-01-15T00:00:00Z" or just "2024-01-15"
  const d = new Date(bucket);
  if (isNaN(d.getTime())) return bucket;

  switch (period) {
    case 'day':
      // hourly buckets — show "2pm" style
      return d.getHours() === 0
        ? '12am'
        : d.getHours() < 12
        ? `${d.getHours()}am`
        : d.getHours() === 12
        ? '12pm'
        : `${d.getHours() - 12}pm`;
    case 'week':
      // daily — "Mon 15"
      return d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' });
    case 'month':
      // weekly buckets — "Jan 8"
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    case 'year':
      // monthly buckets — "Jan"
      return d.toLocaleDateString('en-US', { month: 'short' });
    default:
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
}

function CustomTooltip({ active, payload, label, currency }) {
  if (!active || !payload?.length) return null;
  const { sales_cents, order_count } = payload[0]?.payload ?? {};
  return (
    <div
      role="tooltip"
      className="bg-card border border-border shadow-elevated rounded-xl px-4 py-3 text-sm min-w-[150px]"
    >
      <p className="font-semibold text-muted-foreground mb-2 text-xs uppercase tracking-wide">{label}</p>
      <p className="text-primary font-bold text-lg tabular-nums">{formatPrice(sales_cents ?? 0, currency)}</p>
      <p className="text-muted-foreground text-xs mt-0.5">{(order_count ?? 0).toLocaleString()} orders</p>
    </div>
  );
}

function ChartSkeleton() {
  return (
    <div className="px-2 space-y-3" aria-label="Loading chart" aria-busy="true">
      <div className="flex items-end gap-1.5 h-52">
        {[40, 65, 45, 80, 55, 90, 70].map((h, i) => (
          <div
            key={i}
            className="flex-1 rounded-t-md bg-primary/10 animate-pulse"
            style={{ height: `${h}%` }}
          />
        ))}
      </div>
      <Skeleton className="h-3 w-full rounded" />
    </div>
  );
}

export default function SalesTrendChart({ series = [], period = 'week', currency = 'USD', loading }) {
  const data = useMemo(
    () =>
      series.map((s) => ({
        ...s,
        label: bucketLabel(s.bucket, period),
      })),
    [series, period]
  );

  const maxVal = useMemo(() => Math.max(...data.map((d) => d.sales_cents ?? 0), 1), [data]);
  const tickFormatter = (v) => {
    if (maxVal >= 100_000) return `${(v / 100_00).toFixed(0)}k`;
    return formatPrice(v, currency);
  };

  return (
    <Card variant="elevated" className="overflow-hidden">
      <CardHeader className="pb-2 px-6 pt-6">
        <CardTitle className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <TrendingUp className="h-4 w-4" aria-hidden="true" />
          </span>
          Sales Trend
        </CardTitle>
      </CardHeader>
      <CardContent className="px-3 pb-6 pt-3">
        {loading ? (
          <ChartSkeleton />
        ) : data.length === 0 ? (
          <div
            className="flex flex-col items-center justify-center h-52 gap-3"
            role="status"
            aria-label="No sales data"
          >
            <div className="w-14 h-14 rounded-2xl bg-muted flex items-center justify-center">
              <TrendingUp className="w-6 h-6 text-muted-foreground/40" aria-hidden="true" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-muted-foreground">No sales data</p>
              <p className="text-xs text-muted-foreground/60 mt-0.5">for this period</p>
            </div>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="salesGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f97316" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#f97316" stopOpacity={0.01} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.5} vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                tickFormatter={tickFormatter}
                tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                tickLine={false}
                axisLine={false}
                width={62}
              />
              <Tooltip
                content={<CustomTooltip currency={currency} />}
                cursor={{ stroke: '#f97316', strokeWidth: 1, strokeDasharray: '4 2' }}
              />
              <Area
                type="monotone"
                dataKey="sales_cents"
                stroke="#f97316"
                strokeWidth={2.5}
                fill="url(#salesGradient)"
                dot={false}
                activeDot={{ r: 5, fill: '#f97316', strokeWidth: 2.5, stroke: '#fff' }}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
