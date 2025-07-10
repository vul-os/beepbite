import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { 
  Building2, 
  MapPin,
  Settings as SettingsIcon,
  Save,
  CheckCircle,
  Loader2,
  AlertCircle,
  Plus,
  Edit
} from 'lucide-react';
import { useAuth } from '@/context/auth-context';
import { supabase } from '@/services/supabase-client';
import { cn } from "@/lib/utils";

const OrganizationSettings = () => {
  const { activeOrganization, user, fetchOrganizations } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [activeTab, setActiveTab] = useState('organization');
  const [locations, setLocations] = useState([]);
  const [formData, setFormData] = useState({
    // Organization data
    name: '',
    is_active: true
  });

  useEffect(() => {
    if (activeOrganization) {
      loadOrganizationData();
    }
  }, [activeOrganization]);

  const loadOrganizationData = async () => {
    if (!activeOrganization) return;
    
    setLoading(true);
    try {
      // Load organization data
      const { data: orgData, error: orgError } = await supabase
        .from('organizations')
        .select('*')
        .eq('id', activeOrganization.id)
        .single();
      
      if (orgError) {
        console.error('Error loading organization data:', orgError);
      }

      // Load locations for this organization
      const { data: locationsData, error: locationsError } = await supabase
        .from('locations')
        .select('*')
        .eq('organization_id', activeOrganization.id)
        .order('name');
      
      if (locationsError) {
        console.error('Error loading locations:', locationsError);
      }
      
      setFormData({
        name: orgData?.name || '',
        is_active: orgData?.is_active ?? true
      });

      setLocations(locationsData || []);
    } catch (error) {
      console.error('Error loading data:', error);
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

  const saveOrganizationSettings = async () => {
    if (!activeOrganization) return;
    
    setSaving(true);
    setSaveMessage('');
    
    try {
      // Validate required fields
      if (!formData.name.trim()) {
        throw new Error('Organization name is required');
      }

      // Update organization
      const { error: orgError } = await supabase
        .from('organizations')
        .update({ 
          name: formData.name.trim(),
          is_active: formData.is_active,
          updated_at: new Date().toISOString()
        })
        .eq('id', activeOrganization.id);
      
      if (orgError) throw orgError;
      
      setSaveMessage('Organization settings saved successfully!');
      
      // Refresh organizations in auth context
      await fetchOrganizations();
      
      // Reload data to reflect changes
      loadOrganizationData();
      
      setTimeout(() => {
        setSaveMessage('');
      }, 3000);
      
    } catch (error) {
      console.error('Error saving settings:', error);
      setSaveMessage(error.message || 'Failed to save settings. Please try again.');
      
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-2">
              <Building2 className="w-8 h-8 text-blue-500" />
              Organization Settings
            </h1>
            <p className="text-gray-600 mt-1">
              Manage your organization and locations
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

      {/* Current Organization Info */}
      <Card className="border-gray-200 bg-blue-50 border-blue-200">
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-500 flex items-center justify-center">
              <Building2 className="w-5 h-5 text-white" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-lg font-bold text-gray-900 truncate">{activeOrganization?.name || 'Unknown Organization'}</p>
              <p className="text-xs text-gray-600">Managing organization settings</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Save Buttons */}
      <Button
        onClick={saveOrganizationSettings}
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
          onClick={saveOrganizationSettings}
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
              Save Organization Settings
            </>
          )}
        </Button>
      </div>

      {/* Settings Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-2 h-auto p-1 bg-gray-100">
          <TabsTrigger 
            value="organization" 
            className="flex items-center gap-2 text-xs sm:text-sm p-3"
          >
            <Building2 className="w-4 h-4" />
            <span>Organization</span>
          </TabsTrigger>
          <TabsTrigger 
            value="locations" 
            className="flex items-center gap-2 text-xs sm:text-sm p-3"
          >
            <MapPin className="w-4 h-4" />
            <span>Locations</span>
          </TabsTrigger>
        </TabsList>

        {/* Organization Tab */}
        <TabsContent value="organization" className="mt-6">
          <Card className="border-gray-200">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="w-5 h-5 text-blue-500" />
                Organization Information
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Organization Name <span className="text-red-500">*</span>
                </label>
                <Input
                  placeholder="Your Organization Name"
                  value={formData.name}
                  onChange={(e) => handleInputChange('name', e.target.value)}
                  className="w-full"
                  required
                />
                <p className="text-xs text-gray-500 mt-1">
                  The name of your organization that contains all your locations
                </p>
              </div>

              <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                <div>
                  <h4 className="text-sm font-semibold text-gray-700">Organization Status</h4>
                  <p className="text-xs text-gray-500 mt-1">
                    Control whether this organization is active
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    id="is_active"
                    checked={formData.is_active}
                    onChange={(e) => handleInputChange('is_active', e.target.checked)}
                    className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                  />
                  <label htmlFor="is_active" className="text-sm font-medium text-gray-700">
                    Organization Active
                  </label>
                </div>
              </div>

              <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
                <div className="mb-3">
                  <p className="text-sm font-semibold text-blue-800 mb-1">
                    🏢 Organization Summary:
                  </p>
                  <p className="text-xs text-blue-700">
                    Status: {formData.is_active ? 'Active' : 'Inactive'} | 
                    Locations: {locations.length} | 
                    Active Locations: {locations.filter(l => l.is_active).length}
                  </p>
                </div>
                <div>
                  <p className="text-sm font-semibold text-blue-800 mb-1">
                    💡 Tips:
                  </p>
                  <p className="text-xs text-blue-700">
                    • Inactive organizations won't be accessible by users<br />
                    • Organization name is visible to all members<br />
                    • You can manage individual locations in the Locations tab
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Locations Management Tab */}
        <TabsContent value="locations" className="mt-6">
          <div className="space-y-6">
            <Card className="border-gray-200">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MapPin className="w-5 h-5 text-orange-500" />
                  Location Management
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-gray-600">
                  Manage all locations in your organization. Each location can have its own settings for delivery, pickup, and other preferences.
                </p>
                
                {locations.length === 0 ? (
                  <div className="text-center py-8">
                    <MapPin className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                    <p className="text-gray-500">No locations found</p>
                    <p className="text-sm text-gray-400 mt-1">
                      Create locations to manage your business branches
                    </p>
                  </div>
                ) : (
                  <div className="grid gap-4">
                    {locations.map((location) => (
                      <div
                        key={location.id}
                        className="flex items-center justify-between p-4 border border-gray-200 rounded-lg hover:bg-gray-50"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-lg bg-orange-100 flex items-center justify-center">
                            <MapPin className="w-5 h-5 text-orange-600" />
                          </div>
                          <div>
                            <h3 className="font-medium text-gray-900">{location.name}</h3>
                            <p className="text-sm text-gray-500">{location.address || 'No address set'}</p>
                            <div className="flex items-center gap-2 mt-1">
                              <Badge variant={location.is_active ? "success" : "secondary"}>
                                {location.is_active ? "Active" : "Inactive"}
                              </Badge>
                              {location.accepts_delivery && (
                                <Badge variant="outline">Delivery</Badge>
                              )}
                              {location.accepts_pickup && (
                                <Badge variant="outline">Pickup</Badge>
                              )}
                              {location.whatsapp_number && (
                                <Badge variant="outline">WhatsApp</Badge>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button 
                            size="sm" 
                            variant="outline"
                            onClick={() => navigate(`/settings/location/${location.id}`)}
                          >
                            <Edit className="w-4 h-4 mr-1" />
                            Edit
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Location Stats */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-4 border-t border-gray-200">
                  <div className="text-center">
                    <p className="text-2xl font-bold text-gray-900">{locations.length}</p>
                    <p className="text-sm text-gray-500">Total Locations</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-green-600">{locations.filter(l => l.is_active).length}</p>
                    <p className="text-sm text-gray-500">Active</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-blue-600">{locations.filter(l => l.accepts_delivery).length}</p>
                    <p className="text-sm text-gray-500">With Delivery</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-orange-600">{locations.filter(l => l.accepts_pickup).length}</p>
                    <p className="text-sm text-gray-500">With Pickup</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default OrganizationSettings; 