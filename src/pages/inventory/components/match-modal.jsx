import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/api-client';
import { useMoney } from '@/context/locale-context';
import { AlertCircle, CheckCircle } from 'lucide-react';

function fmtPct(v) {
  return `${(v * 100).toFixed(1)}%`;
}

// A variance is "needs a second look, nothing lost yet" (warning); matched
// is the success state; unmatched (not yet run) is neutral.
function matchStatusVariant(status) {
  switch (status) {
    case 'matched': return 'success';
    case 'price_variance':
    case 'qty_variance': return 'warning';
    default: return 'secondary';
  }
}

function matchStatusBadge(status) {
  return (
    <Badge variant={matchStatusVariant(status)}>
      {status?.replace('_', ' ')}
    </Badge>
  );
}

export function MatchModal({ invoice, open, onClose, onMatched }) {
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState('');
  // The invoice is denominated in the supplier's currency, which need not be
  // the store's — every amount on this modal, including the PO-side prices it
  // is compared against, belongs to that invoice.
  const { format: fmtCents } = useMoney({ currency: invoice?.currency });

  async function runMatch() {
    if (!invoice) return;
    setRunning(true);
    setErr('');
    try {
      const { data, error } = await api.request(
        'POST',
        `/inventory/supplier-invoices/${invoice.id}/match`,
        { body: {} }
      );
      // 200 = matched, 422 = variance — both return a body
      if (error && !data) throw new Error(error.message);
      setResult(data);
      if (onMatched) onMatched(data);
    } catch (e) {
      setErr(e.message);
    } finally {
      setRunning(false);
    }
  }

  function handleClose() {
    setResult(null);
    setErr('');
    onClose();
  }

  if (!invoice) return null;

  const poTotal = invoice.total_cents ?? 0; // PO total from invoice record
  const invoiceTotal = invoice.total_cents ?? 0;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>3-Way Match — Invoice {invoice.invoice_number}</DialogTitle>
          <DialogDescription>
            Supplier invoice dated {invoice.invoice_date}. Current match status:{' '}
            {matchStatusBadge(result?.match_status ?? invoice.match_status)}
          </DialogDescription>
        </DialogHeader>

        {/* Invoice summary */}
        <div className="grid grid-cols-3 gap-4 text-sm border border-border rounded p-3 bg-muted/40">
          <div>
            <p className="text-muted-foreground text-xs">Invoice Total</p>
            <p className="font-semibold tabular-nums">{fmtCents(invoice.total_cents)}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Subtotal</p>
            <p className="font-semibold tabular-nums">{fmtCents(invoice.subtotal_cents)}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Tax</p>
            <p className="font-semibold tabular-nums">{fmtCents(invoice.tax_cents)}</p>
          </div>
        </div>

        {/* Match result lines */}
        {result && (
          <div className="space-y-2">
            <p className="text-sm font-semibold text-foreground">
              Match result: {matchStatusBadge(result.match_status)} (tolerance {fmtPct(result.tolerance_pct)})
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-muted text-muted-foreground">
                    <th className="text-left p-2 border border-border">Line</th>
                    <th className="text-right p-2 border border-border">Inv Qty</th>
                    <th className="text-right p-2 border border-border">PO Qty</th>
                    <th className="text-right p-2 border border-border">GRN Qty</th>
                    <th className="text-right p-2 border border-border">Inv Price</th>
                    <th className="text-right p-2 border border-border">PO Price</th>
                    <th className="text-right p-2 border border-border">Qty Var</th>
                    <th className="text-right p-2 border border-border">Price Var</th>
                    <th className="text-center p-2 border border-border">OK?</th>
                  </tr>
                </thead>
                <tbody>
                  {result.lines.map((l, i) => (
                    <tr key={l.invoice_line_id} className={l.has_variance ? 'bg-warning/10' : 'bg-card'}>
                      <td className="p-2 border border-border">{i + 1}</td>
                      <td className="p-2 border border-border text-right tabular-nums">{l.invoice_qty}</td>
                      <td className="p-2 border border-border text-right tabular-nums">{l.po_qty}</td>
                      <td className="p-2 border border-border text-right tabular-nums">{l.grn_qty}</td>
                      <td className="p-2 border border-border text-right tabular-nums">{fmtCents(l.invoice_price_cents)}</td>
                      <td className="p-2 border border-border text-right tabular-nums">{fmtCents(l.po_price_cents)}</td>
                      <td className={`p-2 border border-border text-right tabular-nums ${Math.abs(l.qty_variance_pct) > result.tolerance_pct ? 'text-warning font-semibold' : ''}`}>
                        {fmtPct(l.qty_variance_pct)}
                      </td>
                      <td className={`p-2 border border-border text-right tabular-nums ${Math.abs(l.price_variance_pct) > result.tolerance_pct ? 'text-warning font-semibold' : ''}`}>
                        {fmtPct(l.price_variance_pct)}
                      </td>
                      <td className="p-2 border border-border text-center">
                        {l.has_variance
                          ? <AlertCircle className="w-4 h-4 text-warning mx-auto" />
                          : <CheckCircle className="w-4 h-4 text-success mx-auto" />}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {err && <p className="text-sm text-destructive">{err}</p>}

        <div className="flex gap-3 pt-2">
          <Button variant="outline" onClick={handleClose} className="flex-1">
            Close
          </Button>
          <Button
            onClick={runMatch}
            disabled={running}
            className="flex-1"
          >
            {running ? 'Running match…' : 'Run Match'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
