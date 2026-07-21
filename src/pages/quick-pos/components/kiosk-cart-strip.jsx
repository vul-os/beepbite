import { ShoppingCart, Minus, Plus, Trash2, ChevronUp, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatPrice } from '@/lib/currency';

const KioskCartStrip = ({ cart, currency, onUpdateQty, onClear, onCheckout, collapsed, onToggleCollapse }) => {
  const total = cart.reduce((s, item) => s + item.price * item.quantity, 0);
  const count = cart.reduce((s, item) => s + item.quantity, 0);
  const isEmpty = cart.length === 0;

  return (
    <div className={cn(
      'bg-white border-t-2 border-orange-400 shadow-2xl flex flex-col transition-[height] duration-200',
      collapsed ? 'h-[4.5rem]' : 'h-80 sm:h-72',
    )}>
      {/* Strip header — always visible, tap to expand/collapse */}
      <button
        onClick={onToggleCollapse}
        aria-label={collapsed ? `Expand cart — ${count} item${count === 1 ? '' : 's'}` : 'Collapse cart'}
        aria-expanded={!collapsed}
        className={cn(
          'h-[4.5rem] shrink-0 flex items-center px-4 sm:px-5 gap-3 w-full',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 focus-visible:ring-inset',
          'transition-colors',
          !isEmpty && 'hover:bg-orange-50',
          isEmpty && 'cursor-default',
        )}
        disabled={isEmpty}
      >
        <div className="w-11 h-11 rounded-full bg-orange-500 flex items-center justify-center relative shrink-0">
          <ShoppingCart className="w-5 h-5 text-white" aria-hidden="true" />
          {count > 0 && (
            <span
              aria-label={`${count} items`}
              className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full text-white text-[11px] font-bold flex items-center justify-center"
            >
              {count}
            </span>
          )}
        </div>
        <span className="flex-1 text-left text-base sm:text-lg font-semibold text-gray-900 truncate">
          {isEmpty ? (
            <span className="text-gray-400 font-normal text-sm">Add items to start an order</span>
          ) : (
            `${count} item${count === 1 ? '' : 's'}`
          )}
        </span>
        {!isEmpty && (
          <>
            <span className="text-xl sm:text-2xl font-bold text-orange-600 tabular-nums mr-1">
              {formatPrice(total * 100, currency)}
            </span>
            {collapsed
              ? <ChevronUp className="w-5 h-5 text-gray-400 shrink-0" aria-hidden="true" />
              : <ChevronDown className="w-5 h-5 text-gray-400 shrink-0" aria-hidden="true" />
            }
          </>
        )}
      </button>

      {/* Cart line items (only visible when expanded) */}
      {!collapsed && !isEmpty && (
        <>
          <div className="flex-1 overflow-y-auto px-4 pb-2 space-y-2.5">
            {cart.map(item => (
              <div key={item.cartItemKey} className="flex items-center gap-3 py-0.5">
                {/* Qty controls */}
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => onUpdateQty(item.cartItemKey, item.quantity - 1)}
                    aria-label={item.quantity === 1 ? `Remove ${item.name}` : `Decrease ${item.name} quantity`}
                    className="w-10 h-10 rounded-full border-2 border-orange-200 flex items-center justify-center text-orange-600 hover:bg-orange-50 active:bg-orange-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 transition-colors"
                  >
                    {item.quantity === 1
                      ? <Trash2 className="w-4 h-4" aria-hidden="true" />
                      : <Minus className="w-4 h-4" aria-hidden="true" />
                    }
                  </button>
                  <span className="w-7 text-center text-base font-bold select-none" aria-label={`Quantity: ${item.quantity}`}>
                    {item.quantity}
                  </span>
                  <button
                    onClick={() => onUpdateQty(item.cartItemKey, item.quantity + 1)}
                    aria-label={`Increase ${item.name} quantity`}
                    className="w-10 h-10 rounded-full bg-orange-500 flex items-center justify-center text-white hover:bg-orange-600 active:bg-orange-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 transition-colors"
                  >
                    <Plus className="w-4 h-4" aria-hidden="true" strokeWidth={2.5} />
                  </button>
                </div>
                {/* Name + modifiers */}
                <div className="flex-1 min-w-0">
                  <span className="block text-sm sm:text-base text-gray-900 font-medium truncate">{item.name}</span>
                  {item.selectedModifiers?.length > 0 && (
                    <span className="block text-xs text-orange-600 truncate">
                      {item.selectedModifiers.map(m => m.name).join(', ')}
                    </span>
                  )}
                </div>
                {/* Line total */}
                <span className="text-sm sm:text-base font-bold tabular-nums text-gray-900 whitespace-nowrap shrink-0">
                  {formatPrice(item.price * item.quantity * 100, currency)}
                </span>
              </div>
            ))}
          </div>

          {/* Checkout + Clear row */}
          <div className="shrink-0 px-4 pb-4 pt-2 border-t border-gray-100 flex gap-2.5">
            <button
              onClick={onClear}
              aria-label="Clear all items from cart"
              className="h-13 px-4 rounded-xl border-2 border-orange-200 text-orange-600 font-semibold text-sm sm:text-base hover:bg-orange-50 active:bg-orange-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 transition-colors"
              style={{ height: '3.25rem' }}
            >
              Clear
            </button>
            <button
              onClick={onCheckout}
              aria-label={`Charge ${formatPrice(total * 100, currency)}`}
              className="flex-1 h-13 rounded-xl bg-orange-500 hover:bg-orange-600 active:bg-orange-700 text-white font-bold text-base sm:text-lg shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 focus-visible:ring-offset-2 transition-colors"
              style={{ height: '3.25rem' }}
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
