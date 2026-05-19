import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { DollarSign, Loader2 } from 'lucide-react';

function centsToDisplay(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

export function RecordPaymentDialog({ open, onOpenChange, invoice, onPay }) {
  const [amount, setAmount] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  // Reset when dialog opens for a new invoice
  React.useEffect(() => {
    if (open && invoice) {
      const remaining = invoice.total_cents - invoice.paid_amount_cents;
      setAmount((remaining / 100).toFixed(2));
      setErr(null);
    }
  }, [open, invoice]);

  async function handleSubmit(e) {
    e.preventDefault();
    const cents = Math.round(parseFloat(amount) * 100);
    if (!cents || cents <= 0) { setErr('Enter a valid amount'); return; }
    setSaving(true);
    setErr(null);
    try {
      await onPay(invoice.id, cents);
      onOpenChange(false);
    } catch (e) {
      setErr(e.message || 'Payment failed');
    } finally {
      setSaving(false);
    }
  }

  if (!invoice) return null;

  const remaining = invoice.total_cents - invoice.paid_amount_cents;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <DollarSign className="h-4 w-4" />
            Record payment
          </DialogTitle>
          <DialogDescription>
            Invoice {invoice.invoice_number} — total {centsToDisplay(invoice.total_cents)},
            remaining {centsToDisplay(remaining)}.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="space-y-1">
            <Label htmlFor="pay-amount">Payment amount ($)</Label>
            <Input
              id="pay-amount"
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
          </div>

          {err && <p className="text-sm text-destructive">{err}</p>}

          <DialogFooter className="gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Record payment
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
