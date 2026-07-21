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
import { Loader2, LockKeyhole } from 'lucide-react';

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
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto bg-white">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LockKeyhole className="h-5 w-5 text-destructive" />
            Close Session
          </DialogTitle>
          {!isBlind && (
            <DialogDescription>
              Expected balance: {format(expectedCents)}
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
            <span className="font-semibold">{format(declaredCents)}</span>
          </div>

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
              variant="destructive"
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
