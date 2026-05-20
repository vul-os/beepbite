import React, { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '@/context/auth-context';
import { listPaymentCredentials } from '@/services/payments';
import { ProviderCard } from './provider-card';
import { OnDeliverySection } from './on-delivery-section';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertTriangle } from 'lucide-react';

// Lazily import markdown files as raw strings via Vite's ?raw import
import paystackMd from '@/content/payment-setup/paystack.md?raw';
import stripeMd from '@/content/payment-setup/stripe.md?raw';
import payfastMd from '@/content/payment-setup/payfast.md?raw';

const PROVIDERS = [
  {
    provider: 'paystack',
    label: 'Paystack',
    inactive: false,
    instructionsMd: paystackMd,
  },
  {
    provider: 'stripe',
    label: 'Stripe',
    inactive: false,
    instructionsMd: stripeMd,
  },
  {
    provider: 'payfast',
    label: 'PayFast',
    inactive: true,
    instructionsMd: payfastMd,
  },
];

export default function LocationPaymentsPage() {
  const { locationId } = useParams();
  const { locations } = useAuth();

  const location = locations?.find((l) => l.id === locationId);
  const locationName = location?.name ?? locationId ?? 'this location';

  const [credentials, setCredentials] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchCredentials = useCallback(async () => {
    if (!locationId) return;
    setLoading(true);
    try {
      const { data, error } = await listPaymentCredentials(locationId);
      if (!error) {
        setCredentials(Array.isArray(data) ? data : []);
      }
    } finally {
      setLoading(false);
    }
  }, [locationId]);

  useEffect(() => {
    fetchCredentials();
  }, [fetchCredentials]);

  // Determine if any active online provider is configured
  const hasActiveOnlineProvider = credentials.some(
    (c) => c.is_active && c.provider !== 'payfast'
  );

  // Check if on_delivery_payment_methods is non-empty
  const onDeliveryMethods = location?.on_delivery_payment_methods ?? [];
  const hasOnDeliveryFallback = Array.isArray(onDeliveryMethods) && onDeliveryMethods.length > 0;

  const showNoBillingBanner = !loading && !hasActiveOnlineProvider && !hasOnDeliveryFallback;

  function credentialForProvider(provider) {
    return credentials.find((c) => c.provider === provider) ?? null;
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold">Payment providers for {locationName}</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Connect a payment provider so customers can pay online. Credentials are encrypted at rest.
        </p>
      </div>

      {/* No-provider warning banner */}
      {showNoBillingBanner && (
        <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <span>
            <span className="font-medium">Customers cannot complete orders.</span> Configure a
            payment provider below, or enable on-delivery payment options in your location settings.
          </span>
        </div>
      )}

      {/* Provider cards */}
      {loading ? (
        <div className="space-y-4">
          {PROVIDERS.map((p) => (
            <Skeleton key={p.provider} className="h-20 w-full rounded-lg" />
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          {PROVIDERS.map((p) => (
            <ProviderCard
              key={p.provider}
              provider={p.provider}
              label={p.label}
              inactive={p.inactive}
              instructionsMd={p.instructionsMd}
              credential={credentialForProvider(p.provider)}
              locationId={locationId}
              onRefresh={fetchCredentials}
            />
          ))}
        </div>
      )}

      {/* On-delivery payment section */}
      {locationId && (
        <OnDeliverySection
          locationId={locationId}
          initialMethods={onDeliveryMethods}
          onMethodsChange={() => {}}
        />
      )}
    </div>
  );
}
