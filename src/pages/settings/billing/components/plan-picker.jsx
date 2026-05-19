import React, { useState } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

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
  if (Number(pct) > 0) parts.push(`${Number(pct).toFixed(2)}%`);
  if (fixedCents > 0) parts.push(`+ ${centsToMajor(fixedCents)}`);
  return parts.length ? parts.join(' ') : 'None';
}

function FeatureList({ plan }) {
  const features = plan.features && typeof plan.features === 'object' ? plan.features : {};
  const entries = Object.entries(features);

  const limits = [
    plan.max_locations != null
      ? `Up to ${plan.max_locations} location${plan.max_locations !== 1 ? 's' : ''}`
      : 'Unlimited locations',
    plan.max_staff != null ? `Up to ${plan.max_staff} staff` : 'Unlimited staff',
    plan.max_orders_per_month != null
      ? `Up to ${plan.max_orders_per_month.toLocaleString()} orders/month`
      : 'Unlimited orders',
  ];

  return (
    <ul className="space-y-1 text-sm">
      {limits.map((l) => (
        <li key={l} className="flex items-start gap-1.5">
          <span className="text-green-500 font-bold mt-0.5">&#10003;</span>
          {l}
        </li>
      ))}
      {entries.map(([key, enabled]) => (
        <li key={key} className={`flex items-start gap-1.5 ${!enabled ? 'text-muted-foreground' : ''}`}>
          <span className={`font-bold mt-0.5 ${enabled ? 'text-green-500' : 'text-muted-foreground'}`}>
            {enabled ? '✓' : '✗'}
          </span>
          <span className={!enabled ? 'line-through' : ''}>{key.replace(/_/g, ' ')}</span>
        </li>
      ))}
    </ul>
  );
}

export function PlanPicker({ plans, currentTierCode, onSelect, upgrading, onClose }) {
  const [pending, setPending] = useState(null); // plan to confirm

  function handleSelect(plan) {
    if (plan.tier_code === currentTierCode) return;
    setPending(plan);
  }

  async function handleConfirm() {
    if (!pending) return;
    await onSelect(pending.tier_code);
    setPending(null);
    onClose();
  }

  return (
    <>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Choose a plan</h2>
            <p className="text-sm text-muted-foreground">
              Select the plan that best fits your business.
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {plans.map((plan) => {
            const isCurrent = plan.tier_code === currentTierCode;
            return (
              <Card
                key={plan.tier_code}
                className={`flex flex-col ${
                  isCurrent ? 'border-primary ring-1 ring-primary' : ''
                }`}
              >
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">{plan.display_name}</CardTitle>
                    {isCurrent && (
                      <Badge className="text-xs">Current</Badge>
                    )}
                  </div>
                  {plan.description && (
                    <CardDescription className="text-xs">{plan.description}</CardDescription>
                  )}
                  <p className="text-xl font-bold pt-1">
                    {centsToMajor(plan.monthly_fee_cents)}
                    <span className="text-xs font-normal text-muted-foreground"> /mo</span>
                  </p>
                </CardHeader>

                <CardContent className="flex-1 space-y-2 text-xs pb-2">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Transaction fee</span>
                    <span className="font-medium">
                      {feeLabel(plan.transaction_fee_percentage, plan.transaction_fee_fixed_cents)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Payout fee</span>
                    <span className="font-medium">
                      {feeLabel(plan.payout_fee_percentage, plan.payout_fee_fixed_cents)}
                    </span>
                  </div>
                  <div className="pt-2">
                    <FeatureList plan={plan} />
                  </div>
                </CardContent>

                <CardFooter className="pt-2">
                  <Button
                    className="w-full"
                    variant={isCurrent ? 'secondary' : 'default'}
                    disabled={isCurrent || upgrading}
                    onClick={() => handleSelect(plan)}
                    size="sm"
                  >
                    {isCurrent ? 'Current plan' : 'Select'}
                  </Button>
                </CardFooter>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Confirm dialog */}
      <Dialog open={!!pending} onOpenChange={(open) => { if (!open) setPending(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Switch to {pending?.display_name}?</DialogTitle>
            <DialogDescription>
              You will be charged the new monthly rate of{' '}
              <strong>{centsToMajor(pending?.monthly_fee_cents)}</strong> from your next billing
              cycle. Transaction and payout fees will also update immediately.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPending(null)} disabled={upgrading}>
              Cancel
            </Button>
            <Button onClick={handleConfirm} disabled={upgrading}>
              {upgrading ? 'Switching…' : 'Confirm switch'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
