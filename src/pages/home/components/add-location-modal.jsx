import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/auth-context';
import { supabase } from '@/services/supabase-client';
import { MapPin, Loader2 } from 'lucide-react';
import AddressAutocomplete from '@/components/address-autocomplete';

const AddLocationModal = ({ open, onOpenChange, onSuccess }) => {
  const { activeOrganization, fetchLocations } = useAuth();
  const { toast } = useToast();

  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [country, setCountry] = useState('South Africa');
  const [regionId, setRegionId] = useState('');
  const [regions, setRegions] = useState([]);
  const [loadingRegions, setLoadingRegions] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Fetch regions when modal opens
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoadingRegions(true);
    (async () => {
      try {
        const { data, error } = await supabase
          .from('regions')
          .select('id,name,code,currency')
          .eq('is_active', true)
          .order('name', { ascending: true });
        if (cancelled) return;
        if (error) throw error;
        setRegions(data || []);
        // Default to ZA
        const za = (data || []).find((r) => r.code === 'ZA');
        if (za) setRegionId(za.id);
      } catch (err) {
        console.error('Failed to load regions:', err);
      } finally {
        if (!cancelled) setLoadingRegions(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open]);

  const reset = () => {
    setName('');
    setAddress('');
    setCity('');
    setCountry('South Africa');
    setRegionId('');
    setSubmitting(false);
  };

  const handleOpenChange = (v) => {
    if (!v) reset();
    onOpenChange(v);
  };

  const isValid = name.trim().length >= 2 && regionId;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!isValid || submitting || !activeOrganization?.id) return;

    setSubmitting(true);
    try {
      const payload = {
        organization_id: activeOrganization.id,
        name: name.trim(),
        region_id: regionId,
        ...(address.trim() && { address: address.trim() }),
        ...(city.trim() && { city: city.trim() }),
        ...(country.trim() && { country: country.trim() }),
        ...(lat !== '' && { latitude: parseFloat(lat) }),
        ...(lng !== '' && { longitude: parseFloat(lng) }),
      };

      const { data, error } = await supabase
        .from('locations')
        .insert(payload)
        .select()
        .single();

      if (error) throw error;
      if (!data?.id) throw new Error('Location was not created');

      toast({
        title: 'Location added',
        description: `${name.trim()} is ready. You can now set up your menu and start taking orders.`,
      });

      // Refresh location list in auth context
      await fetchLocations();

      reset();
      onOpenChange(false);
      if (onSuccess) onSuccess(data);
    } catch (err) {
      const msg = err?.message || err?.error || 'Failed to create location';
      toast({
        title: 'Could not add location',
        description: msg,
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2 mb-1">
            <div className="flex items-center justify-center w-8 h-8 rounded-full bg-orange-100">
              <MapPin className="w-4 h-4 text-orange-500" />
            </div>
            <DialogTitle>Add your first location</DialogTitle>
          </div>
          <DialogDescription>
            A location represents one of your physical stores or service points.
            You can add more later from Settings.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          {/* Location name */}
          <div className="space-y-1.5">
            <Label htmlFor="loc-name">
              Location name <span className="text-red-500">*</span>
            </Label>
            <Input
              id="loc-name"
              placeholder="e.g. Main Branch, CBD Store"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={submitting}
              autoFocus
              maxLength={120}
              required
            />
          </div>

          {/* Region */}
          <div className="space-y-1.5">
            <Label htmlFor="loc-region">
              Region <span className="text-red-500">*</span>
            </Label>
            {loadingRegions ? (
              <div className="flex items-center gap-2 text-sm text-gray-500 h-10 px-3 border rounded-md">
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading regions…
              </div>
            ) : (
              <Select
                value={regionId}
                onValueChange={setRegionId}
                disabled={submitting}
              >
                <SelectTrigger id="loc-region">
                  <SelectValue placeholder="Select a region" />
                </SelectTrigger>
                <SelectContent>
                  {regions.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name} ({r.currency})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Address */}
          <div className="space-y-1.5">
            <Label htmlFor="loc-address">Street address</Label>
            <AddressAutocomplete
              id="loc-address"
              placeholder="Start typing a South African address…"
              value={address}
              onChange={setAddress}
              onSelect={(s) => {
                setAddress(s.street || s.place_name || address);
                if (s.city) setCity(s.city);
                if (s.lat != null) setLat(String(s.lat));
                if (s.lng != null) setLng(String(s.lng));
              }}
              disabled={submitting}
            />
            <p className="text-xs text-gray-500">Pick a suggestion to set the location on the map automatically.</p>
          </div>

          {/* City + Country row */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="loc-city">City</Label>
              <Input
                id="loc-city"
                placeholder="e.g. Cape Town"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                disabled={submitting}
                maxLength={100}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="loc-country">Country</Label>
              <Input
                id="loc-country"
                placeholder="South Africa"
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                disabled={submitting}
                maxLength={80}
              />
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={() => handleOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              className="flex-1 bg-orange-500 hover:bg-orange-600 text-white"
              disabled={!isValid || submitting}
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Adding…
                </>
              ) : (
                'Add location'
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default AddLocationModal;
