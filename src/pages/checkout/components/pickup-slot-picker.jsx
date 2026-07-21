/**
 * PickupSlotPicker
 *
 * Given a locationId + date, fetches available pickup time slots from the
 * backend and renders a grid of selectable time chips.
 *
 * Props:
 *   locationId  {string}         — UUID of the location
 *   date        {string}         — "YYYY-MM-DD" — which day to show slots for
 *   selected    {string|null}    — currently selected slot ISO timestamp
 *   onSelect    {function}       — callback(slotIso: string) invoked on pick
 *
 * The component is intentionally self-contained (fetches its own data) so the
 * orchestrator only needs to render it and wire onSelect + selected state.
 *
 * Slot auth: the backend endpoint is PUBLIC — no token required.
 */

import { useEffect, useState } from 'react';
import { Clock, Loader2 } from 'lucide-react';
import { fetchPickupSlots } from '@/services/pickup-slots';

// Format an ISO timestamp to a human-readable "HH:MM" label in local time.
function formatSlotLabel(isoString) {
  try {
    const d = new Date(isoString);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  } catch {
    return isoString;
  }
}

export default function PickupSlotPicker({ locationId, date, selected, onSelect }) {
  const [slots, setSlots] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!locationId || !date) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchPickupSlots(locationId, date).then(({ data, error: fetchErr }) => {
      if (cancelled) return;
      setLoading(false);
      if (fetchErr) {
        setError(fetchErr.message || 'Failed to load time slots.');
        setSlots([]);
        return;
      }
      setSlots(Array.isArray(data) ? data : []);
    });

    return () => { cancelled = true; };
  }, [locationId, date]);

  // --- Loading state ---
  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-3">
        <Loader2 className="h-4 w-4 animate-spin text-orange-500" />
        Loading available time slots…
      </div>
    );
  }

  // --- Error state ---
  if (error) {
    return (
      <p className="text-sm text-destructive py-2">{error}</p>
    );
  }

  // --- Empty state ---
  if (slots.length === 0) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-3">
        <Clock className="h-4 w-4 text-orange-400" />
        No pickup slots available for this date.
      </div>
    );
  }

  // --- Slot grid ---
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
        Choose a pickup time
      </p>
      <div className="flex flex-wrap gap-2">
        {slots.map((slot) => {
          const isSelected = selected === slot.slot_time;
          const isFull = slot.is_full;

          return (
            <button
              key={slot.slot_time}
              type="button"
              disabled={isFull}
              onClick={() => !isFull && onSelect(slot.slot_time)}
              className={[
                'px-3 py-1.5 rounded-full text-sm font-medium border transition-colors',
                isFull
                  ? 'border-gray-200 bg-gray-50 text-gray-400 cursor-not-allowed line-through'
                  : isSelected
                    ? 'border-orange-500 bg-orange-500 text-white shadow-sm'
                    : 'border-orange-200 text-orange-700 hover:bg-orange-50 hover:border-orange-400 cursor-pointer',
              ].join(' ')}
              aria-label={
                isFull
                  ? `${formatSlotLabel(slot.slot_time)} — full`
                  : `Pick up at ${formatSlotLabel(slot.slot_time)}`
              }
              aria-pressed={isSelected}
            >
              {formatSlotLabel(slot.slot_time)}
              {isFull && (
                <span className="ml-1 text-xs text-gray-400">(full)</span>
              )}
              {!isFull && slot.capacity > 0 && slot.scheduled > 0 && (
                <span className="ml-1 text-xs opacity-60">
                  {slot.capacity - slot.scheduled} left
                </span>
              )}
            </button>
          );
        })}
      </div>

      {selected && (
        <p className="text-xs text-muted-foreground pt-1">
          Selected: <span className="font-medium text-orange-600">{formatSlotLabel(selected)}</span>
        </p>
      )}
    </div>
  );
}
