import { useEffect, useState } from 'react';
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
import { RecordPaymentDialog, type HouseAccountInvoice } from './record-payment-dialog';
import { FileText, Loader2 } from 'lucide-react';
import { HOUSE_ACCOUNT_INVOICE_STATUS_COLORS } from '@/lib/status-colors';
import { useMoney } from '@/context/locale-context';

function statusBadge(status: HouseAccountInvoice['status']) {
  // Only 3 visual states exist for this badge; anything other than
  // paid/partial reads as "open" (draft/sent/overdue/cancelled all fall
  // through) -- same behavior as the previous `[status] || ...open` lookup,
  // just keyed by the already-reduced label so it matches the color map's
  // real (3-key) shape.
  const label: keyof typeof HOUSE_ACCOUNT_INVOICE_STATUS_COLORS =
    status === 'paid' ? 'paid' : status === 'partial' ? 'partial' : 'open';
  const cls = HOUSE_ACCOUNT_INVOICE_STATUS_COLORS[label];
  return <Badge className={cls}>{label}</Badge>;
}

interface InvoicesTabProps {
  accountId: string;
  fetchInvoices: () => Promise<HouseAccountInvoice[]>;
  payInvoice: (invoiceId: string, cents: number) => Promise<unknown>;
}

export function InvoicesTab({ accountId, fetchInvoices, payInvoice }: InvoicesTabProps) {
  const { format: centsToDisplay } = useMoney();
  const [invoices, setInvoices] = useState<HouseAccountInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [payTarget, setPayTarget] = useState<HouseAccountInvoice | null>(null); // invoice being paid
  const [payOpen, setPayOpen] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const data = await fetchInvoices();
      setInvoices(data);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load invoices');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // load() is fully try/catch/finally-wrapped above.
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  function openPayDialog(inv: HouseAccountInvoice) {
    setPayTarget(inv);
    setPayOpen(true);
  }

  async function handlePay(invoiceId: string, cents: number) {
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
