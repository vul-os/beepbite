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
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center justify-center py-8 text-center gap-3">
          <ShoppingCart className="h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">Your cart is empty</p>
          <p className="text-xs text-muted-foreground">Add items from the menu</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="shadow-md">
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <ShoppingCart className="h-4 w-4 text-orange-500" />
            Your order
            <span className="ml-1 bg-orange-500 text-white rounded-full text-xs px-1.5 py-0">
              {totalQty}
            </span>
          </CardTitle>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-destructive"
            onClick={onClear}
            title="Clear cart"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="px-4 pb-2 space-y-2">
        {items.map((item) => (
          <div key={item.id} className="flex items-center gap-2">
            {/* Qty controls */}
            <div className="flex items-center gap-1 shrink-0">
              <Button
                size="icon"
                variant="outline"
                className="h-6 w-6 border-orange-200"
                onClick={() => onRemove(item)}
              >
                <Minus className="h-2.5 w-2.5" />
              </Button>
              <span className="w-4 text-center text-xs font-semibold">
                {item.quantity ?? 1}
              </span>
              <Button
                size="icon"
                className="h-6 w-6 bg-orange-500 hover:bg-orange-600"
                onClick={() => onAdd(item)}
              >
                <Plus className="h-2.5 w-2.5" />
              </Button>
            </div>
            {/* Name */}
            <p className="flex-1 text-xs line-clamp-1">{item.name}</p>
            {/* Line total */}
            <span className="text-xs font-medium shrink-0">
              {formatPrice(Number(item.price ?? 0) * (item.quantity ?? 1) * 100, currency)}
            </span>
          </div>
        ))}
      </CardContent>

      <Separator />

      <CardFooter className="flex-col gap-3 px-4 pt-3 pb-4">
        <div className="w-full flex justify-between text-sm font-semibold">
          <span>Subtotal</span>
          <span className="text-orange-600">{formatPrice(subtotal * 100, currency)}</span>
        </div>
        <Button
          className="w-full bg-orange-500 hover:bg-orange-600 text-white"
          onClick={handleCheckout}
        >
          Proceed to checkout · {formatPrice(subtotal * 100, currency)}
        </Button>
      </CardFooter>
    </Card>
  );
}
