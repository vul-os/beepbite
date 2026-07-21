// adjustment-menu.jsx
//
// Inline adjustment context menu for sent ticket lines.
//
// Usage — wraps either a SentItemRow (comp/discount) or a SentOrderGroup
// header (void):
//
//   <AdjustmentMenu
//     orderId={order.id}
//     itemId={item.order_item_id}   // null for order-level void
//     currentPriceCents={item.total_cents}
//     locationId={locationId}
//     onSuccess={() => ...}
//   >
//     {/* the row content */}
//   </AdjustmentMenu>
//
// Desktop: right-click opens the menu.
// Touch  : long-press (500 ms) opens the menu.
//
// Capability gating:
//   Void    → can_void    (order-level, itemId must be null)
//   Comp    → can_comp    (item-level, itemId required)
//   Discount → can_comp   (item-level price-override, itemId required)
//
// Manager approval:
//   If the selected reason has requires_manager_approval=true, step 2 shows a
//   manager-select + PIN entry form.  On submit the raw approver_staff_id and
//   approver_pin are sent to the backend which does its own bcrypt check.
//   (The usePinModal session-auth hook is for actor re-auth, not this flow.)

/* eslint-disable react/prop-types */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { Ban, ChevronRight, Gift, Loader2, Tag, X } from 'lucide-react';

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useMoney } from '@/context/locale-context';
import { api } from '@/lib/api-client';
import { hasCapability, getStaff } from '@/services/pos';
import { useAdjustmentReasons } from '@/components/order-adjustments/use-adjustment-reasons';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LONG_PRESS_MS = 500;

// Which types are supported at each level
const ORDER_TYPES = ['void'];
const ITEM_TYPES  = ['comp', 'price_override'];

const TYPE_META = {
  void: {
    label: 'Void Order',
    short: 'Void',
    icon: Ban,
    colorClass: 'text-red-700 bg-red-50 hover:bg-red-100 border-red-200',
    capability: 'can_void',
  },
  comp: {
    label: 'Comp Item',
    short: 'Comp',
    icon: Gift,
    colorClass: 'text-purple-700 bg-purple-50 hover:bg-purple-100 border-purple-200',
    capability: 'can_comp',
  },
  price_override: {
    label: 'Discount',
    short: 'Discount',
    icon: Tag,
    colorClass: 'text-amber-700 bg-amber-50 hover:bg-amber-100 border-amber-200',
    capability: 'can_comp',
  },
};

// ---------------------------------------------------------------------------
// Build the correct backend endpoint
// ---------------------------------------------------------------------------

function buildEndpoint(type, orderId, itemId) {
  switch (type) {
    case 'void':
      return `/orders/${orderId}/void`;
    case 'comp':
      return `/orders/${orderId}/items/${itemId}/comp`;
    case 'price_override':
      return `/orders/${orderId}/items/${itemId}/price-override`;
    default:
      throw new Error(`Unknown adjustment type: ${type}`);
  }
}

// ---------------------------------------------------------------------------
// Inner flow — shown inside the PopoverContent
// ---------------------------------------------------------------------------

const STEP_PICK   = 'pick';    // choose action + reason
const STEP_MANAGER = 'manager'; // manager credentials (if required)

