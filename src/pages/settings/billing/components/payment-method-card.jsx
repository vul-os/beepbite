import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CreditCard } from 'lucide-react';

export function PaymentMethodCard() {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="text-base flex items-center gap-2">
            <CreditCard className="h-4 w-4" /> Payment method
          </CardTitle>
          <CardDescription>Card used to charge your BeepBite subscription.</CardDescription>
        </div>
        <Badge variant="outline">Coming soon</Badge>
      </CardHeader>
      <CardContent>
        <div className="rounded-lg border border-dashed bg-muted/30 p-6 flex items-center justify-between gap-4">
          <div className="text-sm text-muted-foreground">
            <p>No payment method on file.</p>
            <p className="mt-1">Subscription invoices are settled from your wallet balance for now.</p>
          </div>
          <Button disabled title="Add payment method — coming soon">
            Add payment method
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
