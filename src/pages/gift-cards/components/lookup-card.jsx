import React, { useState } from 'react';
import { api } from '@/lib/api-client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Search, RefreshCw } from 'lucide-react';
import { useMoney, useDateTime } from '@/context/locale-context';

// Map backend status values to badge variants.
const STATUS_VARIANT = {
  active: 'default',
  redeemed: 'secondary',
  expired: 'destructive',
  disabled: 'destructive',
  fraud_hold: 'destructive',
};

/**
 * LookupCard — the "Lookup" tab content.
 * Handles lookup, reload, and refund actions for a found card.
 */
export function LookupCard() {
  // A card carries its own currency, which may differ from the active
  // location's (a gift card sold before a currency change); the card's own
  // value wins whenever one is loaded, falling back to the active location's
  // only before a lookup has returned a card.
  const [code, setCode] = useState('');
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [card, setCard] = useState(null); // LookupResult
  const { format: formatCurrency } = useMoney({ currency: card?.currency });
  const { formatDate } = useDateTime();
  const fmtExpiry = (iso) =>
    iso ? formatDate(iso, { year: 'numeric', month: 'short', day: 'numeric' }) : 'Never';

  // Reload sub-form state
  const [reloadAmount, setReloadAmount] = useState('');
  const [reloadLoading, setReloadLoading] = useState(false);
  const [reloadError, setReloadError] = useState('');
  const [reloadSuccess, setReloadSuccess] = useState('');

  // Refund sub-form state
  const [refundAmount, setRefundAmount] = useState('');
  const [refundNotes, setRefundNotes] = useState('');
  const [refundLoading, setRefundLoading] = useState(false);
  const [refundError, setRefundError] = useState('');
  const [refundSuccess, setRefundSuccess] = useState('');

  async function handleLookup(e) {
    e.preventDefault();
    if (!code.trim()) return;
    setLoading(true);
    setError('');
    setCard(null);
    setReloadSuccess('');
    setRefundSuccess('');

    const qs = new URLSearchParams({ code: code.trim() });
    if (pin.trim()) qs.set('pin', pin.trim());

    const { data, error: err } = await api.request('GET', `/gift-cards/lookup?${qs}`);
    setLoading(false);
    if (err) {
      setError(err.message || 'Lookup failed.');
      return;
    }
    setCard(data);
  }

  async function handleReload(e) {
    e.preventDefault();
    const cents = Math.round(parseFloat(reloadAmount) * 100);
    if (!cents || cents <= 0) {
      setReloadError('Enter a valid amount.');
      return;
    }
    setReloadLoading(true);
    setReloadError('');
    setReloadSuccess('');

    const { data, error: err } = await api.request('POST', '/gift-cards/reload', {
      body: {
        code: code.trim(),
        amount_cents: cents,
        performed_by_staff_id: '',
        notes: '',
        order_id: '',
      },
    });

    if (err) {
      setReloadLoading(false);
      setReloadError(err.message || 'Reload failed.');
      return;
    }
    // Refresh balance using the new balance_after_cents from the transaction.
    setCard((prev) => ({
      ...prev,
      current_balance_cents: data.balance_after_cents,
    }));
    setReloadAmount('');
    setReloadSuccess(`Reloaded ${formatCurrency(cents)}. New balance: ${formatCurrency(data.balance_after_cents)}`);
    setReloadLoading(false);
  }

  async function handleRefund(e) {
    e.preventDefault();
    const cents = Math.round(parseFloat(refundAmount) * 100);
    if (!cents || cents <= 0) {
      setRefundError('Enter a valid amount.');
      return;
    }
    setRefundLoading(true);
    setRefundError('');
    setRefundSuccess('');

    const { data, error: err } = await api.request('POST', '/gift-cards/refund', {
      body: {
        code: code.trim(),
        amount_cents: cents,
        performed_by_staff_id: '',
        notes: refundNotes.trim(),
        order_id: '',
      },
    });

    if (err) {
      setRefundLoading(false);
      setRefundError(err.message || 'Refund failed.');
      return;
    }
    setCard((prev) => ({
      ...prev,
      current_balance_cents: data.balance_after_cents,
    }));
    setRefundAmount('');
    setRefundNotes('');
    setRefundSuccess(`Refunded ${formatCurrency(cents)}. New balance: ${formatCurrency(data.balance_after_cents)}`);
    setRefundLoading(false);
  }

  return (
    <div className="space-y-6">
      {/* Search form */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Look Up a Card</CardTitle>
          <CardDescription>Enter the card code and optional PIN.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLookup} className="flex flex-col gap-4 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="gc-code">Card Code</Label>
              <Input
                id="gc-code"
                placeholder="e.g. GIFT-XXXX-XXXX"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                autoComplete="off"
                required
              />
            </div>
            <div className="w-32 space-y-1.5">
              <Label htmlFor="gc-pin">PIN (optional)</Label>
              <Input
                id="gc-pin"
                type="password"
                placeholder="••••"
                maxLength={6}
                value={pin}
                onChange={(e) => setPin(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={loading || !code.trim()} className="shrink-0">
              {loading ? (
                <RefreshCw className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Search className="h-4 w-4 mr-2" />
              )}
              Lookup
            </Button>
          </form>
          {error && (
            <p className="mt-3 text-sm text-destructive">{error}</p>
          )}
        </CardContent>
      </Card>

      {/* Card details + actions */}
      {card && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-mono tracking-wider">
                {card.masked_code}
              </CardTitle>
              <Badge variant={STATUS_VARIANT[card.status] ?? 'outline'}>
                {card.status}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* Summary row */}
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 text-sm">
              <div>
                <p className="text-muted-foreground text-xs mb-0.5">Balance</p>
                <p className="font-semibold text-lg">
                  {formatCurrency(card.current_balance_cents)}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs mb-0.5">Currency</p>
                <p className="font-medium">{card.currency}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs mb-0.5">Expires</p>
                <p className="font-medium">{fmtExpiry(card.expires_at)}</p>
              </div>
            </div>

            <Separator />

            {/* Reload action */}
            <div>
              <h4 className="text-sm font-semibold mb-2">Reload</h4>
              <form onSubmit={handleReload} className="flex gap-2 items-end">
                <div className="w-36 space-y-1.5">
                  <Label htmlFor="reload-amount">Amount ({card.currency})</Label>
                  <Input
                    id="reload-amount"
                    type="number"
                    min="0.01"
                    step="0.01"
                    placeholder="0.00"
                    value={reloadAmount}
                    onChange={(e) => setReloadAmount(e.target.value)}
                  />
                </div>
                <Button
                  type="submit"
                  variant="outline"
                  disabled={reloadLoading || !reloadAmount}
                  size="sm"
                >
                  {reloadLoading && <RefreshCw className="h-3 w-3 animate-spin mr-1" />}
                  Reload
                </Button>
              </form>
              {reloadError && <p className="mt-1.5 text-xs text-destructive">{reloadError}</p>}
              {reloadSuccess && <p className="mt-1.5 text-xs text-green-600">{reloadSuccess}</p>}
            </div>

            <Separator />

            {/* Refund action */}
            <div>
              <h4 className="text-sm font-semibold mb-2">Refund to Card</h4>
              <form onSubmit={handleRefund} className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <div className="w-36 space-y-1.5">
                  <Label htmlFor="refund-amount">Amount ({card.currency})</Label>
                  <Input
                    id="refund-amount"
                    type="number"
                    min="0.01"
                    step="0.01"
                    placeholder="0.00"
                    value={refundAmount}
                    onChange={(e) => setRefundAmount(e.target.value)}
                  />
                </div>
                <div className="flex-1 space-y-1.5">
                  <Label htmlFor="refund-notes">Reason (optional)</Label>
                  <Input
                    id="refund-notes"
                    placeholder="e.g. Order cancelled"
                    value={refundNotes}
                    onChange={(e) => setRefundNotes(e.target.value)}
                  />
                </div>
                <Button
                  type="submit"
                  variant="outline"
                  disabled={refundLoading || !refundAmount}
                  size="sm"
                >
                  {refundLoading && <RefreshCw className="h-3 w-3 animate-spin mr-1" />}
                  Refund
                </Button>
              </form>
              {refundError && <p className="mt-1.5 text-xs text-destructive">{refundError}</p>}
              {refundSuccess && <p className="mt-1.5 text-xs text-green-600">{refundSuccess}</p>}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
