import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { PageHeader, PageContainer } from "@/components/ui/page-header";
import { Reveal } from "@/components/ui/motion";
import AddressAutocomplete from "@/components/address-autocomplete";
import {
  MapPin,
  Settings as SettingsIcon,
  Save,
  CheckCircle,
  Loader2,
  AlertCircle,
  Truck,
  ArrowLeft,
  Activity,
  UtensilsCrossed,
  ShoppingBag,
} from 'lucide-react';
import { useAuth } from '@/context/auth-context';
import { supabase } from '@/services/supabase-client';
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Service-style localStorage helpers (same key as workspace.jsx)
// ---------------------------------------------------------------------------
function getServiceStyleLS(locId) {
  if (!locId) return 'dine_in';
  try {
    const v = localStorage.getItem(`bb_service_style_${locId}`);
    return v === 'takeaway' ? 'takeaway' : 'dine_in';
  } catch {
    return 'dine_in';
  }
}
function setServiceStyleLS(locId, value) {
  if (!locId) return;
  try { localStorage.setItem(`bb_service_style_${locId}`, value); } catch { /* ignore */ }
}

const LocationSettings = () => {
  const { activeOrganization, user, fetchLocations } = useAuth();
  const { locationId } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [activeTab, setActiveTab] = useState('details');
  const [locationData, setLocationData] = useState(null);
  // Service style — stored locally per-location. Loaded on mount; persisted on save.
  const [serviceStyle, setServiceStyle] = useState(() => getServiceStyleLS(locationId));
  const [formData, setFormData] = useState({
    // Location details
    name: '',
    description: '',
    whatsapp_number: '',
    address: '',
    latitude: '',
    longitude: '',

    // Delivery settings
    delivery_fee: '',
    free_delivery_threshold: '',
    max_delivery_distance_km: '',
    estimated_prep_time: '',
    accepts_delivery: true,
    accepts_pickup: true,
    is_active: true
  });

  useEffect(() => {
    if (locationId) {
      loadLocationData();
    }
  }, [locationId]);

  const loadLocationData = async () => {
    if (!locationId) return;

    setLoading(true);
    try {
      // Load location data by ID
      const { data: location, error: locationError } = await supabase
        .from('locations')
        .select('*')
        .eq('id', locationId)
        .single();

      if (locationError) {
        console.error('Error loading location data:', locationError);
        if (locationError.code === 'PGRST116') {
          // Location not found
          navigate('/settings/organization');
          return;
        }
        return;
      }

      // Check if location belongs to active organization
      if (activeOrganization && location.organization_id !== activeOrganization.id) {
        console.error('Location does not belong to active organization');
        navigate('/settings/organization');
        return;
      }

      setLocationData(location);
      setFormData({
        name: location.name || '',
        description: location.description || '',
        whatsapp_number: location.whatsapp_number || '',
        address: location.address || '',
        latitude: location.latitude || '',
        longitude: location.longitude || '',
        delivery_fee: location.delivery_fee || '',
        free_delivery_threshold: location.free_delivery_threshold || '',
        max_delivery_distance_km: location.max_delivery_distance_km || '',
        estimated_prep_time: location.estimated_prep_time || '',
        accepts_delivery: location.accepts_delivery ?? true,
        accepts_pickup: location.accepts_pickup ?? true,
        is_active: location.is_active ?? true
      });
      // Sync service style from localStorage
      setServiceStyle(getServiceStyleLS(locationId));
    } catch (error) {
      console.error('Error loading location data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (field, value) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));

    if (saveMessage) {
      setSaveMessage('');
    }
  };

  const saveLocationSettings = async () => {
    if (!locationId) return;

    setSaving(true);
    setSaveMessage('');

    try {
      // Validate required fields
      if (!formData.name.trim()) {
        throw new Error('Location name is required');
      }

      // Update location data
      const { error: locationError } = await supabase
        .from('locations')
        .update({
          name: formData.name.trim(),
          description: formData.description.trim() || null,
          whatsapp_number: formData.whatsapp_number.trim() || null,
          address: formData.address.trim() || null,
          latitude: formData.latitude ? parseFloat(formData.latitude) : null,
          longitude: formData.longitude ? parseFloat(formData.longitude) : null,
          delivery_fee: formData.delivery_fee ? parseFloat(formData.delivery_fee) : null,
          free_delivery_threshold: formData.free_delivery_threshold ? parseFloat(formData.free_delivery_threshold) : null,
          max_delivery_distance_km: formData.max_delivery_distance_km ? parseFloat(formData.max_delivery_distance_km) : null,
          estimated_prep_time: formData.estimated_prep_time ? parseInt(formData.estimated_prep_time) : null,
          accepts_delivery: formData.accepts_delivery,
          accepts_pickup: formData.accepts_pickup,
          is_active: formData.is_active,
          updated_at: new Date().toISOString()
        })
        .eq('id', locationId);

      if (locationError) throw locationError;

      // Persist service style to localStorage
      setServiceStyleLS(locationId, serviceStyle);

      setSaveMessage('Location settings saved successfully!');

      // Refresh locations in auth context
      await fetchLocations();

      // Reload location data to reflect changes
      await loadLocationData();

      setTimeout(() => {
        setSaveMessage('');
      }, 3000);

    } catch (error) {
      console.error('Error saving location settings:', error);
      setSaveMessage(error.message || 'Failed to save location settings. Please try again.');

      setTimeout(() => {
        setSaveMessage('');
      }, 5000);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <PageContainer>
        <div className="flex items-start gap-3">
          <Skeleton className="h-11 w-11 rounded-2xl" />
          <div className="space-y-2">
            <Skeleton className="h-8 w-52" />
            <Skeleton className="h-4 w-64" />
          </div>
        </div>
        <Skeleton className="h-[72px] w-full rounded-2xl" />
        <Skeleton className="h-10 w-full rounded-xl" />
        <Skeleton className="h-72 w-full rounded-2xl" />
      </PageContainer>
    );
  }

  if (!locationData) {
    return (
      <PageContainer>
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted mb-4">
            <AlertCircle className="w-7 h-7 text-muted-foreground" />
          </span>
          <h2 className="font-display text-xl font-semibold text-foreground mb-2">Location not found</h2>
          <p className="text-sm text-muted-foreground mb-6 max-w-sm">
            The location you're looking for doesn't exist or you don't have access to it.
          </p>
          <Button onClick={() => navigate('/settings/organization')} variant="outline" className="rounded-xl">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Organization Settings
          </Button>
        </div>
      </PageContainer>
    );
  }

  const isSuccess = saveMessage.includes('successfully');

  return (
    <PageContainer>
      {/* Back breadcrumb + page header */}
      <Reveal>
        <div className="space-y-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/settings/organization')}
            className="text-muted-foreground hover:text-primary -ml-2 rounded-lg h-8 px-2 gap-1.5"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span className="text-xs">Organization</span>
          </Button>

          <PageHeader
            eyebrow="Location"
            title={locationData?.name || 'Location Settings'}
            description={`Manage address, delivery rules, and status for this location.`}
            icon={MapPin}
            actions={
              <Button
                onClick={saveLocationSettings}
                disabled={saving}
                className="hidden sm:inline-flex shadow-sm transition-all duration-200"
              >
                {saving ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Saving…
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4 mr-2" />
                    Save changes
                  </>
                )}
              </Button>
            }
          />
        </div>
      </Reveal>

      {/* Save message */}
      {saveMessage && (
        <Reveal delay={0.05}>
          <div
            className={cn(
              'flex items-center gap-2.5 px-4 py-3 rounded-xl border text-sm font-medium',
              isSuccess
                ? 'bg-green-50 text-green-800 border-green-200 dark:bg-green-950/40 dark:text-green-300 dark:border-green-800'
                : 'bg-destructive/10 text-destructive border-destructive/20'
            )}
          >
            {isSuccess ? (
              <CheckCircle className="w-4 h-4 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0" />
            )}
            <span>{saveMessage}</span>
          </div>
        </Reveal>
      )}

      {/* Location status banner */}
      <Reveal delay={0.07}>
        <Card variant="feature" className="border-primary/20">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
                <MapPin className="w-5 h-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-foreground truncate">{locationData?.name}</p>
                <p className="text-xs text-muted-foreground">
                  {formData.is_active ? 'Active' : 'Inactive'} ·{' '}
                  {formData.accepts_delivery && formData.accepts_pickup
                    ? 'Delivery & pickup'
                    : formData.accepts_delivery
                    ? 'Delivery only'
                    : formData.accepts_pickup
                    ? 'Pickup only'
                    : 'No fulfilment methods'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </Reveal>

      {/* Settings tabs */}
      <Reveal delay={0.1}>
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-3 h-auto p-1 bg-muted/60 rounded-xl">
            <TabsTrigger
              value="details"
              className="flex items-center gap-2 text-xs sm:text-sm py-2.5 rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-sm data-[state=active]:text-primary"
            >
              <MapPin className="w-4 h-4" />
              <span>Details</span>
            </TabsTrigger>
            <TabsTrigger
              value="delivery"
              className="flex items-center gap-2 text-xs sm:text-sm py-2.5 rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-sm data-[state=active]:text-primary"
            >
              <Truck className="w-4 h-4" />
              <span>Delivery</span>
            </TabsTrigger>
            <TabsTrigger
              value="status"
              className="flex items-center gap-2 text-xs sm:text-sm py-2.5 rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-sm data-[state=active]:text-primary"
            >
              <SettingsIcon className="w-4 h-4" />
              <span>Status</span>
            </TabsTrigger>
          </TabsList>

          {/* ── Details tab ── */}
          <TabsContent value="details" className="mt-5 space-y-5">
            <Reveal>
              <Card variant="elevated">
                <CardHeader className="pb-4">
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <MapPin className="h-4 w-4" />
                    </span>
                    <div>
                      <CardTitle>Location details</CardTitle>
                      <CardDescription className="mt-0.5">Name, contact, address and map coordinates.</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-5">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    <div className="space-y-1.5">
                      <label htmlFor="loc-name" className="block text-sm font-medium text-foreground">
                        Location name <span className="text-destructive">*</span>
                      </label>
                      <Input
                        id="loc-name"
                        placeholder="Main Branch, Downtown, etc."
                        value={formData.name}
                        onChange={(e) => handleInputChange('name', e.target.value)}
                        className="rounded-xl h-10"
                        required
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label htmlFor="whatsapp" className="block text-sm font-medium text-foreground">
                        WhatsApp number
                      </label>
                      <Input
                        id="whatsapp"
                        type="tel"
                        placeholder="+27 82 123 4567"
                        value={formData.whatsapp_number}
                        onChange={(e) => handleInputChange('whatsapp_number', e.target.value)}
                        className="rounded-xl h-10"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label htmlFor="description" className="block text-sm font-medium text-foreground">
                      Description
                    </label>
                    <Textarea
                      id="description"
                      placeholder="Describe this location…"
                      value={formData.description}
                      onChange={(e) => handleInputChange('description', e.target.value)}
                      rows={3}
                      className="rounded-xl resize-none"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-sm font-medium text-foreground">
                      Address
                    </label>
                    <AddressAutocomplete
                      placeholder="Start typing a South African address…"
                      value={formData.address}
                      onChange={(text) => handleInputChange('address', text)}
                      onSelect={(s) => {
                        handleInputChange('address', s.place_name || s.street || formData.address);
                        if (s.lat != null) handleInputChange('latitude', String(s.lat));
                        if (s.lng != null) handleInputChange('longitude', String(s.lng));
                      }}
                      className="rounded-xl"
                    />
                    <p className="text-xs text-muted-foreground">
                      Pick a suggestion to auto-fill the map coordinates below.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    <div className="space-y-1.5">
                      <label htmlFor="latitude" className="block text-sm font-medium text-foreground">
                        Latitude
                      </label>
                      <Input
                        id="latitude"
                        type="number"
                        step="0.000001"
                        placeholder="-26.2041"
                        value={formData.latitude}
                        onChange={(e) => handleInputChange('latitude', e.target.value)}
                        className="rounded-xl h-10"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label htmlFor="longitude" className="block text-sm font-medium text-foreground">
                        Longitude
                      </label>
                      <Input
                        id="longitude"
                        type="number"
                        step="0.000001"
                        placeholder="28.0473"
                        value={formData.longitude}
                        onChange={(e) => handleInputChange('longitude', e.target.value)}
                        className="rounded-xl h-10"
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Reveal>

            {/* Mobile save */}
            <div className="sm:hidden">
              <Button
                onClick={saveLocationSettings}
                disabled={saving}
                className="w-full rounded-xl h-11"
              >
                {saving ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving…</>
                ) : (
                  <><Save className="w-4 h-4 mr-2" />Save Location Settings</>
                )}
              </Button>
            </div>
          </TabsContent>

          {/* ── Delivery tab ── */}
          <TabsContent value="delivery" className="mt-5 space-y-5">
            <Reveal>
              <Card variant="elevated">
                <CardHeader className="pb-4">
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <Truck className="h-4 w-4" />
                    </span>
                    <div>
                      <CardTitle>Delivery settings</CardTitle>
                      <CardDescription className="mt-0.5">Fees, thresholds, distances and prep times for this location.</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-5">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    <div className="space-y-1.5">
                      <label htmlFor="delivery_fee" className="block text-sm font-medium text-foreground">
                        Delivery fee (R)
                      </label>
                      <Input
                        id="delivery_fee"
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="25.00"
                        value={formData.delivery_fee}
                        onChange={(e) => handleInputChange('delivery_fee', e.target.value)}
                        className="rounded-xl h-10"
                      />
                      <p className="text-xs text-muted-foreground">Standard delivery fee charged to customers</p>
                    </div>

                    <div className="space-y-1.5">
                      <label htmlFor="free_delivery_threshold" className="block text-sm font-medium text-foreground">
                        Free delivery threshold (R)
                      </label>
                      <Input
                        id="free_delivery_threshold"
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="150.00"
                        value={formData.free_delivery_threshold}
                        onChange={(e) => handleInputChange('free_delivery_threshold', e.target.value)}
                        className="rounded-xl h-10"
                      />
                      <p className="text-xs text-muted-foreground">Minimum order amount for free delivery</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    <div className="space-y-1.5">
                      <label htmlFor="max_delivery_distance_km" className="block text-sm font-medium text-foreground">
                        Max delivery distance (km)
                      </label>
                      <Input
                        id="max_delivery_distance_km"
                        type="number"
                        step="0.1"
                        min="0"
                        placeholder="10.0"
                        value={formData.max_delivery_distance_km}
                        onChange={(e) => handleInputChange('max_delivery_distance_km', e.target.value)}
                        className="rounded-xl h-10"
                      />
                      <p className="text-xs text-muted-foreground">Maximum distance for delivery orders</p>
                    </div>

                    <div className="space-y-1.5">
                      <label htmlFor="estimated_prep_time" className="block text-sm font-medium text-foreground">
                        Estimated prep time (minutes)
                      </label>
                      <Input
                        id="estimated_prep_time"
                        type="number"
                        min="1"
                        placeholder="30"
                        value={formData.estimated_prep_time}
                        onChange={(e) => handleInputChange('estimated_prep_time', e.target.value)}
                        className="rounded-xl h-10"
                      />
                      <p className="text-xs text-muted-foreground">Average time to prepare orders</p>
                    </div>
                  </div>

                  {/* Fulfilment toggles */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="flex items-center justify-between p-4 bg-muted/50 rounded-xl border border-border/50">
                      <div>
                        <p className="text-sm font-medium text-foreground">Accept delivery</p>
                        <p className="text-xs text-muted-foreground mt-0.5">Receive delivery orders</p>
                      </div>
                      <input
                        type="checkbox"
                        id="accepts_delivery"
                        checked={formData.accepts_delivery}
                        onChange={(e) => handleInputChange('accepts_delivery', e.target.checked)}
                        className="w-4 h-4 accent-primary border-border rounded"
                      />
                    </div>

                    <div className="flex items-center justify-between p-4 bg-muted/50 rounded-xl border border-border/50">
                      <div>
                        <p className="text-sm font-medium text-foreground">Accept pickup</p>
                        <p className="text-xs text-muted-foreground mt-0.5">Receive collection orders</p>
                      </div>
                      <input
                        type="checkbox"
                        id="accepts_pickup"
                        checked={formData.accepts_pickup}
                        onChange={(e) => handleInputChange('accepts_pickup', e.target.checked)}
                        className="w-4 h-4 accent-primary border-border rounded"
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Reveal>

            {/* Mobile save */}
            <div className="sm:hidden">
              <Button
                onClick={saveLocationSettings}
                disabled={saving}
                className="w-full rounded-xl h-11"
              >
                {saving ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving…</>
                ) : (
                  <><Save className="w-4 h-4 mr-2" />Save Location Settings</>
                )}
              </Button>
            </div>
          </TabsContent>

          {/* ── Status tab ── */}
          <TabsContent value="status" className="mt-5 space-y-5">

            {/* Service style card */}
            <Reveal>
              <Card variant="elevated">
                <CardHeader className="pb-4">
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <UtensilsCrossed className="h-4 w-4" />
                    </span>
                    <div>
                      <CardTitle>Service style</CardTitle>
                      <CardDescription className="mt-0.5">Tell BeepBite how this location serves customers so it shows the right features in the POS.</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {/* Dine-in option */}
                    <button
                      type="button"
                      onClick={() => setServiceStyle('dine_in')}
                      className={cn(
                        'flex items-start gap-3 rounded-xl border-2 p-4 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                        serviceStyle === 'dine_in'
                          ? 'border-primary bg-primary/5'
                          : 'border-border/50 bg-muted/30 hover:border-border hover:bg-muted/60'
                      )}
                    >
                      <span className={cn(
                        'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                        serviceStyle === 'dine_in' ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'
                      )}>
                        <UtensilsCrossed className="h-4 w-4" />
                      </span>
                      <div>
                        <p className="text-sm font-semibold text-foreground">Dine-in</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">Restaurant or café with tables. Shows the floor plan, seat selection and dine-in flow.</p>
                      </div>
                    </button>

                    {/* Takeaway option */}
                    <button
                      type="button"
                      onClick={() => setServiceStyle('takeaway')}
                      className={cn(
                        'flex items-start gap-3 rounded-xl border-2 p-4 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                        serviceStyle === 'takeaway'
                          ? 'border-primary bg-primary/5'
                          : 'border-border/50 bg-muted/30 hover:border-border hover:bg-muted/60'
                      )}
                    >
                      <span className={cn(
                        'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                        serviceStyle === 'takeaway' ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'
                      )}>
                        <ShoppingBag className="h-4 w-4" />
                      </span>
                      <div>
                        <p className="text-sm font-semibold text-foreground">Takeaway / counter</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">Market stall, food truck, counter service or delivery-only. No floor plan or table selection needed.</p>
                      </div>
                    </button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    You can change this any time. Choosing &ldquo;Takeaway&rdquo; hides the dine-in flow in the POS so it&apos;s never in the way.
                  </p>
                </CardContent>
              </Card>
            </Reveal>

            <Reveal>
              <Card variant="elevated">
                <CardHeader className="pb-4">
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <Activity className="h-4 w-4" />
                    </span>
                    <div>
                      <CardTitle>Location status</CardTitle>
                      <CardDescription className="mt-0.5">Control whether this location is visible and accepting orders.</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-5">
                  <div className="flex items-center justify-between p-4 bg-muted/50 rounded-xl border border-border/50">
                    <div>
                      <p className="text-sm font-medium text-foreground">Location active</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Inactive locations won't appear in customer searches
                      </p>
                    </div>
                    <div className="flex items-center gap-2.5 shrink-0">
                      <input
                        type="checkbox"
                        id="is_active"
                        checked={formData.is_active}
                        onChange={(e) => handleInputChange('is_active', e.target.checked)}
                        className="w-4 h-4 accent-primary border-border rounded"
                      />
                      <label htmlFor="is_active" className="text-sm font-medium text-foreground cursor-pointer">
                        Active
                      </label>
                    </div>
                  </div>

                  {/* Live summary */}
                  <div className="grid grid-cols-3 gap-3 p-4 bg-primary/5 rounded-xl border border-primary/15">
                    <div className="text-center">
                      <p className={cn('text-xl font-bold font-display', formData.is_active ? 'text-primary' : 'text-muted-foreground')}>
                        {formData.is_active ? 'On' : 'Off'}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">Status</p>
                    </div>
                    <div className="text-center border-x border-primary/15">
                      <p className={cn('text-xl font-bold font-display', formData.accepts_delivery ? 'text-primary' : 'text-muted-foreground')}>
                        {formData.accepts_delivery ? 'On' : 'Off'}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">Delivery</p>
                    </div>
                    <div className="text-center">
                      <p className={cn('text-xl font-bold font-display', formData.accepts_pickup ? 'text-primary' : 'text-muted-foreground')}>
                        {formData.accepts_pickup ? 'On' : 'Off'}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">Pickup</p>
                    </div>
                  </div>

                  <div className="p-4 bg-muted/40 rounded-xl border border-border/40 space-y-1.5">
                    <p className="text-xs font-semibold text-foreground">Tips</p>
                    <ul className="space-y-1 text-xs text-muted-foreground list-disc list-inside">
                      <li>Inactive locations won't appear in customer searches</li>
                      <li>You can disable delivery or pickup individually</li>
                      <li>Set realistic prep times for better customer satisfaction</li>
                    </ul>
                  </div>
                </CardContent>
              </Card>
            </Reveal>

            {/* Mobile save */}
            <div className="sm:hidden">
              <Button
                onClick={saveLocationSettings}
                disabled={saving}
                className="w-full rounded-xl h-11"
              >
                {saving ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving…</>
                ) : (
                  <><Save className="w-4 h-4 mr-2" />Save Location Settings</>
                )}
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </Reveal>

      {/* Mobile floating save button */}
      <Button
        onClick={saveLocationSettings}
        disabled={saving}
        size="icon"
        className="fixed bottom-6 right-6 w-14 h-14 rounded-full shadow-elevated hover:shadow-glow transition-all duration-300 z-40 sm:hidden"
      >
        {saving ? (
          <Loader2 className="w-5 h-5 animate-spin" />
        ) : (
          <Save className="w-5 h-5" />
        )}
      </Button>
    </PageContainer>
  );
};

export default LocationSettings;
