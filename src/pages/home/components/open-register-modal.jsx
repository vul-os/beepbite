import React, { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, Minus, Plus, Unlock, Wallet, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  listDrawers,
  openRegisterSession,
  persistRegister,
  getStaff,
} from '@/services/pos';
import { denominationRows, denominationTotal } from '@/lib/denominations';
import { useMoney } from '@/context/locale-context';

// Single denomination row with +/- steppers and a per-denom subtotal.
function DenomRow({ denom, count, onChange }) {
  const { format } = useMoney();
  // The tile's own label — a drawer in Tokyo holds ¥1,000 notes, not R10 ones.
  const label = format(denom.minor);
  const subtotal = (count || 0) * denom.minor;
  const setSafe = (val) => onChange(Math.max(0, val | 0));

  return (
    <div className="flex flex-col gap-1 rounded-lg border border-orange-200/80 bg-card p-3 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-foreground">{label}</span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {format(subtotal)}
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setSafe((count || 0) - 1)}
          className="h-7 w-7 p-0 rounded-full border-orange-200 text-orange-600 hover:bg-orange-50 shrink-0"
          aria-label={`Decrease ${label}`}
        >
          <Minus className="w-3 h-3" />
        </Button>
        <Input
          type="number"
          min="0"
          value={count || ''}
          placeholder="0"
          onChange={(e) => setSafe(parseInt(e.target.value, 10) || 0)}
          className="h-7 text-sm text-center tabular-nums px-1"
        />
        <Button
          type="button"
          size="sm"
          onClick={() => setSafe((count || 0) + 1)}
          className="h-7 w-7 p-0 rounded-full bg-orange-500 hover:bg-orange-600 text-white shrink-0"
          aria-label={`Increase ${label}`}
        >
          <Plus className="w-3 h-3" />
        </Button>
      </div>
    </div>
  );
}

/**
 * OpenRegisterModal
 * Prompts the cashier to count their opening float across notes/coins, then
 * calls POST /cash-drawers/{drawer}/sessions/open. On success, persists the
 * session id via persistRegister() and invokes onOpened with the new session.
 */
export default function OpenRegisterModal({ open, onOpenChange, locationId, onOpened }) {
  const { format, currency } = useMoney();
  // Which notes and coins exist is a property of the currency, not of the app.
  const denoms = denominationRows(currency);

  const [drawers, setDrawers] = useState([]);
  const [drawerId, setDrawerId] = useState('');
  const [drawersLoading, setDrawersLoading] = useState(false);
  const [drawersError, setDrawersError] = useState('');

  const [counts, setCounts] = useState({});
  const [openingNote, setOpeningNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  // Fetch drawers whenever the modal opens.
  useEffect(() => {
    if (!open || !locationId) return;
    let cancelled = false;
    setDrawersLoading(true);
    setDrawersError('');
    listDrawers(locationId)
      .then((rows) => {
        if (cancelled) return;
        setDrawers(rows);
        if (rows.length > 0) setDrawerId((cur) => cur || rows[0].id);
      })
      .catch((err) => {
        if (cancelled) return;
        setDrawersError(err.message || 'Failed to load drawers');
      })
      .finally(() => !cancelled && setDrawersLoading(false));
    return () => { cancelled = true; };
  }, [open, locationId]);

  // Reset transient state on close.
  useEffect(() => {
    if (!open) {
      setCounts({});
      setOpeningNote('');
      setSubmitError('');
      setSubmitting(false);
    }
  }, [open]);

  const totalCents = denominationTotal(counts, currency);

  const handleCountChange = (key, v) => {
    setCounts((prev) => ({ ...prev, [key]: v }));
  };

  const handleSubmit = async () => {
    setSubmitError('');
    if (!drawerId) {
      setSubmitError('Please select a drawer first');
      return;
    }
    setSubmitting(true);
    try {
      const staff = getStaff();
      const session = await openRegisterSession({
        drawerId,
        openingFloatCents: totalCents,
        openedByStaffId: staff?.id || '',
        denominations: counts,
        note: openingNote,
      });
      persistRegister({
        sessionId: session?.id,
        drawerId,
        openedAt: session?.opened_at || new Date().toISOString(),
      });
      onOpened?.({ session, drawerId });
      onOpenChange(false);
    } catch (err) {
      setSubmitError(err.message || 'Failed to open register');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Unlock className="w-5 h-5 text-orange-500" />
            Open Register
          </DialogTitle>
          <DialogDescription>
            Count the opening float in your cash drawer to start your shift.
          </DialogDescription>
        </DialogHeader>

        {/* Drawer selector */}
        <div className="space-y-1.5">
          <Label htmlFor="reg-drawer">Drawer</Label>
          {drawersLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading drawers…
            </div>
          ) : drawersError ? (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{drawersError}</AlertDescription>
            </Alert>
          ) : drawers.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">
              No active drawers for this location. Please ask an admin to configure one.
            </p>
          ) : (
            <select
              id="reg-drawer"
              value={drawerId}
              onChange={(e) => setDrawerId(e.target.value)}
              className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
            >
              {drawers.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          )}
        </div>

        {/* Denominations */}
        <div className="space-y-2">
          <Label className="text-sm font-medium text-foreground">Denominations</Label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {denoms.map((d) => (
              <DenomRow
                key={d.key}
                denom={d}
                count={counts[d.key] || 0}
                onChange={(v) => handleCountChange(d.key, v)}
              />
            ))}
          </div>
        </div>

        {/* Optional note */}
        <div className="space-y-1.5">
          <Label htmlFor="reg-note">Opening note (optional)</Label>
          <Input
            id="reg-note"
            placeholder="Anything noteworthy about the float?"
            value={openingNote}
            onChange={(e) => setOpeningNote(e.target.value)}
          />
        </div>

        {/* Running total */}
        <div
          className={cn(
            'flex justify-between items-center rounded-lg px-4 py-3 border',
            'bg-gradient-to-r from-orange-50 to-amber-50 border-orange-200',
          )}
        >
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Wallet className="w-4 h-4 text-orange-500" />
            Opening Float Total
          </div>
          <span className="text-xl font-bold text-orange-600 tabular-nums">
            {format(totalCents)}
          </span>
        </div>

        {submitError && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{submitError}</AlertDescription>
          </Alert>
        )}

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
            type="button"
            onClick={handleSubmit}
            disabled={submitting || !drawerId || drawers.length === 0}
            className="bg-orange-500 hover:bg-orange-600 text-white min-w-[140px]"
          >
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Opening…
              </>
            ) : (
              <>
                <Unlock className="w-4 h-4 mr-2" />
                Open Register
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
