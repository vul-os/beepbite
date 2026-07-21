import { useEffect, useMemo, useState } from 'react';
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
import { Card, CardContent } from '@/components/ui/card';
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  RotateCcw,
  Search,
  ShieldCheck,
  Minus,
  Plus,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api-client';
import { applyOrderAdjustment, getStaff } from '@/services/pos';
import { useMoney } from '@/context/locale-context';

const REASONS = [
  { value: 'refund', label: 'Refund' },
  { value: 'void', label: 'Void' },
  { value: 'comp', label: 'Comp' },
  { value: 'manager_discount', label: 'Manager Discount' },
];

/**
 * ReturnModal — manager-PIN gated order adjustment.
 *
 * Flow:
 *   1. Cashier looks up the order by order number (or it's passed in directly).
 *   2. Selects items + quantities to return and chooses a reason.
 *   3. Manager enters their PIN at the bottom.
 *   4. We call POST /orders/{order_id}/{void|refund|comp} with the manager PIN.
 *
 * Note: the backend currently exposes per-type endpoints
 * (void, refund, comp, price-override) instead of a generic POST /adjustments.
 * The applyOrderAdjustment() helper in services/pos.js handles the routing.
 *
 * TODO: when the canonical POST /adjustments endpoint lands (with per-item
 * quantity support), swap applyOrderAdjustment to send `{ order_id, items, reason, manager_pin }`
 * in one call. Right now whole-order void/refund are supported; comp is per-item.
 *
 * Props:
 *   open              boolean
 *   onOpenChange      (open: boolean) => void
 *   locationId        string
 *   initialOrder?     { id, order_number } — optional preselected order
 *   onSuccess?        (result) => void
 */
