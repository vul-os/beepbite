import React from 'react';
import { ShoppingCart, Minus, Plus, Trash2, ChevronUp, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatPrice } from '@/lib/currency';

const KioskCartStrip = ({ cart, currency, onUpdateQty, onClear, onCheckout, collapsed, onToggleCollapse }) => {
  const total = cart.reduce((s, item) => s + item.price * item.quantity, 0);
  const count = cart.reduce((s, item) => s + item.quantity, 0);

  return (
    <div className={cn(
      'bg-white border-t-2 border-orange-400 shadow-2xl flex flex-col transition-all duration-200',
      collapsed ? 'h-16' : 'h-72'
    )}>
      {/* Strip header — always visible, tap to expand/collapse */}
      <button
        onClick={onToggleCollapse}
        className="h-16 shrink-0 flex items-center px-5 gap-3 w-full focus:outline-none hover:bg-orange-50 transition-colors"
      >
        <div className="w-10 h-10 rounded-full bg-orange-500 flex items-center justify-center relative">
          <ShoppingCart className="w-5 h-5 text-white" />
          {count > 0 && (
            <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full text-white text-xs font-bold flex items-center justify-center">
              {count}
            </span>
          )}
        </div>
        <span className="flex-1 text-left text-lg font-semibold text-gray-900">
          {cart.length === 0 ? 'Cart is empty' : `${cart.length} line${cart.length === 1 ? '' : 's'}`}
        </span>
        <span className="text-2xl font-bold text-orange-600 tabular-nums mr-2">
          {formatPrice(total * 100, currency)}
        </span>
        {cart.length > 0 && (
          collapsed ? <ChevronUp className="w-5 h-5 text-gray-500" /> : <ChevronDown className="w-5 h-5 text-gray-500" />
        )}
      </button>

      {/* Cart line items (only visible when expanded) */}
      {!collapsed && cart.length > 0 && (
        <>
          <div className="flex-1 overflow-y-auto px-4 pb-2 space-y-2">
            {cart.map(item => (
              <div key={item.cartItemKey} className="flex items-center gap-3">
                {/* Qty controls */}
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => onUpdateQty(item.cartItemKey, item.quantity - 1)}
                    className="w-9 h-9 rounded-full border border-orange-200 flex items-center justify-center text-orange-600 hover:bg-orange-50 active:bg-orange-100 transition-colors"
                  >
                    {item.quantity === 1 ? <Trash2 className="w-4 h-4" /> : <Minus className="w-4 h-4" />}
                  </button>
                  <span className="w-8 text-center text-base font-semibold">{item.quantity}</span>
                  <button
                    onClick={() => onUpdateQty(item.cartItemKey, item.quantity + 1)}
                    className="w-9 h-9 rounded-full bg-orange-500 flex items-center justify-center text-white hover:bg-orange-600 active:bg-orange-700 transition-colors"
                  >
                    <Plus className="w-4 h-4" strokeWidth={2.5} />
                  </button>
                </div>
                {/* Name */}
                <span className="flex-1 text-base text-gray-900 font-medium truncate">{item.name}</span>
                {/* Variation chips */}
                {item.variationDetails?.length > 0 && (
                  <span className="text-xs text-gray-500 truncate max-w-[80px]">
                    {item.variationDetails.map(v => v.optionName).join(', ')}
                  </span>
                )}
                {/* Line total */}
                <span className="text-base font-bold tabular-nums text-gray-900 whitespace-nowrap">
                  {formatPrice(item.price * item.quantity * 100, currency)}
                </span>
              </div>
            ))}
          </div>

          {/* Checkout + Clear row */}
          <div className="shrink-0 px-4 pb-4 pt-2 border-t border-gray-100 flex gap-3">
            <button
              onClick={onClear}
              className="h-12 px-4 rounded-xl border-2 border-orange-200 text-orange-600 font-semibold text-base hover:bg-orange-50 active:bg-orange-100 transition-colors"
            >
              Clear
            </button>
            <button
              onClick={onCheckout}
              className="flex-1 h-12 rounded-xl bg-orange-500 hover:bg-orange-600 active:bg-orange-700 text-white font-bold text-lg shadow-md transition-colors"
            >
              Charge {formatPrice(total * 100, currency)}
            </button>
          </div>
        </>
      )}
    </div>
  );
};

export default KioskCartStrip;
