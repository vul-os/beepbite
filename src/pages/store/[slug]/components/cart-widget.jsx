import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { ShoppingCart, Trash2, Plus, Minus } from 'lucide-react';
import { formatPrice } from '@/lib/currency';

/**
 * CartWidget — sticky sidebar cart backed by localStorage (managed by parent).
 *
 * Props:
 *   slug: string
 *   items: Array<{ id, name, price, quantity }>
 *   onAdd: (item) => void
 *   onRemove: (item) => void
 *   onClear: () => void
 *   storeName: string
 *   currency: string          ISO 4217 code from the store (default 'USD')
 *   fulfillmentType: string   'delivery' | 'collection' | null
 *   deliveryAddress: string   customer's delivery address (when fulfillmentType='delivery')
 */
export default function CartWidget({ slug, items = [], onAdd, onRemove, onClear, storeName, currency = 'USD', fulfillmentType, deliveryAddress }) {
  const navigate = useNavigate();

  const subtotal = items.reduce((sum, i) => sum + Number(i.price ?? 0) * (i.quantity ?? 1), 0);
  const totalQty = items.reduce((sum, i) => sum + (i.quantity ?? 1), 0);

  const handleCheckout = () => {
    // Pass state so checkout knows which store + cart + fulfillment
    navigate('/checkout', {
      state: { slug, storeName, items, subtotal, currency, fulfillment_type: fulfillmentType, delivery_address: deliveryAddress },
    });
  };

  if (items.length === 0) {
    return (
      <Card className="border-dashed border-2 border-muted-foreground/20 shadow-none">
        <CardContent className="flex flex-col items-center justify-center py-10 text-center gap-3">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
            <ShoppingCart className="h-6 w-6 text-muted-foreground/50" aria-hidden="true" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">Your cart is empty</p>
            <p className="text-xs text-muted-foreground mt-0.5">Add items from the menu to get started</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="shadow-lg border-border/60 overflow-hidden">
      <CardHeader className="pb-2 pt-4 px-4 bg-orange-50/50">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <ShoppingCart className="h-4 w-4 text-orange-500" aria-hidden="true" />
            Your order
            <span className="ml-0.5 bg-orange-500 text-white rounded-full text-xs w-5 h-5 flex items-center justify-center font-bold">
              {totalQty}
            </span>
          </CardTitle>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
            onClick={onClear}
            title="Clear cart"
            aria-label="Clear all items from cart"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="px-4 pb-2 pt-3 space-y-2.5">
        {items.map((item) => (
          <div key={item.id} className="flex items-center gap-2.5">
            {/* Qty controls */}
            <div className="flex items-center gap-1 shrink-0">
              <Button
                size="icon"
                variant="outline"
                className="h-6 w-6 border-orange-200 hover:bg-orange-50 hover:border-orange-400"
                onClick={() => onRemove(item)}
                aria-label={`Remove one ${item.name}`}
              >
                <Minus className="h-2.5 w-2.5" />
              </Button>
              <span className="w-5 text-center text-xs font-bold tabular-nums">
                {item.quantity ?? 1}
              </span>
              <Button
                size="icon"
                className="h-6 w-6 bg-orange-500 hover:bg-orange-600"
                onClick={() => onAdd(item)}
                aria-label={`Add one more ${item.name}`}
              >
                <Plus className="h-2.5 w-2.5" />
              </Button>
            </div>
            {/* Name */}
            <p className="flex-1 text-xs line-clamp-1 font-medium">{item.name}</p>
            {/* Line total */}
            <span className="text-xs font-semibold shrink-0 tabular-nums text-foreground">
              {formatPrice(Number(item.price ?? 0) * (item.quantity ?? 1) * 100, currency)}
            </span>
          </div>
        ))}
      </CardContent>

      <Separator className="mt-1" />

      <CardFooter className="flex-col gap-3 px-4 pt-3 pb-4">
        <div className="w-full flex justify-between text-sm">
          <span className="text-muted-foreground">Subtotal</span>
          <span className="font-bold text-orange-600 tabular-nums">{formatPrice(subtotal * 100, currency)}</span>
        </div>
        <Button
          className="w-full bg-orange-500 hover:bg-orange-600 text-white font-semibold h-11 rounded-xl shadow-sm shadow-orange-200 text-sm"
          onClick={handleCheckout}
        >
          Checkout · {formatPrice(subtotal * 100, currency)}
        </Button>
        <p className="text-[11px] text-center text-muted-foreground leading-tight">
          Delivery fees and tips calculated at checkout
        </p>
      </CardFooter>
    </Card>
  );
}