export default function ReturnModal({
  open,
  onOpenChange,
  locationId,
  initialOrder = null,
  onSuccess,
}) {
  // Line totals arrive as major-unit floats; `scale` is 1 in JPY, 1000 in KWD.
  const { format, scale } = useMoney();

  // ---- order lookup state ----
  const [orderQuery, setOrderQuery] = useState('');
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState('');
  const [order, setOrder] = useState(initialOrder);
  const [orderItems, setOrderItems] = useState([]);

  // ---- return state ----
  const [returnQty, setReturnQty] = useState({}); // { order_item_id: qty }
  const [reason, setReason] = useState('refund');

  // ---- manager PIN state ----
  const [managerPin, setManagerPin] = useState('');
  const [managers, setManagers] = useState([]);
  const [managersLoading, setManagersLoading] = useState(false);
  const [approverStaffId, setApproverStaffId] = useState('');

  // ---- submission ----
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [success, setSuccess] = useState(false);

  // Reset when reopened.
  useEffect(() => {
    if (!open) return;
    setOrderQuery(initialOrder?.order_number || '');
    setOrder(initialOrder);
    setLookupError('');
    setReturnQty({});
    setReason('refund');
    setManagerPin('');
    setApproverStaffId('');
    setSubmitError('');
    setSuccess(false);
  }, [open, initialOrder]);

  // Fetch managers for the location.
  useEffect(() => {
    if (!open || !locationId) return;
    let cancelled = false;
    setManagersLoading(true);
    api
      .request('GET', `/staff?role=manager,owner&location_id=${encodeURIComponent(locationId)}`)
      .then(({ data }) => {
        if (cancelled) return;
        setManagers(Array.isArray(data) ? data : []);
      })
      .catch(() => !cancelled && setManagers([]))
      .finally(() => !cancelled && setManagersLoading(false));
    return () => { cancelled = true; };
  }, [open, locationId]);

  // Fetch order items once we have an order.
  useEffect(() => {
    if (!order?.id) {
      setOrderItems([]);
      return;
    }
    let cancelled = false;
    api
      .request(
        'GET',
        `/data/order_items?eq=order_id,${encodeURIComponent(order.id)}`,
      )
      .then(({ data }) => {
        if (cancelled) return;
        setOrderItems(Array.isArray(data) ? data : []);
      })
      .catch(() => !cancelled && setOrderItems([]));
    return () => { cancelled = true; };
  }, [order?.id]);

  const handleLookup = async () => {
    setLookupError('');
    if (!orderQuery.trim()) {
      setLookupError('Enter an order number');
      return;
    }
    setLookupLoading(true);
    try {
      const { data, error } = await api.request(
        'GET',
        `/data/orders?eq=order_number,${encodeURIComponent(orderQuery.trim())}&eq=location_id,${encodeURIComponent(locationId)}&limit=1`,
      );
      if (error) throw new Error(error.message || 'Order lookup failed');
      const rows = Array.isArray(data) ? data : data ? [data] : [];
      if (rows.length === 0) {
        setLookupError('Order not found');
        setOrder(null);
        return;
      }
      setOrder(rows[0]);
    } catch (err) {
      setLookupError(err.message || 'Order lookup failed');
      setOrder(null);
    } finally {
      setLookupLoading(false);
    }
  };

  const updateQty = (itemId, qty) => {
    setReturnQty((prev) => ({ ...prev, [itemId]: Math.max(0, qty) }));
  };

  const totalReturnQty = useMemo(
    () => Object.values(returnQty).reduce((sum, q) => sum + (q || 0), 0),
    [returnQty],
  );

  const canSubmit =
    order &&
    reason &&
    approverStaffId &&
    managerPin.length >= 4 &&
    (reason === 'void' || reason === 'refund' || totalReturnQty > 0);

  const handleSubmit = async () => {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setSubmitError('');
    try {
      const staff = getStaff();
      // For comp we must pass a specific item id. Pick the first selected item.
      let itemId;
      if (reason === 'comp') {
        const entry = Object.entries(returnQty).find(([, q]) => q > 0);
        itemId = entry?.[0];
      }
      const result = await applyOrderAdjustment({
        orderId: order.id,
        reason,
        appliedByStaffId: staff?.id || '',
        approverStaffId,
        approverPin: managerPin,
        itemId,
      });
      setSuccess(true);
      onSuccess?.(result);
      // Auto-close after a moment so the cashier sees confirmation.
      setTimeout(() => onOpenChange(false), 1200);
    } catch (err) {
      if (err.status === 401) {
        setSubmitError(err.message || 'Manager PIN incorrect');
        setManagerPin('');
      } else if (err.status === 403) {
        setSubmitError('That user is not a manager.');
      } else if (err.status === 409) {
        setSubmitError(err.message || 'This order has already been adjusted.');
      } else {
        setSubmitError(err.message || 'Adjustment failed');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <RotateCcw className="w-5 h-5 text-orange-500" />
            Process Return
          </DialogTitle>
          <DialogDescription>
            Return or void items on an existing order. Requires a manager PIN.
          </DialogDescription>
        </DialogHeader>

        {/* ---- Order lookup ---- */}
        {!initialOrder && (
          <div className="space-y-1.5">
            <Label htmlFor="ret-order">Order number</Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="ret-order"
                  className="pl-9"
                  placeholder="e.g. 1042"
                  value={orderQuery}
                  onChange={(e) => setOrderQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleLookup()}
                />
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={handleLookup}
                disabled={lookupLoading}
              >
                {lookupLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Find'}
              </Button>
            </div>
            {lookupError && (
              <p className="text-xs text-destructive">{lookupError}</p>
            )}
          </div>
        )}

        {/* ---- Order summary + items ---- */}
        {order && (
          <Card className="border-orange-200">
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Order</p>
                  <p className="font-semibold text-foreground">#{order.order_number}</p>
                </div>
                {order.status && (
                  <span className="text-xs px-2 py-1 rounded-full bg-orange-50 text-orange-700 border border-orange-200">
                    {order.status}
                  </span>
                )}
              </div>

              {orderItems.length === 0 ? (
                <p className="text-sm text-muted-foreground">No line items loaded.</p>
              ) : (
                <div className="divide-y border rounded-md">
                  {orderItems.map((oi) => {
                    const qty = returnQty[oi.id] || 0;
                    return (
                      <div key={oi.id} className="flex items-center gap-3 px-3 py-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">
                            {oi.item_name || oi.name || `Item ${oi.id?.slice(0, 6)}`}
                          </p>
                          <p className="text-xs text-muted-foreground tabular-nums">
                            Qty {oi.quantity} · {format(Math.round(parseFloat(oi.total_price || 0) * scale))}
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => updateQty(oi.id, qty - 1)}
                            className="h-7 w-7 p-0 rounded-full border-orange-200"
                            aria-label="Decrease return quantity"
                          >
                            <Minus className="w-3 h-3" />
                          </Button>
                          <span className="w-8 text-center text-sm font-medium tabular-nums">
                            {qty}
                          </span>
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => updateQty(oi.id, qty + 1)}
                            className="h-7 w-7 p-0 rounded-full bg-orange-500 hover:bg-orange-600"
                            aria-label="Increase return quantity"
                          >
                            <Plus className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* ---- Reason ---- */}
        <div className="space-y-1.5">
          <Label htmlFor="ret-reason">Reason</Label>
          <select
            id="ret-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            {REASONS.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
          {reason === 'void' && (
            <p className="text-xs text-muted-foreground">
              Void cancels the entire order (no items selected required).
            </p>
          )}
          {reason === 'refund' && (
            <p className="text-xs text-muted-foreground">
              Refunds reverse a completed payment for the whole order.
            </p>
          )}
        </div>

        {/* ---- Manager PIN ---- */}
        <div
          className={cn(
            'rounded-lg border bg-gradient-to-r from-amber-50 to-orange-50 border-orange-200 p-4 space-y-3',
          )}
        >
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <ShieldCheck className="w-4 h-4 text-orange-500" />
            Manager Authorization Required
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ret-mgr">Approving manager</Label>
              <select
                id="ret-mgr"
                value={approverStaffId}
                onChange={(e) => setApproverStaffId(e.target.value)}
                disabled={managersLoading}
                className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">
                  {managersLoading ? 'Loading…' : 'Select manager'}
                </option>
                {managers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.first_name || m.name || m.full_name || m.email || m.id}
                    {m.last_name ? ` ${m.last_name}` : ''}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ret-pin">Manager PIN</Label>
              <Input
                id="ret-pin"
                type="password"
                inputMode="numeric"
                maxLength={6}
                placeholder="4–6 digits"
                value={managerPin}
                onChange={(e) => {
                  setManagerPin(e.target.value.replace(/\D/g, ''));
                  if (submitError) setSubmitError('');
                }}
                autoComplete="off"
              />
            </div>
          </div>
        </div>

        {submitError && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{submitError}</AlertDescription>
          </Alert>
        )}
        {success && (
          <Alert className="bg-green-50 border-green-200 text-green-800">
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            <AlertDescription>Adjustment applied successfully.</AlertDescription>
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
            disabled={!canSubmit || submitting || success}
            className="bg-orange-500 hover:bg-orange-600 text-white min-w-[160px]"
          >
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Submitting…
              </>
            ) : (
              <>
                <ShieldCheck className="w-4 h-4 mr-2" />
                Process Return
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
