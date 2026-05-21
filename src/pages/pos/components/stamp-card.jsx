// stamp-card.jsx — customer-facing punch-card widget for the POS.
//
// Props:
//   customerId  {string}   — UUID of the customer whose stamps to display
//   onReward    {Function} — called with no args when a reward is just earned
//                            (so the POS can prompt the cashier to issue the
//                             free item / apply a coupon)
//   className   {string}   — extra Tailwind classes forwarded to the root div
//
// Behaviour:
//   • On mount, fetches the customer's stamp count via GET /customers/:id/stamps.
//   • "Add stamp" button fires POST /customers/:id/stamps/accrue and re-renders.
//   • When reward_earned === true, shows a celebratory overlay and calls onReward.
//   • Stamps are shown as a grid of circles: filled (orange) for earned stamps,
//     empty (grey ring) for stamps still needed.

import React, { useCallback, useEffect, useState } from 'react';
import { Stamp, Gift, Loader2, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';

import { Button } from '@/components/ui/button';
import { getCustomerStamps, accrueStamp } from '@/services/loyalty-stamps';

// ---------------------------------------------------------------------------

function StampDot({ filled }) {
  return (
    <div
      className={cn(
        'flex h-8 w-8 items-center justify-center rounded-full border-2 transition-all duration-300',
        filled
          ? 'border-orange-500 bg-orange-500 shadow-md shadow-orange-200'
          : 'border-gray-300 bg-white',
      )}
    >
      {filled && <Stamp className="h-4 w-4 text-white" />}
    </div>
  );
}

// ---------------------------------------------------------------------------

export default function StampCard({ customerId, onReward, className }) {
  const [stamps,       setStamps]       = useState(null);   // CustomerStamps object
  const [loading,      setLoading]      = useState(true);
  const [accruing,     setAccruing]     = useState(false);
  const [rewardEarned, setRewardEarned] = useState(false);
  const [error,        setError]        = useState(null);

  // Fetch stamp state.
  const load = useCallback(async () => {
    if (!customerId) return;
    setLoading(true);
    setError(null);
    const { data, error: err } = await getCustomerStamps(customerId);
    setLoading(false);
    if (err) {
      setError(err.message ?? 'Failed to load stamps');
    } else {
      setStamps(data);
    }
  }, [customerId]);

  useEffect(() => { load(); }, [load]);

  // Clear the celebratory overlay after 3 seconds.
  useEffect(() => {
    if (!rewardEarned) return;
    const id = setTimeout(() => setRewardEarned(false), 3000);
    return () => clearTimeout(id);
  }, [rewardEarned]);

  // Add stamp handler.
  async function handleAccrue() {
    if (!customerId || accruing) return;
    setAccruing(true);
    setError(null);
    const { data, error: err } = await accrueStamp(customerId, 1);
    setAccruing(false);
    if (err) {
      setError(err.message ?? 'Failed to add stamp');
      return;
    }
    setStamps(data);
    if (data?.reward_earned) {
      setRewardEarned(true);
      onReward?.();
    }
  }

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  if (loading) {
    return (
      <div className={cn('flex items-center gap-2 py-4 text-muted-foreground', className)}>
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">Loading stamps…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className={cn('space-y-2', className)}>
        <p className="text-sm text-destructive">{error}</p>
        <Button size="sm" variant="outline" onClick={load} className="gap-1">
          <RefreshCw className="h-3 w-3" /> Retry
        </Button>
      </div>
    );
  }

  if (!stamps) return null;

  const { stamps: filled, stamps_required: total, stamps_until_free: remaining } = stamps;

  // Build an array of booleans: index < filled → true.
  const dots = Array.from({ length: total }, (_, i) => i < filled);

  // ---------------------------------------------------------------------------
  // Celebratory reward overlay
  // ---------------------------------------------------------------------------

  if (rewardEarned) {
    return (
      <div
        className={cn(
          'flex flex-col items-center gap-3 rounded-xl border-2 border-orange-400',
          'bg-orange-50 px-6 py-8 text-center animate-in fade-in zoom-in duration-300',
          className,
        )}
      >
        <Gift className="h-12 w-12 text-orange-500" />
        <p className="text-lg font-bold text-orange-700">Reward earned!</p>
        <p className="text-sm text-orange-600">
          This customer has collected all {total} stamps — issue their free item.
        </p>
        <p className="text-xs text-orange-400">Stamp counter has been reset.</p>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Normal punch-card view
  // ---------------------------------------------------------------------------

  return (
    <div
      className={cn(
        'space-y-4 rounded-xl border bg-white p-4 shadow-sm',
        className,
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Stamp className="h-5 w-5 text-orange-500" />
          <span className="font-semibold text-gray-800">Stamp card</span>
        </div>
        <span className="text-xs text-muted-foreground">
          {filled} / {total}
        </span>
      </div>

      {/* Stamp grid */}
      <div className="flex flex-wrap gap-2">
        {dots.map((isFilled, idx) => (
          <StampDot key={idx} filled={isFilled} />
        ))}
      </div>

      {/* Progress message */}
      <p className="text-sm text-gray-500">
        {remaining === 0
          ? 'All stamps collected — reward due!'
          : `${remaining} more stamp${remaining !== 1 ? 's' : ''} until a free item`}
      </p>

      {/* Action */}
      <Button
        size="sm"
        onClick={handleAccrue}
        disabled={accruing}
        className="w-full gap-2 bg-orange-500 hover:bg-orange-600 text-white"
      >
        {accruing
          ? <><Loader2 className="h-4 w-4 animate-spin" />Adding stamp…</>
          : <><Stamp className="h-4 w-4" />Add stamp</>}
      </Button>
    </div>
  );
}
