import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CreditCard } from 'lucide-react';
import { useAuth } from '@/context/auth-context';
import { PageHeader, PageContainer } from '@/components/ui/page-header';
import { OnDeliverySection } from './on-delivery-section';

/**
 * LocationPaymentsPage — how a location takes payment.
 *
 * BeepBite is self-hosted and does not broker online card payments, so this
 * page configures the tender types staff/drivers accept at the point of
 * hand-over (cash, card machine). Everything else is settled in the POS.
 */
export default function LocationPaymentsPage() {
  const { locationId } = useParams();
  const { locations } = useAuth();

  const location = locations?.find((l) => l.id === locationId);
  const locationName = location?.name ?? locationId ?? 'this location';

  const [methods, setMethods] = useState([]);

  const syncFromLocation = useCallback(() => {
    const m = location?.on_delivery_payment_methods;
    setMethods(Array.isArray(m) ? m : []);
  }, [location]);

  useEffect(() => {
    syncFromLocation();
  }, [syncFromLocation]);

  return (
    <PageContainer className="max-w-3xl">
      <PageHeader
        eyebrow="Settings"
        title={`Payment options for ${locationName}`}
        description="Choose how customers can pay when their order is handed over. Orders are settled in the POS — BeepBite does not process card payments on your behalf."
        icon={CreditCard}
      />

      {locationId && (
        <OnDeliverySection
          locationId={locationId}
          initialMethods={methods}
          onMethodsChange={setMethods}
        />
      )}
    </PageContainer>
  );
}
