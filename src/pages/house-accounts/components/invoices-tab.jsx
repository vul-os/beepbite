import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { RecordPaymentDialog } from './record-payment-dialog';
import { FileText, Loader2 } from 'lucide-react';
import { HOUSE_ACCOUNT_INVOICE_STATUS_COLORS } from '@/lib/status-colors';

function centsToDisplay(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

function statusBadge(status) {
  const cls = HOUSE_ACCOUNT_INVOICE_STATUS_COLORS[status] || HOUSE_ACCOUNT_INVOICE_STATUS_COLORS.open;
  const label = status === 'paid' ? 'paid' : status === 'partial' ? 'partial' : 'open';
  return <Badge className={cls}>{label}</Badge>;
}

export function InvoicesTab({ accountId, fetchInvoices, payInvoice }) {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [payTarget, setPayTarget] = useState(null); // invoice being paid
  const [payOpen, setPayOpen] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const data = await fetchInvoices();
      setInvoices(data);
      setErr(null);
    } catch (e) {
      setErr(e.message || 'Failed to load invoices');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  function openPayDialog(inv) {
    setPayTarget(inv);
    setPayOpen(true);
  }

  async function handlePay(invoiceId, cents) {
    await payInvoice(invoiceId, cents);
    await load();
  }

  return (
    <div className="space-y-4">
      {err && <p className="text-sm text-destructive">{err}</p>}

      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground py-8 justify-center">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading invoices…
        </div>
      ) : invoices.length === 0 ? (
        <div className="text-center py-10 text-muted-foreground">
          <FileText className="h-10 w-10 mx-auto mb-2 opacity-40" />
          <p className="text-sm">No invoices yet. Generate one from the Charges tab.</p>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Invoice #</TableHead>
              <TableHead>Period</TableHead>
              <TableHead>Total</TableHead>
              <TableHead>Paid</TableHead>
              <TableHead>Due</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-32" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {invoices.map((inv) => (
              <TableRow key={inv.id}>
                <TableCell className="font-mono text-xs">{inv.invoice_number}</TableCell>
                <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                  {new Date(inv.period_start).toLocaleDateString()} –{' '}
                  {new Date(inv.period_end).toLocaleDateString()}
                </TableCell>
                <TableCell className="font-medium">{centsToDisplay(inv.total_cents)}</TableCell>
                <TableCell>{centsToDisplay(inv.paid_amount_cents)}</TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {inv.due_date ? new Date(inv.due_date).toLocaleDateString() : '—'}
                </TableCell>
                <TableCell>{statusBadge(inv.status)}</TableCell>
                <TableCell>
                  {inv.status !== 'paid' && (
                    <Button size="sm" variant="outline" onClick={() => openPayDialog(inv)}>
                      Record payment
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <RecordPaymentDialog
        open={payOpen}
        onOpenChange={setPayOpen}
        invoice={payTarget}
        onPay={handlePay}
      />
    </div>
  );
}
