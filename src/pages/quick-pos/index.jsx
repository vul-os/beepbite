/**
 * Quick POS — chrome-less kiosk page at /q/:slug
 *
 * Resolves the store/location via GET /stores/:slug (public endpoint).
 * Then loads the menu via Supabase (same query as home/pos-section).
 * No top nav, no sidebar — full-screen tap-to-order-to-tender in ≤5 taps.
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { Loader2, AlertCircle } from 'lucide-react';

import { getStore } from '@/services/marketplace';
import { submitPosOrder } from '@/services/pos';
import { supabase } from '@/services/supabase-client';

import KioskMenuGrid from './components/kiosk-menu-grid';
import KioskCartStrip from './components/kiosk-cart-strip';
import KioskTenderModal from './components/kiosk-tender-modal';
import KioskModifierPrompt from './components/kiosk-modifier-prompt';

// ---- cart helpers -------------------------------------------------------

function buildCartItemKey(item, selectedVariations) {
  const vKey = Object.keys(selectedVariations).sort()
    .map(k => `${k}:${selectedVariations[k]}`).join('|');
  return `${item.id}${vKey ? '|' + vKey : ''}`;
}

function computePrice(item, selectedVariations) {
  let price = parseFloat(item.price || 0);
  for (const variation of (item.item_variations || [])) {
    const optId = selectedVariations[variation.id];
    if (!optId) continue;
    const opt = variation.item_variation_options?.find(o => o.id === optId);
    if (opt) price += parseFloat(opt.price_modifier || 0);
  }
  return price;
}

function buildVariationDetails(item, selectedVariations) {
  const details = [];
  for (const variation of (item.item_variations || [])) {
    const optId = selectedVariations[variation.id];
    if (!optId) continue;
    const opt = variation.item_variation_options?.find(o => o.id === optId);
    if (opt) {
      details.push({
        variationName: variation.name,
        optionName: opt.name,
        priceModifier: parseFloat(opt.price_modifier || 0),
      });
    }
  }
  return details;
}

// ---- component ----------------------------------------------------------

const QuickPOS = () => {
  const { slug } = useParams();

  // Store / location resolution
  const [store, setStore] = useState(null);
  const [storeLoading, setStoreLoading] = useState(true);
  const [storeError, setStoreError] = useState(null);

  // Menu data
  const [items, setItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [menuLoading, setMenuLoading] = useState(false);

  // Cart
  const [cart, setCart] = useState([]);
  const [cartCollapsed, setCartCollapsed] = useState(true);

  // Modifier prompt
  const [modifierItem, setModifierItem] = useState(null);

  // Tender modal
  const [tenderOpen, setTenderOpen] = useState(false);
  const [tenderLoading, setTenderLoading] = useState(false);
  const [tenderError, setTenderError] = useState('');
  const [lastOrderNumber, setLastOrderNumber] = useState(null);

  // ---- Resolve store by slug -------------------------------------------
  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    setStoreLoading(true);
    setStoreError(null);

    getStore(slug).then(({ data, error }) => {
      if (cancelled) return;
      if (error || !data) {
        setStoreError(error?.message || 'Store not found');
      } else {
        setStore(data);
      }
      setStoreLoading(false);
    }).catch(err => {
      if (!cancelled) {
        setStoreError(err?.message || 'Failed to load store');
        setStoreLoading(false);
      }
    });

    return () => { cancelled = true; };
  }, [slug]);

  // ---- Load menu once store is resolved --------------------------------
  const locationId = store?.location_id || store?.id;
  const currency = store?.currency_code || store?.currency || 'USD';

  useEffect(() => {
    if (!locationId) return;
    let cancelled = false;
    setMenuLoading(true);

    Promise.all([
      supabase.from('categories')
        .select('*')
        .eq('location_id', locationId)
        .eq('is_active', true)
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true }),
      supabase.from('items')
        .select(`
          *,
          category:categories (id, name),
          item_variations (
            id, name, is_required,
            item_variation_options (id, name, price_modifier, is_default)
          )
        `)
        .eq('location_id', locationId)
        .eq('is_active', true)
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true }),
    ]).then(([catRes, itemRes]) => {
      if (cancelled) return;
      setCategories(catRes.data || []);
      setItems(itemRes.data || []);
      setMenuLoading(false);
    }).catch(() => {
      if (!cancelled) setMenuLoading(false);
    });

    return () => { cancelled = true; };
  }, [locationId]);

  // ---- Cart logic ------------------------------------------------------

  const addItem = useCallback((item, selectedVariations = {}) => {
    const key = buildCartItemKey(item, selectedVariations);
    const price = computePrice(item, selectedVariations);
    const variationDetails = buildVariationDetails(item, selectedVariations);

    setCart(prev => {
      const existing = prev.find(ci => ci.cartItemKey === key);
      if (existing) {
        return prev.map(ci =>
          ci.cartItemKey === key ? { ...ci, quantity: ci.quantity + 1 } : ci
        );
      }
      return [...prev, {
        ...item,
        cartItemKey: key,
        quantity: 1,
        price,
        basePrice: parseFloat(item.price || 0),
        selectedVariations,
        variationDetails,
      }];
    });
    setCartCollapsed(false);
  }, []);

  // When user taps an item on the grid
  const handleTapItem = useCallback((item) => {
    const hasVariations = item.item_variations?.length > 0;
    if (hasVariations) {
      setModifierItem(item);
    } else {
      addItem(item, {});
    }
  }, [addItem]);

  // Modifier prompt confirmed
  const handleModifierConfirm = useCallback((selections) => {
    if (!modifierItem) return;
    addItem(modifierItem, selections);
    setModifierItem(null);
  }, [modifierItem, addItem]);

  const updateQty = useCallback((cartItemKey, qty) => {
    if (qty <= 0) {
      setCart(prev => prev.filter(ci => ci.cartItemKey !== cartItemKey));
    } else {
      setCart(prev => prev.map(ci =>
        ci.cartItemKey === cartItemKey ? { ...ci, quantity: qty } : ci
      ));
    }
  }, []);

  const clearCart = useCallback(() => {
    setCart([]);
    setCartCollapsed(true);
  }, []);

  const cartTotal = useMemo(
    () => cart.reduce((s, ci) => s + ci.price * ci.quantity, 0),
    [cart]
  );

  // ---- Tender / order placement ----------------------------------------

  const handleCheckout = useCallback(() => {
    if (cart.length === 0) return;
    setTenderError('');
    setLastOrderNumber(null);
    setTenderOpen(true);
  }, [cart.length]);

  const handleTenderConfirm = useCallback(async ({ method }) => {
    setTenderLoading(true);
    setTenderError('');
    try {
      const result = await submitPosOrder({
        locationId,
        orderType: 'counter',
        items: cart.map(ci => ({
          item_id: ci.id,
          quantity: Math.max(1, Math.ceil(parseFloat(ci.quantity) || 1)),
          variation_option_ids: ci.selectedVariations
            ? Object.values(ci.selectedVariations).filter(Boolean)
            : [],
        })),
      });
      const orderNum = result?.order_number || result?.id || '?';
      setLastOrderNumber(orderNum);
      clearCart();
    } catch (err) {
      setTenderError(err.message || 'Failed to place order. Please try again.');
    } finally {
      setTenderLoading(false);
    }
  }, [locationId, cart, clearCart]);

  const handleTenderClose = useCallback(() => {
    setTenderOpen(false);
    setLastOrderNumber(null);
    setTenderError('');
  }, []);

  // ---- Render ----------------------------------------------------------

  if (storeLoading) {
    return (
      <div className="fixed inset-0 bg-gradient-to-br from-orange-50 to-amber-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-orange-500">
          <Loader2 className="w-12 h-12 animate-spin" />
          <p className="text-lg font-medium text-gray-600">Loading menu…</p>
        </div>
      </div>
    );
  }

  if (storeError || !store) {
    return (
      <div className="fixed inset-0 bg-gradient-to-br from-orange-50 to-amber-50 flex items-center justify-center p-6">
        <div className="flex flex-col items-center gap-4 text-center max-w-sm">
          <AlertCircle className="w-16 h-16 text-orange-400" />
          <h1 className="text-2xl font-bold text-gray-900">Store not found</h1>
          <p className="text-gray-500">{storeError || `No store found at "${slug}"`}</p>
        </div>
      </div>
    );
  }

  const storeName = store.name || store.business_name || slug;

  return (
    // Full-screen, no scrollbars, kiosk-friendly
    <div className="fixed inset-0 bg-gradient-to-br from-orange-50 to-amber-50 flex flex-col overflow-hidden">
      {/* Minimal header strip — store name only, no nav */}
      <header className="shrink-0 bg-orange-500 px-5 py-3 flex items-center gap-3 shadow-sm">
        <h1 className="text-white text-xl font-bold truncate">{storeName}</h1>
      </header>

      {/* Menu grid — fills remaining space above cart strip */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <KioskMenuGrid
          items={items}
          categories={categories}
          loading={menuLoading}
          currency={currency}
          onAddItem={handleTapItem}
        />
      </div>

      {/* Cart strip — compact bar at bottom, expandable */}
      <KioskCartStrip
        cart={cart}
        currency={currency}
        onUpdateQty={updateQty}
        onClear={clearCart}
        onCheckout={handleCheckout}
        collapsed={cartCollapsed || cart.length === 0}
        onToggleCollapse={() => cart.length > 0 && setCartCollapsed(c => !c)}
      />

      {/* Modifier prompt overlay */}
      {modifierItem && (
        <KioskModifierPrompt
          item={modifierItem}
          currency={currency}
          onConfirm={handleModifierConfirm}
          onCancel={() => setModifierItem(null)}
        />
      )}

      {/* Tender modal overlay */}
      {tenderOpen && (
        <KioskTenderModal
          total={cartTotal}
          currency={currency}
          onClose={handleTenderClose}
          onConfirm={handleTenderConfirm}
          loading={tenderLoading}
          error={tenderError}
          lastOrderNumber={lastOrderNumber}
        />
      )}
    </div>
  );
};

export default QuickPOS;
