/**
 * BarMode — Wave 32 Quick-Pour bar POS view.
 *
 * Chrome-less, large-button grid optimised for a bartender:
 *  - Loads the location's menu via Supabase (same pattern as quick-pos/index.jsx)
 *  - Category chip filters across the top
 *  - Each item = one BIG tap target → instantly adds 1 to cart, NO modifier picker
 *  - Re-tap adds more; − removes one; long-press removes one (mobile-friendly)
 *  - Compact collapsible cart panel on the right (desktop) / bottom drawer (mobile)
 *  - One-tap "Charge" submits via submitPosOrder, shows ReceiptModal, clears for next round
 *
 * Props:
 *   locationId  {string}  – resolved by the parent/orchestrator (e.g. from slug or auth)
 *   currency    {string}  – ISO 4217 code, default 'USD'
 *   storeName   {string}  – shown in the top bar
 *   onExit      {fn}      – optional back/exit handler
 */

/* eslint-disable react/prop-types */
import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from 'react';
import {
  Beer,
  ChevronDown,
  ChevronUp,
  Loader2,
  Minus,
  Plus,
  RotateCcw,
  ShoppingCart,
  Trash2,
  Utensils,
  X,
  Zap,
} from 'lucide-react';

import { supabase } from '@/services/supabase-client';
import { submitPosOrder } from '@/services/pos';
import { formatPrice } from '@/lib/currency';
import { cn } from '@/lib/utils';
import ReceiptModal from '@/pages/pos/components/receipt-modal';

// ---------------------------------------------------------------------------
// Drink-category detection — items whose category name matches any of these
// are highlighted (but ALL items are still shown; bartender can filter via chips)
// ---------------------------------------------------------------------------

const DRINK_KEYWORDS = /drink|beverage|beer|wine|spirit|cocktail|shots?|ales?|lager|cider|soda|juice|water|coffee|tea|mixer|non.?alc/i;

function isDrinkCategory(categoryName = '') {
  return DRINK_KEYWORDS.test(categoryName);
}

// ---------------------------------------------------------------------------
// Emoji lookup — same table as kiosk-menu-grid.jsx for visual consistency
// ---------------------------------------------------------------------------

const ITEM_EMOJI_KEYWORDS = [
  { match: /burger|patty|cheeseburger/i, emoji: '🍔' },
  { match: /fries|chips/i, emoji: '🍟' },
  { match: /coke|cola|pepsi|sprite|fanta/i, emoji: '🥤' },
  { match: /soda|soft drink/i, emoji: '🥤' },
  { match: /water/i, emoji: '💧' },
  { match: /coffee|espresso|latte|cappuccino/i, emoji: '☕' },
  { match: /tea/i, emoji: '🍵' },
  { match: /beer|lager|stout|ale|draught/i, emoji: '🍺' },
  { match: /wine/i, emoji: '🍷' },
  { match: /champagne|prosecco|sparkling/i, emoji: '🥂' },
  { match: /whiskey|whisky|bourbon|scotch/i, emoji: '🥃' },
  { match: /cocktail|margarita|mojito/i, emoji: '🍹' },
  { match: /shot/i, emoji: '🥃' },
  { match: /juice/i, emoji: '🧃' },
  { match: /milkshake|shake/i, emoji: '🥛' },
  { match: /cider/i, emoji: '🍺' },
  { match: /rum|gin|vodka|tequila/i, emoji: '🥃' },
  { match: /pizza/i, emoji: '🍕' },
  { match: /chicken|wing/i, emoji: '🍗' },
  { match: /salad/i, emoji: '🥗' },
  { match: /ice cream/i, emoji: '🍨' },
  { match: /snack|nuts/i, emoji: '🥜' },
];

const CATEGORY_EMOJI_MAP = {
  burgers: '🍔', drinks: '🥤', beer: '🍺', wine: '🍷',
  spirits: '🥃', cocktails: '🍹', shots: '🥃',
  coffee: '☕', juice: '🧃', water: '💧', sides: '🍟',
  snacks: '🥜', desserts: '🍰', food: '🍽️',
};

function emojiForItem(item) {
  const name = item?.name || '';
  for (const { match, emoji } of ITEM_EMOJI_KEYWORDS) {
    if (match.test(name)) return emoji;
  }
  const cat = (item?.category?.name || '').toLowerCase().trim();
  return CATEGORY_EMOJI_MAP[cat] || '🍽️';
}

// ---------------------------------------------------------------------------
// Cart helpers
// ---------------------------------------------------------------------------

