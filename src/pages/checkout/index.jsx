import { useState, useEffect, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  AlertTriangle,
  Banknote,
  CheckCircle,
  ChevronLeft,
  CreditCard,
  Loader2,
  MapPin,
  ShoppingBag,
  Truck,
} from 'lucide-react';
import { createOrder, clearCart, getStore } from '@/services/marketplace';
import { formatPrice, currencyScale } from '@/lib/currency';
import { useLocale } from '@/context/locale-context';
import ReceiptModal from '@/pages/pos/components/receipt-modal';
import AddressAutocomplete from '@/components/address-autocomplete';

const TIP_OPTIONS = [
  { label: '0%', value: 0 },
  { label: '5%', value: 5 },
  { label: '10%', value: 10 },
  { label: '15%', value: 15 },
  { label: '20%', value: 20 },
];

// Payment mode enum derived from store config
// 'online'      — redirect-to-pay (normal flow)
// 'on_delivery' — cash/card on delivery
// 'none'        — no payment method; checkout blocked
// 'loading'     — fetching store config

export default function CheckoutPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { currency: activeCurrency, phoneCountryCode } = useLocale();

  // State passed from the store page via navigate()
  const {
    slug = '',
    storeName = 'Store',
    items = [],
    subtotal: passedSubtotal = 0,
    // The store page always passes its own currency; the active location is
    // only a fallback for a stale/incomplete navigation state.
    currency = activeCurrency || '',
  } = location.state || {};

  // Cart prices are held as MAJOR units (floats), but formatPrice takes minor
  // units. The conversion factor is a property of the currency — 1 for JPY,
  // 100 for USD, 1000 for KWD — so a literal *100 renders ¥1,000 as ¥100,000
  // and KD 1.000 as KD 0.100.
  const toMinor = (major) => Math.round(Number(major ?? 0) * currencyScale(currency));

  // Fallback: recalculate subtotal in case state was stale
  const subtotal =
    items.length > 0
      ? items.reduce((s, i) => s + Number(i.price ?? 0) * (i.quantity ?? 1), 0)
      : passedSubtotal;

  // ── Store payment config ───────────────────────────────────────────────────
  const [paymentMode, setPaymentMode] = useState('loading');
  const [onDeliveryMethods, setOnDeliveryMethods] = useState([]); // ['cash', 'card_machine']
  const [selectedDeliveryMethod, setSelectedDeliveryMethod] = useState(null);

  useEffect(() => {
    if (!slug) {
      setPaymentMode('none');
      return;
    }
    let cancelled = false;
    getStore(slug).then(({ data, error }) => {
      if (cancelled) return;
      if (error || !data) {
        setPaymentMode('none');
        return;
      }
      const methods = Array.isArray(data.on_delivery_payment_methods)
        ? data.on_delivery_payment_methods
        : [];
      const hasOnline =
        Array.isArray(data.payment_credentials) && data.payment_credentials.some((c) => c.is_active);

      if (hasOnline) {
        setPaymentMode('online');
      } else if (methods.length > 0) {
        setOnDeliveryMethods(methods);
        setSelectedDeliveryMethod(methods[0]);
        setPaymentMode('on_delivery');
      } else {
        setPaymentMode('none');
      }
    });
    return () => { cancelled = true; };
  }, [slug]);

  // ── Form state ────────────────────────────────────────────────────────────
  const [fulfillment, setFulfillment] = useState('delivery'); // 'delivery' | 'collection'
  const [address, setAddress] = useState({
    street: '',
    suburb: '',
    city: '',
    notes: '',
  });
  const [tipPct, setTipPct] = useState(10);
  const [customTip, setCustomTip] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');

  // ── Submission state ──────────────────────────────────────────────────────
  const [submitting, setSubmitting] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [confirmedMethod, setConfirmedMethod] = useState(null); // for confirmation message
  const [orderRef, setOrderRef] = useState(null);
  const [submitError, setSubmitError] = useState(null);

  // ── Receipt modal state ───────────────────────────────────────────────────
  const [receiptOpen, setReceiptOpen] = useState(false);

  // ── Computed totals ───────────────────────────────────────────────────────
  const tipAmount =
    customTip !== ''
      ? Number(customTip) || 0
      : (subtotal * tipPct) / 100;

  const total = subtotal + tipAmount;

  // ── Guard: if no items, bounce back ──────────────────────────────────────
  const hasItems = items.length > 0;

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitError(null);
    setSubmitting(true);

    const isOnDelivery = paymentMode === 'on_delivery';

    const payload = {
      store_slug: slug,
      fulfillment,
      delivery_address:
        fulfillment === 'delivery'
          ? { ...address }
          : null,
      tip_amount: tipAmount,
      subtotal,
      total,
      customer: {
        name: customerName.trim(),
        phone: customerPhone.trim(),
      },
      items: items.map((i) => ({
        item_id: i.id,
        name: i.name,
        quantity: i.quantity ?? 1,
        unit_price: Number(i.price ?? 0),
      })),
      ...(isOnDelivery
        ? { payment_method: `on_delivery_${selectedDeliveryMethod}` }
        : {}),
    };

    const { data, error } = await createOrder(payload);

    if (error) {
      // Placeholder success for dev — real endpoint not yet wired up
      if (error.status === 404 || error.status === 405 || error.status === 501) {
        const ref = `ORD-${Date.now().toString(36).toUpperCase()}`;
        clearCart(slug);
        setOrderRef(ref);
        setConfirmedMethod(isOnDelivery ? selectedDeliveryMethod : null);
        setConfirmed(true);
        setReceiptOpen(true);
      } else {
        setSubmitError(error.message || 'Something went wrong. Please try again.');
      }
      setSubmitting(false);
      return;
    }

    // Online payment: when the store has a payment gateway configured, the
    // backend creates the order as pending and returns a hosted pay-page URL
    // instead of an on-delivery confirmation. Hand the customer off to it —
    // they pay there, and the provider redirects their browser back to
    // beepbite's /pay/return endpoint, which does one authoritative verify and
    // renders the confirmation (see backend docs/ONLINE-PAYMENTS.md). Clear the
    // cart first so a back-navigation can't re-submit; the order already exists
    // server-side, pending, keyed to this pay link.
    if (data?.pay_url) {
      clearCart(slug);
      window.location.assign(data.pay_url);
      return;
    }

    const ref = data?.order_number || data?.id || `ORD-${Date.now().toString(36).toUpperCase()}`;
    clearCart(slug);
    setOrderRef(ref);
    setConfirmedMethod(isOnDelivery ? selectedDeliveryMethod : null);
    setConfirmed(true);
    setReceiptOpen(true);
    setSubmitting(false);
  };

  // ── Receipt modal handlers ────────────────────────────────────────────────
  const handleReceiptClose = useCallback(() => {
    setReceiptOpen(false);
  }, []);

  const handleReceiptNewOrder = useCallback(() => {
    // "Done" — close receipt and navigate back to the store menu
    setReceiptOpen(false);
    if (slug) {
      navigate(`/store/${slug}`);
    } else {
      navigate('/discover');
    }
  }, [navigate, slug]);

  // ── Confirmation screen ───────────────────────────────────────────────────
  if (confirmed) {
    const totalFormatted = formatPrice(toMinor(total), currency);
    return (
      <div className="min-h-screen bg-gradient-to-br from-primary/5 to-primary/10 flex items-center justify-center px-4 py-8">
        <Card className="w-full max-w-sm text-center shadow-xl border-0 rounded-3xl overflow-hidden">
          <div className="bg-success px-6 pt-10 pb-8">
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-white/20 mx-auto mb-4 backdrop-blur-sm">
              <CheckCircle className="h-10 w-10 text-success-foreground" aria-hidden="true" />
            </div>
            <h2 className="text-2xl font-display text-success-foreground leading-tight">
              {confirmedMethod ? 'On its way!' : 'Order placed!'}
            </h2>
            {orderRef && (
              <p className="text-success-foreground/80 text-xs mt-1.5 font-mono tabular-nums">{orderRef}</p>
            )}
          </div>

          <CardContent className="py-6 space-y-4 px-6">
            <p className="text-sm text-muted-foreground leading-relaxed">
              <strong className="text-foreground">{storeName}</strong> has received your order and is getting it ready.
            </p>

            {/* On-delivery confirmation messages */}
            {confirmedMethod === 'cash' && (
              <div className="flex items-start gap-3 text-sm font-medium text-primary bg-primary/10 rounded-xl px-4 py-3 border border-primary/20 text-left">
                <Banknote className="h-4 w-4 mt-0.5 shrink-0 text-primary" aria-hidden="true" />
                <span>Please have <strong>{totalFormatted}</strong> in cash ready for the driver.</span>
              </div>
            )}
            {confirmedMethod === 'card_machine' && (
              <div className="flex items-start gap-3 text-sm font-medium text-primary bg-primary/10 rounded-xl px-4 py-3 border border-primary/20 text-left">
                <CreditCard className="h-4 w-4 mt-0.5 shrink-0 text-primary" aria-hidden="true" />
                <span>Have your card ready — the driver will bring a card machine.</span>
              </div>
            )}

            {/* Standard fulfillment messages */}
            {!confirmedMethod && fulfillment === 'delivery' && (
              <p className="text-xs text-muted-foreground">
                You'll get a notification when your order is on the way.
              </p>
            )}
            {!confirmedMethod && fulfillment === 'collection' && (
              <p className="text-xs text-muted-foreground">
                Head over to collect once you get the ready notification.
              </p>
            )}

            <div className="flex flex-col gap-2.5 pt-1">
              <Button
                className="w-full font-semibold h-11 rounded-xl"
                onClick={() => navigate('/discover')}
              >
                Discover more food
              </Button>
              <Button
                variant="outline"
                className="w-full border-primary/25 text-primary hover:bg-primary/10 rounded-xl"
                onClick={() => navigate(`/store/${slug}`)}
              >
                Back to menu
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Receipt modal — shown immediately after order placement */}
        <ReceiptModal
          orderId={orderRef}
          open={receiptOpen}
          onClose={handleReceiptClose}
          onNewOrder={handleReceiptNewOrder}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/30">
      {/* Top nav */}
      <div className="sticky top-0 z-20 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 border-b px-4 h-13 flex items-center">
        <button
          onClick={() => navigate(-1)}
          aria-label="Go back"
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors -ml-1 px-2 py-2 rounded-lg hover:bg-muted"
        >
          <ChevronLeft className="h-4 w-4" />
          Back
        </button>
        <h1 className="absolute left-1/2 -translate-x-1/2 text-sm font-bold">
          Checkout
        </h1>
      </div>

      <form onSubmit={handleSubmit} className="max-w-lg mx-auto px-4 py-5 space-y-4 pb-10">
        {/* No-items warning — informational, not urgent: a calm brand-tinted
            nudge back to browsing, not an error state. */}
        {!hasItems && (
          <Card className="border-primary/20 bg-primary/5 rounded-2xl">
            <CardContent className="py-5 text-sm text-primary text-center space-y-3">
              <p className="font-medium">Your cart is empty</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate('/discover')}
                className="border-primary/30 text-primary hover:bg-primary/10 rounded-xl"
              >
                Browse restaurants
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Store not accepting orders — blocks checkout but isn't the
            customer's mistake and nothing irreversible has happened, so this
            is the warning tone, not destructive. */}
        {hasItems && paymentMode === 'none' && (
          <Card className="border-warning/30 bg-warning/10 rounded-2xl">
            <CardContent className="py-4 flex items-start gap-3 text-sm text-warning">
              <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" aria-hidden="true" />
              <span>This store isn't currently accepting orders online.</span>
            </CardContent>
          </Card>
        )}

        {/* 1. Fulfillment method */}
        <Card className="rounded-2xl border-border/60 shadow-sm overflow-hidden">
          <CardHeader className="pb-2 pt-4">
            <CardTitle className="text-sm font-semibold">How would you like it?</CardTitle>
          </CardHeader>
          <CardContent>
            <Tabs value={fulfillment} onValueChange={setFulfillment}>
              <TabsList className="w-full p-1 bg-muted rounded-xl h-auto">
                <TabsTrigger
                  value="delivery"
                  className="flex-1 gap-2 rounded-lg py-2 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm transition-all"
                >
                  <Truck className="h-3.5 w-3.5" aria-hidden="true" />
                  Delivery
                </TabsTrigger>
                <TabsTrigger
                  value="collection"
                  className="flex-1 gap-2 rounded-lg py-2 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm transition-all"
                >
                  <ShoppingBag className="h-3.5 w-3.5" aria-hidden="true" />
                  Collection
                </TabsTrigger>
              </TabsList>

              <TabsContent value="delivery" className="pt-4 space-y-3">
                <div>
                  <Label htmlFor="street" className="text-xs font-medium">Street address <span className="text-primary">*</span></Label>
                  <AddressAutocomplete
                    id="street"
                    placeholder="123 Main Road"
                    value={address.street}
                    onChange={(text) => setAddress((a) => ({ ...a, street: text }))}
                    onSelect={(s) =>
                      setAddress((a) => ({
                        ...a,
                        street: s.street || s.place_name || a.street,
                        suburb: s.suburb || a.suburb,
                        city: s.city || a.city,
                        lat: s.lat ?? null,
                        lng: s.lng ?? null,
                      }))
                    }
                    required={fulfillment === 'delivery'}
                    className="mt-1.5 h-10 text-sm rounded-xl focus-visible:ring-ring"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="suburb" className="text-xs font-medium">Suburb</Label>
                    <Input
                      id="suburb"
                      placeholder="Suburb"
                      value={address.suburb}
                      onChange={(e) => setAddress((a) => ({ ...a, suburb: e.target.value }))}
                      className="mt-1.5 h-10 text-sm rounded-xl focus-visible:ring-ring"
                    />
                  </div>
                  <div>
                    <Label htmlFor="city" className="text-xs font-medium">City <span className="text-primary">*</span></Label>
                    <Input
                      id="city"
                      placeholder="City"
                      value={address.city}
                      onChange={(e) => setAddress((a) => ({ ...a, city: e.target.value }))}
                      required={fulfillment === 'delivery'}
                      className="mt-1.5 h-10 text-sm rounded-xl focus-visible:ring-ring"
                    />
                  </div>
                </div>
                <div>
                  <Label htmlFor="notes" className="text-xs font-medium text-muted-foreground">Delivery notes <span className="font-normal">(optional)</span></Label>
                  <Input
                    id="notes"
                    placeholder="Gate code, flat number, landmark…"
                    value={address.notes}
                    onChange={(e) => setAddress((a) => ({ ...a, notes: e.target.value }))}
                    className="mt-1.5 h-10 text-sm rounded-xl focus-visible:ring-ring"
                  />
                </div>
              </TabsContent>

              <TabsContent value="collection" className="pt-4">
                <div className="flex items-start gap-3 rounded-xl bg-primary/10 border border-primary/20 p-4 text-sm">
                  <MapPin className="h-4 w-4 mt-0.5 text-primary shrink-0" aria-hidden="true" />
                  <span className="text-primary">
                    Collect your order directly from <strong>{storeName}</strong>. You'll get a notification when it's ready.
                  </span>
                </div>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        {/* 2. Customer contact */}
        <Card className="rounded-2xl border-border/60 shadow-sm">
          <CardHeader className="pb-2 pt-4">
            <CardTitle className="text-sm font-semibold">Your details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label htmlFor="name" className="text-xs font-medium">Name <span className="text-primary">*</span></Label>
              <Input
                id="name"
                placeholder="Your full name"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                required
                className="mt-1.5 h-10 text-sm rounded-xl focus-visible:ring-ring"
              />
            </div>
            <div>
              <Label htmlFor="phone" className="text-xs font-medium">WhatsApp / phone <span className="text-primary">*</span></Label>
              <Input
                id="phone"
                type="tel"
                placeholder={phoneCountryCode ? `+${phoneCountryCode} 82 000 0000` : '+ country code and number'}
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                required
                className="mt-1.5 h-10 text-sm rounded-xl focus-visible:ring-ring"
              />
            </div>
          </CardContent>
        </Card>

        {/* 3. Order summary */}
        {hasItems && (
          <Card className="rounded-2xl border-border/60 shadow-sm">
            <CardHeader className="pb-2 pt-4">
              <CardTitle className="text-sm font-semibold">Order summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2.5">
              {items.map((item) => (
                <div key={item.id} className="flex justify-between items-baseline text-sm">
                  <span className="text-muted-foreground">
                    <span className="font-medium text-foreground">{item.quantity ?? 1}×</span>{' '}{item.name}
                  </span>
                  <span className="font-medium tabular-nums shrink-0 ml-3">
                    {formatPrice(toMinor(Number(item.price ?? 0) * (item.quantity ?? 1)), currency)}
                  </span>
                </div>
              ))}
              <Separator className="my-1" />
              <div className="flex justify-between text-sm font-semibold">
                <span>Subtotal</span>
                <span className="tabular-nums">{formatPrice(toMinor(subtotal), currency)}</span>
              </div>
            </CardContent>
          </Card>
        )}

        {/* 4. Tip selector */}
        {hasItems && (
          <Card className="rounded-2xl border-border/60 shadow-sm">
            <CardHeader className="pb-2 pt-4">
              <CardTitle className="text-sm font-semibold">Add a tip for the team</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2 flex-wrap">
                {TIP_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    className={`px-3.5 py-1.5 rounded-full text-sm font-semibold border transition-all ${
                      tipPct === opt.value && customTip === ''
                        ? 'bg-primary border-primary text-primary-foreground shadow-sm'
                        : 'border-primary/25 text-primary hover:bg-primary/10 hover:border-primary/50'
                    }`}
                    onClick={() => {
                      setTipPct(opt.value);
                      setCustomTip('');
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-3">
                <Label htmlFor="custom-tip" className="text-xs text-muted-foreground shrink-0">
                  Custom ({currency})
                </Label>
                <Input
                  id="custom-tip"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={customTip}
                  onChange={(e) => setCustomTip(e.target.value)}
                  className="h-9 text-sm w-28 rounded-xl focus-visible:ring-ring"
                />
                {tipAmount > 0 && (
                  <span className="text-sm font-medium text-primary tabular-nums">
                    {formatPrice(toMinor(tipAmount), currency)}
                  </span>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* 5. On-delivery payment method selector */}
        {hasItems && paymentMode === 'on_delivery' && (
          <Card className="rounded-2xl border-primary/20 shadow-sm">
            <CardHeader className="pb-2 pt-4">
              <CardTitle className="text-sm font-semibold">How will you pay?</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {onDeliveryMethods.includes('cash') && (
                <label
                  className={`flex items-center gap-3 p-3.5 rounded-xl border cursor-pointer transition-all ${
                    selectedDeliveryMethod === 'cash'
                      ? 'border-primary/50 bg-primary/10 shadow-sm'
                      : 'border-border hover:border-primary/35 hover:bg-primary/5'
                  }`}
                >
                  <input
                    type="radio"
                    name="delivery_method"
                    value="cash"
                    checked={selectedDeliveryMethod === 'cash'}
                    onChange={() => setSelectedDeliveryMethod('cash')}
                    className="accent-primary h-4 w-4"
                  />
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 shrink-0">
                    <Banknote className="h-4 w-4 text-primary" aria-hidden="true" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold">Cash on delivery</p>
                    <p className="text-xs text-muted-foreground">Have cash ready for the driver</p>
                  </div>
                </label>
              )}
              {onDeliveryMethods.includes('card_machine') && (
                <label
                  className={`flex items-center gap-3 p-3.5 rounded-xl border cursor-pointer transition-all ${
                    selectedDeliveryMethod === 'card_machine'
                      ? 'border-primary/50 bg-primary/10 shadow-sm'
                      : 'border-border hover:border-primary/35 hover:bg-primary/5'
                  }`}
                >
                  <input
                    type="radio"
                    name="delivery_method"
                    value="card_machine"
                    checked={selectedDeliveryMethod === 'card_machine'}
                    onChange={() => setSelectedDeliveryMethod('card_machine')}
                    className="accent-primary h-4 w-4"
                  />
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 shrink-0">
                    <CreditCard className="h-4 w-4 text-primary" aria-hidden="true" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold">Card on delivery</p>
                    <p className="text-xs text-muted-foreground">Driver will bring a card machine</p>
                  </div>
                </label>
              )}
            </CardContent>
          </Card>
        )}

        {/* 6. Total + place order / pay button */}
        {hasItems && (
          <Card className="bg-primary/5 border-primary/20 rounded-2xl shadow-sm">
            <CardContent className="py-5 space-y-4">
              {/* Price breakdown */}
              <div className="space-y-1.5 text-sm">
                <div className="flex justify-between text-muted-foreground">
                  <span>Subtotal</span>
                  <span className="tabular-nums">{formatPrice(toMinor(subtotal), currency)}</span>
                </div>
                {tipAmount > 0 && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>Tip</span>
                    <span className="tabular-nums">{formatPrice(toMinor(tipAmount), currency)}</span>
                  </div>
                )}
                <Separator className="my-2 border-primary/20" />
                <div className="flex justify-between font-bold text-base">
                  <span>Total</span>
                  <span className="text-primary tabular-nums">{formatPrice(toMinor(total), currency)}</span>
                </div>
              </div>

              {submitError && (
                <div className="flex items-center gap-2 rounded-xl bg-destructive/10 border border-destructive/20 px-3 py-2.5">
                  <AlertTriangle className="h-4 w-4 text-destructive shrink-0" aria-hidden="true" />
                  <p className="text-xs text-destructive">{submitError}</p>
                </div>
              )}

              {/* No payment method configured */}
              {paymentMode === 'none' && (
                <Button
                  type="button"
                  disabled
                  className="w-full bg-muted text-muted-foreground h-12 rounded-xl cursor-not-allowed"
                >
                  Store not accepting orders
                </Button>
              )}

              {/* Loading payment config */}
              {paymentMode === 'loading' && (
                <Button disabled className="w-full h-12 rounded-xl">
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Checking payment options…
                </Button>
              )}

              {/* On-delivery flow */}
              {paymentMode === 'on_delivery' && (
                <Button
                  type="submit"
                  disabled={submitting || !hasItems || !selectedDeliveryMethod}
                  className="w-full h-12 rounded-xl font-semibold shadow-sm shadow-primary/20 text-sm"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Placing your order…
                    </>
                  ) : (
                    `Place order · ${formatPrice(toMinor(total), currency)}`
                  )}
                </Button>
              )}

              {/* Online payment flow */}
              {paymentMode === 'online' && (
                <Button
                  type="submit"
                  disabled={submitting || !hasItems}
                  className="w-full h-12 rounded-xl font-semibold shadow-sm shadow-primary/20 text-sm"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Processing…
                    </>
                  ) : (
                    `Pay securely · ${formatPrice(toMinor(total), currency)}`
                  )}
                </Button>
              )}

              {/* Trust cues */}
              <div className="flex items-center justify-center gap-4 pt-1 text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1">
                  <span role="img" aria-label="Secure">🔒</span> Secure checkout
                </span>
                <span className="flex items-center gap-1">
                  <span role="img" aria-label="Terms">📋</span> Order protected by{' '}
                  <span className="font-medium text-primary">BeepBite</span>
                </span>
              </div>
            </CardContent>
          </Card>
        )}
      </form>
    </div>
  );
}
