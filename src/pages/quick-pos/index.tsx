/**
 * Quick POS — chrome-less kiosk page at /q/:slug
 *
 * Resolves the store/location via GET /stores/:slug (public endpoint).
 * Then loads the menu via Supabase (same query as home/pos-section).
 * No top nav, no sidebar — full-screen tap-to-order-to-tender in ≤5 taps.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { Loader2, AlertCircle } from 'lucide-react';

import { getStore, type StoreDetail } from '@/services/marketplace';
import { submitPosOrder } from '@/services/pos';
import { supabase } from '@/services/supabase-client';

import KioskMenuGrid from './components/kiosk-menu-grid';
import KioskCartStrip from './components/kiosk-cart-strip';
import KioskTenderModal from './components/kiosk-tender-modal';
import KioskModifierPrompt from './components/kiosk-modifier-prompt';
import ReceiptModal from '@/pages/pos/components/receipt-modal';
import { OfflineBanner } from '@/components/ui/sync-status';

// ---- Kiosk menu types -----------------------------------------------------
// Mirrors backend/migrations/001_baseline.sql `categories` table (subset).
export interface KioskCategory {
  id: string;
  name: string;
  sort_order?: number;
  [key: string]: unknown;
}

// Mirrors backend/migrations/001_baseline.sql `modifiers` table.
export interface KioskModifier {
  id: string;
  modifier_group_id?: string;
  name: string;
  price_delta_cents: number;
  is_default?: boolean;
  is_active?: boolean;
  sort_order?: number;
}

// Mirrors backend/migrations/001_baseline.sql `modifier_groups` table, with
// `modifiers` nested client-side in the fetch effect below.
export interface KioskModifierGroup {
  id: string;
  item_id?: string;
  name: string;
  min_select?: number;
  max_select?: number;
  is_required?: boolean;
  sort_order?: number;
  modifiers: KioskModifier[];
}

// Mirrors backend/migrations/001_baseline.sql `items` table (subset used by
// the kiosk), with `category` embedded (Supabase-style join) and
// `modifier_groups` nested client-side.
export interface KioskItem {
  id: string;
  category_id?: string;
  name: string;
  description?: string | null;
  price: string | number;
  daily_quantity?: number | null;
  daily_sold_count?: number;
  daily_counter_date?: string | null;
  category?: { id: string; name: string } | null;
  modifier_groups?: KioskModifierGroup[];
  [key: string]: unknown;
}

export interface KioskCartItem extends KioskItem {
  cartItemKey: string;
  quantity: number;
  price: number;
  basePrice: number;
  selectedModifiers: KioskModifier[];
  selectedModifierIds: string[];
}

// ---- cart helpers -------------------------------------------------------

/**
 * Build a stable cart-item key from the item id + sorted selected modifier ids.
 */
function buildCartItemKey(itemId: string, selectedModifierIds: string[]) {
  const mKey = [...selectedModifierIds].sort().join('|');
  return `${itemId}${mKey ? '|' + mKey : ''}`;
}

/**
 * Compute line price in currency units given base price + selected modifiers.
 * @param basePrice   - item.price as a float
 * @param modifiers   - selected modifier objects
 */
function computeModifierPrice(basePrice: number, modifiers: KioskModifier[]) {
  const extraCents = modifiers.reduce((s, m) => s + (m.price_delta_cents || 0), 0);
  return basePrice + extraCents / 100;
}

// ---- component ----------------------------------------------------------

