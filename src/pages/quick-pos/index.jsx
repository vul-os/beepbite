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
import ReceiptModal from '@/pages/pos/components/receipt-modal';

// ---- cart helpers -------------------------------------------------------

/**
 * Build a stable cart-item key from the item id + sorted selected modifier ids.
 * @param {string} itemId
 * @param {string[]} selectedModifierIds
 */
function buildCartItemKey(itemId, selectedModifierIds) {
  const mKey = [...selectedModifierIds].sort().join('|');
  return `${itemId}${mKey ? '|' + mKey : ''}`;
}

/**
 * Compute line price in currency units given base price + selected modifiers.
 * @param {number} basePrice   - item.price as a float
 * @param {Array}  modifiers   - [{price_delta_cents, ...}] selected modifier objects
 */
function computeModifierPrice(basePrice, modifiers) {
  const extraCents = modifiers.reduce((s, m) => s + (m.price_delta_cents || 0), 0);
  return basePrice + extraCents / 100;
}

// ---- component ----------------------------------------------------------

const QuickPOS = () => {
  const { slug } = useParams();

  // Store / location resolution
  const [store, setStore] = useState(null);
  const [storeLoading, setStoreLoading] = useState(true);
  const [storeError, setStoreError] = useState(null);

  // Menu data (items now include modifier_groups via separate fetch in effect below)
  const [items, setItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [menuLoading, setMenuLoading] = useState(false);

  // Cart
  const [cart, setCart] = useState([]);
  const [cartCollapsed, setCartCollapsed] = useState(true);

  // Modifier prompt — item being customised (with modifier_groups attached)
  const [modifierItem, setModifierItem] = useState(null);

  // Tender modal
  const [tenderOpen, setTenderOpen] = useState(false);
  const [tenderLoading, setTenderLoading] = useState(false);
  const [tenderError, setTenderError] = useState('');
  const [lastOrderNumber, setLastOrderNumber] = useState(null);

  // Receipt modal — shown after a successful tender
  const [receiptOrderId, setReceiptOrderId] = useState(null);
  const [receiptOpen, setReceiptOpen] = useState(false);

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
          category:categories (id, name)
        `)
        .eq('location_id', locationId)
        .eq('is_active', true)
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true }),
    ]).then(async ([catRes, itemRes]) => {
      if (cancelled) return;
      const fetchedItems = itemRes.data || [];
      setCategories(catRes.data || []);

      // Fetch modifier_groups + modifiers for all items in one shot
      if (fetchedItems.length > 0) {
        const itemIds = fetchedItems.map(it => it.id);
        const [{ data: gData }, { data: mData }] = await Promise.all([
          supabase.from('modifier_groups')
            .select('*')
            .in('item_id', itemIds)
            .order('sort_order', { ascending: true })
            .order('name', { ascending: true }),
          supabase.from('modifiers')
            .select('*')
            .eq('is_active', true)
            .order('sort_order', { ascending: true })
            .order('name', { ascending: true }),
        ]);

        if (!cancelled) {
          const groups = gData || [];
          const modifiers = mData || [];

          // Index: groupId → modifiers[]
          const modsByGroup = {};
          modifiers.forEach(m => {
            if (!modsByGroup[m.modifier_group_id]) modsByGroup[m.modifier_group_id] = [];
            modsByGroup[m.modifier_group_id].push(m);
          });

          // Index: itemId → groups[] (with nested modifiers)
          const groupsByItem = {};
          groups.forEach(g => {
            if (!groupsByItem[g.item_id]) groupsByItem[g.item_id] = [];
            groupsByItem[g.item_id].push({ ...g, modifiers: modsByGroup[g.id] || [] });
          });

          setItems(fetchedItems.map(it => ({
            ...it,
            modifier_groups: groupsByItem[it.id] || [],
          })));
        }
      } else {
        if (!cancelled) setItems([]);
      }

      if (!cancelled) setMenuLoading(false);
    }).catch(() => {
      if (!cancelled) setMenuLoading(false);
    });

    return () => { cancelled = true; };
  }, [locationId]);

  // ---- Cart logic ------------------------------------------------------

  /**
   * Add (or stack) an item into the cart.
   * @param {object} item                - menu item with modifier_groups attached
   * @param {Array}  selectedModifiers   - [{id, name, price_delta_cents, ...}]
   */
  const addItem = useCallback((item, selectedModifiers = []) => {
    const selectedModifierIds = selectedModifiers.map(m => m.id);
    const key = buildCartItemKey(item.id, selectedModifierIds);
    const basePrice = parseFloat(item.price || 0);
    const price = computeModifierPrice(basePrice, selectedModifiers);

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
        basePrice,
        selectedModifiers,
        selectedModifierIds,
      }];
    });
    setCartCollapsed(false);
  }, []);

  // When user taps an item on the grid
  const handleTapItem = useCallback((item) => {
    const hasModifierGroups = (item.modifier_groups || []).length > 0;
    if (hasModifierGroups) {
      setModifierItem(item);
    } else {
      addItem(item, []);
    }
  }, [addItem]);

  // Modifier prompt confirmed — selectedModifiers is [{id, name, price_delta_cents, ...}]
  const handleModifierConfirm = useCallback((selectedModifiers) => {
    if (!modifierItem) return;
    addItem(modifierItem, selectedModifiers);
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
        items: cart.map(ci => {
          const lineItem = {
            item_id: ci.id,
            quantity: Math.max(1, Math.ceil(parseFloat(ci.quantity) || 1)),
          };
          if (ci.selectedModifierIds && ci.selectedModifierIds.length > 0) {
            lineItem.modifiers = ci.selectedModifierIds.map(id => ({ modifier_id: id }));
          }
          return lineItem;
        }),
      });
      const orderNum = result?.order_number || result?.id || '?';
      setLastOrderNumber(orderNum);
      clearCart();

      // Open receipt modal with the returned order id (prefer uuid id; fall back to order_number)
      const orderId = result?.id || result?.order_number || null;
      if (orderId) {
        setReceiptOrderId(String(orderId));
        setTenderOpen(false);
        setReceiptOpen(true);
      }
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

  // Receipt modal handlers
  const handleReceiptClose = useCallback(() => {
    setReceiptOpen(false);
    setReceiptOrderId(null);
  }, []);

  const handleReceiptNewOrder = useCallback(() => {
    // Reset kiosk for next customer — clear cart + close receipt
    setReceiptOpen(false);
    setReceiptOrderId(null);
    setLastOrderNumber(null);
    clearCart();
  }, [clearCart]);

  // ---- Render ----------------------------------------------------------

  if (storeLoading) {
    return (
      <div className="fixed inset-0 bg-gradient-to-br from-orange-50 to-amber-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4 text-orange-500" role="status" aria-label="Loading menu">
          <div className="w-20 h-20 rounded-full bg-orange-500/10 flex items-center justify-center">
            <Loader2 className="w-10 h-10 animate-spin text-orange-500" />
          </div>
          <p className="text-lg font-semibold text-gray-600">Loading menu…</p>
        </div>
      </div>
    );
  }

  if (storeError || !store) {
    return (
      <div className="fixed inset-0 bg-gradient-to-br from-orange-50 to-amber-50 flex items-center justify-center p-6">
        <div className="flex flex-col items-center gap-4 text-center max-w-sm" role="alert">
          <div className="w-20 h-20 rounded-full bg-red-100 flex items-center justify-center">
            <AlertCircle className="w-10 h-10 text-red-400" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Store not found</h1>
          <p className="text-gray-500 text-sm">{storeError || `No store found at "${slug}"`}</p>
        </div>
      </div>
    );
  }

  const storeName = store.name || store.business_name || slug;

  return (
    // Full-screen, no scrollbars, kiosk-friendly
    <div className="fixed inset-0 bg-gradient-to-br from-orange-50 to-amber-50 flex flex-col overflow-hidden">
      {/* Minimal header strip — store name only, no nav */}
      <header className="shrink-0 bg-orange-500 px-5 py-3.5 flex items-center gap-3 shadow-md">
        <h1 className="text-white text-xl font-bold tracking-tight truncate">{storeName}</h1>
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

      {/* Receipt modal — shown after a successful payment */}
      <ReceiptModal
        orderId={receiptOrderId}
        open={receiptOpen}
        onClose={handleReceiptClose}
        onNewOrder={handleReceiptNewOrder}
      />
    </div>
  );
};

export default QuickPOS;
