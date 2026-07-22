// stamps-config.jsx — owner-facing settings form for the stamp programme.
//
// Allows an org owner to:
//   • Toggle the stamp programme on / off
//   • Set how many stamps are required for a free item
//   • Optionally pin the programme to a specific qualifying item UUID
//
// Uses shadcn/ui form primitives consistent with the rest of the settings pages.

import { useEffect, useState } from 'react';
import { Stamp, Save, Loader2 } from 'lucide-react';

import { Button }   from '@/components/ui/button';
import { Input }    from '@/components/ui/input';
import { Label }    from '@/components/ui/label';
import { Switch }   from '@/components/ui/switch';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader, PageContainer } from '@/components/ui/page-header';

import { getStampConfig, setStampConfig } from '@/services/loyalty-stamps';

// ---------------------------------------------------------------------------

const DEFAULT_REQUIRED = 10;

export default function StampsConfig() {
  const [loading, setLoading]   = useState(true);
  const [saving,  setSaving]    = useState(false);
  const [error,   setError]     = useState(null);
  const [success, setSuccess]   = useState(false);

  const [enabled,  setEnabled]  = useState(false);
  const [required, setRequired] = useState(DEFAULT_REQUIRED);
  const [itemId,   setItemId]   = useState('');

  // Load current config on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error: err } = await getStampConfig();
      if (cancelled) return;
      if (err) {
        setError(err.message ?? 'Failed to load stamp config');
      } else if (data) {
        setEnabled(data.stamps_enabled ?? false);
        setRequired(data.stamps_required ?? DEFAULT_REQUIRED);
        setItemId(data.stamp_item_id ?? '');
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  async function handleSave(e) {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    const req = parseInt(required, 10);
    if (!req || req < 1) {
      setError('Stamps required must be a positive number.');
      return;
    }

    setSaving(true);
    const { error: err } = await setStampConfig({
      stampsEnabled:  enabled,
      stampsRequired: req,
      stampItemId:    itemId.trim() || null,
    });
    setSaving(false);

    if (err) {
      setError(err.message ?? 'Failed to save stamp config');
    } else {
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    }
  }

  // -------------------------------------------------------------------------

  if (loading) {
    return (
      <PageContainer>
        <PageHeader
          eyebrow="Settings"
          title="Loyalty"
          description="Reward loyal customers with a digital punch card."
          icon={Stamp}
        />
        <div className="flex items-center gap-2 py-8 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Loading stamp config…</span>
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Settings"
        title="Loyalty"
        description="Reward loyal customers with a digital punch card."
        icon={Stamp}
      />
      <Card className="max-w-lg">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Stamp className="h-5 w-5 text-primary" />
          <CardTitle>Stamp Programme</CardTitle>
        </div>
        <CardDescription>
          Reward loyal customers with a "buy N, get 1 free" digital punch card.
          Stamps are accrued at the POS and reset automatically when a reward is earned.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form onSubmit={handleSave} className="space-y-6">

          {/* Enabled toggle */}
          <div className="flex items-center justify-between rounded-lg border p-4">
            <div>
              <p className="font-medium leading-none">Enable stamp programme</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Customers earn a stamp on qualifying purchases.
              </p>
            </div>
            <Switch
              checked={enabled}
              onCheckedChange={setEnabled}
              id="stamps-enabled"
              aria-label="Enable stamp programme"
            />
          </div>

          {/* Stamps required */}
          <div className="space-y-2">
            <Label htmlFor="stamps-required">Stamps required for free item</Label>
            <Input
              id="stamps-required"
              type="number"
              min={1}
              max={100}
              value={required}
              onChange={(e) => setRequired(e.target.value)}
              disabled={!enabled}
              className="w-32"
            />
            <p className="text-xs text-muted-foreground">
              After collecting this many stamps the customer's counter resets and a reward is issued.
            </p>
          </div>

          {/* Qualifying item */}
          <div className="space-y-2">
            <Label htmlFor="stamp-item-id">Qualifying item ID (optional)</Label>
            <Input
              id="stamp-item-id"
              type="text"
              placeholder="Leave blank to award a stamp on any purchase"
              value={itemId}
              onChange={(e) => setItemId(e.target.value)}
              disabled={!enabled}
            />
            <p className="text-xs text-muted-foreground">
              Paste the UUID of a specific menu item. When set, stamps are only awarded
              when that item is on the order.
            </p>
          </div>

          {/* Feedback */}
          {error && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
          {success && (
            <p className="rounded-md bg-success/10 px-3 py-2 text-sm text-success">
              Stamp config saved.
            </p>
          )}

          <Button type="submit" disabled={saving} className="gap-2">
            {saving
              ? <><Loader2 className="h-4 w-4 animate-spin" />Saving…</>
              : <><Save className="h-4 w-4" />Save changes</>}
          </Button>
        </form>
      </CardContent>
      </Card>
    </PageContainer>
  );
}
