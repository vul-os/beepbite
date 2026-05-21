import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { TrendingUp, TrendingDown, Minus, ShoppingBag, DollarSign, Users, BarChart2 } from 'lucide-react';
import { formatPrice } from '@/lib/currency';
import { cn } from '@/lib/utils';

function delta(current, previous) {
  if (!previous || previous === 0) return null;
  const pct = ((current - previous) / previous) * 100;
  return pct;
}

function DeltaBadge({ current, previous }) {
  const pct = delta(current, previous);
  if (pct === null) return null;

  const up = pct >= 0;
  const Icon = pct === 0 ? Minus : up ? TrendingUp : TrendingDown;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 text-xs font-semibold px-1.5 py-0.5 rounded-full',
        up ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
      )}
    >
      <Icon className="w-3 h-3" />
      {Math.abs(pct).toFixed(1)}%
    </span>
  );
}

function KpiCard({ icon: Icon, label, value, deltaProps, loading, iconColor = 'text-orange-500', iconBg = 'bg-orange-50' }) {
  return (
    <Card className="border border-orange-100 shadow-sm">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className={cn('rounded-lg p-2 flex-shrink-0', iconBg)}>
            <Icon className={cn('w-5 h-5', iconColor)} />
          </div>
          {!loading && deltaProps && (
            <DeltaBadge current={deltaProps.current} previous={deltaProps.previous} />
          )}
        </div>
        <div className="mt-3">
          {loading ? (
            <>
              <Skeleton className="h-7 w-24 mb-1" />
              <Skeleton className="h-3.5 w-16" />
            </>
          ) : (
            <>
              <p className="text-2xl font-bold text-gray-900 leading-tight">{value}</p>
              <p className="text-xs text-gray-500 mt-0.5">{label}</p>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function KpiCards({ kpis, previous, currency = 'USD', loading }) {
  const fmt = (cents) => formatPrice(cents ?? 0, currency);

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <KpiCard
        icon={DollarSign}
        label="Gross Sales"
        value={fmt(kpis?.gross_sales_cents)}
        deltaProps={{ current: kpis?.gross_sales_cents ?? 0, previous: previous?.gross_sales_cents ?? 0 }}
        loading={loading}
        iconColor="text-orange-600"
        iconBg="bg-orange-50"
      />
      <KpiCard
        icon={ShoppingBag}
        label="Orders"
        value={(kpis?.order_count ?? 0).toLocaleString()}
        deltaProps={{ current: kpis?.order_count ?? 0, previous: previous?.order_count ?? 0 }}
        loading={loading}
        iconColor="text-blue-600"
        iconBg="bg-blue-50"
      />
      <KpiCard
        icon={BarChart2}
        label="Avg Order Value"
        value={fmt(kpis?.avg_order_value_cents)}
        deltaProps={{ current: kpis?.avg_order_value_cents ?? 0, previous: previous?.avg_order_value_cents ?? 0 }}
        loading={loading}
        iconColor="text-purple-600"
        iconBg="bg-purple-50"
      />
      <KpiCard
        icon={Users}
        label="New Customers"
        value={(kpis?.new_customers ?? 0).toLocaleString()}
        deltaProps={{ current: kpis?.new_customers ?? 0, previous: previous?.new_customers ?? 0 }}
        loading={loading}
        iconColor="text-emerald-600"
        iconBg="bg-emerald-50"
      />
    </div>
  );
}
