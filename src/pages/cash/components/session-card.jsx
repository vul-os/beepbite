import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { MovementsList } from './movements-list';
import { CloseSessionModal } from './close-session-modal';
import { api } from '@/lib/api-client';
import { hasCapability } from '@/services/pos';
import { useMoney } from '@/context/locale-context';
import { Loader2, LockKeyhole, PlusCircle, Wallet } from 'lucide-react';

// Movement types with inflow/outflow sign convention
const MOVEMENT_TYPES = [
  { value: 'paid_in',    label: 'Paid In',    sign: 1  },
  { value: 'paid_out',   label: 'Paid Out',   sign: -1 },
  { value: 'petty_cash', label: 'Petty Cash', sign: 1  },
  { value: 'tip_out',    label: 'Tip Out',    sign: -1 },
  { value: 'no_sale',    label: 'No Sale',    sign: 0  },
  { value: 'drop',       label: 'Drop',       sign: 1  },
  { value: 'pickup',     label: 'Pickup',     sign: -1 },
];

function fmtDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

/**
 * SessionCard
 *
 * Props:
 *   session: session object (from getSession / listSessions)
 *   staffId: string
 *   onMovementAdded: () => void   — refetch signal
 *   onSessionClosed: (session) => void
 *
 * Requires LocaleProvider above it.
 */
export function SessionCard({ session, staffId, onMovementAdded, onSessionClosed }) {
  const { format, parse, symbol, scale, decimals } = useMoney();
  const [movType, setMovType] = useState('paid_in');
  const [amountMajor, setAmountMajor] = useState('');
  const [reason, setReason] = useState('');
  const [movLoading, setMovLoading] = useState(false);
  const [movError, setMovError] = useState(null);
  const [closeOpen, setCloseOpen] = useState(false);

  const canSettle = hasCapability('can_settle');

  // Compute expected balance from movements when server hasn't closed yet
  const movements = session.movements || [];
  const movementsNet = movements.reduce((s, m) => s + (m.amount_cents || 0), 0);
  const expectedCents =
    session.expected_closing_cents != null
      ? session.expected_closing_cents
      : (session.opening_float_cents || 0) + movementsNet;

  const selectedType = MOVEMENT_TYPES.find((t) => t.value === movType);
  const sign = selectedType?.sign ?? 1;

  const handleAddMovement = async (e) => {
    e.preventDefault();
    setMovError(null);
    const absVal = Math.abs(parse(amountMajor) ?? 0);
    if (movType !== 'no_sale' && absVal === 0) {
      setMovError('Amount must be non-zero');
      return;
    }
    // Apply sign convention: outflows are stored as negative
    const amountCents = sign === 0 ? 0 : sign * absVal;

    setMovLoading(true);
    try {
      const { error: apiErr } = await api.request(
        'POST',
        `/cash-drawers/sessions/${session.id}/movements`,
        {
          body: {
            movement_type: movType,
            amount_cents: amountCents,
            reason,
            performed_by: staffId || '',
          },
        },
      );
      if (apiErr) throw new Error(apiErr.message);
      setAmountMajor('');
      setReason('');
      onMovementAdded?.();
    } catch (err) {
      setMovError(err.message || 'Failed to record movement');
    } finally {
      setMovLoading(false);
    }
  };

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4 pb-2">
          <div className="flex items-center gap-2">
            <Wallet className="h-5 w-5 text-orange-500" />
            <CardTitle>Current Session</CardTitle>
            <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
              Open
            </Badge>
          </div>
          {canSettle && (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setCloseOpen(true)}
              className="shrink-0"
            >
              <LockKeyhole className="mr-1.5 h-4 w-4" />
              Close Session
            </Button>
          )}
        </CardHeader>

        <CardContent className="space-y-6">
          {/* Session summary */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">Opened at</p>
              <p className="font-medium">{fmtDate(session.opened_at)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Opening float</p>
              <p className="font-medium">
                {format(session.opening_float_cents || 0)}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Expected balance</p>
              <p className="font-semibold text-orange-600">
                {format(expectedCents)}
              </p>
            </div>
          </div>

          {/* Movements list */}
          <div>
            <h3 className="text-sm font-semibold mb-2">Movements</h3>
            <MovementsList movements={movements} />
          </div>

          {/* Record movement inline form */}
          <div className="rounded-lg border bg-muted/30 p-4 space-y-4">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <PlusCircle className="h-4 w-4 text-orange-500" />
              Record Movement
            </h3>
            <form onSubmit={handleAddMovement} className="space-y-4">
              {/* Movement type radio */}
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Type</Label>
                <RadioGroup
                  value={movType}
                  onValueChange={setMovType}
                  className="grid grid-cols-2 sm:grid-cols-4 gap-2"
                >
                  {MOVEMENT_TYPES.map((t) => (
                    <div key={t.value} className="flex items-center gap-2">
                      <RadioGroupItem id={`mt-${t.value}`} value={t.value} />
                      <Label
                        htmlFor={`mt-${t.value}`}
                        className="cursor-pointer text-sm font-normal"
                      >
                        {t.label}
                      </Label>
                    </div>
                  ))}
                </RadioGroup>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Amount */}
                <div className="space-y-1">
                  <Label htmlFor="mov-amount" className="text-xs text-muted-foreground">
                    Amount ({symbol}) {sign < 0 && '— outflow'}
                  </Label>
                  <Input
                    id="mov-amount"
                    type="number"
                    min="0"
                    // One minor unit. A fixed 0.01 makes a JPY till reject ¥1.
                    step={(1 / scale).toFixed(decimals)}
                    placeholder={(0).toFixed(decimals)}
                    value={amountMajor}
                    onChange={(e) => setAmountMajor(e.target.value)}
                    disabled={movType === 'no_sale'}
                  />
                </div>
                {/* Reason */}
                <div className="space-y-1">
                  <Label htmlFor="mov-reason" className="text-xs text-muted-foreground">
                    Reason
                  </Label>
                  <Input
                    id="mov-reason"
                    placeholder="Optional description"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </div>
              </div>

              {movError && <p className="text-sm text-destructive">{movError}</p>}

              <Button
                type="submit"
                size="sm"
                disabled={movLoading}
                className="bg-orange-500 hover:bg-orange-600 text-white"
              >
                {movLoading && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
                Add Movement
              </Button>
            </form>
          </div>
        </CardContent>
      </Card>

      <CloseSessionModal
        open={closeOpen}
        onOpenChange={setCloseOpen}
        session={session}
        staffId={staffId}
        expectedCents={expectedCents}
        onClosed={onSessionClosed}
      />
    </>
  );
}
