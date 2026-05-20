import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { MapPin, Star, Clock, ChevronLeft, ShoppingCart } from 'lucide-react';
import { getStore, readCart, writeCart } from '@/services/marketplace';
import MenuSection from './components/menu-section';
import CartWidget from './components/cart-widget';

function StoreHeaderSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-40 sm:h-56 w-full rounded-none" />
      <div className="px-4 space-y-2">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-32" />
      </div>
    </div>
  );
}

/**
 * Cart state helpers — merge add/remove into the items array.
 */
function addToCart(items, item) {
  const existing = items.find((i) => i.id === item.id);
  if (existing) {
    return items.map((i) =>
      i.id === item.id ? { ...i, quantity: (i.quantity ?? 1) + 1 } : i
    );
  }
  return [...items, { id: item.id, name: item.name, price: item.price, quantity: 1 }];
}

function removeFromCart(items, item) {
  return items
    .map((i) =>
      i.id === item.id ? { ...i, quantity: (i.quantity ?? 1) - 1 } : i
    )
    .filter((i) => (i.quantity ?? 0) > 0);
}

export default function StoreDetailPage() {
  const { slug } = useParams();
  const navigate = useNavigate();

  const [store, setStore] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Cart — initialise from localStorage
  const [cartItems, setCartItems] = useState(() => readCart(slug));
  const [cartOpen, setCartOpen] = useState(false);

  // Persist cart to localStorage whenever it changes
  useEffect(() => {
    writeCart(slug, cartItems);
  }, [slug, cartItems]);

  // Fetch store detail
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    getStore(slug)
      .then(({ data, error: err }) => {
        if (cancelled) return;
        if (err) throw new Error(err.message || 'Store not found');
        setStore(data);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [slug]);

  const handleAdd = useCallback((item) => {
    setCartItems((prev) => addToCart(prev, item));
  }, []);

  const handleRemove = useCallback((item) => {
    setCartItems((prev) => removeFromCart(prev, item));
  }, []);

  const handleClear = useCallback(() => {
    setCartItems([]);
  }, []);

  const cartQty = cartItems.reduce((s, i) => s + (i.quantity ?? 1), 0);
  const menu = store?.menu || store?.categories || [];

  return (
    <div className="min-h-screen bg-background">
      {/* Back nav */}
      <div className="sticky top-0 z-20 bg-background/95 backdrop-blur border-b px-4 h-12 flex items-center justify-between">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
          Back
        </button>

        {/* Mobile cart trigger */}
        <Sheet open={cartOpen} onOpenChange={setCartOpen}>
          <SheetTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="relative gap-2 border-orange-300 text-orange-600 hover:bg-orange-50 sm:hidden"
            >
              <ShoppingCart className="h-4 w-4" />
              {cartQty > 0 && (
                <span className="absolute -top-1.5 -right-1.5 bg-orange-500 text-white text-xs rounded-full h-4 w-4 flex items-center justify-center">
                  {cartQty}
                </span>
              )}
              Cart
            </Button>
          </SheetTrigger>
          <SheetContent side="bottom" className="h-auto max-h-[80vh] overflow-y-auto rounded-t-xl">
            <div className="pt-2 pb-4">
              <CartWidget
                slug={slug}
                items={cartItems}
                onAdd={handleAdd}
                onRemove={handleRemove}
                onClear={handleClear}
                storeName={store?.name}
                currency={store?.currency || store?.default_currency_code || store?.currency_code || 'USD'}
              />
            </div>
          </SheetContent>
        </Sheet>
      </div>

      {/* Store header */}
      {loading ? (
        <StoreHeaderSkeleton />
      ) : error ? (
        <div className="px-4 py-10 text-center space-y-3">
          <p className="text-destructive text-sm">{error}</p>
          <Button variant="outline" size="sm" onClick={() => navigate('/discover')}>
            Back to discover
          </Button>
        </div>
      ) : store ? (
        <>
          {/* Cover image */}
          <div className="relative h-40 sm:h-56 bg-orange-100 overflow-hidden">
            {store.cover_image_url ? (
              <img
                src={store.cover_image_url}
                alt={store.name}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-orange-100 to-orange-200">
                <span className="text-6xl">🍽️</span>
              </div>
            )}
          </div>

          {/* Store info */}
          <div className="px-4 pt-4 pb-3 border-b space-y-2">
            <div className="flex items-start gap-3">
              {store.logo_url && (
                <img
                  src={store.logo_url}
                  alt={`${store.name} logo`}
                  className="h-12 w-12 rounded-full border object-cover shrink-0 -mt-6 shadow"
                />
              )}
              <div className="flex-1 min-w-0">
                <h1 className="text-xl font-bold leading-tight">{store.name}</h1>
                {store.cuisine_type && (
                  <Badge variant="outline" className="text-xs border-orange-300 text-orange-600 mt-1">
                    {store.cuisine_type}
                  </Badge>
                )}
              </div>
              {store.is_open !== undefined && (
                <Badge className={store.is_open ? 'bg-green-500 shrink-0' : 'bg-gray-400 shrink-0'}>
                  {store.is_open ? 'Open' : 'Closed'}
                </Badge>
              )}
            </div>

            {store.description && (
              <p className="text-sm text-muted-foreground">{store.description}</p>
            )}

            {/* Meta */}
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {store.city && (
                <span className="flex items-center gap-1">
                  <MapPin className="h-3 w-3 text-orange-500" />
                  {store.city}
                </span>
              )}
              {store.rating && (
                <span className="flex items-center gap-1">
                  <Star className="h-3 w-3 fill-orange-400 text-orange-400" />
                  {Number(store.rating).toFixed(1)}
                  {store.review_count ? ` (${store.review_count} reviews)` : ''}
                </span>
              )}
              {store.delivery_time_min && (
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3 text-orange-500" />
                  {store.delivery_time_min}–{store.delivery_time_max ?? store.delivery_time_min + 10} min
                </span>
              )}
            </div>
          </div>

          {/* Two-column layout: menu + sidebar cart */}
          <div className="max-w-5xl mx-auto px-4 py-4 flex gap-6">
            {/* Menu */}
            <div className="flex-1 min-w-0">
              <MenuSection
                menu={menu}
                cartItems={cartItems}
                onAddItem={handleAdd}
                onRemoveItem={handleRemove}
                currency={store?.currency || store?.default_currency_code || store?.currency_code || 'USD'}
              />
            </div>

            {/* Desktop sticky cart */}
            <div className="hidden sm:block w-72 shrink-0">
              <div className="sticky top-16">
                <CartWidget
                  slug={slug}
                  items={cartItems}
                  onAdd={handleAdd}
                  onRemove={handleRemove}
                  onClear={handleClear}
                  storeName={store?.name}
                  currency={store?.currency || store?.default_currency_code || store?.currency_code || 'USD'}
                />
              </div>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
