import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { MapPin, Star, Clock, ChevronLeft, ShoppingCart, Truck, Store } from 'lucide-react';
import { getStore, readCart, writeCart, readCartMeta, writeCartMeta } from '@/services/marketplace';
import MenuSection from './components/menu-section';
import CartWidget from './components/cart-widget';

function StoreHeaderSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <Skeleton className="h-44 sm:h-60 w-full rounded-none" />
      <div className="px-4 space-y-2.5">
        <div className="flex items-center gap-3">
          <Skeleton className="h-12 w-12 rounded-full shrink-0" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-3 w-24" />
          </div>
        </div>
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-3/4" />
        <div className="flex gap-3 pt-1">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 w-24" />
        </div>
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

/**
 * Derive which fulfillment modes a store offers.
 * If neither flag is present (backend gap), default to offering both.
 *
 * @param {object} store
 * @returns {{ offersDelivery: boolean, offersCollection: boolean }}
 */
function getFulfillmentOptions(store) {
  if (!store) return { offersDelivery: true, offersCollection: true };

  const hasDeliveryFlag = 'offers_delivery' in store;
  const hasCollectionFlag = 'offers_collection' in store;

  // Defensive: if neither flag is present, show both
  if (!hasDeliveryFlag && !hasCollectionFlag) {
    return { offersDelivery: true, offersCollection: true };
  }

  return {
    offersDelivery: store.offers_delivery === true,
    offersCollection: store.offers_collection === true,
  };
}

/**
 * FulfillmentSelector — shows a Delivery / Collection toggle (or nothing if
 * only one mode is available, which gets auto-selected).
 */
function FulfillmentSelector({ store, value, onChange, deliveryAddress, onAddressChange }) {
  const { offersDelivery, offersCollection } = getFulfillmentOptions(store);

  // Build store address string for collection note
  const storeAddress = [store?.address, store?.city, store?.country]
    .filter(Boolean)
    .join(', ');

  const showToggle = offersDelivery && offersCollection;

  return (
    <div className="rounded-xl border border-border/60 bg-muted/30 px-4 py-3 space-y-3">
      {/* Tab-style toggle — only shown when both modes are available */}
      {showToggle && (
        <div className="flex gap-2 p-1 bg-muted rounded-lg w-fit">
          <button
            type="button"
            onClick={() => onChange('delivery')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
              value === 'delivery'
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:text-primary'
            }`}
          >
            <Truck className="h-3.5 w-3.5" />
            Delivery
          </button>
          <button
            type="button"
            onClick={() => onChange('collection')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
              value === 'collection'
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:text-primary'
            }`}
          >
            <Store className="h-3.5 w-3.5" />
            Collection
          </button>
        </div>
      )}

      {/* Single-mode label when only one is available */}
      {!showToggle && (
        <div className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
          {value === 'delivery' ? (
            <>
              <Truck className="h-3.5 w-3.5 text-primary" />
              <span>Delivery only</span>
            </>
          ) : (
            <>
              <Store className="h-3.5 w-3.5 text-primary" />
              <span>Collection only</span>
            </>
          )}
        </div>
      )}

      {/* Delivery address input */}
      {value === 'delivery' && (
        <div className="space-y-1.5">
          <Label htmlFor="delivery-address" className="text-xs text-muted-foreground font-medium">
            Delivery address
          </Label>
          <Input
            id="delivery-address"
            type="text"
            placeholder="Enter your delivery address"
            value={deliveryAddress}
            onChange={(e) => onAddressChange(e.target.value)}
            className="h-9 text-sm focus-visible:ring-ring bg-background"
          />
        </div>
      )}

      {/* Collection note */}
      {value === 'collection' && (
        <p className="text-xs text-muted-foreground flex items-start gap-1.5">
          <MapPin className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            Collect at{' '}
            <span className="font-medium text-foreground">
              {storeAddress || store?.name || 'the store'}
            </span>
          </span>
        </p>
      )}
    </div>
  );
}

