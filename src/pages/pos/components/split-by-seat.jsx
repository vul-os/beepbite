// split-by-seat.jsx — Split a dine-in check by seat.
//
// Flow:
//   1. Open for a table-bound ticket that has at least one sent order.
//   2. All order-items across every sent order are listed.
//   3. Cashier assigns items to seat buckets (Seat 1, 2, …) by toggling them.
//      Partial quantity splits are supported via a qty-per-seat input.
//   4. "Apply Split" POSTs to /sessions/{id}/split-check which records
//      check_splits + check_split_items in the DB.
//   5. Each resulting split is shown with its own subtotal and a "Tender" button
//      that opens TenderModal pre-loaded with just that split's amount.
//
// Props:
//   open           {bool}
//   onOpenChange   {(bool) => void}
//   ticket         {Ticket}        — the active table ticket
//   onChargeSplit  {(splitId, legs) => Promise<void>}
//                                  — called when a split is tendered;
//                                    parent records order_payments rows
//   staffId        {string?}
/* eslint-disable react/prop-types */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Loader2,
  Plus,
  Receipt,
  Scissors,
  UserRound,
  Wallet,
  X,
} from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { splitCheck } from '@/services/tables';
import TenderModal from './tender-modal';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const fmt = (cents) => `R ${(Math.abs(cents) / 100).toFixed(2)}`;

/** Build a flat list of order-items from all sent orders on the ticket. */
function buildItemList(ticket) {
  if (!ticket) return [];
  const rows = [];
  for (const order of ticket.sentOrders || []) {
    for (const item of order.items || []) {
      rows.push({
        key: `${order.id}::${item.order_item_id}`,
        orderId: order.id,
        orderItemId: item.order_item_id,
        name: item.item_name || item.name || 'Item',
        quantity: item.quantity || 1,
        unitCents: item.total_cents
          ? Math.round(item.total_cents / (item.quantity || 1))
          : Math.round((parseFloat(item.unit_price || 0)) * 100),
        totalCents: item.total_cents
          || Math.round((parseFloat(item.unit_price || 0) * (item.quantity || 1)) * 100),
      });
    }
  }
  return rows;
}

/** Compute the total cents allocated to a given seat from the assignments map. */
function seatTotalCents(seatId, assignments, allItems) {
  let total = 0;
  for (const item of allItems) {
    const qty = assignments[item.key]?.[seatId] || 0;
    total += qty * item.unitCents;
  }
  return total;
}

// ---------------------------------------------------------------------------
// Sub-component: seat column header
// ---------------------------------------------------------------------------

