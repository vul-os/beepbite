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
      className="bg-white border border-gray-200 shadow-xl rounded-xl px-3.5 py-2.5 text-sm min-w-[140px]"
    >
      <p className="font-semibold text-gray-700 mb-1.5 text-xs uppercase tracking-wide">{label}</p>
      <p className="text-orange-600 font-bold text-base">{formatPrice(sales_cents ?? 0, currency)}</p>
      <p className="text-gray-400 text-xs mt-0.5">{(order_count ?? 0).toLocaleString()} orders</p>
    </div>
  );
}

function ChartSkeleton() {
  return (
    <div className="px-2 space-y-2" aria-label="Loading chart" aria-busy="true">
      <div className="flex items-end gap-1 h-48">
        {[40, 65, 45, 80, 55, 90, 70].map((h, i) => (
          <div
            key={i}
            className="flex-1 rounded-t-sm bg-orange-100 animate-pulse"
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
    <Card className="border border-gray-200 shadow-sm bg-white">
      <CardHeader className="pb-1 px-5 pt-5">
        <CardTitle className="text-sm font-semibold text-gray-800 flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-orange-50 flex items-center justify-center flex-shrink-0">
            <TrendingUp className="w-4 h-4 text-orange-500" aria-hidden="true" />
          </div>
          Sales Trend
        </CardTitle>
      </CardHeader>
      <CardContent className="px-2 pb-5 pt-2">
        {loading ? (
          <ChartSkeleton />
        ) : data.length === 0 ? (
          <div
            className="flex flex-col items-center justify-center h-48 gap-3"
            role="status"
            aria-label="No sales data"
          >
            <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center">
              <TrendingUp className="w-6 h-6 text-gray-300" aria-hidden="true" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-gray-500">No sales data</p>
              <p className="text-xs text-gray-400 mt-0.5">for this period</p>
            </div>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="salesGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f97316" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#f97316" stopOpacity={0.01} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: '#9ca3af' }}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                tickFormatter={tickFormatter}
                tick={{ fontSize: 10, fill: '#9ca3af' }}
                tickLine={false}
                axisLine={false}
                width={58}
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
                activeDot={{ r: 5, fill: '#f97316', strokeWidth: 2, stroke: '#fff' }}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