export default function StoreDetailPage() {
  const { slug } = useParams();
  const navigate = useNavigate();

  const [store, setStore] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Cart — initialise items from localStorage
  const [cartItems, setCartItems] = useState(() => readCart(slug));
  const [cartOpen, setCartOpen] = useState(false);

  // Fulfillment — initialise from localStorage meta
  const [fulfillmentType, setFulfillmentType] = useState(() => {
    const meta = readCartMeta(slug);
    return meta.fulfillment_type || null; // null = not yet resolved; set once store loads
  });
  const [deliveryAddress, setDeliveryAddress] = useState(() => {
    const meta = readCartMeta(slug);
    return meta.delivery_address || '';
  });

  // Once store data is available, auto-select fulfillment type if not already set
  useEffect(() => {
    if (!store) return;
    if (fulfillmentType) return; // already set by localStorage or previous interaction

    const { offersDelivery, offersCollection } = getFulfillmentOptions(store);
    if (offersDelivery) {
      setFulfillmentType('delivery');
    } else if (offersCollection) {
      setFulfillmentType('collection');
    }
  }, [store, fulfillmentType]);

  // Also correct an existing fulfillment_type if the store doesn't actually offer it
  useEffect(() => {
    if (!store || !fulfillmentType) return;
    const { offersDelivery, offersCollection } = getFulfillmentOptions(store);
    if (fulfillmentType === 'delivery' && !offersDelivery && offersCollection) {
      setFulfillmentType('collection');
    } else if (fulfillmentType === 'collection' && !offersCollection && offersDelivery) {
      setFulfillmentType('delivery');
    }
  }, [store, fulfillmentType]);

  // Persist cart items to localStorage whenever they change
  useEffect(() => {
    writeCart(slug, cartItems);
  }, [slug, cartItems]);

  // Persist fulfillment meta to localStorage whenever it changes
  useEffect(() => {
    writeCartMeta(slug, { fulfillment_type: fulfillmentType, delivery_address: deliveryAddress });
  }, [slug, fulfillmentType, deliveryAddress]);

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

  const handleFulfillmentChange = useCallback((type) => {
    setFulfillmentType(type);
    if (type === 'collection') {
      setDeliveryAddress('');
    }
  }, []);

  const cartQty = cartItems.reduce((s, i) => s + (i.quantity ?? 1), 0);
  const menu = store?.menu || store?.categories || [];

  return (
    <div className="min-h-screen bg-background">
      {/* Back nav */}
      <div className="sticky top-0 z-20 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 border-b px-4 h-13 flex items-center justify-between">
        <button
          onClick={() => navigate(-1)}
          aria-label="Go back"
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors -ml-1 px-2 py-2 rounded-lg hover:bg-muted"
        >
          <ChevronLeft className="h-4 w-4" />
          <span className="hidden xs:inline">Back</span>
        </button>

        {/* Mobile cart trigger — floating pill */}
        <Sheet open={cartOpen} onOpenChange={setCartOpen}>
          <SheetTrigger asChild>
            <Button
              size="sm"
              className={`relative gap-2 sm:hidden rounded-full px-4 transition-all ${
                cartQty > 0
                  ? 'bg-primary hover:bg-primary/90 text-primary-foreground shadow-md shadow-primary/20'
                  : 'bg-muted text-muted-foreground border border-border'
              }`}
              aria-label={`View cart${cartQty > 0 ? `, ${cartQty} items` : ''}`}
            >
              <ShoppingCart className="h-4 w-4" />
              {cartQty > 0 ? (
                <span className="font-semibold text-sm">{cartQty}</span>
              ) : (
                <span className="text-sm">Cart</span>
              )}
            </Button>
          </SheetTrigger>
          <SheetContent side="bottom" className="h-auto max-h-[85vh] overflow-y-auto rounded-t-2xl px-0">
            <div className="pt-1 pb-6 px-4">
              <div className="mx-auto w-10 h-1 bg-muted rounded-full mb-4" />
              <CartWidget
                slug={slug}
                items={cartItems}
                onAdd={handleAdd}
                onRemove={handleRemove}
                onClear={handleClear}
                storeName={store?.name}
                currency={store?.currency || store?.default_currency_code || store?.currency_code || 'USD'}
                fulfillmentType={fulfillmentType}
                deliveryAddress={deliveryAddress}
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
          {/* Hero cover image */}
          <div className="relative h-44 sm:h-64 bg-primary/10 overflow-hidden">
            {store.cover_image_url ? (
              <img
                src={store.cover_image_url}
                alt={store.name}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-primary/10">
                <span className="text-7xl" role="img" aria-hidden="true">🍽️</span>
              </div>
            )}
            {/* Bottom gradient */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent pointer-events-none" />

            {/* Open/closed pill over hero */}
            {store.is_open !== undefined && (
              <span
                className={`absolute bottom-3 right-3 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold shadow-lg ${
                  store.is_open
                    ? 'bg-success text-success-foreground'
                    : 'bg-black/70 text-white/80'
                }`}
              >
                <span className={`inline-block h-1.5 w-1.5 rounded-full ${store.is_open ? 'bg-success-foreground' : 'bg-muted-foreground'}`} />
                {store.is_open ? 'Open now' : 'Closed'}
              </span>
            )}
          </div>

          {/* Store info card */}
          <div className="px-4 pt-4 pb-4 border-b space-y-3 bg-background">
            <div className="flex items-start gap-3">
              {store.logo_url && (
                <img
                  src={store.logo_url}
                  alt={`${store.name} logo`}
                  className="h-14 w-14 rounded-2xl border-2 border-white object-cover shrink-0 -mt-8 shadow-md"
                />
              )}
              <div className="flex-1 min-w-0 pt-0.5">
                <h1 className="text-xl sm:text-2xl font-display leading-tight tracking-tight">{store.name}</h1>
                {store.cuisine_type && (
                  <Badge
                    variant="secondary"
                    className="text-xs mt-1 bg-primary/10 text-primary border border-primary/20"
                  >
                    {store.cuisine_type}
                  </Badge>
                )}
              </div>
            </div>

            {store.description && (
              <p className="text-sm text-muted-foreground leading-relaxed">{store.description}</p>
            )}

            {/* Meta chips */}
            <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
              {store.city && (
                <span className="flex items-center gap-1">
                  <MapPin className="h-3 w-3 text-primary" aria-hidden="true" />
                  {store.city}
                </span>
              )}
              {store.rating && (
                <span className="flex items-center gap-1 font-medium">
                  <Star className="h-3 w-3 fill-warning text-warning" aria-hidden="true" />
                  <span className="text-foreground tabular-nums">{Number(store.rating).toFixed(1)}</span>
                  {store.review_count ? (
                    <span className="text-muted-foreground">({store.review_count} reviews)</span>
                  ) : null}
                </span>
              )}
              {store.delivery_time_min && (
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3 text-primary" aria-hidden="true" />
                  {store.delivery_time_min}–{store.delivery_time_max ?? store.delivery_time_min + 10} min
                </span>
              )}
            </div>

            {/* Fulfillment selector */}
            {fulfillmentType && (
              <div className="pt-1">
                <FulfillmentSelector
                  store={store}
                  value={fulfillmentType}
                  onChange={handleFulfillmentChange}
                  deliveryAddress={deliveryAddress}
                  onAddressChange={setDeliveryAddress}
                />
              </div>
            )}
          </div>

          {/* Two-column layout: menu + sidebar cart */}
          <div className="max-w-5xl mx-auto px-4 py-5 flex gap-6">
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
            <aside className="hidden sm:block w-72 shrink-0" aria-label="Your cart">
              <div className="sticky top-16">
                <CartWidget
                  slug={slug}
                  items={cartItems}
                  onAdd={handleAdd}
                  onRemove={handleRemove}
                  onClear={handleClear}
                  storeName={store?.name}
                  currency={store?.currency || store?.default_currency_code || store?.currency_code || 'USD'}
                  fulfillmentType={fulfillmentType}
                  deliveryAddress={deliveryAddress}
                />
              </div>
            </aside>
          </div>
        </>
      ) : null}
    </div>
  );
}
