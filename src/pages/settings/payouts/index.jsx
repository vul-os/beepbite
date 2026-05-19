import React from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { useAuth } from '@/context/auth-context';
import { BankAccountTab } from './bank-account-tab';
import { PayoutHistoryTab } from './payout-history-tab';

export default function PayoutsPage() {
  const { activeOrganization, activeLocation } = useAuth();

  const orgId = activeOrganization?.id ?? null;
  const locationId = activeLocation?.id ?? null;

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Payouts</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Manage your bank accounts and view payout history.
        </p>
      </div>

      <Tabs defaultValue="bank-account">
        <TabsList>
          <TabsTrigger value="bank-account">Bank account</TabsTrigger>
          <TabsTrigger value="payout-history">Payout history</TabsTrigger>
        </TabsList>

        <TabsContent value="bank-account" className="mt-6">
          <BankAccountTab orgId={orgId} locationId={locationId} />
        </TabsContent>

        <TabsContent value="payout-history" className="mt-6">
          <PayoutHistoryTab orgId={orgId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