function buildKey(itemId) {
  // Bar mode: no modifiers, so key is just the item id
  return String(itemId);
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Category filter chip */
function CategoryChip({ label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'h-10 px-4 rounded-full text-sm font-semibold whitespace-nowrap transition-all duration-150 shrink-0',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400',
        active
          ? 'bg-orange-500 text-white shadow'
          : 'bg-white/10 text-white/80 border border-white/20 hover:bg-white/20',
      )}
    >
      {label}
    </button>
  );
}

/** Large drink button — the core quick-pour tap target */
function DrinkButton({ item, currency, cartQty, onTap, onRemove }) {
  const longPressRef = useRef(null);

  // Long-press (≥500 ms) removes one unit — convenient on mobile
  const handlePointerDown = useCallback(() => {
    longPressRef.current = setTimeout(() => {
      longPressRef.current = null;
      onRemove?.();
    }, 500);
  }, [onRemove]);

  const handlePointerUp = useCallback(() => {
    if (longPressRef.current) {
      clearTimeout(longPressRef.current);
      longPressRef.current = null;
    }
  }, []);

  const handlePointerLeave = useCallback(() => {
    if (longPressRef.current) {
      clearTimeout(longPressRef.current);
      longPressRef.current = null;
    }
  }, []);

  const price = parseFloat(item.price || 0);
  const isDrink = isDrinkCategory(item.category?.name);

  return (
    <div className="relative flex flex-col">
      {/* Quantity badge */}
      {cartQty > 0 && (
        <span
          className={cn(
            'absolute -top-2 -right-2 z-10',
            'w-7 h-7 rounded-full bg-orange-500 border-2 border-gray-900',
            'flex items-center justify-center',
            'text-xs font-bold text-white tabular-nums',
            'shadow-lg select-none pointer-events-none',
          )}
        >
          {cartQty > 9 ? '9+' : cartQty}
        </span>
      )}

      {/* Main tap target */}
      <button
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerLeave}
        onClick={onTap}
        className={cn(
          'group relative flex flex-col items-center justify-between',
          'rounded-2xl border-2 p-3 min-h-[120px] sm:min-h-[140px]',
          'text-center transition-all duration-100 select-none',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400',
          'active:scale-95',
          cartQty > 0
            ? 'bg-orange-500 border-orange-400 shadow-lg shadow-orange-900/30'
            : isDrink
            ? 'bg-gray-800 border-gray-700 hover:border-orange-500 hover:bg-gray-750'
            : 'bg-gray-800/60 border-gray-700/60 hover:border-orange-500/70',
        )}
      >
        {/* Emoji */}
        <span
          className={cn(
            'text-4xl sm:text-5xl leading-none mb-1',
            'transition-transform duration-100 group-active:scale-90',
          )}
        >
          {emojiForItem(item)}
        </span>

        {/* Name */}
        <p
          className={cn(
            'text-xs sm:text-sm font-semibold leading-tight line-clamp-2',
            cartQty > 0 ? 'text-white' : 'text-gray-100',
          )}
        >
          {item.name}
        </p>

        {/* Price */}
        <p
          className={cn(
            'text-sm font-bold tabular-nums mt-1',
            cartQty > 0 ? 'text-orange-100' : 'text-orange-400',
          )}
        >
          {formatPrice(price * 100, currency)}
        </p>
      </button>

      {/* Small − remove button — shown when item is in cart */}
      {cartQty > 0 && (
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className={cn(
            'mt-1.5 mx-auto flex items-center justify-center gap-1',
            'h-7 px-3 rounded-full',
            'bg-gray-700 border border-gray-600 text-gray-300',
            'text-xs font-medium',
            'hover:bg-gray-600 active:bg-gray-500 transition-colors',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400',
          )}
          aria-label={`Remove one ${item.name}`}
        >
          <Minus className="w-3 h-3" />
          <span>Remove</span>
        </button>
      )}
    </div>
  );
}

