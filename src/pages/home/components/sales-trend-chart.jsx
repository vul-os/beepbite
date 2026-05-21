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
    <div className="bg-white border border-orange-200 shadow-lg rounded-lg px-3 py-2 text-sm">
      <p className="font-semibold text-gray-800 mb-1">{label}</p>
      <p className="text-orange-600 font-bold">{formatPrice(sales_cents ?? 0, currency)}</p>
      <p className="text-gray-500">{(order_count ?? 0).toLocaleString()} orders</p>
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
    <Card className="border border-orange-100 shadow-sm">
      <CardHeader className="pb-2 px-4 pt-4">
        <CardTitle className="text-sm font-semibold text-gray-700 flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-orange-500" />
          Sales Trend
        </CardTitle>
      </CardHeader>
      <CardContent className="px-2 pb-4">
        {loading ? (
          <div className="space-y-2 px-2">
            <Skeleton className="h-48 w-full rounded-lg" />
          </div>
        ) : data.length === 0 ? (
          <div className="flex items-center justify-center h-48 text-gray-400 text-sm">
            No sales data for this period
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="salesGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f97316" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#f97316" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#fde8d0" vertical={false} />
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
                width={56}
              />
              <Tooltip content={<CustomTooltip currency={currency} />} />
              <Area
                type="monotone"
                dataKey="sales_cents"
                stroke="#f97316"
                strokeWidth={2}
                fill="url(#salesGradient)"
                dot={false}
                activeDot={{ r: 4, fill: '#f97316', strokeWidth: 0 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
