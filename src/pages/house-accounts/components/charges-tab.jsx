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
import { FileText, Loader2, Receipt } from 'lucide-react';

function centsToDisplay(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

export function ChargesTab({ accountId, generateInvoice, fetchCharges }) {
  const [charges, setCharges] = useState([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [err, setErr] = useState(null);

  async function load() {
    setLoading(true);
    try {
      const data = await fetchCharges();
      setCharges(data);
      setErr(null);
    } catch (e) {
      setErr(e.message || 'Failed to load charges');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  async function handleGenerate() {
    if (!confirm('Generate an invoice for all open charges?')) return;
    setGenerating(true);
    setErr(null);
    try {
      await generateInvoice();
      await load();
    } catch (e) {
      setErr(e.message || 'Failed to generate invoice');
    } finally {
      setGenerating(false);
    }
  }

  const openCharges = charges.filter((c) => !c.house_account_invoice_id);
  const invoicedCharges = charges.filter((c) => c.house_account_invoice_id);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Receipt className="h-4 w-4" />
          <span className="text-sm">
            {openCharges.length} open, {invoicedCharges.length} invoiced
          </span>
        </div>
        <Button
          size="sm"
          disabled={generating || openCharges.length === 0}
          onClick={handleGenerate}
        >
          {generating
            ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            : <FileText className="h-4 w-4 mr-2" />}
          Generate invoice
        </Button>
      </div>

      {err && <p className="text-sm text-destructive">{err}</p>}

      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground py-8 justify-center">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading charges…
        </div>
      ) : charges.length === 0 ? (
        <div className="text-center py-10 text-muted-foreground">
          <Receipt className="h-10 w-10 mx-auto mb-2 opacity-40" />
          <p className="text-sm">No charges recorded yet.</p>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Order ID</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Date</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {charges.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-mono text-xs">{c.order_id}</TableCell>
                <TableCell className="font-medium">{centsToDisplay(c.amount_cents)}</TableCell>
                <TableCell>
                  {c.house_account_invoice_id ? (
                    <Badge variant="secondary">invoiced</Badge>
                  ) : (
                    <Badge variant="outline" className="border-amber-400 text-amber-700">open</Badge>
                  )}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {new Date(c.created_at).toLocaleDateString()}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