const QuickPOS = () => {
  const { slug } = useParams<{ slug: string }>();

  // Store / location resolution
  const [store, setStore] = useState<StoreDetail | null>(null);
  const [storeLoading, setStoreLoading] = useState(true);
  const [storeError, setStoreError] = useState<string | null>(null);

  // Menu data (items now include modifier_groups via separate fetch in effect below)
  const [items, setItems] = useState<KioskItem[]>([]);
  const [categories, setCategories] = useState<KioskCategory[]>([]);
  const [menuLoading, setMenuLoading] = useState(false);

  // Cart
  const [cart, setCart] = useState<KioskCartItem[]>([]);
  const [cartCollapsed, setCartCollapsed] = useState(true);

  // Modifier prompt — item being customised (with modifier_groups attached)
  const [modifierItem, setModifierItem] = useState<KioskItem | null>(null);

  // Tender modal
  const [tenderOpen, setTenderOpen] = useState(false);
  const [tenderLoading, setTenderLoading] = useState(false);
  const [tenderError, setTenderError] = useState('');
  const [lastOrderNumber, setLastOrderNumber] = useState<string | null>(null);

  // Receipt modal — shown after a successful tender
  const [receiptOrderId, setReceiptOrderId] = useState<string | null>(null);
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
        setStoreError(err instanceof Error ? err.message : 'Failed to load store');
        setStoreLoading(false);
      }
    });

    return () => { cancelled = true; };
  }, [slug]);

  // ---- Load menu once store is resolved --------------------------------
  // `location_id` never exists on the real StoreDetail DTO (see
  // services/marketplace.ts) — dead defensive fallback preserved via a
  // cast; store.id is what actually resolves in practice.
  const locationId = (store?.location_id as string | undefined) || store?.id;
  // `currency` never exists on the real StoreDetail DTO either — only
  // `currency_code` does.
  const currency = (store?.currency_code || store?.currency || 'USD') as string;

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
      const fetchedItems: KioskItem[] = itemRes.data || [];
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
          const groups: KioskModifierGroup[] = gData || [];
          const modifiers: KioskModifier[] = mData || [];

          // Index: groupId → modifiers[]
          const modsByGroup: Record<string, KioskModifier[]> = {};
          modifiers.forEach(m => {
            const gid = m.modifier_group_id as string;
            if (!modsByGroup[gid]) modsByGroup[gid] = [];
            modsByGroup[gid].push(m);
          });

          // Index: itemId → groups[] (with nested modifiers)
          const groupsByItem: Record<string, KioskModifierGroup[]> = {};
          groups.forEach(g => {
            const iid = g.item_id as string;
            if (!groupsByItem[iid]) groupsByItem[iid] = [];
            groupsByItem[iid].push({ ...g, modifiers: modsByGroup[g.id] || [] });
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
   */
  const addItem = useCallback((item: KioskItem, selectedModifiers: KioskModifier[] = []) => {
    const selectedModifierIds = selectedModifiers.map(m => m.id);
    const key = buildCartItemKey(item.id, selectedModifierIds);
    const basePrice = parseFloat(String(item.price || 0));
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
  const handleTapItem = useCallback((item: KioskItem) => {
    const hasModifierGroups = (item.modifier_groups || []).length > 0;
    if (hasModifierGroups) {
      setModifierItem(item);
    } else {
      addItem(item, []);
    }
  }, [addItem]);

  // Modifier prompt confirmed — selectedModifiers is [{id, name, price_delta_cents, ...}]
  const handleModifierConfirm = useCallback((selectedModifiers: KioskModifier[]) => {
    if (!modifierItem) return;
    addItem(modifierItem, selectedModifiers);
    setModifierItem(null);
  }, [modifierItem, addItem]);

  const updateQty = useCallback((cartItemKey: string, qty: number) => {
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

  const handleTenderConfirm = useCallback(async ({ method }: { method: 'cash' | 'card' }) => {
    setTenderLoading(true);
    setTenderError('');
    try {
      const result = await submitPosOrder({
        locationId: locationId as string,
        orderType: 'counter',
        items: cart.map(ci => {
          const lineItem: { item_id: string; quantity: number; modifiers?: { modifier_id: string }[] } = {
            item_id: ci.id,
            quantity: Math.max(1, Math.ceil(parseFloat(String(ci.quantity)) || 1)),
          };
          if (ci.selectedModifierIds && ci.selectedModifierIds.length > 0) {
            lineItem.modifiers = ci.selectedModifierIds.map(id => ({ modifier_id: id }));
          }
          return lineItem;
        }),
      });
      const orderNum = result?.order_number || '?';
      setLastOrderNumber(orderNum);
      clearCart();

      // Open receipt modal. CreatedOrder (mirrors backend/internal/handlers/
      // pos/store.go) has no `id` field — only `order_id`/`order_number` — so
      // this uses order_number, same as the order-number line above.
      const orderId = result?.order_number || null;
      if (orderId) {
        setReceiptOrderId(String(orderId));
        setTenderOpen(false);
        setReceiptOpen(true);
      }
    } catch (err) {
      setTenderError(err instanceof Error ? err.message : 'Failed to place order. Please try again.');
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
      <div className="fixed inset-0 bg-primary/5 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4 text-primary" role="status" aria-label="Loading menu">
          <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center">
            <Loader2 className="w-10 h-10 animate-spin text-primary" />
          </div>
          <p className="text-lg font-semibold text-muted-foreground">Loading menu…</p>
        </div>
      </div>
    );
  }

  if (storeError || !store) {
    return (
      <div className="fixed inset-0 bg-primary/5 flex items-center justify-center p-6">
        <div className="flex flex-col items-center gap-4 text-center max-w-sm" role="alert">
          <div className="w-20 h-20 rounded-full bg-destructive/10 flex items-center justify-center">
            <AlertCircle className="w-10 h-10 text-destructive" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">Store not found</h1>
          <p className="text-muted-foreground text-sm">{storeError || `No store found at "${slug}"`}</p>
        </div>
      </div>
    );
  }

  // `business_name` never exists on the real StoreDetail DTO — dead
  // defensive fallback preserved via a cast.
  const storeName = store.name || (store.business_name as string | undefined) || slug;

  return (
    // Full-screen, no scrollbars, kiosk-friendly
    <div className="fixed inset-0 bg-primary/5 flex flex-col overflow-hidden">
      {/* Minimal header strip — store name only, no nav */}
      <header className="shrink-0 bg-primary px-5 py-3.5 flex items-center gap-3 shadow-md">
        <h1 className="font-display text-primary-foreground text-xl tracking-tight truncate">{storeName}</h1>
      </header>

      {/* This screen POSTs orders directly (submitPosOrder) with no top bar
          to host a status badge — a dropped connection here is invisible
          otherwise. Renders nothing once synced. */}
      <OfflineBanner />

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
        orderId={receiptOrderId as string}
        open={receiptOpen}
        onClose={handleReceiptClose}
        onNewOrder={handleReceiptNewOrder}
      />
    </div>
  );
};

export default QuickPOS;
