import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { 
  MapPin, 
  Settings as SettingsIcon,
  Save,
  CheckCircle,
  Loader2,
  AlertCircle,
  Truck,
  Clock,
  Phone,
  ArrowLeft
} from 'lucide-react';
import { useAuth } from '@/context/auth-context';
import { supabase } from '@/services/supabase-client';
import { cn } from "@/lib/utils";

const LocationSettings = () => {
  const { activeOrganization, user, fetchLocations } = useAuth();
  const { locationId } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [activeTab, setActiveTab] = useState('details');
  const [locationData, setLocationData] = useState(null);
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
      <div className="space-y-4">
        <div className="h-12 bg-gray-200 rounded animate-pulse"></div>
        <div className="h-64 bg-gray-200 rounded animate-pulse"></div>
        <div className="h-96 bg-gray-200 rounded animate-pulse"></div>
      </div>
    );
  }

  if (!locationData) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <AlertCircle className="w-16 h-16 text-gray-400 mb-4" />
        <h2 className="text-xl font-semibold text-gray-900 mb-2">Location Not Found</h2>
        <p className="text-gray-600 mb-4">The location you're looking for doesn't exist or you don't have access to it.</p>
        <Button onClick={() => navigate('/settings/organization')}>
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Organization Settings
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate('/settings/organization')}
                className="text-gray-500 hover:text-gray-700"
              >
                <ArrowLeft className="w-4 h-4 mr-1" />
                Back to Organization
              </Button>
            </div>
            <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-2">
              <MapPin className="w-8 h-8 text-orange-500" />
              Location Settings
            </h1>
            <p className="text-gray-600 mt-1">
              Manage settings for {locationData?.name || 'this location'}
            </p>
          </div>
        </div>

        {/* Save Message */}
        {saveMessage && (
          <div className={cn(
            "flex items-center gap-2 px-4 py-3 rounded-lg",
            saveMessage.includes('successfully') 
              ? "bg-green-50 text-green-800 border border-green-200"
              : "bg-red-50 text-red-800 border border-red-200"
          )}>
            {saveMessage.includes('successfully') ? (
              <CheckCircle className="w-4 h-4" />
            ) : (
              <AlertCircle className="w-4 h-4" />
            )}
            <span className="text-sm font-medium">{saveMessage}</span>
          </div>
        )}
      </div>

      {/* Current Location Info */}
      <Card className="border-gray-200 bg-orange-50 border-orange-200">
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-orange-500 flex items-center justify-center">
              <MapPin className="w-5 h-5 text-white" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-lg font-bold text-gray-900 truncate">{locationData?.name || 'Unknown Location'}</p>
              <p className="text-xs text-gray-600">Managing settings for this location</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Save Buttons */}
      <Button
        onClick={saveLocationSettings}
        disabled={saving}
        className="fixed bottom-6 right-6 w-14 h-14 rounded-full beepbite-gradient text-white shadow-xl hover:shadow-2xl transition-all duration-300 z-40 flex items-center justify-center sm:hidden"
        size="lg"
      >
        {saving ? (
          <Loader2 className="w-6 h-6 animate-spin" />
        ) : (
          <Save className="w-6 h-6" />
        )}
      </Button>

      {/* Desktop Save Button */}
      <div className="hidden sm:flex justify-end">
        <Button 
          onClick={saveLocationSettings}
          disabled={saving}
          className="beepbite-gradient text-white shadow-lg hover:shadow-xl transition-all duration-200"
        >
          {saving ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Save className="w-4 h-4 mr-2" />
              Save Location Settings
            </>
          )}
        </Button>
      </div>

      {/* Settings Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-3 h-auto p-1 bg-gray-100">
          <TabsTrigger 
            value="details" 
            className="flex items-center gap-2 text-xs sm:text-sm p-3"
          >
            <MapPin className="w-4 h-4" />
            <span>Details</span>
          </TabsTrigger>
          <TabsTrigger 
            value="delivery" 
            className="flex items-center gap-2 text-xs sm:text-sm p-3"
          >
            <Truck className="w-4 h-4" />
            <span>Delivery</span>
          </TabsTrigger>
          <TabsTrigger 
            value="status" 
            className="flex items-center gap-2 text-xs sm:text-sm p-3"
          >
            <SettingsIcon className="w-4 h-4" />
            <span>Status</span>
          </TabsTrigger>
        </TabsList>

        {/* Location Details Tab */}
        <TabsContent value="details" className="mt-6">
          <Card className="border-gray-200">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MapPin className="w-5 h-5 text-orange-500" />
                Location Details
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Location Name <span className="text-red-500">*</span>
                  </label>
                  <Input
                    placeholder="Main Branch, Downtown Location, etc."
                    value={formData.name}
                    onChange={(e) => handleInputChange('name', e.target.value)}
                    className="w-full"
                    required
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    WhatsApp Number
                  </label>
                  <Input
                    type="tel"
                    placeholder="+27 82 123 4567"
                    value={formData.whatsapp_number}
                    onChange={(e) => handleInputChange('whatsapp_number', e.target.value)}
                    className="w-full"
                  />
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Location Description
                </label>
                <Textarea
                  placeholder="Describe this location..."
                  value={formData.description}
                  onChange={(e) => handleInputChange('description', e.target.value)}
                  rows={3}
                  className="w-full"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Address
                </label>
                <Textarea
                  placeholder="123 Main Street, City, State, ZIP Code"
                  value={formData.address}
                  onChange={(e) => handleInputChange('address', e.target.value)}
                  rows={3}
                  className="w-full"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Latitude
                  </label>
                  <Input
                    type="number"
                    step="0.000001"
                    placeholder="-26.2041"
                    value={formData.latitude}
                    onChange={(e) => handleInputChange('latitude', e.target.value)}
                    className="w-full"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Longitude
                  </label>
                  <Input
                    type="number"
                    step="0.000001"
                    placeholder="28.0473"
                    value={formData.longitude}
                    onChange={(e) => handleInputChange('longitude', e.target.value)}
                    className="w-full"
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Delivery Settings Tab */}
        <TabsContent value="delivery" className="mt-6">
          <Card className="border-gray-200">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Truck className="w-5 h-5 text-blue-500" />
                Delivery Settings
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Delivery Fee (R)
                  </label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="25.00"
                    value={formData.delivery_fee}
                    onChange={(e) => handleInputChange('delivery_fee', e.target.value)}
                    className="w-full"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Standard delivery fee charged to customers
                  </p>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Free Delivery Threshold (R)
                  </label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="150.00"
                    value={formData.free_delivery_threshold}
                    onChange={(e) => handleInputChange('free_delivery_threshold', e.target.value)}
                    className="w-full"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Minimum order amount for free delivery
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Max Delivery Distance (km)
                  </label>
                  <Input
                    type="number"
                    step="0.1"
                    min="0"
                    placeholder="10.0"
                    value={formData.max_delivery_distance_km}
                    onChange={(e) => handleInputChange('max_delivery_distance_km', e.target.value)}
                    className="w-full"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Maximum distance for delivery orders
                  </p>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Estimated Prep Time (minutes)
                  </label>
                  <Input
                    type="number"
                    min="1"
                    placeholder="30"
                    value={formData.estimated_prep_time}
                    onChange={(e) => handleInputChange('estimated_prep_time', e.target.value)}
                    className="w-full"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Average time to prepare orders
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    id="accepts_delivery"
                    checked={formData.accepts_delivery}
                    onChange={(e) => handleInputChange('accepts_delivery', e.target.checked)}
                    className="w-4 h-4 text-orange-600 border-gray-300 rounded focus:ring-orange-500"
                  />
                  <label htmlFor="accepts_delivery" className="text-sm font-medium text-gray-700">
                    Accept Delivery Orders
                  </label>
                </div>
                
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    id="accepts_pickup"
                    checked={formData.accepts_pickup}
                    onChange={(e) => handleInputChange('accepts_pickup', e.target.checked)}
                    className="w-4 h-4 text-orange-600 border-gray-300 rounded focus:ring-orange-500"
                  />
                  <label htmlFor="accepts_pickup" className="text-sm font-medium text-gray-700">
                    Accept Pickup Orders
                  </label>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Location Status Tab */}
        <TabsContent value="status" className="mt-6">
          <Card className="border-gray-200">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <SettingsIcon className="w-5 h-5 text-purple-500" />
                Location Status
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                <div>
                  <h4 className="text-sm font-semibold text-gray-700">Location Status</h4>
                  <p className="text-xs text-gray-500 mt-1">
                    Control whether this location is active and accepting orders
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    id="is_active"
                    checked={formData.is_active}
                    onChange={(e) => handleInputChange('is_active', e.target.checked)}
                    className="w-4 h-4 text-orange-600 border-gray-300 rounded focus:ring-orange-500"
                  />
                  <label htmlFor="is_active" className="text-sm font-medium text-gray-700">
                    Location Active
                  </label>
                </div>
              </div>

              <div className="p-4 bg-orange-50 rounded-lg border border-orange-200">
                <div className="mb-3">
                  <p className="text-sm font-semibold text-orange-800 mb-1">
                    📍 Location Summary:
                  </p>
                  <p className="text-xs text-orange-700">
                    Status: {formData.is_active ? 'Active' : 'Inactive'} | 
                    Delivery: {formData.accepts_delivery ? 'Enabled' : 'Disabled'} | 
                    Pickup: {formData.accepts_pickup ? 'Enabled' : 'Disabled'}
                  </p>
                </div>
                <div>
                  <p className="text-sm font-semibold text-orange-800 mb-1">
                    💡 Tips:
                  </p>
                  <p className="text-xs text-orange-700">
                    • Inactive locations won't appear in customer searches<br />
                    • You can disable delivery or pickup individually<br />
                    • Set realistic prep times for better customer satisfaction
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default LocationSettings; 