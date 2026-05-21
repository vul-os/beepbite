import React, { useState } from 'react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Wallet, PlusCircle, Clock } from 'lucide-react';
import { formatPrice } from '@/lib/currency';
import { topup } from '@/services/wallet';
import { useToast } from '@/hooks/use-toast';

/**
 * Displays the wallet balance and exposes a Top-up action via a modal.
 *
 * Props:
 *   wallet   — wallet object from GET /wallet (or null while loading)
 *   loading  — boolean
 *   error    — string | null
 *   onTopup  — () => void  callback to refresh parent after successful top-up
 */
export function WalletBalanceCard({ wallet, loading, error, onTopup }) {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [amountInput, setAmountInput] = useState('');
  const [pending, setPending] = useState(false);
  const [topupError, setTopupError] = useState(null);
  const [topupResult, setTopupResult] = useState(null);

  const currency = wallet?.currency_code ?? 'USD';
  const balanceCents = wallet?.balance_cents ?? 0;
  const holdCents = wallet?.hold_cents ?? 0;
  const availableCents = balanceCents - holdCents;

  function openDialog() {
    setAmountInput('');
    setTopupError(null);
    setTopupResult(null);
    setDialogOpen(true);
  }

  function closeDialog() {
    if (pending) return; // don't close while in-flight
    setDialogOpen(false);
  }

  async function handleTopup() {
    const majorUnits = parseFloat(amountInput);
    if (!majorUnits || majorUnits <= 0) {
      setTopupError('Please enter a valid positive amount.');
      return;
    }
    const amountCents = Math.round(majorUnits * 100);
    setPending(true);
    setTopupError(null);
    setTopupResult(null);

    const { data, error: err } = await topup(amountCents);
    setPending(false);

    if (err) {
      setTopupError(err.message ?? 'Top-up failed. Please try again.');
      return;
    }

    setTopupResult(data);
    toast({
      title: 'Top-up initiated',
      description: `${formatPrice(amountCents, currency)} is being added to your wallet.`,
    });
    onTopup?.();
  }

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Wallet className="h-5 w-5 text-orange-500" />
            <CardTitle className="text-base">Wallet balance</CardTitle>
          </div>
          <CardDescription>
            Your prepaid AI usage balance. Funds are drawn as AI features are used.
          </CardDescription>
        </CardHeader>

        <CardContent>
          {loading && !wallet ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-40" />
              <Skeleton className="h-4 w-56" />
            </div>
          ) : error && !wallet ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : (
            <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
              <div>
                <p className="text-3xl font-bold tracking-tight">
                  {formatPrice(balanceCents, currency)}
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  {currency} &middot; Available:{' '}
                  <span className="font-medium text-foreground">
                    {formatPrice(availableCents, currency)}
                  </span>
                  {holdCents > 0 && (
                    <span className="ml-2 text-xs text-amber-600">
                      ({formatPrice(holdCents, currency)} on hold)
                    </span>
                  )}
                </p>
              </div>

              <Button
                onClick={openDialog}
                className="bg-orange-500 hover:bg-orange-600 text-white shrink-0"
              >
                <PlusCircle className="h-4 w-4 mr-1.5" />
                Top up
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Top-up dialog */}
      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) closeDialog(); else setDialogOpen(true); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Top up wallet</DialogTitle>
            <DialogDescription>
              Enter the amount to add to your wallet in {currency}.
            </DialogDescription>
          </DialogHeader>

          {topupResult ? (
            <div className="space-y-3 py-2">
              <div className="flex items-center gap-2 text-amber-600">
                <Clock className="h-5 w-5 shrink-0" />
                <span className="text-sm font-medium">Payment pending</span>
              </div>
              <p className="text-sm text-muted-foreground">
                Your top-up of{' '}
                <span className="font-semibold text-foreground">
                  {formatPrice(topupResult.amount_cents ?? 0, currency)}
                </span>{' '}
                is being processed. Your balance will update once confirmed.
              </p>
              <p className="text-xs text-muted-foreground">
                Reference: <code className="text-xs bg-muted px-1 py-0.5 rounded">{topupResult.id}</code>
              </p>
            </div>
          ) : (
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label htmlFor="topup-amount">Amount ({currency})</Label>
                <Input
                  id="topup-amount"
                  type="number"
                  min="1"
                  step="1"
                  placeholder="e.g. 50"
                  value={amountInput}
                  onChange={(e) => setAmountInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleTopup(); }}
                  disabled={pending}
                />
              </div>
              {topupError && (
                <Alert variant="destructive" className="py-2">
                  <AlertDescription className="text-sm">{topupError}</AlertDescription>
                </Alert>
              )}
            </div>
          )}

          <DialogFooter>
            {topupResult ? (
              <Button variant="outline" onClick={closeDialog}>
                Close
              </Button>
            ) : (
              <>
                <Button variant="outline" onClick={closeDialog} disabled={pending}>
                  Cancel
                </Button>
                <Button
                  onClick={handleTopup}
                  disabled={pending || !amountInput}
                  className="bg-orange-500 hover:bg-orange-600 text-white"
                >
                  {pending ? 'Processing…' : 'Top up'}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
