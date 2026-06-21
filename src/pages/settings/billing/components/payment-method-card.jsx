import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { CreditCard } from 'lucide-react';

export function PaymentMethodCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <CreditCard className="h-4 w-4" /> Payment method
        </CardTitle>
        <CardDescription>Card used to charge your BeepBite subscription.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="rounded-lg border border-dashed bg-muted/30 p-6 text-sm text-muted-foreground space-y-1">
          <p>No payment method on file.</p>
          <p>Subscription invoices are settled from your wallet balance. Contact support to update your billing details.</p>
        </div>
      </CardContent>
    </Card>
  );
}
