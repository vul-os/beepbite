import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/auth-context';
import { supabase } from '@/services/supabase-client';

// Onboarding creates the bare-minimum tenancy state so the user can land
// in the app: an organisation row + an organization_members row (owner).
// Location is intentionally NOT created here — the user adds it from
// /settings/location-settings once they're in. This keeps the popup
// dependency-free of regions/lat-lng and lets the user dismiss any
// friction on signup.
const OnboardingPopup = () => {
  const { user, fetchOrganizations, needsOnboarding } = useAuth();
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);

  if (!needsOnboarding || !user) return null;

  const trimmedName = name.trim();
  const isValid = trimmedName.length >= 2;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!isValid || loading) return;

    setLoading(true);
    try {
      const { data: org, error: orgError } = await supabase
        .from('organizations')
        .insert({ name: trimmedName })
        .select()
        .single();

      if (orgError) throw orgError;
      if (!org?.id) throw new Error('Failed to create organization');

      const { error: memberError } = await supabase
        .from('organization_members')
        .insert({ organization_id: org.id, profile_id: user.id, role: 'owner' });

      if (memberError) throw memberError;

      // Refresh context — flips needsOnboarding off and sets activeOrganization.
      await fetchOrganizations();

      toast({
        title: 'Welcome!',
        description: `${trimmedName} created. Add a location from Settings when you're ready.`,
      });
    } catch (err) {
      const detail = err?.message || err?.error || JSON.stringify(err);
      const status = err?.status ? ` (${err.status})` : '';
      console.error('Onboarding error:', err);
      toast({
        title: 'Setup failed',
        description: `${detail}${status}`,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={true}>
      <DialogContent
        className="sm:max-w-md"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Set up your organisation</DialogTitle>
          <DialogDescription>
            One quick step before you start. You can add locations and other
            details from Settings.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="space-y-1">
            <Label htmlFor="onboarding-name">Business name</Label>
            <Input
              id="onboarding-name"
              placeholder="e.g. Mario's Pizza"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={loading}
              autoFocus
              maxLength={120}
              required
            />
          </div>

          <Button
            type="submit"
            className="w-full"
            disabled={loading || !isValid}
          >
            {loading ? 'Setting up…' : 'Get started'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default OnboardingPopup;