/** Compact cart panel shown on the right (md+) or bottom (mobile) */
function BarCart({ cart, currency, cartTotal, onUpdateQty, onClear, onCharge, charging, chargeError }) {
  const [collapsed, setCollapsed] = useState(false);
  const count = cart.reduce((s, ci) => s + ci.quantity, 0);

  return (
    <div
      className={cn(
        'flex flex-col bg-gray-900 border-t-2 md:border-t-0 md:border-l-2 border-orange-500/60',
        'md:w-72 lg:w-80 shrink-0',
        'transition-all duration-200',
        // Mobile: drawer from bottom (fixed height when expanded)
        collapsed ? 'h-16 md:h-auto md:flex' : 'h-72 md:h-auto md:flex',
      )}
    >
      {/* Cart header / toggle (mobile) */}
      <button
        className={cn(
          'flex items-center gap-3 px-4 py-3 shrink-0',
          'md:cursor-default',
          'border-b border-white/10',
        )}
        onClick={() => setCollapsed(c => !c)}
      >
        <div className="relative w-9 h-9 rounded-full bg-orange-500 flex items-center justify-center">
          <ShoppingCart className="w-4 h-4 text-white" />
          {count > 0 && (
            <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-500 flex items-center justify-center text-white text-[10px] font-bold">
              {count > 9 ? '9+' : count}
            </span>
          )}
        </div>
        <span className="flex-1 text-left text-sm font-semibold text-white">
          {count === 0 ? 'Cart empty' : `${count} drink${count === 1 ? '' : 's'}`}
        </span>
        <span className="text-lg font-bold tabular-nums text-orange-400">
          {formatPrice(cartTotal * 100, currency)}
        </span>
        <span className="md:hidden text-gray-500">
          {collapsed ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </span>
      </button>

      {/* Line items — hidden on mobile when collapsed */}
      <div
        className={cn(
          'flex-1 overflow-y-auto',
          collapsed ? 'hidden md:block' : 'block',
        )}
      >
        {cart.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full py-10 text-gray-600 gap-2">
            <Beer className="w-8 h-8 opacity-40" />
            <p className="text-sm">Tap a drink to add</p>
          </div>
        ) : (
          <ul className="divide-y divide-white/5 px-3 py-2">
            {cart.map(ci => (
              <li key={ci.cartItemKey} className="flex items-center gap-2 py-2">
                <span className="text-xl leading-none w-7 shrink-0 text-center">
                  {emojiForItem(ci)}
                </span>
                <span className="flex-1 text-sm text-white font-medium truncate">
                  {ci.name}
                </span>
                {/* Qty stepper */}
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => onUpdateQty(ci.cartItemKey, ci.quantity - 1)}
                    className="w-7 h-7 rounded-full bg-gray-700 hover:bg-gray-600 flex items-center justify-center text-white transition-colors"
                    aria-label="Decrease quantity"
                  >
                    {ci.quantity === 1
                      ? <Trash2 className="w-3 h-3 text-red-400" />
                      : <Minus className="w-3 h-3" />}
                  </button>
                  <span className="w-6 text-center text-sm font-bold text-white tabular-nums">
                    {ci.quantity}
                  </span>
                  <button
                    onClick={() => onUpdateQty(ci.cartItemKey, ci.quantity + 1)}
                    className="w-7 h-7 rounded-full bg-orange-500 hover:bg-orange-400 flex items-center justify-center text-white transition-colors"
                    aria-label="Increase quantity"
                  >
                    <Plus className="w-3 h-3" strokeWidth={2.5} />
                  </button>
                </div>
                <span className="w-16 text-right text-sm font-semibold tabular-nums text-orange-300 shrink-0">
                  {formatPrice(ci.price * ci.quantity * 100, currency)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Footer — Charge + Clear */}
      <div
        className={cn(
          'shrink-0 px-3 pb-4 pt-3 border-t border-white/10 space-y-2',
          collapsed ? 'hidden md:block' : 'block',
        )}
      >
        {chargeError && (
          <p className="text-xs text-red-400 text-center px-1">{chargeError}</p>
        )}
        <button
          onClick={onCharge}
          disabled={cart.length === 0 || charging}
          className={cn(
            'w-full h-14 rounded-xl font-bold text-lg transition-all duration-150',
            'flex items-center justify-center gap-2',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400',
            cart.length === 0
              ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
              : 'bg-orange-500 hover:bg-orange-400 active:bg-orange-600 text-white shadow-lg shadow-orange-900/30',
          )}
        >
          {charging ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <>
              <Zap className="w-5 h-5" />
              Charge {cart.length > 0 ? formatPrice(cartTotal * 100, currency) : ''}
            </>
          )}
        </button>

        {cart.length > 0 && (
          <button
            onClick={onClear}
            disabled={charging}
            className="w-full h-9 rounded-xl border border-white/10 text-gray-400 hover:text-white hover:border-white/30 text-sm transition-colors focus:outline-none"
          >
            <span className="flex items-center justify-center gap-1.5">
              <RotateCcw className="w-3.5 h-3.5" />
              Clear all
            </span>
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main BarMode component
// ---------------------------------------------------------------------------

const BarMode = ({
  locationId,
  currency = 'USD',
  storeName = 'Bar',
  onExit,
}) => {
  // ---- Menu state ---------------------------------------------------------
  const [items, setItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [menuLoading, setMenuLoading] = useState(false);
  const [menuError, setMenuError] = useState(null);

  // ---- Category filter ----------------------------------------------------
  const [activeCat, setActiveCat] = useState('all');

  // ---- Cart ---------------------------------------------------------------
  const [cart, setCart] = useState([]);

  // ---- Charge / submit ----------------------------------------------------
  const [charging, setCharging] = useState(false);
  const [chargeError, setChargeError] = useState('');

  // ---- Receipt modal ------------------------------------------------------
  const [receiptOrderId, setReceiptOrderId] = useState(null);
  const [receiptOpen, setReceiptOpen] = useState(false);

  // ---- Load menu ----------------------------------------------------------
  useEffect(() => {
    if (!locationId) return;
    let cancelled = false;
    setMenuLoading(true);
    setMenuError(null);

    Promise.all([
      supabase
        .from('categories')
        .select('*')
        .eq('location_id', locationId)
        .eq('is_active', true)
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true }),
      supabase
        .from('items')
        .select('*, category:categories(id, name)')
        .eq('location_id', locationId)
        .eq('is_active', true)
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true }),
    ])
      .then(([catRes, itemRes]) => {
        if (cancelled) return;
        setCategories(catRes.data || []);
        setItems(itemRes.data || []);
        setMenuLoading(false);
      })
      .catch((err) => {
        if (!cancelled) {
          setMenuError(err?.message || 'Failed to load menu');
          setMenuLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [locationId]);

  // ---- Filtered item list -------------------------------------------------
  const filteredItems = useMemo(() => {
    if (activeCat === 'all') return items;
    return items.filter(it => it.category_id === activeCat);
  }, [items, activeCat]);

  // Drink categories appear first in the chip rail (if any exist)
  const sortedCategories = useMemo(() => {
    const drinks = categories.filter(c => isDrinkCategory(c.name));
    const rest = categories.filter(c => !isDrinkCategory(c.name));
    return [...drinks, ...rest];
  }, [categories]);

  // ---- Cart helpers -------------------------------------------------------
  const addToCart = useCallback((item) => {
    const key = buildKey(item.id);
    const price = parseFloat(item.price || 0);
    setCart(prev => {
      const existing = prev.find(ci => ci.cartItemKey === key);
      if (existing) {
        return prev.map(ci =>
          ci.cartItemKey === key ? { ...ci, quantity: ci.quantity + 1 } : ci,
        );
      }
      return [
        ...prev,
        {
          ...item,
          cartItemKey: key,
          quantity: 1,
          price,
        },
      ];
    });
  }, []);

  const removeOne = useCallback((item) => {
    const key = buildKey(item.id);
    setCart(prev => {
      const existing = prev.find(ci => ci.cartItemKey === key);
      if (!existing) return prev;
      if (existing.quantity <= 1) return prev.filter(ci => ci.cartItemKey !== key);
      return prev.map(ci =>
        ci.cartItemKey === key ? { ...ci, quantity: ci.quantity - 1 } : ci,
      );
    });
  }, []);

  const updateQty = useCallback((cartItemKey, qty) => {
    if (qty <= 0) {
      setCart(prev => prev.filter(ci => ci.cartItemKey !== cartItemKey));
    } else {
      setCart(prev =>
        prev.map(ci => ci.cartItemKey === cartItemKey ? { ...ci, quantity: qty } : ci),
      );
    }
  }, []);

  const clearCart = useCallback(() => {
    setCart([]);
  }, []);

  const cartTotal = useMemo(
    () => cart.reduce((s, ci) => s + ci.price * ci.quantity, 0),
    [cart],
  );

  // ---- Quick-pour cart qty lookup (for badge on each button) --------------
  const cartQtyMap = useMemo(() => {
    const m = {};
    cart.forEach(ci => { m[ci.cartItemKey] = ci.quantity; });
    return m;
  }, [cart]);

  // ---- Charge / submit order ----------------------------------------------
  const handleCharge = useCallback(async () => {
    if (cart.length === 0 || charging) return;
    setCharging(true);
    setChargeError('');

    try {
      const result = await submitPosOrder({
        locationId,
        orderType: 'counter',
        items: cart.map(ci => ({
          item_id: ci.id,
          quantity: Math.max(1, Math.ceil(parseFloat(ci.quantity) || 1)),
        })),
      });

      const orderId = result?.id || result?.order_number || null;
      clearCart();

      if (orderId) {
        setReceiptOrderId(String(orderId));
        setReceiptOpen(true);
      }
    } catch (err) {
      setChargeError(err.message || 'Failed to place order. Please try again.');
    } finally {
      setCharging(false);
    }
  }, [cart, charging, locationId, clearCart]);

  // ---- Receipt handlers ---------------------------------------------------
  const handleReceiptClose = useCallback(() => {
    setReceiptOpen(false);
    setReceiptOrderId(null);
  }, []);

  const handleReceiptNewOrder = useCallback(() => {
    setReceiptOpen(false);
    setReceiptOrderId(null);
    clearCart();
  }, [clearCart]);

  // ---- Render -------------------------------------------------------------
  return (
    <div className="fixed inset-0 flex flex-col bg-gray-950 text-white overflow-hidden">
      {/* ------------------------------------------------------------------ */}
      {/* Top bar                                                             */}
      {/* ------------------------------------------------------------------ */}
      <header className="shrink-0 bg-gray-900 border-b border-white/10 px-4 py-3 flex items-center gap-3 shadow">
        {/* Brand mark */}
        <div className="w-9 h-9 rounded-xl bg-orange-500 flex items-center justify-center shrink-0">
          <Beer className="w-5 h-5 text-white" />
        </div>

        <div className="flex-1 min-w-0">
          <h1 className="text-base font-bold text-white truncate leading-tight">
            {storeName}
          </h1>
          <p className="text-[11px] text-orange-400 font-semibold uppercase tracking-wide leading-none">
            Quick Pour
          </p>
        </div>

        {/* Exit / back button — only rendered when onExit is provided */}
        {onExit && (
          <button
            onClick={onExit}
            className={cn(
              'flex items-center gap-1.5 h-9 px-3 rounded-lg',
              'border border-white/10 text-gray-400 hover:text-white hover:border-white/30',
              'text-sm transition-colors focus:outline-none',
            )}
          >
            <X className="w-4 h-4" />
            <span className="hidden sm:inline">Exit</span>
          </button>
        )}
      </header>

      {/* ------------------------------------------------------------------ */}
      {/* Category chips                                                      */}
      {/* ------------------------------------------------------------------ */}
      <div className="shrink-0 bg-gray-900/80 border-b border-white/10 px-4 py-2 overflow-x-auto">
        <div className="flex gap-2 min-w-max">
          <CategoryChip
            label="All"
            active={activeCat === 'all'}
            onClick={() => setActiveCat('all')}
          />
          {sortedCategories.map(cat => (
            <CategoryChip
              key={cat.id}
              label={cat.name}
              active={activeCat === cat.id}
              onClick={() => setActiveCat(cat.id)}
            />
          ))}
        </div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Main content: drink grid + cart panel                               */}
      {/* ------------------------------------------------------------------ */}
      <div className="flex flex-1 min-h-0 overflow-hidden flex-col md:flex-row">

        {/* Drink grid — fills all remaining space */}
        <div className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-4">
          {menuLoading && (
            <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
              {Array.from({ length: 18 }).map((_, i) => (
                <div
                  key={i}
                  className="h-36 rounded-2xl bg-gray-800 animate-pulse"
                />
              ))}
            </div>
          )}

          {!menuLoading && menuError && (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-red-400 py-20">
              <Utensils className="w-12 h-12 opacity-40" />
              <p className="text-sm font-medium text-center">{menuError}</p>
            </div>
          )}

          {!menuLoading && !menuError && filteredItems.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-gray-600 py-20">
              <Beer className="w-12 h-12 opacity-30" />
              <p className="text-sm">No items in this category</p>
            </div>
          )}

          {!menuLoading && !menuError && filteredItems.length > 0 && (
            <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
              {filteredItems.map(item => (
                <DrinkButton
                  key={item.id}
                  item={item}
                  currency={currency}
                  cartQty={cartQtyMap[buildKey(item.id)] || 0}
                  onTap={() => addToCart(item)}
                  onRemove={() => removeOne(item)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Cart panel */}
        <BarCart
          cart={cart}
          currency={currency}
          cartTotal={cartTotal}
          onUpdateQty={updateQty}
          onClear={clearCart}
          onCharge={handleCharge}
          charging={charging}
          chargeError={chargeError}
        />
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Receipt modal — shown after a successful charge                     */}
      {/* ------------------------------------------------------------------ */}
      <ReceiptModal
        orderId={receiptOrderId}
        open={receiptOpen}
        onClose={handleReceiptClose}
        onNewOrder={handleReceiptNewOrder}
      />
    </div>
  );
};

export default BarMode;
