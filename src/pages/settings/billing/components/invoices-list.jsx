import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Download, FileText } from 'lucide-react';
import { api } from '@/lib/api-client';

function formatMoney(cents, currency = 'USD') {
  const amount = (cents ?? 0) / 100;
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

function statusVariant(status) {
  switch (status) {
    case 'paid':       return 'default';
    case 'pending':    return 'secondary';
    case 'overdue':    return 'destructive';
    case 'void':       return 'outline';
    default:           return 'secondary';
  }
}

export function InvoicesList() {
  const [invoices, setInvoices] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error: err } = await api.request('GET', '/billing/invoices');
      if (cancelled) return;
      if (err) {
        setError(err.message ?? 'Failed to load invoices');
      } else {
        setInvoices(Array.isArray(data) ? data : []);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Invoices</CardTitle>
        <CardDescription>Subscription invoices issued to your organization.</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : invoices.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center text-muted-foreground">
            <FileText className="h-8 w-8 mb-2 opacity-60" />
            <p className="text-sm">No invoices yet. Your first invoice will appear here after your next billing cycle.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2 font-medium">Period</th>
                  <th className="py-2 font-medium">Issued</th>
                  <th className="py-2 font-medium">Amount</th>
                  <th className="py-2 font-medium">Status</th>
                  <th className="py-2 font-medium text-right">PDF</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id} className="border-b last:border-0">
                    <td className="py-2.5">
                      <span className="font-medium">{inv.period_start}</span>
                      <span className="text-muted-foreground"> → {inv.period_end}</span>
                    </td>
                    <td className="py-2.5 text-muted-foreground">
                      {inv.issued_at ? new Date(inv.issued_at).toLocaleDateString() : '—'}
                    </td>
                    <td className="py-2.5">
                      {formatMoney(inv.local_amount_cents, inv.local_currency_code)}
                      <span className="text-xs text-muted-foreground ml-1">
                        ({formatMoney(inv.usd_amount_cents, 'USD')})
                      </span>
                    </td>
                    <td className="py-2.5">
                      <Badge variant={statusVariant(inv.status)} className="capitalize">{inv.status}</Badge>
                    </td>
                    <td className="py-2.5 text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled
                        title="PDF download coming soon"
                      >
                        <Download className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
