import React, { useState } from 'react';
import { Search, X, Utensils, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatPrice } from '@/lib/currency';

/**
 * Compute remaining_today from raw daily countdown columns.
 * Returns null when daily_quantity is null/undefined (unlimited).
 */
function computeRemainingToday(item) {
  if (item.daily_quantity == null) return null;
  const todayStr = new Date().toISOString().slice(0, 10);
  const soldToday =
    item.daily_counter_date === todayStr
      ? (item.daily_sold_count ?? 0)
      : 0;
  return Math.max(item.daily_quantity - soldToday, 0);
}

/**
 * Pill badge for daily countdown on a kiosk item card.
 */
function KioskCountdownPill({ remaining }) {
  if (remaining === null || remaining === undefined) return null;
  if (remaining === 0) {
    return (
      <span className="absolute top-2 left-2 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-500 text-white leading-none shadow">
        Sold out
      </span>
    );
  }
  return (
    <span className="absolute top-2 left-2 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500 text-white leading-none shadow">
      {remaining} left
    </span>
  );
}

// Emoji lookup — reuse the same table as pos-section.jsx
const ITEM_EMOJI_KEYWORDS = [
  { match: /burger|patty|cheeseburger/i, emoji: '🍔' },
  { match: /pizza/i, emoji: '🍕' },
  { match: /fries|chips/i, emoji: '🍟' },
  { match: /onion ring/i, emoji: '🧅' },
  { match: /sweet potato/i, emoji: '🍠' },
  { match: /chicken|wing|nugget/i, emoji: '🍗' },
  { match: /salad|veggie|lettuce/i, emoji: '🥗' },
  { match: /hot dog|sausage/i, emoji: '🌭' },
  { match: /taco/i, emoji: '🌮' },
  { match: /burrito|wrap/i, emoji: '🌯' },
  { match: /sushi|roll/i, emoji: '🍣' },
  { match: /noodle|ramen|pasta/i, emoji: '🍜' },
  { match: /rice/i, emoji: '🍚' },
  { match: /coke|cola|pepsi|soda|sprite|fanta/i, emoji: '🥤' },
  { match: /water/i, emoji: '💧' },
  { match: /coffee|espresso|latte|cappuccino/i, emoji: '☕' },
  { match: /tea/i, emoji: '🍵' },
  { match: /beer|lager|stout/i, emoji: '🍺' },
  { match: /wine/i, emoji: '🍷' },
  { match: /juice/i, emoji: '🧃' },
  { match: /milkshake|shake/i, emoji: '🥛' },
  { match: /ice cream|gelato|sundae/i, emoji: '🍨' },
  { match: /brownie|cake|cupcake/i, emoji: '🍰' },
  { match: /donut|doughnut/i, emoji: '🍩' },
  { match: /cookie|biscuit/i, emoji: '🍪' },
  { match: /chocolate/i, emoji: '🍫' },
  { match: /fruit|apple/i, emoji: '🍎' },
];
const CATEGORY_EMOJI = {
  burgers: '🍔', sides: '🍟', drinks: '🥤', desserts: '🍰',
  pizza: '🍕', salads: '🥗', chicken: '🍗', breakfast: '🍳',
  seafood: '🦐', coffee: '☕', alcohol: '🍺',
};
function emojiForItem(item) {
  const name = item?.name || '';
  for (const { match, emoji } of ITEM_EMOJI_KEYWORDS) {
    if (match.test(name)) return emoji;
  }
  const cat = (item?.category?.name || '').toLowerCase().trim();
  return CATEGORY_EMOJI[cat] || '🍽️';
}

const KioskMenuGrid = ({ items, categories, loading, currency, onAddItem }) => {
  const [search, setSearch] = useState('');
  const [activeCat, setActiveCat] = useState('all');

  const filtered = items.filter(item => {
    const matchSearch = !search ||
      item.name.toLowerCase().includes(search.toLowerCase()) ||
      item.description?.toLowerCase().includes(search.toLowerCase());
    const matchCat = activeCat === 'all' || item.category_id === activeCat;
    return matchSearch && matchCat;
  });

  // Pre-compute remaining counts once per render so we don't redo it per item.
  const remainingMap = new Map(filtered.map(item => [item.id, computeRemainingToday(item)]));

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Search bar */}
      <div className="px-4 pt-4 pb-3 bg-white border-b border-orange-100 shrink-0">
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
          <input
            type="search"
            placeholder="Search items…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-11 pr-10 h-12 text-lg rounded-xl border-2 border-orange-200 focus:border-orange-400 focus:ring-0 focus:outline-none bg-white"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-1"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Category pills */}
      <div className="px-4 py-2 bg-white border-b border-orange-100 shrink-0 overflow-x-auto">
        <div className="flex gap-2 min-w-max">
          <button
            onClick={() => setActiveCat('all')}
            className={cn(
              'h-11 px-5 rounded-full text-base font-medium transition-colors whitespace-nowrap',
              activeCat === 'all'
                ? 'bg-orange-500 text-white shadow-sm'
                : 'bg-orange-50 text-gray-700 border border-orange-200 hover:bg-orange-100'
            )}
          >
            All
          </button>
          {categories.map(cat => (
            <button
              key={cat.id}
              onClick={() => setActiveCat(cat.id)}
              className={cn(
                'h-11 px-5 rounded-full text-base font-medium transition-colors whitespace-nowrap',
                activeCat === cat.id
                  ? 'bg-orange-500 text-white shadow-sm'
                  : 'bg-orange-50 text-gray-700 border border-orange-200 hover:bg-orange-100'
              )}
            >
              {cat.name}
            </button>
          ))}
        </div>
      </div>

      {/* Menu grid */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="h-44 bg-gray-100 rounded-2xl animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-gray-400">
            <Utensils className="w-16 h-16 mb-3" />
            <p className="text-xl font-medium">No items found</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {filtered.map(item => {
              const remaining = remainingMap.get(item.id);
              const soldOutToday = remaining !== null && remaining === 0;
              return (
                <button
                  key={item.id}
                  onClick={() => !soldOutToday && onAddItem(item)}
                  disabled={soldOutToday}
                  className={cn(
                    'group relative flex flex-col overflow-hidden rounded-2xl border-2 bg-white shadow-sm transition-all duration-150 text-left focus:outline-none focus:ring-2 focus:ring-orange-400',
                    soldOutToday
                      ? 'border-gray-200 opacity-60 cursor-not-allowed'
                      : 'border-gray-200 hover:border-orange-400 hover:shadow-lg active:scale-95',
                  )}
                >
                  {/* Emoji tile */}
                  <div className="relative flex items-center justify-center bg-gradient-to-br from-orange-50 via-amber-50 to-orange-100/60 h-24 sm:h-28">
                    <span className="text-5xl leading-none select-none group-hover:scale-110 transition-transform duration-200">
                      {emojiForItem(item)}
                    </span>
                    <KioskCountdownPill remaining={remaining} />
                  </div>
                  {/* Details */}
                  <div className="flex flex-col flex-1 p-3">
                    <p className="font-semibold text-gray-900 text-base line-clamp-2 leading-tight">
                      {item.name}
                    </p>
                    <div className="mt-auto pt-2 flex items-center justify-between">
                      <span className="text-lg font-bold text-gray-900 tabular-nums">
                        {formatPrice(parseFloat(item.price || 0) * 100, currency)}
                      </span>
                      {!soldOutToday && (
                        <span className="w-9 h-9 rounded-full bg-orange-500 flex items-center justify-center text-white shrink-0">
                          <Plus className="w-5 h-5" strokeWidth={2.5} />
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default KioskMenuGrid;
