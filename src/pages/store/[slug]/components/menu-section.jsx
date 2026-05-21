import React, { useState } from 'react';
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
      <div className="text-center py-10 text-muted-foreground text-sm">
        Menu not available yet.
      </div>
    );
  }

  return (
    <div>
      {/* Category tabs — scrollable on mobile */}
      {categories.length > 1 && (
        <Tabs value={activeTab} onValueChange={setActiveTab} className="mb-4">
          <TabsList className="flex overflow-x-auto whitespace-nowrap scrollbar-hide gap-1 h-auto p-1 bg-muted rounded-lg w-full justify-start">
            {categories.map((cat) => (
              <TabsTrigger
                key={cat}
                value={cat}
                className="text-xs sm:text-sm px-3 py-1.5 rounded-md data-[state=active]:bg-orange-500 data-[state=active]:text-white shrink-0"
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
      <div className="space-y-3">
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
              className={`flex gap-3 rounded-lg border p-3 bg-card ${effectivelyUnavailable ? 'opacity-50' : ''}`}
            >
              {/* Image */}
              {item.image_url && (
                <div className="shrink-0 w-16 h-16 sm:w-20 sm:h-20 rounded-md overflow-hidden bg-muted">
                  <img
                    src={item.image_url}
                    alt={item.name}
                    className="w-full h-full object-cover"
                  />
                </div>
              )}

              {/* Info */}
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium text-sm leading-tight line-clamp-2">
                    {item.name}
                  </p>
                  <span className="text-sm font-semibold text-orange-600 shrink-0">
                    {formatPrice(Number(item.price ?? 0) * 100, currency)}
                  </span>
                </div>
                {item.description && (
                  <p className="text-xs text-muted-foreground line-clamp-2">
                    {item.description}
                  </p>
                )}
                <div className="flex flex-wrap gap-1">
                  {unavailable && (
                    <Badge variant="secondary" className="text-xs">
                      Unavailable
                    </Badge>
                  )}
                  <CountdownBadge remaining={remaining} />
                </div>
              </div>

              {/* Qty controls */}
              {!effectivelyUnavailable && (
                <div className="flex items-center gap-1 shrink-0 self-end">
                  {qty > 0 ? (
                    <>
                      <Button
                        size="icon"
                        variant="outline"
                        className="h-7 w-7 border-orange-300"
                        onClick={() => onRemoveItem(item)}
                      >
                        <Minus className="h-3 w-3" />
                      </Button>
                      <span className="w-5 text-center text-sm font-semibold">
                        {qty}
                      </span>
                      <Button
                        size="icon"
                        className="h-7 w-7 bg-orange-500 hover:bg-orange-600"
                        onClick={() => onAddItem(item)}
                      >
                        <Plus className="h-3 w-3" />
                      </Button>
                    </>
                  ) : (
                    <Button
                      size="icon"
                      className="h-7 w-7 bg-orange-500 hover:bg-orange-600"
                      onClick={() => onAddItem(item)}
                    >
                      <Plus className="h-3 w-3" />
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
