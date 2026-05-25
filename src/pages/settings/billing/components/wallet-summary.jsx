import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Wallet, ArrowRight } from 'lucide-react';
import { fetchWallet } from '@/services/wallet';

function fmt(cents, currency = 'USD') {
  const amount = (cents ?? 0) / 100;
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

export function WalletSummary() {
  const [wallet, setWallet] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error: err } = await fetchWallet();
      if (cancelled) return;
      if (err) setError(err.message ?? 'Failed to load wallet');
      else setWallet(data);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const available = wallet ? (wallet.balance_cents ?? 0) - (wallet.hold_cents ?? 0) : 0;
  const autoOn = wallet?.auto_refill_enabled;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="text-base flex items-center gap-2">
            <Wallet className="h-4 w-4" /> Wallet
          </CardTitle>
          <CardDescription>Prepaid balance used for transactional fees.</CardDescription>
        </div>
        <Button asChild variant="ghost" size="sm">
          <Link to="/settings/billing/wallet">
            Manage <ArrowRight className="ml-1 h-3.5 w-3.5" />
          </Link>
        </Button>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-12 w-40" />
        ) : error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : (
          <div className="flex items-end gap-6">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Available</p>
              <p className="text-2xl font-semibold tabular-nums">
                {fmt(available, wallet?.currency_code)}
              </p>
            </div>
            {wallet?.hold_cents > 0 && (
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">On hold</p>
                <p className="text-sm font-medium tabular-nums text-muted-foreground">
                  {fmt(wallet.hold_cents, wallet.currency_code)}
                </p>
              </div>
            )}
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Auto-refill</p>
              <p className={`text-sm font-medium ${autoOn ? 'text-green-700' : 'text-muted-foreground'}`}>
                {autoOn ? 'On' : 'Off'}
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
