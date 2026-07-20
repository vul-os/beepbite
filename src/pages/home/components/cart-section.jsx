import React from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  ShoppingCart,
  Minus,
  Plus,
  Edit,
  Settings,
  RotateCcw,
  Loader2,
  Unlock,
  CheckCircle2
} from 'lucide-react';
import { cn } from "@/lib/utils";
import { useDateTime, useLocale, useMoney } from "@/context/locale-context";

const CartSection = ({
  cart,
  items,
  expandedCartItems,
  tempVariationSelections,
  updateCartQuantity,
  toggleCartItemExpanded,
  updateTempVariation,
  saveInlineVariationEdit,
  openFractionalQtyModal,
  cartTotal,
  clearCart,
  setIsCreateOrderOpen,
  // POS checkout props (optional — only used by the POS cashier flow)
  registerSession,
  registerOpenedAt,
  onPlaceOrder,
  onProcessReturn,
  placingOrder,
  placeOrderError,
  lastPlacedOrderNumber,
}) => {
  const { format, scale } = useMoney();
  const { taxRate, taxInclusive, taxLabel } = useLocale();
  const { formatTime } = useDateTime();

  // A shift that opened at 08:42 in the store's timezone must not read 06:42
  // because the till's browser is somewhere else.
  const fmtOpenedTime = (iso) => {
    if (!iso) return '';
    try {
      return formatTime(iso, { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  };

  const hasPosCheckout = typeof onPlaceOrder === 'function';

  // The cart carries major-unit prices; everything below is integer minor units.
  // `scale` rather than 100: a JPY cart has no sub-unit and a KWD cart has three.
  const subtotalMinor = Math.round(cartTotal * scale);

  // taxRate arrives as a percent (15.00), and 0 when the location has not
  // configured tax — a store with no tax set up must not have one invented.
  const rate = (Number(taxRate) || 0) / 100;
  // Inclusive pricing carries the tax inside the ticket price and backs it out;
  // US-style exclusive pricing adds it on top, so the total is not the subtotal.
  const taxMinor = !hasPosCheckout || rate === 0
    ? 0
    : taxInclusive
      ? subtotalMinor - Math.round(subtotalMinor / (1 + rate))
      : Math.round(subtotalMinor * rate);
  const netMinor = taxInclusive ? subtotalMinor - taxMinor : subtotalMinor;
  const totalMinor = taxInclusive ? subtotalMinor : subtotalMinor + taxMinor;
  // Reusable header strip showing the register-open badge for the POS flow.
  const registerBadge = hasPosCheckout && registerSession ? (
    <div className="flex items-center justify-between gap-2 px-4 py-2 border-b border-primary/15 bg-gradient-to-r from-green-50 to-emerald-50">
      <div className="flex items-center gap-2 text-xs font-medium text-green-700">
        <Unlock className="w-3.5 h-3.5" />
        Register open
        {registerOpenedAt && (
          <span className="text-green-600/80">· since {fmtOpenedTime(registerOpenedAt)}</span>
        )}
      </div>
      {onProcessReturn && (
        <Button
          type="button"
          variant="link"
          onClick={onProcessReturn}
          className="h-auto p-0 text-xs font-medium text-primary hover:text-primary/80"
        >
          Process Return
        </Button>
      )}
    </div>
  ) : null;

  if (cart.length === 0) {
    return (
      <>
        {registerBadge}
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="text-center">
            <ShoppingCart className="w-16 h-16 text-muted-foreground/40 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-foreground mb-2">Cart is empty</h3>
            <p className="text-muted-foreground">Add items from the menu to get started.</p>
            {lastPlacedOrderNumber && (
              <div className="mt-6 inline-flex items-center gap-2 px-3 py-2 rounded-full bg-green-50 text-green-700 border border-green-200 text-sm font-medium animate-in fade-in slide-in-from-bottom-2 duration-300">
                <CheckCircle2 className="w-4 h-4" />
                Order #{lastPlacedOrderNumber} sent to kitchen
              </div>
            )}
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      {registerBadge}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {cart.map((item) => {
          const isExpanded = expandedCartItems.has(item.cartItemKey);
          const originalItem = items.find(i => i.id === item.id);
          
          return (
            <Card key={item.cartItemKey} className="border border-primary/20 hover:shadow-md transition-shadow">
              <CardContent className="p-4">
                {/* Top Row: Item Name and Edit Button */}
                <div className="flex justify-between items-start mb-2">
                  <h4 className="font-medium text-foreground flex-1 pr-2">{item.name}</h4>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => toggleCartItemExpanded(item.cartItemKey)}
                    className={cn(
                      "h-8 w-8 p-0 rounded-full border-primary/20 transition-colors",
                      isExpanded ? "bg-primary/15 border-primary" : ""
                    )}
                  >
                    <Edit className="w-4 h-4" />
                  </Button>
                </div>

                {/* Current Variations Display */}
                {item.variationDetails && item.variationDetails.length > 0 && (
                  <div className="mb-3">
                    <div className="flex flex-wrap gap-1">
                      {item.variationDetails.map((variation, index) => (
                        <span key={index} className="inline-block bg-muted rounded-full px-2 py-1 text-xs text-muted-foreground">
                          <span className="font-medium">{variation.variationName}:</span> {variation.optionName}
                          {variation.priceModifier !== 0 && (
                            <span className="text-primary ml-1">
                              {variation.priceModifier > 0 ? '+' : ''}{format(Math.round(variation.priceModifier * scale))}
                            </span>
                          )}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Expandable Variation Edit Section */}
                {isExpanded && originalItem?.item_variations && (
                  <div className="mb-4 p-3 bg-primary/5 rounded-lg border border-primary/20">
                    <h5 className="text-sm font-medium text-foreground mb-3">Edit Options:</h5>
                    <div className="space-y-3">
                      {originalItem.item_variations.map((variation) => (
                        <div key={variation.id} className="space-y-2">
                          <label className="text-xs font-medium text-muted-foreground block">
                            {variation.name} {variation.is_required && <span className="text-red-500">*</span>}
                          </label>
                          <div className="grid grid-cols-1 gap-1">
                            {variation.item_variation_options?.map((option) => (
                              <Button
                                key={option.id}
                                type="button"
                                variant="outline"
                                aria-pressed={tempVariationSelections[item.cartItemKey]?.[variation.id] === option.id}
                                onClick={() => updateTempVariation(item.cartItemKey, variation.id, option.id)}
                                className={cn(
                                  "h-auto justify-start text-left p-2 text-xs font-normal",
                                  tempVariationSelections[item.cartItemKey]?.[variation.id] === option.id
                                    ? "border-primary bg-primary/15 text-primary hover:bg-primary/15"
                                    : "hover:border-primary/30 hover:bg-primary/5"
                                )}
                              >
                                <div className="flex justify-between items-center w-full">
                                  <span className="font-medium">{option.name}</span>
                                  {option.price_modifier !== 0 && (
                                    <span className="text-primary">
                                      {option.price_modifier > 0 ? '+' : ''}{format(Math.round(parseFloat(option.price_modifier || 0) * scale))}
                                    </span>
                                  )}
                                </div>
                              </Button>
                            ))}
                          </div>
                        </div>
                      ))}
                      
                      {/* Save/Cancel Buttons */}
                      <div className="flex gap-2 pt-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => toggleCartItemExpanded(item.cartItemKey)}
                          className="flex-1 h-7 text-xs"
                        >
                          Cancel
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => saveInlineVariationEdit(item.cartItemKey)}
                          className="flex-1 h-7 text-xs"
                        >
                          Save
                        </Button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Bottom Row: Quantity Controls (Left) and Price (Right) */}
                <div className="flex justify-between items-center">
                  {/* Quantity Controls - Bottom Left */}
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => updateCartQuantity(item.cartItemKey, item.quantity - 1)}
                      className="h-7 w-7 p-0 rounded-full border-primary/20"
                    >
                      <Minus className="w-3 h-3" />
                    </Button>
                    
                    <span className="text-sm font-medium w-8 text-center">
                      {item.quantity % 1 === 0 ? item.quantity : item.quantity.toFixed(2)}
                    </span>
                    
                    <Button
                      size="sm"
                      onClick={() => updateCartQuantity(item.cartItemKey, item.quantity + 1)}
                      className="h-7 w-7 p-0 rounded-full"
                    >
                      <Plus className="w-3 h-3" />
                    </Button>

                    {/* Settings Icon for Fractional Quantity */}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => openFractionalQtyModal(item)}
                      className="h-7 w-7 p-0 rounded-full border-primary/20 hover:bg-primary/5"
                    >
                      <Settings className="w-3 h-3" />
                    </Button>
                  </div>

                  {/* Price and Per-Item Cost - Bottom Right */}
                  <div className="text-right">
                    <div className="text-lg font-bold text-primary">
                      {format(Math.round(item.price * item.quantity * scale))}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {format(Math.round(parseFloat(item.price) * scale))} each
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
      
      {/* Cart Footer */}
      <div className="border-t border-border bg-muted p-6">
        {hasPosCheckout ? (
          <>
            <div className="space-y-1 mb-3 text-sm">
              <div className="flex justify-between text-muted-foreground">
                <span>Subtotal</span>
                <span className="tabular-nums">{format(netMinor)}</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>{taxLabel}{taxInclusive ? ' (incl.)' : ''}</span>
                <span className="tabular-nums">{format(taxMinor)}</span>
              </div>
              <div className="h-px bg-border my-2" />
              <div className="flex justify-between text-lg font-bold">
                <span className="text-foreground">Total</span>
                <span className="text-primary tabular-nums">{format(totalMinor)}</span>
              </div>
            </div>

            {placeOrderError && (
              <p className="text-xs text-destructive mb-2">{placeOrderError}</p>
            )}

            <div className="flex gap-2 mb-2">
              <Button
                onClick={clearCart}
                variant="outline"
                disabled={placingOrder}
                className="flex-1 border-primary/30 text-primary hover:bg-primary/10"
              >
                <RotateCcw className="w-4 h-4 mr-2" />
                Clear
              </Button>
              <Button
                onClick={onPlaceOrder}
                disabled={placingOrder || !registerSession}
                className="flex-[2] h-12 text-lg font-semibold shadow-md"
              >
                {placingOrder ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    Placing…
                  </>
                ) : (
                  'Place Order'
                )}
              </Button>
            </div>

            {onProcessReturn && (
              <Button
                onClick={onProcessReturn}
                variant="outline"
                className="w-full border-border text-muted-foreground hover:bg-muted"
              >
                <RotateCcw className="w-4 h-4 mr-2" />
                Process Return
              </Button>
            )}
          </>
        ) : (
          <>
            <div className="flex justify-between items-center mb-4">
              <span className="text-xl font-bold text-foreground">Total:</span>
              <span className="text-2xl font-bold text-primary">
                {format(subtotalMinor)}
              </span>
            </div>
            <div className="flex gap-3">
              <Button
                onClick={clearCart}
                variant="outline"
                className="flex-1 border-primary/30 text-primary hover:bg-primary/10"
              >
                <RotateCcw className="w-4 h-4 mr-2" />
                Clear
              </Button>
              <Button
                onClick={() => setIsCreateOrderOpen(true)}
                className="flex-2 h-12 text-lg font-semibold"
              >
                Create Order
              </Button>
            </div>
          </>
        )}
      </div>
    </>
  );
};

export default CartSection; 