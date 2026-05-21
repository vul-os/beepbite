import React, { useState, useEffect, useCallback } from 'react';
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
import { formatPrice } from '@/lib/currency';
import ReceiptModal from '@/pages/pos/components/receipt-modal';

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

  // State passed from the store page via navigate()
  const {
    slug = '',
    storeName = 'Store',
    items = [],
    subtotal: passedSubtotal = 0,
    currency = 'ZAR',
  } = location.state || {};

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
    const totalFormatted = formatPrice(total * 100, currency);
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <Card className="w-full max-w-md text-center shadow-lg">
          <CardContent className="py-10 space-y-4">
            <CheckCircle className="h-14 w-14 text-green-500 mx-auto" />
            <h2 className="text-xl font-bold">
              {confirmedMethod ? 'Your order is on the way!' : 'Order placed!'}
            </h2>
            <p className="text-muted-foreground text-sm">
              Your order{orderRef ? ` (${orderRef})` : ''} has been received by{' '}
              <strong>{storeName}</strong>.
            </p>

            {/* On-delivery confirmation messages */}
            {confirmedMethod === 'cash' && (
              <p className="text-sm font-medium text-orange-700 bg-orange-50 rounded-lg px-4 py-3 border border-orange-200">
                Please have <strong>{totalFormatted}</strong> ready in cash for the driver.
              </p>
            )}
            {confirmedMethod === 'card_machine' && (
              <p className="text-sm font-medium text-orange-700 bg-orange-50 rounded-lg px-4 py-3 border border-orange-200">
                Please have a card ready for the driver — they will bring a card machine.
              </p>
            )}

            {/* Standard fulfillment messages */}
            {!confirmedMethod && fulfillment === 'delivery' && (
              <p className="text-sm text-muted-foreground">
                We'll deliver to your address once it's confirmed.
              </p>
            )}
            {!confirmedMethod && fulfillment === 'collection' && (
              <p className="text-sm text-muted-foreground">
                Head over to collect when it's ready.
              </p>
            )}

            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              <Button
                variant="outline"
                className="flex-1 border-orange-300 text-orange-600 hover:bg-orange-50"
                onClick={() => navigate(`/store/${slug}`)}
              >
                Back to menu
              </Button>
              <Button
                className="flex-1 bg-orange-500 hover:bg-orange-600 text-white"
                onClick={() => navigate('/discover')}
              >
                Discover more
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
    <div className="min-h-screen bg-background">
      {/* Top nav */}
      <div className="sticky top-0 z-20 bg-background/95 backdrop-blur border-b px-4 h-12 flex items-center">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
          Back
        </button>
        <h1 className="absolute left-1/2 -translate-x-1/2 text-sm font-semibold">
          Checkout
        </h1>
      </div>

      <form onSubmit={handleSubmit} className="max-w-lg mx-auto px-4 py-6 space-y-5">
        {/* No-items warning */}
        {!hasItems && (
          <Card className="border-orange-200 bg-orange-50">
            <CardContent className="py-4 text-sm text-orange-700 text-center space-y-2">
              <p>Your cart is empty.</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate('/discover')}
                className="border-orange-300 text-orange-600"
              >
                Browse stores
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Store not accepting orders */}
        {hasItems && paymentMode === 'none' && (
          <Card className="border-red-200 bg-red-50">
            <CardContent className="py-4 flex items-start gap-3 text-sm text-red-700">
              <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <span>This store isn't currently accepting orders.</span>
            </CardContent>
          </Card>
        )}

        {/* 1. Fulfillment method */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">How do you want it?</CardTitle>
          </CardHeader>
          <CardContent>
            <Tabs value={fulfillment} onValueChange={setFulfillment}>
              <TabsList className="w-full">
                <TabsTrigger value="delivery" className="flex-1 gap-2 data-[state=active]:bg-orange-500 data-[state=active]:text-white">
                  <Truck className="h-3.5 w-3.5" />
                  Delivery
                </TabsTrigger>
                <TabsTrigger value="collection" className="flex-1 gap-2 data-[state=active]:bg-orange-500 data-[state=active]:text-white">
                  <ShoppingBag className="h-3.5 w-3.5" />
                  Collection
                </TabsTrigger>
              </TabsList>

              <TabsContent value="delivery" className="pt-3 space-y-3">
                <div>
                  <Label htmlFor="street" className="text-xs">Street address *</Label>
                  <Input
                    id="street"
                    placeholder="123 Main Road"
                    value={address.street}
                    onChange={(e) => setAddress((a) => ({ ...a, street: e.target.value }))}
                    required={fulfillment === 'delivery'}
                    className="mt-1 h-9 text-sm"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="suburb" className="text-xs">Suburb</Label>
                    <Input
                      id="suburb"
                      placeholder="Suburb"
                      value={address.suburb}
                      onChange={(e) => setAddress((a) => ({ ...a, suburb: e.target.value }))}
                      className="mt-1 h-9 text-sm"
                    />
                  </div>
                  <div>
                    <Label htmlFor="city" className="text-xs">City *</Label>
                    <Input
                      id="city"
                      placeholder="City"
                      value={address.city}
                      onChange={(e) => setAddress((a) => ({ ...a, city: e.target.value }))}
                      required={fulfillment === 'delivery'}
                      className="mt-1 h-9 text-sm"
                    />
                  </div>
                </div>
                <div>
                  <Label htmlFor="notes" className="text-xs">Delivery notes (optional)</Label>
                  <Input
                    id="notes"
                    placeholder="Gate code, flat number…"
                    value={address.notes}
                    onChange={(e) => setAddress((a) => ({ ...a, notes: e.target.value }))}
                    className="mt-1 h-9 text-sm"
                  />
                </div>
              </TabsContent>

              <TabsContent value="collection" className="pt-3">
                <div className="flex items-start gap-2 rounded-md bg-muted p-3 text-sm text-muted-foreground">
                  <MapPin className="h-4 w-4 mt-0.5 text-orange-500 shrink-0" />
                  <span>
                    Collect your order directly from <strong>{storeName}</strong>. You'll receive a
                    notification when it's ready.
                  </span>
                </div>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        {/* 2. Customer contact */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Your details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label htmlFor="name" className="text-xs">Name *</Label>
              <Input
                id="name"
                placeholder="Your name"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                required
                className="mt-1 h-9 text-sm"
              />
            </div>
            <div>
              <Label htmlFor="phone" className="text-xs">WhatsApp / phone *</Label>
              <Input
                id="phone"
                type="tel"
                placeholder="+27 82 000 0000"
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                required
                className="mt-1 h-9 text-sm"
              />
            </div>
          </CardContent>
        </Card>

        {/* 3. Order summary */}
        {hasItems && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Order summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {items.map((item) => (
                <div key={item.id} className="flex justify-between text-sm">
                  <span className="text-muted-foreground">
                    {item.quantity ?? 1}× {item.name}
                  </span>
                  <span>
                    {formatPrice(Number(item.price ?? 0) * (item.quantity ?? 1) * 100, currency)}
                  </span>
                </div>
              ))}
              <Separator />
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Subtotal</span>
                <span>{formatPrice(subtotal * 100, currency)}</span>
              </div>
            </CardContent>
          </Card>
        )}

        {/* 4. Tip selector */}
        {hasItems && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Add a tip</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2 flex-wrap">
                {TIP_OPTIONS.map((opt) => (
                  <Button
                    key={opt.value}
                    type="button"
                    variant={tipPct === opt.value && customTip === '' ? 'default' : 'outline'}
                    size="sm"
                    className={
                      tipPct === opt.value && customTip === ''
                        ? 'bg-orange-500 hover:bg-orange-600 border-orange-500'
                        : 'border-orange-200 text-orange-600 hover:bg-orange-50'
                    }
                    onClick={() => {
                      setTipPct(opt.value);
                      setCustomTip('');
                    }}
                  >
                    {opt.label}
                  </Button>
                ))}
              </div>
              <div>
                <Label htmlFor="custom-tip" className="text-xs text-muted-foreground">
                  Custom amount ({currency})
                </Label>
                <Input
                  id="custom-tip"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={customTip}
                  onChange={(e) => setCustomTip(e.target.value)}
                  className="mt-1 h-9 text-sm w-32"
                />
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Tip</span>
                <span>{formatPrice(tipAmount * 100, currency)}</span>
              </div>
            </CardContent>
          </Card>
        )}

        {/* 5. On-delivery payment method selector */}
        {hasItems && paymentMode === 'on_delivery' && (
          <Card className="border-orange-200">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">How will you pay?</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {onDeliveryMethods.includes('cash') && (
                <label
                  className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                    selectedDeliveryMethod === 'cash'
                      ? 'border-orange-400 bg-orange-50'
                      : 'border-gray-200 hover:border-orange-200'
                  }`}
                >
                  <input
                    type="radio"
                    name="delivery_method"
                    value="cash"
                    checked={selectedDeliveryMethod === 'cash'}
                    onChange={() => setSelectedDeliveryMethod('cash')}
                    className="accent-orange-500"
                  />
                  <Banknote className="h-4 w-4 text-orange-500 flex-shrink-0" />
                  <span className="text-sm font-medium">Pay with cash on delivery</span>
                </label>
              )}
              {onDeliveryMethods.includes('card_machine') && (
                <label
                  className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                    selectedDeliveryMethod === 'card_machine'
                      ? 'border-orange-400 bg-orange-50'
                      : 'border-gray-200 hover:border-orange-200'
                  }`}
                >
                  <input
                    type="radio"
                    name="delivery_method"
                    value="card_machine"
                    checked={selectedDeliveryMethod === 'card_machine'}
                    onChange={() => setSelectedDeliveryMethod('card_machine')}
                    className="accent-orange-500"
                  />
                  <CreditCard className="h-4 w-4 text-orange-500 flex-shrink-0" />
                  <span className="text-sm font-medium">Pay with card on delivery</span>
                </label>
              )}
            </CardContent>
          </Card>
        )}

        {/* 6. Total + place order / pay button */}
        {hasItems && (
          <Card className="bg-orange-50 border-orange-200">
            <CardContent className="py-4 space-y-3">
              <div className="flex justify-between font-semibold">
                <span>Total</span>
                <span className="text-orange-600">{formatPrice(total * 100, currency)}</span>
              </div>

              {submitError && (
                <p className="text-xs text-destructive">{submitError}</p>
              )}

              {/* No payment method configured */}
              {paymentMode === 'none' && (
                <Button
                  type="button"
                  disabled
                  className="w-full bg-gray-300 text-gray-500 h-11 cursor-not-allowed"
                >
                  Store not accepting orders
                </Button>
              )}

              {/* Loading payment config */}
              {paymentMode === 'loading' && (
                <Button disabled className="w-full bg-orange-500 text-white h-11">
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Loading…
                </Button>
              )}

              {/* On-delivery flow */}
              {paymentMode === 'on_delivery' && (
                <Button
                  type="submit"
                  disabled={submitting || !hasItems || !selectedDeliveryMethod}
                  className="w-full bg-orange-500 hover:bg-orange-600 text-white h-11"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Placing order…
                    </>
                  ) : (
                    `Place order · ${formatPrice(total * 100, currency)}`
                  )}
                </Button>
              )}

              {/* Online payment flow */}
              {paymentMode === 'online' && (
                <Button
                  type="submit"
                  disabled={submitting || !hasItems}
                  className="w-full bg-orange-500 hover:bg-orange-600 text-white h-11"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Placing order…
                    </>
                  ) : (
                    `Pay · ${formatPrice(total * 100, currency)}`
                  )}
                </Button>
              )}

              <p className="text-xs text-center text-muted-foreground">
                By placing this order you agree to the store's terms.
              </p>
            </CardContent>
          </Card>
        )}
      </form>
    </div>
  );
}