function SeatHeader({ seat, onRemove, canRemove }) {
  return (
    <div className="flex items-center gap-1 min-w-0">
      <UserRound className="w-3.5 h-3.5 text-orange-500 shrink-0" />
      <span className="text-xs font-semibold truncate">{seat.label}</span>
      {canRemove && (
        <button
          type="button"
          onClick={() => onRemove(seat.id)}
          className="text-gray-400 hover:text-red-500 ml-auto shrink-0"
          aria-label={`Remove ${seat.label}`}
        >
          <X className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

let _seatCounter = 0;
const nextSeatId = () => `seat-${++_seatCounter}`;

export default function SplitBySeat({
  open,
  onOpenChange,
  ticket,
  onChargeSplit,
  staffId,
}) {
  // ------ Local state -------------------------------------------------------
  const [seats, setSeats] = useState([]);
  const [assignments, setAssignments] = useState({});  // {itemKey: {seatId: qty}}
  const [applying, setApplying] = useState(false);
  const [appliedSplits, setAppliedSplits] = useState(null); // SplitCheckResult | null
  const [error, setError] = useState('');

  // Tender sub-modal state — which split is being tendered
  const [tenderingSplit, setTenderingSplit] = useState(null); // { splitId, amountCents, label }
  const [tenderBusy, setTenderBusy] = useState(false);
  const [tenderError, setTenderError] = useState('');
  const [paidSplits, setPaidSplits] = useState(new Set());

  // ------ Derived -----------------------------------------------------------
  const allItems = useMemo(() => buildItemList(ticket), [ticket]);

  // Reset when modal opens
  useEffect(() => {
    if (open) {
      _seatCounter = 0;
      const initial = [
        { id: nextSeatId(), label: 'Seat 1' },
        { id: nextSeatId(), label: 'Seat 2' },
      ];
      setSeats(initial);
      setAssignments({});
      setApplying(false);
      setAppliedSplits(null);
      setError('');
      setTenderingSplit(null);
      setTenderError('');
      setPaidSplits(new Set());
    }
  }, [open]);

  // ------ Seat management ---------------------------------------------------

  const handleAddSeat = () => {
    const n = seats.length + 1;
    setSeats((prev) => [...prev, { id: nextSeatId(), label: `Seat ${n}` }]);
  };

  const handleRemoveSeat = (seatId) => {
    setSeats((prev) => prev.filter((s) => s.id !== seatId));
    // Clear assignments for removed seat
    setAssignments((prev) => {
      const next = {};
      for (const [itemKey, seatMap] of Object.entries(prev)) {
        const { [seatId]: _, ...rest } = seatMap;
        if (Object.keys(rest).length > 0) next[itemKey] = rest;
      }
      return next;
    });
  };

  const handleRenameSeat = (seatId, label) => {
    setSeats((prev) => prev.map((s) => s.id === seatId ? { ...s, label } : s));
  };

  // ------ Assignment --------------------------------------------------------

  const handleAssign = useCallback((itemKey, seatId, qty) => {
    const q = Math.max(0, Math.min(parseInt(qty, 10) || 0, allItems.find((i) => i.key === itemKey)?.quantity || 0));
    setAssignments((prev) => {
      const seatMap = { ...(prev[itemKey] || {}) };
      if (q === 0) {
        delete seatMap[seatId];
      } else {
        seatMap[seatId] = q;
      }
      return { ...prev, [itemKey]: seatMap };
    });
  }, [allItems]);

  const handleToggleAssign = useCallback((itemKey, seatId) => {
    const item = allItems.find((i) => i.key === itemKey);
    if (!item) return;
    const current = assignments[itemKey]?.[seatId] || 0;
    if (current > 0) {
      handleAssign(itemKey, seatId, 0);
    } else {
      // Assign all remaining unallocated qty to this seat
      const allocated = Object.values(assignments[itemKey] || {}).reduce((s, v) => s + v, 0);
      const remaining = item.quantity - allocated;
      handleAssign(itemKey, seatId, Math.max(1, remaining));
    }
  }, [allItems, assignments, handleAssign]);

  // ------ Validation --------------------------------------------------------

  const unallocatedItems = useMemo(() => {
    return allItems.filter((item) => {
      const allocated = Object.values(assignments[item.key] || {}).reduce((s, v) => s + v, 0);
      return allocated < item.quantity;
    });
  }, [allItems, assignments]);

  const canApply = unallocatedItems.length === 0 && allItems.length > 0 && seats.length > 0;

  // ------ Apply split -------------------------------------------------------

  const handleApply = async () => {
    if (!canApply || !ticket?.sessionId) return;
    setApplying(true);
    setError('');
    try {
      // Build splits payload: one split per seat that has items
      const splitsPayload = seats
        .map((seat) => {
          const items = allItems
            .filter((item) => (assignments[item.key]?.[seat.id] || 0) > 0)
            .map((item) => ({
              order_item_id: item.orderItemId,
              quantity: assignments[item.key][seat.id],
            }));
          return { label: seat.label, items };
        })
        .filter((sp) => sp.items.length > 0);

      const result = await splitCheck(ticket.sessionId, splitsPayload, staffId);
      setAppliedSplits(result);
    } catch (err) {
      console.error('Split check failed:', err);
      setError(err.message || 'Failed to split check');
    } finally {
      setApplying(false);
    }
  };

  // ------ Tender per split --------------------------------------------------

  const handleTenderSplit = (split) => {
    // Calculate the split's subtotal from assignments
    const seat = seats.find((s) => s.label === split.split_label);
    const amountCents = seat ? seatTotalCents(seat.id, assignments, allItems) : 0;
    setTenderingSplit({ splitId: split.id, label: split.split_label, amountCents });
    setTenderError('');
  };

  const handleTenderConfirm = async (legs) => {
    if (!tenderingSplit || !onChargeSplit) return;
    setTenderBusy(true);
    setTenderError('');
    try {
      await onChargeSplit(tenderingSplit.splitId, legs);
      setPaidSplits((prev) => new Set([...prev, tenderingSplit.splitId]));
      setTenderingSplit(null);
    } catch (err) {
      console.error('Split tender failed:', err);
      setTenderError(err.message || 'Payment failed');
    } finally {
      setTenderBusy(false);
    }
  };

  // ------ Render ------------------------------------------------------------

  if (!ticket) return null;

  const allSplitsPaid = appliedSplits
    && appliedSplits.splits.length > 0
    && appliedSplits.splits.every((sp) => paidSplits.has(sp.id));

  return (
    <>
      <Dialog open={open && !tenderingSplit} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl w-full p-0 overflow-hidden max-h-[90vh] flex flex-col">
          <DialogHeader className="px-6 pt-5 pb-3 border-b shrink-0">
            <DialogTitle className="flex items-center gap-2 text-lg">
              <Scissors className="w-5 h-5 text-orange-500" />
              Split Check by Seat
              {ticket.table_number && (
                <span className="ml-1 text-sm font-normal text-gray-500">
                  — Table {ticket.table_number}
                </span>
              )}
            </DialogTitle>
            <DialogDescription className="sr-only">
              Assign order items to seats then tender each seat's total independently.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
            {/* Seat management */}
            {!appliedSplits && (
              <>
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-gray-700">Seats</h3>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleAddSeat}
                    className="h-7 px-2 text-xs border-orange-200 text-orange-700 hover:bg-orange-50"
                  >
                    <Plus className="w-3 h-3 mr-1" /> Add Seat
                  </Button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {seats.map((seat) => (
                    <div key={seat.id} className="flex items-center gap-1.5">
                      <Input
                        value={seat.label}
                        onChange={(e) => handleRenameSeat(seat.id, e.target.value)}
                        className="h-8 w-28 text-xs"
                      />
                      {seats.length > 1 && (
                        <button
                          type="button"
                          onClick={() => handleRemoveSeat(seat.id)}
                          className="text-gray-400 hover:text-red-500"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                {/* Item assignment grid */}
                <div className="overflow-x-auto border rounded-lg">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b bg-orange-50/60">
                        <th className="text-left px-3 py-2 font-semibold text-gray-600 w-40">Item</th>
                        <th className="text-center px-2 py-2 font-semibold text-gray-600 w-12">Qty</th>
                        {seats.map((seat) => (
                          <th key={seat.id} className="text-center px-2 py-2 font-semibold text-orange-700 min-w-[72px]">
                            <SeatHeader
                              seat={seat}
                              onRemove={handleRemoveSeat}
                              canRemove={seats.length > 1}
                            />
                          </th>
                        ))}
                        <th className="text-center px-2 py-2 font-semibold text-gray-400 w-14">Left</th>
                      </tr>
                    </thead>
                    <tbody>
                      {allItems.map((item) => {
                        const allocated = Object.values(assignments[item.key] || {}).reduce((s, v) => s + v, 0);
                        const unallocated = item.quantity - allocated;
                        return (
                          <tr key={item.key} className={cn('border-b last:border-0', unallocated > 0 && 'bg-red-50/30')}>
                            <td className="px-3 py-2">
                              <span className="font-medium text-gray-900 line-clamp-1">{item.name}</span>
                              <span className="text-gray-400 ml-1">({fmt(item.unitCents)}/ea)</span>
                            </td>
                            <td className="px-2 py-2 text-center font-semibold">{item.quantity}</td>
                            {seats.map((seat) => {
                              const qty = assignments[item.key]?.[seat.id] || 0;
                              return (
                                <td key={seat.id} className="px-2 py-2 text-center">
                                  {item.quantity === 1 ? (
                                    // Single-quantity item: toggle button
                                    <button
                                      type="button"
                                      onClick={() => handleToggleAssign(item.key, seat.id)}
                                      className={cn(
                                        'w-8 h-8 rounded-full border-2 transition flex items-center justify-center mx-auto',
                                        qty > 0
                                          ? 'bg-orange-500 border-orange-500 text-white'
                                          : 'border-gray-200 text-gray-300 hover:border-orange-300',
                                      )}
                                    >
                                      {qty > 0 ? <CheckCircle2 className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                                    </button>
                                  ) : (
                                    // Multi-quantity: numeric input
                                    <input
                                      type="number"
                                      min={0}
                                      max={item.quantity}
                                      value={qty || ''}
                                      placeholder="0"
                                      onChange={(e) => handleAssign(item.key, seat.id, e.target.value)}
                                      className={cn(
                                        'w-14 h-8 text-center text-xs rounded border focus:outline-none focus:border-orange-400 tabular-nums',
                                        qty > 0 ? 'border-orange-300 bg-orange-50' : 'border-gray-200',
                                      )}
                                    />
                                  )}
                                </td>
                              );
                            })}
                            <td className={cn('px-2 py-2 text-center font-semibold tabular-nums', unallocated > 0 ? 'text-red-500' : 'text-green-600')}>
                              {unallocated}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t bg-gray-50">
                        <td className="px-3 py-2 font-semibold text-xs text-gray-600" colSpan={2}>Subtotal</td>
                        {seats.map((seat) => (
                          <td key={seat.id} className="px-2 py-2 text-center font-bold tabular-nums text-xs text-orange-700">
                            {fmt(seatTotalCents(seat.id, assignments, allItems))}
                          </td>
                        ))}
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>

                {unallocatedItems.length > 0 && (
                  <p className="text-xs text-red-600">
                    {unallocatedItems.length} item(s) not fully assigned — allocate all quantities before splitting.
                  </p>
                )}
                {error && (
                  <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}
              </>
            )}

            {/* Applied splits — tender view */}
            {appliedSplits && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-green-700 bg-green-50 rounded-lg px-3 py-2 border border-green-200">
                  <CheckCircle2 className="w-4 h-4" />
                  Check split applied — tender each seat below.
                </div>
                {appliedSplits.splits.map((split) => {
                  const seat = seats.find((s) => s.label === split.split_label);
                  const amountCents = seat ? seatTotalCents(seat.id, assignments, allItems) : 0;
                  const isPaid = paidSplits.has(split.id);
                  return (
                    <div
                      key={split.id}
                      className={cn(
                        'flex items-center justify-between p-3 rounded-lg border',
                        isPaid ? 'bg-green-50 border-green-200' : 'bg-white border-orange-100',
                      )}
                    >
                      <div>
                        <div className="flex items-center gap-1.5">
                          <UserRound className="w-4 h-4 text-orange-500" />
                          <span className="font-semibold text-sm">{split.split_label}</span>
                          {isPaid && <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />}
                        </div>
                        <span className="text-xs text-gray-500">
                          {(appliedSplits.items.filter((i) => i.check_split_id === split.id)).length} item(s)
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="font-bold tabular-nums text-base">{fmt(amountCents)}</span>
                        {!isPaid ? (
                          <Button
                            size="sm"
                            onClick={() => handleTenderSplit(split)}
                            className="bg-orange-500 hover:bg-orange-600 text-white h-8 px-3"
                          >
                            <Wallet className="w-3.5 h-3.5 mr-1" />
                            Tender
                          </Button>
                        ) : (
                          <span className="text-xs font-semibold text-green-700 px-3">Paid</span>
                        )}
                      </div>
                    </div>
                  );
                })}
                {allSplitsPaid && (
                  <div className="text-center pt-2">
                    <p className="text-sm text-green-700 font-semibold">All seats paid — table cleared.</p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-2"
                      onClick={() => onOpenChange(false)}
                    >
                      Close
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer — only shown before split is applied */}
          {!appliedSplits && (
            <div className="px-6 pb-5 pt-2 border-t flex gap-2 shrink-0">
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                onClick={handleApply}
                disabled={!canApply || applying}
                className={cn(
                  'flex-1 bg-orange-500 hover:bg-orange-600 text-white',
                  'disabled:bg-orange-200 disabled:text-orange-400',
                )}
              >
                {applying ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                    Applying…
                  </>
                ) : (
                  <>
                    <Receipt className="w-4 h-4 mr-1" />
                    Apply Split
                  </>
                )}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Per-seat tender modal */}
      <TenderModal
        open={Boolean(tenderingSplit)}
        onOpenChange={(o) => { if (!o) setTenderingSplit(null); }}
        totalCents={tenderingSplit?.amountCents || 0}
        submitting={tenderBusy}
        errorMessage={tenderError}
        onConfirm={handleTenderConfirm}
      />
    </>
  );
}
