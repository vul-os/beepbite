import React, { useState, useEffect } from 'react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { RefreshCcw } from 'lucide-react';
import { setAutoRefill } from '@/services/wallet';
import { useToast } from '@/hooks/use-toast';
import { currencySymbol } from '@/lib/currency';

/**
 * Auto-refill settings card.
 *
 * Props:
 *   wallet   — wallet object (or null)
 *   loading  — boolean
 *   error    — string | null
 *   onSaved  — () => void  callback to refresh parent after successful save
 */
export function AutoRefillCard({ wallet, loading, error, onSaved }) {
  const { toast } = useToast();

  const [enabled, setEnabled] = useState(false);
  const [threshold, setThreshold] = useState('');
  const [target, setTarget] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  const currency = wallet?.currency_code ?? 'USD';
  const symbol = currencySymbol(currency);

  // Sync local state whenever wallet data changes
  useEffect(() => {
    if (!wallet) return;
    setEnabled(wallet.auto_refill_enabled ?? false);
    setThreshold(
      wallet.auto_refill_threshold_cents != null
        ? String(wallet.auto_refill_threshold_cents / 100)
        : ''
    );
    setTarget(
      wallet.auto_refill_target_cents != null
        ? String(wallet.auto_refill_target_cents / 100)
        : ''
    );
  }, [wallet]);

  async function handleSave() {
    const thresholdCents = Math.round(parseFloat(threshold || '0') * 100);
    const targetCents = Math.round(parseFloat(target || '0') * 100);

    if (enabled) {
      if (!thresholdCents || thresholdCents <= 0) {
        setSaveError('Please enter a valid threshold amount.');
        return;
      }
      if (!targetCents || targetCents <= 0) {
        setSaveError('Please enter a valid top-up target amount.');
        return;
      }
      if (targetCents <= thresholdCents) {
        setSaveError('Top-up target must be greater than the threshold.');
        return;
      }
    }

    setSaving(true);
    setSaveError(null);

    const { error: err } = await setAutoRefill({ enabled, thresholdCents, targetCents });
    setSaving(false);

    if (err) {
      setSaveError(err.message ?? 'Failed to save auto-refill settings.');
      return;
    }

    toast({ title: 'Auto-refill updated', description: 'Your settings have been saved.' });
    onSaved?.();
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <RefreshCcw className="h-5 w-5 text-orange-500" />
          <CardTitle className="text-base">Auto-refill</CardTitle>
        </div>
        <CardDescription>
          When your balance drops below the threshold, we automatically top it up to the target amount.
        </CardDescription>
      </CardHeader>

      <CardContent>
        {loading && !wallet ? (
          <div className="space-y-3">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : error && !wallet ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : (
          <div className="space-y-5">
            {/* Enable toggle */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Enable auto-refill</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Automatically top up when balance is low
                </p>
              </div>
              <Switch
                checked={enabled}
                onCheckedChange={setEnabled}
                disabled={saving}
                aria-label="Enable auto-refill"
              />
            </div>

            {/* Threshold + Target */}
            <div className={`space-y-4 transition-opacity ${enabled ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="refill-threshold">
                    Threshold ({symbol})
                  </Label>
                  <Input
                    id="refill-threshold"
                    type="number"
                    min="0"
                    step="1"
                    placeholder="e.g. 10"
                    value={threshold}
                    onChange={(e) => setThreshold(e.target.value)}
                    disabled={saving || !enabled}
                  />
                  <p className="text-xs text-muted-foreground">
                    Refill triggers when balance falls below this
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="refill-target">
                    Top-up target ({symbol})
                  </Label>
                  <Input
                    id="refill-target"
                    type="number"
                    min="0"
                    step="1"
                    placeholder="e.g. 50"
                    value={target}
                    onChange={(e) => setTarget(e.target.value)}
                    disabled={saving || !enabled}
                  />
                  <p className="text-xs text-muted-foreground">
                    We add funds until balance reaches this level
                  </p>
                </div>
              </div>
            </div>

            {saveError && (
              <Alert variant="destructive" className="py-2">
                <AlertDescription className="text-sm">{saveError}</AlertDescription>
              </Alert>
            )}

            <div className="flex justify-end">
              <Button
                onClick={handleSave}
                disabled={saving}
                className="bg-orange-500 hover:bg-orange-600 text-white"
              >
                {saving ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
