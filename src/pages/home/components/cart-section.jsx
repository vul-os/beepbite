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
import { formatPrice } from "@/lib/currency";

// Format an ISO date as a short clock time, e.g. "08:42 AM".
function fmtOpenedTime(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

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
  taxRate = 0.15,
  currency = 'USD',
}) => {
  const hasPosCheckout = typeof onPlaceOrder === 'function';
  const subtotal = cartTotal;
  // Tax is approximated client-side as inclusive; backend remains source of truth.
  const tax = hasPosCheckout ? subtotal - subtotal / (1 + taxRate) : 0;
  // Reusable header strip showing the register-open badge for the POS flow.
  const registerBadge = hasPosCheckout && registerSession ? (
    <div className="flex items-center justify-between gap-2 px-4 py-2 border-b border-orange-100 bg-gradient-to-r from-green-50 to-emerald-50">
      <div className="flex items-center gap-2 text-xs font-medium text-green-700">
        <Unlock className="w-3.5 h-3.5" />
        Register open
        {registerOpenedAt && (
          <span className="text-green-600/80">· since {fmtOpenedTime(registerOpenedAt)}</span>
        )}
      </div>
      {onProcessReturn && (
        <button
          type="button"
          onClick={onProcessReturn}
          className="text-xs font-medium text-orange-600 hover:text-orange-700 hover:underline"
        >
          Process Return
        </button>
      )}
    </div>
  ) : null;

  if (cart.length === 0) {
    return (
      <>
        {registerBadge}
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="text-center">
            <ShoppingCart className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">Cart is empty</h3>
            <p className="text-gray-500">Add items from the menu to get started.</p>
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
            <Card key={item.cartItemKey} className="border border-orange-200 hover:shadow-md transition-shadow">
              <CardContent className="p-4">
                {/* Top Row: Item Name and Edit Button */}
                <div className="flex justify-between items-start mb-2">
                  <h4 className="font-medium text-gray-900 flex-1 pr-2">{item.name}</h4>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => toggleCartItemExpanded(item.cartItemKey)}
                    className={cn(
                      "h-8 w-8 p-0 rounded-full border-orange-200 transition-colors",
                      isExpanded ? "bg-orange-100 border-orange-400" : ""
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
                        <span key={index} className="inline-block bg-gray-100 rounded-full px-2 py-1 text-xs text-gray-700">
                          <span className="font-medium">{variation.variationName}:</span> {variation.optionName}
                          {variation.priceModifier !== 0 && (
                            <span className="text-orange-600 ml-1">
                              {variation.priceModifier > 0 ? '+' : ''}{formatPrice(variation.priceModifier * 100, currency)}
                            </span>
                          )}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Expandable Variation Edit Section */}
                {isExpanded && originalItem?.item_variations && (
                  <div className="mb-4 p-3 bg-orange-50 rounded-lg border border-orange-200">
                    <h5 className="text-sm font-medium text-gray-900 mb-3">Edit Options:</h5>
                    <div className="space-y-3">
                      {originalItem.item_variations.map((variation) => (
                        <div key={variation.id} className="space-y-2">
                          <label className="text-xs font-medium text-gray-700 block">
                            {variation.name} {variation.is_required && <span className="text-red-500">*</span>}
                          </label>
                          <div className="grid grid-cols-1 gap-1">
                            {variation.item_variation_options?.map((option) => (
                              <button
                                key={option.id}
                                onClick={() => updateTempVariation(item.cartItemKey, variation.id, option.id)}
                                className={cn(
                                  "text-left p-2 rounded border transition-colors text-xs",
                                  tempVariationSelections[item.cartItemKey]?.[variation.id] === option.id
                                    ? "border-orange-400 bg-orange-100 text-orange-700"
                                    : "border-gray-200 hover:border-orange-300 hover:bg-orange-50"
                                )}
                              >
                                <div className="flex justify-between items-center">
                                  <span className="font-medium">{option.name}</span>
                                  {option.price_modifier !== 0 && (
                                    <span className="text-orange-600">
                                      {option.price_modifier > 0 ? '+' : ''}{formatPrice(parseFloat(option.price_modifier || 0) * 100, currency)}
                                    </span>
                                  )}
                                </div>
                              </button>
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
                          className="flex-1 h-7 text-xs bg-orange-500 hover:bg-orange-600 text-white"
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
                      className="h-7 w-7 p-0 rounded-full border-orange-200"
                    >
                      <Minus className="w-3 h-3" />
                    </Button>
                    
                    <span className="text-sm font-medium w-8 text-center">
                      {item.quantity % 1 === 0 ? item.quantity : item.quantity.toFixed(2)}
                    </span>
                    
                    <Button
                      size="sm"
                      onClick={() => updateCartQuantity(item.cartItemKey, item.quantity + 1)}
                      className="h-7 w-7 p-0 rounded-full bg-orange-500 hover:bg-orange-600"
                    >
                      <Plus className="w-3 h-3" />
                    </Button>

                    {/* Settings Icon for Fractional Quantity */}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => openFractionalQtyModal(item)}
                      className="h-7 w-7 p-0 rounded-full border-orange-200 hover:bg-orange-50"
                    >
                      <Settings className="w-3 h-3" />
                    </Button>
                  </div>

                  {/* Price and Per-Item Cost - Bottom Right */}
                  <div className="text-right">
                    <div className="text-lg font-bold text-orange-600">
                      {formatPrice(item.price * item.quantity * 100, currency)}
                    </div>
                    <div className="text-xs text-gray-500">
                      {formatPrice(parseFloat(item.price) * 100, currency)} each
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
      
      {/* Cart Footer */}
      <div className="border-t border-gray-200 bg-gray-50 p-6">
        {hasPosCheckout ? (
          <>
            <div className="space-y-1 mb-3 text-sm">
              <div className="flex justify-between text-gray-600">
                <span>Subtotal</span>
                <span className="tabular-nums">{formatPrice((subtotal - tax) * 100, currency)}</span>
              </div>
              <div className="flex justify-between text-gray-600">
                <span>Tax (incl.)</span>
                <span className="tabular-nums">{formatPrice(tax * 100, currency)}</span>
              </div>
              <div className="h-px bg-gray-200 my-2" />
              <div className="flex justify-between text-lg font-bold">
                <span className="text-gray-900">Total</span>
                <span className="text-orange-600 tabular-nums">{formatPrice(subtotal * 100, currency)}</span>
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
                className="flex-1 border-orange-200 text-orange-600 hover:bg-orange-50"
              >
                <RotateCcw className="w-4 h-4 mr-2" />
                Clear
              </Button>
              <Button
                onClick={onPlaceOrder}
                disabled={placingOrder || !registerSession}
                className="flex-[2] bg-orange-500 hover:bg-orange-600 text-white h-12 text-lg font-semibold shadow-md"
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
                className="w-full border-gray-200 text-gray-700 hover:bg-gray-100"
              >
                <RotateCcw className="w-4 h-4 mr-2" />
                Process Return
              </Button>
            )}
          </>
        ) : (
          <>
            <div className="flex justify-between items-center mb-4">
              <span className="text-xl font-bold text-gray-900">Total:</span>
              <span className="text-2xl font-bold text-orange-600">
                {formatPrice(cartTotal * 100, currency)}
              </span>
            </div>
            <div className="flex gap-3">
              <Button
                onClick={clearCart}
                variant="outline"
                className="flex-1 border-orange-200 text-orange-600 hover:bg-orange-50"
              >
                <RotateCcw className="w-4 h-4 mr-2" />
                Clear
              </Button>
              <Button
                onClick={() => setIsCreateOrderOpen(true)}
                className="flex-2 bg-orange-500 hover:bg-orange-600 text-white h-12 text-lg font-semibold"
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