function AdjustmentFlow({
  orderId,
  itemId,
  currentPriceCents,
  locationId,
  onSuccess,
  onClose,
}) {
  const { toast } = useToast();
  const { format, parse, symbol, scale, decimals } = useMoney();

  const [step, setStep]           = useState(STEP_PICK);
  const [adjType, setAdjType]     = useState(null);
  const [reasonCode, setReasonCode] = useState('');
  const [reasonObj, setReasonObj]   = useState(null);
  // Held as a major-unit string because that is what the <input type="number">
  // carries; it is converted back through the currency, never through 100.
  const [newPriceMajor, setNewPriceMajor] = useState(
    currentPriceCents != null ? (currentPriceCents / scale).toFixed(decimals) : '',
  );

  // Manager step
  const [managers, setManagers]         = useState([]);
  const [loadingManagers, setLoadingManagers] = useState(false);
  const [approverStaffId, setApproverStaffId] = useState('');
  const [approverPin, setApproverPin]     = useState('');
  const [pinError, setPinError]           = useState('');

  const [submitting, setSubmitting] = useState(false);

  const currentStaff = getStaff();

  // Fetch reasons
  const { reasons, loading: loadingReasons } = useAdjustmentReasons(locationId);

  // Derive which types are available to this actor at this level
  const availableTypes = (itemId ? ITEM_TYPES : ORDER_TYPES).filter(
    (t) => hasCapability(TYPE_META[t].capability),
  );

  // Fetch managers when we know we'll need them (on step change or when reasons loaded)
  const fetchManagers = useCallback(async () => {
    if (!locationId) return;
    setLoadingManagers(true);
    const { data, error } = await api.request(
      'GET',
      `/staff?role=manager,owner&location_id=${encodeURIComponent(locationId)}`,
    );
    setLoadingManagers(false);
    if (!error && Array.isArray(data)) setManagers(data);
  }, [locationId]);

  useEffect(() => {
    if (step === STEP_MANAGER && managers.length === 0) {
      fetchManagers();
    }
  }, [step, managers.length, fetchManagers]);

  // ---- step 1 helpers -------------------------------------------------------

  function handleTypeSelect(type) {
    setAdjType(type);
    setReasonCode('');
    setReasonObj(null);
  }

  function handleReasonChange(code) {
    const r = reasons.find((x) => (x.code ?? x.id) === code);
    setReasonCode(code);
    setReasonObj(r ?? null);
  }

  function handleNext() {
    if (!adjType || !reasonCode) return;
    if (adjType === 'price_override') {
      const p = parse(newPriceMajor);
      if (p == null || p < 0) return;
    }
    if (reasonObj?.requires_manager_approval) {
      setStep(STEP_MANAGER);
    } else {
      handleSubmit();
    }
  }

  // ---- submission -----------------------------------------------------------

  async function handleSubmit(managerOverride = false) {
    setSubmitting(true);
    setPinError('');

    const body = {
      reason_code: reasonCode,
      applied_by_staff_id: currentStaff?.id || '',
      approver_staff_id: managerOverride ? approverStaffId : (currentStaff?.id || ''),
      approver_pin: managerOverride ? approverPin : '',
    };

    if (adjType === 'price_override') {
      body.new_price_cents = parse(newPriceMajor) ?? 0;
    }

    let endpoint;
    try {
      endpoint = buildEndpoint(adjType, orderId, itemId);
    } catch (err) {
      toast({ variant: 'destructive', title: 'Error', description: err.message });
      setSubmitting(false);
      return;
    }

    const { data, error } = await api.request('POST', endpoint, { body });
    setSubmitting(false);

    if (error) {
      if (error.status === 401 && managerOverride) {
        setApproverPin('');
        setPinError(error.message || 'Incorrect PIN. Try again.');
        return;
      }
      if (error.status === 409) {
        toast({
          variant: 'destructive',
          title: 'Cannot adjust',
          description: error.message || 'This order has already been adjusted.',
        });
        onClose();
        return;
      }
      toast({
        variant: 'destructive',
        title: 'Adjustment failed',
        description: error.message || 'Unexpected error.',
      });
      return;
    }

    toast({ title: `${TYPE_META[adjType]?.label ?? 'Adjustment'} applied` });
    if (onSuccess) onSuccess(data);
    onClose();
  }

  // ---- derived validity -----------------------------------------------------

  const step1Valid =
    adjType &&
    reasonCode &&
    (adjType !== 'price_override' || (newPriceMajor !== '' && (parse(newPriceMajor) ?? -1) >= 0));

  const step2Valid = approverStaffId && approverPin.length >= 4;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (availableTypes.length === 0) {
    return (
      <p className="text-xs text-gray-500 px-1">No adjustment permissions.</p>
    );
  }

  return (
    <div className="space-y-3 w-64">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold uppercase tracking-wide text-gray-500">
          {step === STEP_PICK ? 'Adjust line' : 'Manager approval'}
        </p>
        <button
          type="button"
          onClick={onClose}
          className="p-0.5 rounded text-gray-400 hover:text-gray-600 transition"
          aria-label="Close"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* ---- Step 1: pick action + reason ---- */}
      {step === STEP_PICK && (
        <>
          {/* Action selector */}
          <div className="flex gap-1.5 flex-wrap">
            {availableTypes.map((t) => {
              const meta = TYPE_META[t];
              const Icon = meta.icon;
              const active = adjType === t;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => handleTypeSelect(t)}
                  className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded border text-[11px] font-semibold transition ${meta.colorClass} ${active ? 'ring-2 ring-offset-1 ring-orange-400' : ''}`}
                >
                  <Icon className="w-3 h-3" />
                  {meta.short}
                </button>
              );
            })}
          </div>

          {adjType && (
            <>
              {/* Reason picker */}
              <div className="space-y-1">
                <Label className="text-[11px] font-semibold text-gray-600">
                  Reason
                </Label>
                <Select
                  value={reasonCode}
                  onValueChange={handleReasonChange}
                  disabled={loadingReasons}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue
                      placeholder={loadingReasons ? 'Loading…' : 'Select reason'}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {reasons.map((r) => (
                      <SelectItem
                        key={r.code ?? r.id}
                        value={r.code ?? r.id}
                        className="text-xs"
                      >
                        {r.label ?? r.name ?? r.code ?? r.id}
                        {r.requires_manager_approval && (
                          <span className="ml-1 text-[10px] text-amber-600 font-medium">
                            (mgr)
                          </span>
                        )}
                      </SelectItem>
                    ))}
                    {!loadingReasons && reasons.length === 0 && (
                      <SelectItem value="other">Other</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>

              {/* New price input for discount */}
              {adjType === 'price_override' && (
                <div className="space-y-1">
                  <Label className="text-[11px] font-semibold text-gray-600">
                    New price ({symbol})
                    {currentPriceCents != null && (
                      <span className="ml-1 font-normal text-gray-400">
                        — current: {format(currentPriceCents)}
                      </span>
                    )}
                  </Label>
                  <Input
                    type="number"
                    min="0"
                    step={String(1 / scale)}
                    value={newPriceMajor}
                    onChange={(e) => setNewPriceMajor(e.target.value)}
                    className="h-8 text-xs"
                    placeholder="0.00"
                  />
                </div>
              )}

              {reasonObj?.requires_manager_approval && (
                <p className="text-[10px] text-amber-600 font-medium">
                  Manager approval required for this reason.
                </p>
              )}

              <Button
                size="sm"
                onClick={handleNext}
                disabled={!step1Valid || submitting}
                className="w-full h-8 text-xs bg-orange-500 hover:bg-orange-600 text-white font-semibold"
              >
                {submitting ? (
                  <Loader2 className="w-3 h-3 animate-spin mr-1" />
                ) : (
                  <>
                    {reasonObj?.requires_manager_approval ? (
                      <>Next <ChevronRight className="w-3 h-3 ml-0.5" /></>
                    ) : (
                      'Apply'
                    )}
                  </>
                )}
              </Button>
            </>
          )}
        </>
      )}

      {/* ---- Step 2: manager PIN ---- */}
      {step === STEP_MANAGER && (
        <>
          <div className="space-y-1">
            <Label className="text-[11px] font-semibold text-gray-600">
              Approving manager
            </Label>
            <Select
              value={approverStaffId}
              onValueChange={setApproverStaffId}
              disabled={loadingManagers}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue
                  placeholder={loadingManagers ? 'Loading…' : 'Select manager'}
                />
              </SelectTrigger>
              <SelectContent>
                {managers.map((m) => (
                  <SelectItem key={m.id} value={m.id} className="text-xs">
                    {m.name ?? m.full_name ?? m.display_name ?? m.email ?? m.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-[11px] font-semibold text-gray-600">
              Manager PIN
            </Label>
            <Input
              type="password"
              inputMode="numeric"
              maxLength={6}
              value={approverPin}
              onChange={(e) => {
                const v = e.target.value.replace(/\D/g, '');
                setApproverPin(v);
                if (pinError) setPinError('');
              }}
              placeholder="4–6 digits"
              autoComplete="off"
              className="h-8 text-xs"
            />
            {pinError && (
              <p className="text-[11px] text-red-600">{pinError}</p>
            )}
          </div>

          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setStep(STEP_PICK); setPinError(''); }}
              disabled={submitting}
              className="flex-1 h-8 text-xs"
            >
              Back
            </Button>
            <Button
              size="sm"
              onClick={() => handleSubmit(true)}
              disabled={!step2Valid || submitting}
              className="flex-1 h-8 text-xs bg-orange-500 hover:bg-orange-600 text-white font-semibold"
            >
              {submitting ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Authorise'}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Public component — adds context-menu trigger to children
// ---------------------------------------------------------------------------

/**
 * AdjustmentMenu
 *
 * Wraps any children.  Right-click (desktop) or long-press (touch) opens an
 * inline Popover with the adjustment flow.
 *
 * Props:
 *   orderId           string          — required
 *   itemId            string | null   — null → order-level (Void only)
 *                                       non-null → item-level (Comp / Discount)
 *   currentPriceCents number | null   — optional hint for price_override
 *   locationId        string          — scopes reason list + manager list
 *   onSuccess         (data) => void  — called after successful adjustment
 *   disabled          boolean         — skip context menu entirely
 *   children          ReactNode
 */
export default function AdjustmentMenu({
  orderId,
  itemId = null,
  currentPriceCents = null,
  locationId = '',
  onSuccess,
  disabled = false,
  children,
}) {
  const [open, setOpen] = useState(false);

  // Long-press support
  const longPressTimer = useRef(null);
  const touchMoved     = useRef(false);

  const openMenu  = useCallback(() => { if (!disabled) setOpen(true); }, [disabled]);
  const closeMenu = useCallback(() => setOpen(false), []);

  function handleContextMenu(e) {
    e.preventDefault();
    openMenu();
  }

  function handleTouchStart() {
    touchMoved.current = false;
    longPressTimer.current = window.setTimeout(() => {
      if (!touchMoved.current) openMenu();
    }, LONG_PRESS_MS);
  }

  function handleTouchMove() {
    touchMoved.current = true;
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
  }

  function handleTouchEnd() {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
  }

  // No visible capabilities → render children as-is, no context wrapper
  const hasAny = (itemId ? ITEM_TYPES : ORDER_TYPES).some(
    (t) => hasCapability(TYPE_META[t].capability),
  );

  if (!hasAny || disabled) return <>{children}</>;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div
          onContextMenu={handleContextMenu}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          className="select-none"
          role="presentation"
        >
          {children}
        </div>
      </PopoverTrigger>
      <PopoverContent
        className="p-3 w-auto"
        align="start"
        side="right"
        sideOffset={6}
        onInteractOutside={closeMenu}
      >
        <AdjustmentFlow
          orderId={orderId}
          itemId={itemId}
          currentPriceCents={currentPriceCents}
          locationId={locationId}
          onSuccess={onSuccess}
          onClose={closeMenu}
        />
      </PopoverContent>
    </Popover>
  );
}
