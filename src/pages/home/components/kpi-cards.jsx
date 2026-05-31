import React from 'react';
import { ShoppingBag, DollarSign, Users, BarChart2 } from 'lucide-react';
import { StatCard } from '@/components/ui/stat-card';
import { Stagger, StaggerItem } from '@/components/ui/motion';
import { formatPrice } from '@/lib/currency';

function pctDelta(current, previous) {
  if (!previous || previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

export default function KpiCards({ kpis, previous, currency = 'USD', loading }) {
  const fmt = (cents) => formatPrice(cents ?? 0, currency);

  const cards = [
    {
      icon: DollarSign,
      label: 'Gross Sales',
      value: fmt(kpis?.gross_sales_cents),
      delta: pctDelta(kpis?.gross_sales_cents ?? 0, previous?.gross_sales_cents ?? 0),
    },
    {
      icon: ShoppingBag,
      label: 'Orders',
      value: (kpis?.order_count ?? 0).toLocaleString(),
      delta: pctDelta(kpis?.order_count ?? 0, previous?.order_count ?? 0),
    },
    {
      icon: BarChart2,
      label: 'Avg Order Value',
      value: fmt(kpis?.avg_order_value_cents),
      delta: pctDelta(kpis?.avg_order_value_cents ?? 0, previous?.avg_order_value_cents ?? 0),
    },
    {
      icon: Users,
      label: 'New Customers',
      value: (kpis?.new_customers ?? 0).toLocaleString(),
      delta: pctDelta(kpis?.new_customers ?? 0, previous?.new_customers ?? 0),
    },
  ];

  return (
    <Stagger
      className="grid grid-cols-2 sm:grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4"
      aria-label="Performance summary"
    >
      {cards.map((card) => (
        <StaggerItem key={card.label}>
          <StatCard
            label={card.label}
            value={card.value}
            delta={loading ? undefined : card.delta}
            deltaLabel="vs last period"
            icon={card.icon}
            loading={loading}
          />
        </StaggerItem>
      ))}
    </Stagger>
  );
}
