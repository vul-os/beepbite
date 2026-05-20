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

          return (
            <div
              key={item.id}
              className={`flex gap-3 rounded-lg border p-3 bg-card ${unavailable ? 'opacity-50' : ''}`}
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
                {unavailable && (
                  <Badge variant="secondary" className="text-xs">
                    Unavailable
                  </Badge>
                )}
              </div>

              {/* Qty controls */}
              {!unavailable && (
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
