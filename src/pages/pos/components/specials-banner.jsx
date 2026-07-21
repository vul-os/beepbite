// specials-banner.jsx — pinned horizontal banner of today's daily specials.
//
// Given a locationId, fetches GET /specials and renders a horizontally-
// scrollable row of special item cards. The banner hides itself when there
// are no specials for the day.
//
// Props:
//   locationId  {string}    Required. UUID of the POS location.
//   onSelect    {function}  Called with a special item when a card is tapped.
//                           Payload shape:
//                             {
//                               id:                  string,
//                               name:                string,
//                               location_id:         string,
//                               price_cents:         number,
//                               special_price_cents: number | null,
//                               image_url:           string | null,
//                             }
//   currency    {string}    ISO 4217 code for price formatting (default 'USD').
//   className   {string}    Optional additional wrapper class.

/* eslint-disable react/prop-types */
import { useEffect, useState, useCallback } from 'react';
import { Star, ChevronRight } from 'lucide-react';

import { cn } from '@/lib/utils';
import { formatPrice } from '@/lib/currency';
import { fetchSpecials } from '@/services/specials';

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/**
 * A single special item card. Shows the item image (or a placeholder),
 * its name, and the pricing line (struck-through base price + special price
 * when a promotional price is set, or just the base price otherwise).
 */
function SpecialCard({ special, onSelect, currency }) {
  const hasDiscount =
    special.special_price_cents != null &&
    special.special_price_cents < special.price_cents;

  return (
    <button
      type="button"
      onClick={() => onSelect?.(special)}
      className={cn(
        'flex-shrink-0 w-32 rounded-xl border border-orange-200 bg-white',
        'shadow-sm hover:shadow-md hover:border-orange-400 active:scale-95',
        'transition-all duration-150 overflow-hidden text-left',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500',
      )}
    >
      {/* Image or placeholder */}
      <div className="relative h-20 bg-orange-50">
        {special.image_url ? (
          <img
            src={special.image_url}
            alt={special.name}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Star className="h-8 w-8 text-orange-300" />
          </div>
        )}
        {hasDiscount && (
          <span className="absolute top-1 right-1 rounded-full bg-orange-500 px-1.5 py-0.5 text-[10px] font-bold text-white leading-none">
            DEAL
          </span>
        )}
      </div>

      {/* Details */}
      <div className="p-2">
        <p className="text-xs font-semibold text-gray-800 line-clamp-2 leading-tight">
          {special.name}
        </p>
        <div className="mt-1">
          {hasDiscount ? (
            <>
              <span className="block text-[11px] text-orange-600 font-bold">
                {formatPrice(special.special_price_cents, currency)}
              </span>
              <span className="block text-[10px] text-gray-400 line-through">
                {formatPrice(special.price_cents, currency)}
              </span>
            </>
          ) : (
            <span className="block text-[11px] text-gray-700 font-medium">
              {formatPrice(special.price_cents, currency)}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

/**
 * SpecialsBanner — pinned Today's Specials banner for the POS workspace.
 *
 * Fetches specials on mount (and when locationId changes). Renders nothing
 * when the fetch succeeds but returns an empty list.
 */
export function SpecialsBanner({ locationId, onSelect, currency = 'USD', className }) {
  const [specials, setSpecials] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!locationId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchSpecials(locationId);
      setSpecials(data);
    } catch (err) {
      setError(err.message || 'Failed to load specials');
    } finally {
      setLoading(false);
    }
  }, [locationId]);

  useEffect(() => {
    load();
  }, [load]);

  // Hide entirely when not loading and there are no specials (or no locationId).
  if (!locationId) return null;
  if (!loading && !error && specials.length === 0) return null;

  return (
    <div
      className={cn(
        'w-full rounded-xl border border-orange-300 bg-orange-50 px-4 py-3',
        className,
      )}
      aria-label="Today's Specials"
    >
      {/* Header */}
      <div className="mb-2 flex items-center gap-2">
        <Star className="h-4 w-4 fill-orange-500 text-orange-500" />
        <span className="text-sm font-bold text-orange-700 uppercase tracking-wide">
          Today&apos;s Specials
        </span>
        {!loading && specials.length > 0 && (
          <span className="ml-auto flex items-center text-xs text-orange-500">
            {specials.length} item{specials.length !== 1 ? 's' : ''}
            <ChevronRight className="h-3 w-3" />
          </span>
        )}
      </div>

      {/* Content */}
      {loading ? (
        /* Loading skeletons */
        <div className="flex gap-3 overflow-x-auto pb-1">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="flex-shrink-0 w-32 h-36 rounded-xl bg-orange-100 animate-pulse"
            />
          ))}
        </div>
      ) : error ? (
        <p className="text-xs text-orange-600">{error}</p>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-1 snap-x snap-mandatory">
          {specials.map((sp) => (
            <div key={sp.id} className="snap-start">
              <SpecialCard
                special={sp}
                onSelect={onSelect}
                currency={currency}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default SpecialsBanner;
