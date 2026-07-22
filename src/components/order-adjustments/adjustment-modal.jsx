/**
 * AdjustmentModal
 *
 * A two-step manager-approval modal that wraps void / comp / price-override /
 * refund flows.
 *
 * Props
 * -----
 * open              boolean           - Controls Dialog visibility.
 * onClose           () => void        - Called when the modal should close.
 * orderId           string            - Required for all types.
 * itemId            string | null     - Required for 'comp' and 'price_override'.
 * type              'void'|'comp'|'price_override'|'refund'
 * currentPriceCents number | null     - Optional hint shown for price_override.
 * onSuccess         (data) => void    - Called after the backend confirms success.
 * locationId        string            - Used to scope reason and manager lists.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { api } from '@/lib/api-client';
import { useMoney } from '@/context/locale-context';
import { useAdjustmentReasons } from './use-adjustment-reasons';

// ---- helpers ----------------------------------------------------------------

const STORAGE_KEY = 'bb.auth';

function readStaffId() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Prefer a dedicated staff_id field; fall back to user.id.
    return parsed?.staff_id || parsed?.user?.id || null;
  } catch {
    return null;
  }
}

const TYPE_LABELS = {
  void: 'Void Order',
  comp: 'Comp Item',
  price_override: 'Price Override',
  refund: 'Refund Order',
};

function buildEndpoint(type, orderId, itemId) {
  switch (type) {
    case 'void':
      return `/orders/${orderId}/void`;
    case 'refund':
      return `/orders/${orderId}/refund`;
    case 'comp':
      return `/orders/${orderId}/items/${itemId}/comp`;
    case 'price_override':
      return `/orders/${orderId}/items/${itemId}/price-override`;
    default:
      throw new Error(`Unknown adjustment type: ${type}`);
  }
}

// ---- component --------------------------------------------------------------

const STEP_REASON = 'reason';
const STEP_PIN = 'pin';

export default function AdjustmentModal({
  open,
  onClose,
  orderId,
  itemId = null,
  type,
  currentPriceCents = null,
  onSuccess,
  locationId,
}) {
  const { toast } = useToast();
  const { format: formatMoneyValue, symbol } = useMoney();

  // Step state
  const [step, setStep] = useState(STEP_REASON);

  // Step 1 fields
  const [reasonCode, setReasonCode] = useState('');
  const [newPriceDollars, setNewPriceDollars] = useState('');

  // Step 2 fields
  const [approverStaffId, setApproverStaffId] = useState('');
  const [approverPin, setApproverPin] = useState('');
  const [appliedByStaffId, setAppliedByStaffId] = useState('');

  // Async state
  const [managers, setManagers] = useState([]);
  const [loadingManagers, setLoadingManagers] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [pinError, setPinError] = useState('');

  // Reasons hook
  const { reasons, loading: loadingReasons } = useAdjustmentReasons(locationId);

  // Reset all local state whenever the modal opens.
  useEffect(() => {
    if (open) {
      setStep(STEP_REASON);
      setReasonCode('');
      setNewPriceDollars(
        currentPriceCents != null
          ? (currentPriceCents / 100).toFixed(2)
          : ''
      );
      setApproverStaffId('');
      setApproverPin('');
      setPinError('');
      setAppliedByStaffId(readStaffId() || '');
    }
  }, [open, currentPriceCents]);

  // Load managers when the modal opens (once per open).
  const fetchManagers = useCallback(async () => {
    if (!locationId) return;
    setLoadingManagers(true);
    const { data, error } = await api.request(
      'GET',
      `/staff?role=manager,owner&location_id=${encodeURIComponent(locationId)}`
    );
    setLoadingManagers(false);
    if (!error && Array.isArray(data)) {
      setManagers(data);
    }
  }, [locationId]);

  useEffect(() => {
    if (open) fetchManagers();
  }, [open, fetchManagers]);

  // ---- Step 1: advance to PIN step ----------------------------------------

  function handleReasonNext() {
    if (!reasonCode) return;
    if (type === 'price_override') {
      const parsed = parseFloat(newPriceDollars);
      if (isNaN(parsed) || parsed < 0) return;
    }
    setStep(STEP_PIN);
  }

  // ---- Step 2: submit -------------------------------------------------------

  async function handleSubmit() {
    if (!approverStaffId || !approverPin) return;

    setPinError('');
    setSubmitting(true);

    const body = {
      reason_code: reasonCode,
      applied_by_staff_id: appliedByStaffId,
      approver_staff_id: approverStaffId,
      approver_pin: approverPin,
    };

    if (type === 'price_override') {
      const parsed = parseFloat(newPriceDollars);
      body.new_price_cents = Math.round(parsed * 100);
    }

    const endpoint = buildEndpoint(type, orderId, itemId);
    const { data, error } = await api.request('POST', endpoint, { body });
    setSubmitting(false);

    if (error) {
      if (error.status === 401) {
        // Bad PIN — stay on step 2, show inline error, clear PIN field.
        setApproverPin('');
        setPinError(error.message || 'Incorrect PIN. Please try again.');
        return;
      }
      if (error.status === 409) {
        toast({
          variant: 'destructive',
          title: 'Cannot complete adjustment',
          description: error.message || 'This order has already been adjusted.',
        });
        onClose();
        return;
      }
      // Any other error
      toast({
        variant: 'destructive',
        title: 'Adjustment failed',
        description: error.message || 'An unexpected error occurred.',
      });
      return;
    }

    // Success
    toast({
      title: `${TYPE_LABELS[type]} applied`,
      description: 'The adjustment was recorded successfully.',
    });
    if (onSuccess) onSuccess(data);
    onClose();
  }

  // ---- render ---------------------------------------------------------------

  const title = TYPE_LABELS[type] || 'Order Adjustment';
  const isPriceOverride = type === 'price_override';
  const needsItemId = type === 'comp' || type === 'price_override';

  const step1Invalid =
    !reasonCode || (isPriceOverride && (newPriceDollars === '' || parseFloat(newPriceDollars) < 0));

  const step2Invalid = !approverStaffId || approverPin.length < 4;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {step === STEP_REASON
              ? 'Select a reason for this adjustment.'
              : 'Enter manager credentials to authorise this adjustment.'}
          </DialogDescription>
        </DialogHeader>

        {/* ---- Step 1: reason ---- */}
        {step === STEP_REASON && (
          <div className="grid gap-4 py-2">
            {needsItemId && !itemId && (
              <p className="text-sm text-destructive">
                No item selected. This adjustment requires an item ID.
              </p>
            )}

            <div className="grid gap-1.5">
              <Label htmlFor="adj-reason">Reason</Label>
              <Select
                value={reasonCode}
                onValueChange={setReasonCode}
                disabled={loadingReasons}
              >
                <SelectTrigger id="adj-reason">
                  <SelectValue
                    placeholder={loadingReasons ? 'Loading...' : 'Select a reason'}
                  />
                </SelectTrigger>
                <SelectContent>
                  {reasons.map((r) => (
                    <SelectItem key={r.code ?? r.id} value={r.code ?? r.id}>
                      {r.label ?? r.name ?? r.code ?? r.id}
                    </SelectItem>
                  ))}
                  {!loadingReasons && reasons.length === 0 && (
                    <SelectItem value="other" disabled={false}>
                      Other
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>

            {isPriceOverride && (
              <div className="grid gap-1.5">
                <Label htmlFor="adj-new-price">
                  New Price ({symbol})
                  {currentPriceCents != null && (
                    <span className="ml-1 font-normal text-muted-foreground">
                      — current: {formatMoneyValue(currentPriceCents)}
                    </span>
                  )}
                </Label>
                <Input
                  id="adj-new-price"
                  type="number"
                  min="0"
                  step="0.01"
                  value={newPriceDollars}
                  onChange={(e) => setNewPriceDollars(e.target.value)}
                  placeholder="0.00"
                />
              </div>
            )}
          </div>
        )}

        {/* ---- Step 2: manager PIN ---- */}
        {step === STEP_PIN && (
          <div className="grid gap-4 py-2">
            {/* applied_by override (shown only when session staff ID is missing) */}
            {!readStaffId() && (
              <div className="grid gap-1.5">
                <Label htmlFor="adj-applied-by">Your Staff ID</Label>
                <Input
                  id="adj-applied-by"
                  value={appliedByStaffId}
                  onChange={(e) => setAppliedByStaffId(e.target.value)}
                  placeholder="Enter your staff ID"
                />
              </div>
            )}

            <div className="grid gap-1.5">
              <Label htmlFor="adj-approver">Approving Manager</Label>
              <Select
                value={approverStaffId}
                onValueChange={setApproverStaffId}
                disabled={loadingManagers}
              >
                <SelectTrigger id="adj-approver">
                  <SelectValue
                    placeholder={loadingManagers ? 'Loading managers...' : 'Select manager'}
                  />
                </SelectTrigger>
                <SelectContent>
                  {managers.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name ?? m.full_name ?? m.email ?? m.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="adj-pin">Manager PIN</Label>
              <Input
                id="adj-pin"
                type="password"
                inputMode="numeric"
                maxLength={6}
                value={approverPin}
                onChange={(e) => {
                  const v = e.target.value.replace(/\D/g, '');
                  setApproverPin(v);
                  if (pinError) setPinError('');
                }}
                placeholder="4 to 6 digits"
                autoComplete="off"
              />
              {pinError && (
                <p className="text-sm text-destructive">{pinError}</p>
              )}
            </div>
          </div>
        )}

        {/* ---- footer ---- */}
        <DialogFooter className="gap-2">
          {step === STEP_REASON ? (
            <>
              <Button variant="outline" onClick={onClose} disabled={submitting}>
                Cancel
              </Button>
              <Button
                onClick={handleReasonNext}
                disabled={step1Invalid}
              >
                Next
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={() => { setStep(STEP_REASON); setPinError(''); }}
                disabled={submitting}
              >
                Back
              </Button>
              {/* Void and refund are irreversible money actions — the final
                  authorise button must look and read differently from a
                  routine comp/price-override, not share one generic
                  "Confirm" regardless of what it does. */}
              <Button
                variant={type === 'void' || type === 'refund' ? 'destructive' : 'default'}
                onClick={handleSubmit}
                disabled={step2Invalid || submitting}
              >
                {submitting ? 'Submitting…' : `Authorise ${TYPE_LABELS[type] || 'adjustment'}`}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
