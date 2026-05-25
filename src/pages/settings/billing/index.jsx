import React, { useState } from 'react';
import { useAuth } from '@/context/auth-context';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { RefreshCw } from 'lucide-react';
import { useBilling } from './hooks/use-billing';
import { PlanCard } from './components/plan-card';
import { PlanPicker } from './components/plan-picker';
import { MonthSummary } from './components/month-summary';
import { RecentPayouts } from './components/recent-payouts';
import { InvoicesList } from './components/invoices-list';
import { WalletSummary } from './components/wallet-summary';
import { PaymentMethodCard } from './components/payment-method-card';

export default function BillingPage() {
  const { activeOrganization } = useAuth();
  const orgId = activeOrganization?.id ?? null;
  const { toast } = useToast();

  const {
    plans,
    currentPlan,
    payouts,
    summary,
    loading,
    error,
    upgrading,
    refresh,
    changePlan,
  } = useBilling(orgId);

  const [showPicker, setShowPicker] = useState(false);

  async function handleSelect(tierCode) {
    const { error: err } = await changePlan(tierCode);
    if (err) {
      toast({ variant: 'destructive', title: 'Failed to change plan', description: err });
    } else {
      toast({ title: 'Plan updated', description: `Switched to ${tierCode}.` });
    }
  }

  return (
    <div className="p-6 space-y-6">
      {/* Page header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold">Billing</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Subscription plan, invoices, wallet balance, and payment method.
          </p>
        </div>
        <Button variant="outline" size="icon" onClick={refresh} disabled={loading} title="Refresh">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          <span className="sr-only">Refresh</span>
        </Button>
      </div>

      {/* Error state */}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Current plan card */}
      <section>
        <h2 className="text-base font-semibold mb-3">Current plan</h2>
        {loading ? (
          <Skeleton className="h-52 w-full rounded-xl" />
        ) : currentPlan ? (
          <PlanCard plan={currentPlan} onChangePlan={() => setShowPicker(true)} />
        ) : (
          <p className="text-sm text-muted-foreground">No plan data available.</p>
        )}
      </section>

      {/* Plan picker (inline, shown on demand) */}
      {showPicker && (
        <section>
          <PlanPicker
            plans={plans}
            currentTierCode={currentPlan?.tier_code}
            onSelect={handleSelect}
            upgrading={upgrading}
            onClose={() => setShowPicker(false)}
          />
        </section>
      )}

      {/* Wallet + payment method row */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <WalletSummary />
        <PaymentMethodCard />
      </section>

      {/* Month summary */}
      <section>
        <MonthSummary summary={summary} loading={loading} />
      </section>

      {/* Invoices */}
      <section>
        <InvoicesList />
      </section>

      {/* Recent payouts */}
      <section>
        <RecentPayouts payouts={payouts} loading={loading} />
      </section>
    </div>
  );
}
