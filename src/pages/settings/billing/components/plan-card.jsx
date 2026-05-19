import React from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';

function centsToMajor(cents) {
  if (cents == null) return '—';
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

function feeLabel(pct, fixedCents) {
  const parts = [];
  if (pct > 0) parts.push(`${Number(pct).toFixed(2)}%`);
  if (fixedCents > 0) parts.push(`+ ${centsToMajor(fixedCents)}`);
  return parts.length ? parts.join(' ') : 'None';
}

export function PlanCard({ plan, onChangePlan }) {
  if (!plan) return null;

  const features = plan.features && typeof plan.features === 'object' ? plan.features : {};
  const featureEntries = Object.entries(features);

  const limits = [
    plan.max_locations != null
      ? `Up to ${plan.max_locations} location${plan.max_locations !== 1 ? 's' : ''}`
      : 'Unlimited locations',
    plan.max_staff != null
      ? `Up to ${plan.max_staff} staff`
      : 'Unlimited staff',
    plan.max_orders_per_month != null
      ? `Up to ${plan.max_orders_per_month.toLocaleString()} orders/month`
      : 'Unlimited orders',
  ];

  return (
    <Card className="border-primary/50 shadow-md">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <CardTitle className="text-2xl">{plan.display_name}</CardTitle>
              <Badge variant="secondary" className="capitalize">{plan.tier_code}</Badge>
            </div>
            {plan.description && (
              <CardDescription className="mt-1">{plan.description}</CardDescription>
            )}
          </div>
          <div className="text-right shrink-0">
            <p className="text-2xl font-bold">{centsToMajor(plan.monthly_fee_cents)}</p>
            <p className="text-xs text-muted-foreground">/month</p>
          </div>
        </div>
      </CardHeader>

      <Separator />

      <CardContent className="pt-4 space-y-4">
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-0.5">
              Transaction fee
            </p>
            <p className="font-medium">
              {feeLabel(plan.transaction_fee_percentage, plan.transaction_fee_fixed_cents)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-0.5">
              Payout fee
            </p>
            <p className="font-medium">
              {feeLabel(plan.payout_fee_percentage, plan.payout_fee_fixed_cents)}
            </p>
          </div>
        </div>

        <Separator />

        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Limits</p>
          <ul className="space-y-0.5">
            {limits.map((l) => (
              <li key={l} className="text-sm flex items-center gap-1.5">
                <span className="text-green-500 font-bold">&#10003;</span>
                {l}
              </li>
            ))}
          </ul>
        </div>

        {featureEntries.length > 0 && (
          <>
            <Separator />
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Features</p>
              <ul className="grid grid-cols-2 gap-x-4 gap-y-0.5">
                {featureEntries.map(([key, enabled]) => (
                  <li key={key} className="text-sm flex items-center gap-1.5">
                    <span className={enabled ? 'text-green-500 font-bold' : 'text-muted-foreground'}>
                      {enabled ? '✓' : '✗'}
                    </span>
                    <span className={enabled ? '' : 'text-muted-foreground line-through'}>
                      {key.replace(/_/g, ' ')}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}

        <div className="pt-2">
          <Button variant="outline" onClick={onChangePlan} className="w-full sm:w-auto">
            Change plan
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
