import React from 'react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Receipt } from 'lucide-react';
import { formatPrice } from '@/lib/currency';

/**
 * Maps the raw transaction `kind` to a human-readable label.
 * Extend this map as new kinds are introduced on the backend.
 */
export const KIND_LABEL = {
  topup: 'Top-up',
  debit_llm: 'AI usage',
  debit_ai: 'AI usage',
  debit_sms: 'SMS',
  debit_email: 'Email',
  debit_whatsapp: 'WhatsApp',
  debit_subscription: 'Subscription',
  debit_fee: 'Fee',
  credit_refund: 'Refund',
  credit_adjustment: 'Adjustment',
  hold: 'Hold',
  hold_release: 'Hold release',
  payout: 'Payout',
};

function kindLabel(kind) {
  return KIND_LABEL[kind] ?? kind?.replace(/_/g, ' ') ?? '—';
}

function formatDate(iso) {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function isCredit(amountCents) {
  return amountCents > 0;
}

/**
 * Transactions ledger table.
 *
 * Props:
 *   transactions  — array of transaction objects (or null)
 *   loading       — boolean
 *   error         — string | null
 *   currency      — ISO 4217 code (defaults to 'USD')
 */
export function TransactionsLedger({ transactions, loading, error, currency = 'USD' }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Receipt className="h-5 w-5 text-orange-500" />
          <CardTitle className="text-base">Recent transactions</CardTitle>
        </div>
        <CardDescription>
          Last 50 wallet movements — credits and debits.
        </CardDescription>
      </CardHeader>

      <CardContent className="p-0">
        {loading && !transactions ? (
          <div className="px-6 pb-6 space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : error && !transactions ? (
          <div className="px-6 pb-6">
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          </div>
        ) : !transactions || transactions.length === 0 ? (
          <div className="px-6 pb-8 pt-4 text-center text-sm text-muted-foreground">
            No transactions yet. Top up your wallet to get started.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Date</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-right pr-6">Balance after</TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {transactions.map((tx) => {
                const credit = isCredit(tx.amount_cents);
                return (
                  <TableRow key={tx.id}>
                    <TableCell className="pl-6 text-muted-foreground text-xs whitespace-nowrap">
                      {formatDate(tx.created_at)}
                    </TableCell>
                    <TableCell className="font-medium text-sm">
                      {kindLabel(tx.kind)}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">
                      {tx.reason ?? '—'}
                    </TableCell>
                    <TableCell
                      className={`text-right font-semibold text-sm tabular-nums ${
                        credit ? 'text-green-600' : 'text-red-500'
                      }`}
                    >
                      {credit ? '+' : ''}
                      {formatPrice(tx.amount_cents, currency)}
                    </TableCell>
                    <TableCell className="text-right pr-6 text-sm tabular-nums text-muted-foreground">
                      {tx.balance_after_cents != null
                        ? formatPrice(tx.balance_after_cents, currency)
                        : '—'}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
