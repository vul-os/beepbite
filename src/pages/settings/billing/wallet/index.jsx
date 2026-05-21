import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { RefreshCw } from 'lucide-react';
import { fetchWallet, fetchTransactions } from '@/services/wallet';
import { WalletBalanceCard } from './components/wallet-balance-card';
import { AutoRefillCard } from './components/auto-refill-card';
import { TransactionsLedger } from './components/transactions-ledger';

/**
 * Wallet & Usage settings page.
 *
 * Default export — the orchestrator adds the route; this file only
 * provides the page component.
 */
export default function WalletPage() {
  const [wallet, setWallet] = useState(null);
  const [transactions, setTransactions] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [txError, setTxError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);
    setTxError(null);

    const [walletRes, txRes] = await Promise.all([
      fetchWallet(),
      fetchTransactions(50),
    ]);

    if (walletRes.error) {
      setError(walletRes.error.message ?? 'Failed to load wallet');
    } else {
      setWallet(walletRes.data);
    }

    if (txRes.error) {
      setTxError(txRes.error.message ?? 'Failed to load transactions');
    } else {
      setTransactions(Array.isArray(txRes.data) ? txRes.data : []);
    }

    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    loadData(false);
  }, [loadData]);

  function handleRefresh() {
    loadData(true);
  }

  const currency = wallet?.currency_code ?? 'USD';

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-8">
      {/* Page header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold">Wallet &amp; usage</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Manage your prepaid AI usage balance, auto-refill settings, and review transactions.
          </p>
        </div>
        <Button
          variant="outline"
          size="icon"
          onClick={handleRefresh}
          disabled={loading || refreshing}
          title="Refresh"
        >
          <RefreshCw className={`h-4 w-4 ${loading || refreshing ? 'animate-spin' : ''}`} />
          <span className="sr-only">Refresh</span>
        </Button>
      </div>

      {/* Top-level error (both calls failed) */}
      {error && txError && !wallet && !transactions && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Wallet balance */}
      <section>
        <WalletBalanceCard
          wallet={wallet}
          loading={loading}
          error={error}
          onTopup={handleRefresh}
        />
      </section>

      {/* Auto-refill */}
      <section>
        <AutoRefillCard
          wallet={wallet}
          loading={loading}
          error={error}
          onSaved={handleRefresh}
        />
      </section>

      {/* Transactions ledger */}
      <section>
        <TransactionsLedger
          transactions={transactions}
          loading={loading}
          error={txError}
          currency={currency}
        />
      </section>
    </div>
  );
}
