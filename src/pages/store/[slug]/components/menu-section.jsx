import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Plus, Minus } from 'lucide-react';
import { formatPrice } from '@/lib/currency';

/**
 * MenuSection — displays categorised menu items with add-to-cart controls.
 *
 * Props:
 *   menu: Array<{ id, name, items: Array<{ id, name, price, description, image_url, is_available }> }>
 *   onAddItem: (item) => void
 *   onRemoveItem: (item) => void
 *   cartItems: Array<{ id, quantity }>
 *   currency: string  ISO 4217 code from the store (default 'USD')
 */
export default function MenuSection({ menu = [], onAddItem, onRemoveItem, cartItems = [], currency = 'USD' }) {
  const cartMap = new Map(cartItems.map((ci) => [ci.id, ci.quantity ?? 0]));

  const allItems = menu.flatMap((cat) =>
    (cat.items || []).map((item) => ({ ...item, category: cat.name }))
  );

  /**
   * Render the daily-countdown pill for an item.
   * remaining_today === null  → unlimited, show nothing.
   * remaining_today === 0     → sold out today (red).
   * remaining_today > 0       → "N left today" (amber/orange).
   */
  function CountdownBadge({ remaining }) {
    if (remaining === null || remaining === undefined) return null;
    if (remaining === 0) {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-100 text-red-700 border border-red-200">
          Sold out today
        </span>
      );
    }
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-700 border border-amber-200">
        {remaining} left today
      </span>
    );
  }

  const categories = menu.map((cat) => cat.name).filter(Boolean);
  const [activeTab, setActiveTab] = useState(categories[0] || 'all');

  const visibleItems =
    activeTab === 'all' || categories.length === 0
      ? allItems
      : (menu.find((c) => c.name === activeTab)?.items || []).map((item) => ({
          ...item,
          category: activeTab,
        }));

  if (menu.length === 0) {
    return (
      <div className="flex flex-col items-center text-center py-14 gap-3">
        <span className="text-4xl" role="img" aria-label="Menu">📋</span>
        <p className="text-sm font-medium text-foreground">Menu not available yet</p>
        <p className="text-xs text-muted-foreground">Check back soon — this restaurant is still setting up.</p>
      </div>
    );
  }

  return (
    <div>
      {/* Category tabs — scrollable on mobile */}
      {categories.length > 1 && (
        <Tabs value={activeTab} onValueChange={setActiveTab} className="mb-5">
          <TabsList className="flex overflow-x-auto whitespace-nowrap scrollbar-hide gap-1 h-auto p-1 bg-muted/60 rounded-xl w-full justify-start">
            {categories.map((cat) => (
              <TabsTrigger
                key={cat}
                value={cat}
                className="text-xs sm:text-sm px-3 py-1.5 rounded-lg data-[state=active]:bg-orange-500 data-[state=active]:text-white shrink-0 transition-colors"
              >
                {cat}
              </TabsTrigger>
            ))}
          </TabsList>

          {categories.map((cat) => (
            <TabsContent key={cat} value={cat} />
          ))}
        </Tabs>
      )}

      {/* Items list */}
      <div className="space-y-3" role="list" aria-label="Menu items">
        {visibleItems.map((item) => {
          const qty = cartMap.get(item.id) || 0;
          const unavailable = item.is_available === false;
          // remaining_today: null = unlimited, 0 = sold out, N = N left
          const remaining = item.remaining_today ?? null;
          const soldOutToday = remaining !== null && remaining === 0;
          const effectivelyUnavailable = unavailable || soldOutToday;

          return (
            <div
              key={item.id}
              role="listitem"
              className={`flex gap-3 rounded-2xl border border-border/60 p-3 sm:p-4 bg-card shadow-sm transition-shadow hover:shadow-md ${
                effectivelyUnavailable ? 'opacity-50' : ''
              }`}
            >
              {/* Image */}
              {item.image_url && (
                <div className="shrink-0 w-20 h-20 sm:w-24 sm:h-24 rounded-xl overflow-hidden bg-muted">
                  <img
                    src={item.image_url}
                    alt={item.name}
                    loading="lazy"
                    className="w-full h-full object-cover"
                  />
                </div>
              )}

              {/* Info */}
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-semibold text-sm leading-snug line-clamp-2">
                    {item.name}
                  </p>
                  <span className="text-sm font-bold text-orange-600 shrink-0 tabular-nums">
                    {formatPrice(Number(item.price ?? 0) * 100, currency)}
                  </span>
                </div>
                {item.description && (
                  <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                    {item.description}
                  </p>
                )}
                <div className="flex flex-wrap gap-1 pt-0.5">
                  {unavailable && (
                    <Badge variant="secondary" className="text-xs">
                      Unavailable
                    </Badge>
                  )}
                  <CountdownBadge remaining={remaining} />
                </div>
              </div>

              {/* Qty controls — aligned to the bottom-right of the card */}
              {!effectivelyUnavailable && (
                <div className="flex flex-col justify-end items-end shrink-0">
                  {qty > 0 ? (
                    <div className="flex items-center gap-1 bg-muted/60 rounded-xl p-0.5">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 hover:bg-orange-100 hover:text-orange-600"
                        onClick={() => onRemoveItem(item)}
                        aria-label={`Remove one ${item.name}`}
                      >
                        <Minus className="h-3 w-3" />
                      </Button>
                      <span className="w-5 text-center text-sm font-bold tabular-nums">
                        {qty}
                      </span>
                      <Button
                        size="icon"
                        className="h-7 w-7 bg-orange-500 hover:bg-orange-600 shadow-sm"
                        onClick={() => onAddItem(item)}
                        aria-label={`Add one more ${item.name}`}
                      >
                        <Plus className="h-3 w-3" />
                      </Button>
                    </div>
                  ) : (
                    <Button
                      size="icon"
                      className="h-8 w-8 bg-orange-500 hover:bg-orange-600 rounded-xl shadow-sm"
                      onClick={() => onAddItem(item)}
                      aria-label={`Add ${item.name} to cart`}
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
