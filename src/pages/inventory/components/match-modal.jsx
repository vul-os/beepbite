import React, { useState } from 'react';
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
import { AlertCircle, CheckCircle } from 'lucide-react';

function fmtCents(cents) {
  return `R ${(cents / 100).toFixed(2)}`;
}

function fmtPct(v) {
  return `${(v * 100).toFixed(1)}%`;
}

function matchStatusBadge(status) {
  const map = {
    matched: 'bg-green-100 text-green-800',
    price_variance: 'bg-yellow-100 text-yellow-800',
    qty_variance: 'bg-orange-100 text-orange-800',
    unmatched: 'bg-gray-100 text-gray-700',
  };
  return (
    <Badge className={map[status] || 'bg-gray-100 text-gray-700'}>
      {status?.replace('_', ' ')}
    </Badge>
  );
}

export function MatchModal({ invoice, open, onClose, onMatched }) {
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState('');

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
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto bg-white">
        <DialogHeader>
          <DialogTitle>3-Way Match — Invoice {invoice.invoice_number}</DialogTitle>
          <DialogDescription>
            Supplier invoice dated {invoice.invoice_date}. Current match status:{' '}
            {matchStatusBadge(result?.match_status ?? invoice.match_status)}
          </DialogDescription>
        </DialogHeader>

        {/* Invoice summary */}
        <div className="grid grid-cols-3 gap-4 text-sm border border-orange-100 rounded p-3 bg-orange-50/30">
          <div>
            <p className="text-gray-500 text-xs">Invoice Total</p>
            <p className="font-semibold">{fmtCents(invoice.total_cents)}</p>
          </div>
          <div>
            <p className="text-gray-500 text-xs">Subtotal</p>
            <p className="font-semibold">{fmtCents(invoice.subtotal_cents)}</p>
          </div>
          <div>
            <p className="text-gray-500 text-xs">Tax</p>
            <p className="font-semibold">{fmtCents(invoice.tax_cents)}</p>
          </div>
        </div>

        {/* Match result lines */}
        {result && (
          <div className="space-y-2">
            <p className="text-sm font-semibold text-gray-700">
              Match result: {matchStatusBadge(result.match_status)} (tolerance {fmtPct(result.tolerance_pct)})
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-gray-50 text-gray-600">
                    <th className="text-left p-2 border border-gray-200">Line</th>
                    <th className="text-right p-2 border border-gray-200">Inv Qty</th>
                    <th className="text-right p-2 border border-gray-200">PO Qty</th>
                    <th className="text-right p-2 border border-gray-200">GRN Qty</th>
                    <th className="text-right p-2 border border-gray-200">Inv Price</th>
                    <th className="text-right p-2 border border-gray-200">PO Price</th>
                    <th className="text-right p-2 border border-gray-200">Qty Var</th>
                    <th className="text-right p-2 border border-gray-200">Price Var</th>
                    <th className="text-center p-2 border border-gray-200">OK?</th>
                  </tr>
                </thead>
                <tbody>
                  {result.lines.map((l, i) => (
                    <tr key={l.invoice_line_id} className={l.has_variance ? 'bg-red-50' : 'bg-white'}>
                      <td className="p-2 border border-gray-200">{i + 1}</td>
                      <td className="p-2 border border-gray-200 text-right">{l.invoice_qty}</td>
                      <td className="p-2 border border-gray-200 text-right">{l.po_qty}</td>
                      <td className="p-2 border border-gray-200 text-right">{l.grn_qty}</td>
                      <td className="p-2 border border-gray-200 text-right">{fmtCents(l.invoice_price_cents)}</td>
                      <td className="p-2 border border-gray-200 text-right">{fmtCents(l.po_price_cents)}</td>
                      <td className={`p-2 border border-gray-200 text-right ${Math.abs(l.qty_variance_pct) > result.tolerance_pct ? 'text-red-600 font-semibold' : ''}`}>
                        {fmtPct(l.qty_variance_pct)}
                      </td>
                      <td className={`p-2 border border-gray-200 text-right ${Math.abs(l.price_variance_pct) > result.tolerance_pct ? 'text-red-600 font-semibold' : ''}`}>
                        {fmtPct(l.price_variance_pct)}
                      </td>
                      <td className="p-2 border border-gray-200 text-center">
                        {l.has_variance
                          ? <AlertCircle className="w-4 h-4 text-red-500 mx-auto" />
                          : <CheckCircle className="w-4 h-4 text-green-500 mx-auto" />}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {err && <p className="text-sm text-red-600">{err}</p>}

        <div className="flex gap-3 pt-2">
          <Button variant="outline" onClick={handleClose} className="flex-1">
            Close
          </Button>
          <Button
            onClick={runMatch}
            disabled={running}
            className="flex-1 bg-orange-500 hover:bg-orange-600 text-white"
          >
            {running ? 'Running match…' : 'Run Match'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
