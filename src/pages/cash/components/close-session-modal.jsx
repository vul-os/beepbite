import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { DenominationGrid } from './denomination-grid';
import { api } from '@/lib/api-client';
import { useMoney } from '@/context/locale-context';
import { cn } from '@/lib/utils';
import { Loader2, LockKeyhole, CheckCircle2, AlertTriangle, AlertOctagon } from 'lucide-react';

/**
 * CloseSessionModal
 *
 * Props:
 *   open: boolean
 *   onOpenChange: (open) => void
 *   session: object
 *   staffId: string
 *   expectedCents: number
 *   onClosed: (closedSession) => void
 *
 * Requires LocaleProvider above it.
 */
export function CloseSessionModal({
  open,
  onOpenChange,
  session,
  staffId,
  expectedCents,
  onClosed,
}) {
  const { format, parse, symbol, scale, decimals } = useMoney();
  const [denomCounts, setDenomCounts] = useState({});
  const [denomTotalCents, setDenomTotalCents] = useState(0);
  const [useDenomsForTotal, setUseDenomsForTotal] = useState(false);
  const [manualCents, setManualCents] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const isBlind = session?.is_blind_close ?? false;

  const handleDenomChange = (counts, totalCents) => {
    setDenomCounts(counts);
    setDenomTotalCents(totalCents);
  };

  const declaredCents = useDenomsForTotal
    ? denomTotalCents
    : parse(manualCents) ?? 0;

  // The one number this whole screen exists to surface. Blind closes hide
  // the expected amount from the counter on purpose (that's the point of a
  // blind count), so there is nothing to compare against until it's known.
  const hasExpected = !isBlind && typeof expectedCents === 'number';
  const discrepancyCents = hasExpected ? declaredCents - expectedCents : 0;
  const absDiscrepancyCents = Math.abs(discrepancyCents);
  // "Small" is defined in the currency's own units (5 of them — 5 dollars,
  // 5 yen, 5 rand) via `scale`, not a hardcoded cent amount that would
  // misprice a JPY till (scale 1) or overstate a KWD one (scale 1000).
  const smallVarianceCents = scale * 5;
  const varianceLevel = !hasExpected
    ? null
    : absDiscrepancyCents === 0
      ? 'balanced'
      : absDiscrepancyCents <= smallVarianceCents
        ? 'warning'
        : 'destructive';

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    if (!session?.id) return;

    setSubmitting(true);
    try {
      const { data, error: apiErr } = await api.request(
        'POST',
        `/cash-drawers/sessions/${session.id}/close`,
        {
          body: {
            closed_by_staff_id: staffId || '',
            declared_closing_cents: declaredCents,
            denominations: denomCounts,
            notes,
          },
        },
      );
      if (apiErr) throw new Error(apiErr.message);
      onOpenChange(false);
      onClosed?.(data);
    } catch (err) {
      setError(err.message || 'Failed to close session');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LockKeyhole className="h-5 w-5 text-destructive" />
            Close Session
          </DialogTitle>
          {!isBlind && (
            <DialogDescription>
              Expected balance: <span className="tabular-nums">{format(expectedCents)}</span>
            </DialogDescription>
          )}
          {isBlind && (
            <DialogDescription>
              Blind close — count the till without seeing the expected amount.
            </DialogDescription>
          )}
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5 pt-2">
          {/* Toggle: count by denomination or enter total */}
          <div className="flex items-center gap-3">
            <Switch
              id="use-denoms"
              checked={useDenomsForTotal}
              onCheckedChange={setUseDenomsForTotal}
            />
            <Label htmlFor="use-denoms" className="cursor-pointer">
              Count by denomination
            </Label>
          </div>

          {useDenomsForTotal ? (
            <DenominationGrid counts={denomCounts} onChange={handleDenomChange} />
          ) : (
            <div className="space-y-1">
              <Label htmlFor="declared-amount">Declared closing amount ({symbol})</Label>
              <input
                id="declared-amount"
                type="number"
                min="0"
                // One minor unit. A fixed 0.01 makes a JPY till reject ¥1.
                step={(1 / scale).toFixed(decimals)}
                placeholder={(0).toFixed(decimals)}
                value={manualCents}
                onChange={(e) => setManualCents(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring md:text-sm"
              />
            </div>
          )}

          {/* Declared total preview */}
          <div className="flex justify-between text-sm rounded-md bg-muted px-3 py-2">
            <span className="text-muted-foreground">Your declared total</span>
            <span className="font-semibold tabular-nums">{format(declaredCents)}</span>
          </div>

          {/* Expected-vs-counted discrepancy — the single most important
              number on this screen. Colour + size carry the outcome:
              balanced (success), a small/explainable gap (warning), or a
              gap big enough that a manager should be looped in before the
              drawer closes (destructive). */}
          {hasExpected && (
            <div
              role="status"
              className={cn(
                'flex items-center justify-between gap-3 rounded-lg border-2 px-4 py-3',
                varianceLevel === 'balanced' && 'border-success/30 bg-success/10',
                varianceLevel === 'warning' && 'border-warning/30 bg-warning/10',
                varianceLevel === 'destructive' && 'border-destructive/30 bg-destructive/10',
              )}
            >
              <div>
                <p
                  className={cn(
                    'text-xs font-semibold uppercase tracking-wide',
                    varianceLevel === 'balanced' && 'text-success',
                    varianceLevel === 'warning' && 'text-warning',
                    varianceLevel === 'destructive' && 'text-destructive',
                  )}
                >
                  {varianceLevel === 'balanced'
                    ? 'Balanced'
                    : discrepancyCents > 0
                      ? 'Over'
                      : 'Short'}
                </p>
                <p
                  className={cn(
                    'font-display text-2xl font-bold tabular-nums leading-tight',
                    varianceLevel === 'balanced' && 'text-success',
                    varianceLevel === 'warning' && 'text-warning',
                    varianceLevel === 'destructive' && 'text-destructive',
                  )}
                >
                  {varianceLevel === 'balanced'
                    ? format(0)
                    : `${discrepancyCents > 0 ? '+' : '-'}${format(absDiscrepancyCents)}`}
                </p>
                {varianceLevel === 'destructive' && (
                  <p className="text-xs text-destructive/80 mt-0.5">
                    That's a large gap — add a note below explaining it.
                  </p>
                )}
              </div>
              {varianceLevel === 'balanced' && (
                <CheckCircle2 className="h-7 w-7 text-success flex-shrink-0" aria-hidden="true" />
              )}
              {varianceLevel === 'warning' && (
                <AlertTriangle className="h-7 w-7 text-warning flex-shrink-0" aria-hidden="true" />
              )}
              {varianceLevel === 'destructive' && (
                <AlertOctagon className="h-7 w-7 text-destructive flex-shrink-0" aria-hidden="true" />
              )}
            </div>
          )}

          {/* Notes */}
          <div className="space-y-1">
            <Label htmlFor="close-notes">Notes (optional)</Label>
            <Textarea
              id="close-notes"
              placeholder="Any notes for this close..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant={varianceLevel === 'destructive' ? 'destructive' : 'default'}
              disabled={submitting}
            >
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirm Close
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
