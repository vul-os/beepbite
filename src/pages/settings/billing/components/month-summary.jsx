import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { TrendingDown, Wallet } from 'lucide-react';

function centsToMajor(cents) {
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
    minimumFractionDigits: 2,
  }).format((cents ?? 0) / 100);
}

function StatCard({ icon: Icon, label, value, loading, colorClass }) {
  return (
    <Card>
      <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
        <Icon className={`h-4 w-4 ${colorClass ?? 'text-muted-foreground'}`} />
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-7 w-28 rounded" />
        ) : (
          <p className="text-2xl font-bold">{value}</p>
        )}
      </CardContent>
    </Card>
  );
}

export function MonthSummary({ summary, loading }) {
  const now = new Date();
  const monthLabel = now.toLocaleString('en-ZA', { month: 'long', year: 'numeric' });

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-base font-semibold">This month — {monthLabel}</h2>
        <p className="text-sm text-muted-foreground">
          Platform fees charged and payouts received so far this billing period.
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          icon={TrendingDown}
          label="Transaction fees paid"
          value={centsToMajor(summary?.transactionFeesCents)}
          loading={loading}
          colorClass="text-orange-500"
        />
        <StatCard
          icon={TrendingDown}
          label="Payout fees paid"
          value={centsToMajor(summary?.payoutFeesCents)}
          loading={loading}
          colorClass="text-orange-500"
        />
        <StatCard
          icon={Wallet}
          label="Total payouts received"
          value={centsToMajor(summary?.totalPayoutsNetCents)}
          loading={loading}
          colorClass="text-green-600"
        />
      </div>
    </div>
  );
}
