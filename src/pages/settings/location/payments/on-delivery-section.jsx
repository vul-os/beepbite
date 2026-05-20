import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Loader2 } from 'lucide-react';
import { api } from '@/lib/api-client';

/**
 * OnDeliverySection — "Payment on delivery" card in the payments settings page.
 *
 * Props:
 *   locationId         string
 *   initialMethods     string[]  — current value of on_delivery_payment_methods
 *   onMethodsChange    (methods: string[]) => void  — called after a successful save
 */
export function OnDeliverySection({ locationId, initialMethods = [], onMethodsChange }) {
  const { toast } = useToast();

  const [acceptCash, setAcceptCash] = useState(initialMethods.includes('cash'));
  const [acceptCard, setAcceptCard] = useState(initialMethods.includes('card_machine'));
  const [saving, setSaving] = useState(false);

  // Keep checkboxes in sync if parent re-loads with new initialMethods
  React.useEffect(() => {
    setAcceptCash(initialMethods.includes('cash'));
    setAcceptCard(initialMethods.includes('card_machine'));
  }, [initialMethods.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSave() {
    const methods = [
      ...(acceptCash ? ['cash'] : []),
      ...(acceptCard ? ['card_machine'] : []),
    ];

    setSaving(true);
    try {
      const { error } = await api.request('PATCH', `/locations/${encodeURIComponent(locationId)}`, {
        body: { on_delivery_payment_methods: methods },
      });
      if (error) {
        toast({ variant: 'destructive', title: 'Save failed', description: error.message });
        return;
      }
      toast({ title: 'On-delivery payment settings saved.' });
      onMethodsChange?.(methods);
    } finally {
      setSaving(false);
    }
  }

  const dirty =
    acceptCash !== initialMethods.includes('cash') ||
    acceptCard !== initialMethods.includes('card_machine');

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Payment on delivery</CardTitle>
        <p className="text-sm text-muted-foreground">
          Use this if your customers pay when their order arrives (cash or a portable card machine
          carried by the driver).
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <Checkbox
              id="accept-cash"
              checked={acceptCash}
              onCheckedChange={(v) => setAcceptCash(Boolean(v))}
            />
            <Label htmlFor="accept-cash" className="cursor-pointer text-sm font-normal">
              Accept cash on delivery
            </Label>
          </div>

          <div className="flex items-center gap-3">
            <Checkbox
              id="accept-card"
              checked={acceptCard}
              onCheckedChange={(v) => setAcceptCard(Boolean(v))}
            />
            <Label htmlFor="accept-card" className="cursor-pointer text-sm font-normal">
              Accept card payment on delivery{' '}
              <span className="text-muted-foreground">(I have a card machine)</span>
            </Label>
          </div>
        </div>

        <Button
          size="sm"
          className="bg-orange-500 hover:bg-orange-600 text-white"
          onClick={handleSave}
          disabled={saving || !dirty}
        >
          {saving && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
          Save
        </Button>
      </CardContent>
    </Card>
  );
}
