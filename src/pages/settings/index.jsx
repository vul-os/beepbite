import React, { useState, useEffect, useCallback } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { 
  Building2, 
  FileText, 
  Phone, 
  MapPin, 
  Settings as SettingsIcon,
  Save,
  CheckCircle,
  Loader2,
  AlertCircle,
  Building
} from 'lucide-react';
import { useAuth } from '@/context/auth-context';
import { supabase } from '@/services/supabase-client';
import { cn } from "@/lib/utils";

const Settings = () => {
  const { activeBistro, user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [activeTab, setActiveTab] = useState('business');
  const [formData, setFormData] = useState({
    bistro_name: '',
    description: '',
    cell_number: '',
    address: '',
    company_name: '',
    company_reg_identifier: '',
    stages: {
      pending: true,
      preparing: false,
      packaging: false,
      completed: true
    }
  });

  useEffect(() => {
    if (activeBistro) {
      loadBistroData();
    }
  }, [activeBistro]);

  const loadBistroData = async () => {
    if (!activeBistro) return;
    
    setLoading(true);
    try {
      // Load bistro data from bistros table
      const { data: bistroData, error: bistroError } = await supabase
        .from('bistros')
        .select('name')
        .eq('id', activeBistro.id)
        .single();
      
      if (bistroError) {
        console.error('Error loading bistro data:', bistroError);
      }

      // Load bistro settings data
      const { data: settingsData, error: settingsError } = await supabase
        .from('bistro_settings')
        .select('*')
        .eq('bistro_id', activeBistro.id)
        .single();
      
      if (settingsError && settingsError.code !== 'PGRST116') {
        console.error('Error loading bistro settings:', settingsError);
      }
      
      // Parse stages from database
      let stages = {
        pending: true,
        preparing: false,
        packaging: false,
        completed: true
      };
      
      if (settingsData?.stages && typeof settingsData.stages === 'object') {
        stages = {
          pending: true,
          preparing: settingsData.stages.preparing || false,
          packaging: settingsData.stages.packaging || false,
          completed: true
        };
      }
      
      setFormData({
        bistro_name: bistroData?.name || '',
        description: settingsData?.description || '',
        cell_number: settingsData?.cell_number || '',
        address: settingsData?.address || '',
        company_name: settingsData?.company_name || '',
        company_reg_identifier: settingsData?.company_reg_identifier || '',
        stages: stages
      });
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
    
    // Clear save message when user starts typing
    if (saveMessage) {
      setSaveMessage('');
    }
  };

  const handleStageChange = (stage, checked) => {
    setFormData(prev => ({
      ...prev,
      stages: {
        ...prev.stages,
        [stage]: checked
      }
    }));
    
    if (saveMessage) {
      setSaveMessage('');
    }
  };

  const saveSettings = async () => {
    if (!activeBistro) return;
    
    setSaving(true);
    setSaveMessage('');
    
    try {
      // Update bistro name in bistros table if it changed
      if (formData.bistro_name && formData.bistro_name !== activeBistro.name) {
        const { error: bistroError } = await supabase
          .from('bistros')
          .update({ name: formData.bistro_name })
          .eq('id', activeBistro.id);
        
        if (bistroError) throw bistroError;
      }

      // Update bistro settings
      const { error: settingsError } = await supabase.rpc('update_bistro_details', {
        p_bistro_id: activeBistro.id,
        p_description: formData.description || null,
        p_cell_number: formData.cell_number || null,
        p_address: formData.address || null,
        p_company_name: formData.company_name || null,
        p_company_reg_identifier: formData.company_reg_identifier || null,
        p_stages: JSON.stringify(formData.stages)
      });
      
      if (settingsError) throw settingsError;
      
      setSaveMessage('Settings saved successfully!');
      
      // Clear message after 3 seconds
      setTimeout(() => {
        setSaveMessage('');
      }, 3000);
      
    } catch (error) {
      console.error('Error saving settings:', error);
      setSaveMessage('Failed to save settings. Please try again.');
      
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
              <SettingsIcon className="w-8 h-8 text-orange-500" />
              Bistro Settings
            </h1>
            <p className="text-gray-600 mt-1">
              Manage your bistro information and preferences
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

      {/* Current Bistro Info - Moved to top */}
      <Card className="border-gray-200 bg-orange-50 border-orange-200">
        <CardContent className="p-4 sm:p-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center gap-3 sm:gap-4 min-w-0 flex-1">
              <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-lg beepbite-gradient flex items-center justify-center flex-shrink-0">
                <Building className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-lg sm:text-xl font-bold text-gray-900 truncate">{activeBistro?.name || 'Unknown Bistro'}</p>
                <p className="text-xs sm:text-sm text-gray-600">You are editing settings for this bistro</p>
              </div>
            </div>
            <Badge variant="outline" className="bg-orange-100 text-orange-800 border-orange-300 self-start sm:self-center flex-shrink-0">
              <span className="sm:hidden">Active</span>
              <span className="hidden sm:inline">Active Bistro</span>
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* Save Buttons */}
      {/* Save Button - Fixed for mobile */}
      <Button
        onClick={saveSettings}
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
          onClick={saveSettings}
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
              Save Settings
            </>
          )}
        </Button>
      </div>

      {/* Settings Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-2 lg:grid-cols-4 h-auto p-1 bg-gray-100">
          <TabsTrigger 
            value="business" 
            className="flex items-center gap-2 text-xs sm:text-sm p-3"
          >
            <Building2 className="w-4 h-4" />
            <span className="hidden sm:inline">Business Info</span>
            <span className="sm:hidden">Business</span>
          </TabsTrigger>
          <TabsTrigger 
            value="contact" 
            className="flex items-center gap-2 text-xs sm:text-sm p-3"
          >
            <Phone className="w-4 h-4" />
            <span className="hidden sm:inline">Contact</span>
            <span className="sm:hidden">Contact</span>
          </TabsTrigger>
          <TabsTrigger 
            value="company" 
            className="flex items-center gap-2 text-xs sm:text-sm p-3"
          >
            <FileText className="w-4 h-4" />
            <span className="hidden sm:inline">Company</span>
            <span className="sm:hidden">Company</span>
          </TabsTrigger>
          <TabsTrigger 
            value="workflow" 
            className="flex items-center gap-2 text-xs sm:text-sm p-3"
          >
            <SettingsIcon className="w-4 h-4" />
            <span className="hidden sm:inline">Workflow</span>
            <span className="sm:hidden">Workflow</span>
          </TabsTrigger>
        </TabsList>

        {/* Business Information Tab */}
        <TabsContent value="business" className="mt-6">
          <Card className="border-gray-200">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="w-5 h-5 text-orange-500" />
                Business Information
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Bistro Name
                </label>
                <Input
                  placeholder="Your Bistro Name"
                  value={formData.bistro_name}
                  onChange={(e) => handleInputChange('bistro_name', e.target.value)}
                  className="w-full"
                />
                <p className="text-xs text-gray-500 mt-1">
                  This is how customers will see your business name
                </p>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Description
                </label>
                <Textarea
                  placeholder="Tell customers about your bistro, cuisine, and what makes you special..."
                  value={formData.description}
                  onChange={(e) => handleInputChange('description', e.target.value)}
                  rows={6}
                  className="w-full"
                />
                <p className="text-xs text-gray-500 mt-1">
                  This description will help customers understand what makes your bistro unique
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Contact Information Tab */}
        <TabsContent value="contact" className="mt-6">
          <Card className="border-gray-200">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Phone className="w-5 h-5 text-orange-500" />
                Contact Information
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Phone Number
                </label>
                <Input
                  type="tel"
                  placeholder="+27 82 123 4567"
                  value={formData.cell_number}
                  onChange={(e) => handleInputChange('cell_number', e.target.value)}
                  className="w-full"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Customers will use this number to contact you directly for orders and inquiries
                </p>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Business Address
                </label>
                <Textarea
                  placeholder="123 Main Street, City, State, ZIP Code"
                  value={formData.address}
                  onChange={(e) => handleInputChange('address', e.target.value)}
                  rows={4}
                  className="w-full"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Include your complete business address for deliveries and customer visits
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Company Details Tab */}
        <TabsContent value="company" className="mt-6">
          <Card className="border-gray-200">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-orange-500" />
                Company Details
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  PTY Company Name
                </label>
                <Input
                  placeholder="Your Company Name (PTY) LTD"
                  value={formData.company_name}
                  onChange={(e) => handleInputChange('company_name', e.target.value)}
                  className="w-full"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Your official company name as registered with CIPC (Companies and Intellectual Property Commission)
                </p>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  PTY Registration Number
                </label>
                <Input
                  placeholder="2023/123456/07"
                  value={formData.company_reg_identifier}
                  onChange={(e) => handleInputChange('company_reg_identifier', e.target.value)}
                  className="w-full"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Company registration number from CIPC for legal and tax compliance
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Order Workflow Tab */}
        <TabsContent value="workflow" className="mt-6">
          <Card className="border-gray-200">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <SettingsIcon className="w-5 h-5 text-orange-500" />
                Order Workflow
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <p className="text-sm text-gray-600">
                Configure your order stages. Customers will be notified for each stage, and you'll get detailed reporting for each stage to track your performance.
              </p>
              
              {/* Always Included */}
              <div className="bg-gray-50 rounded-lg p-6 border border-gray-200">
                <h4 className="text-sm font-semibold text-gray-700 mb-4">Always Included</h4>
                
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={true}
                      disabled={true}
                      className="w-4 h-4 text-orange-600 border-gray-300 rounded opacity-50"
                    />
                    <div>
                      <span className="text-sm font-medium text-gray-700">Pending</span>
                      <p className="text-xs text-gray-500">New orders start here - customers get order confirmation</p>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={true}
                      disabled={true}
                      className="w-4 h-4 text-orange-600 border-gray-300 rounded opacity-50"
                    />
                    <div>
                      <span className="text-sm font-medium text-gray-700">Completed</span>
                      <p className="text-xs text-gray-500">Orders end here - customers get completion notification</p>
                    </div>
                  </div>
                </div>
              </div>
              
              {/* Optional Stages */}
              <div className="bg-white rounded-lg p-6 border border-gray-200">
                <h4 className="text-sm font-semibold text-gray-700 mb-4">Optional Stages</h4>
                
                <div className="space-y-4">
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={formData.stages.preparing}
                      onChange={(e) => handleStageChange('preparing', e.target.checked)}
                      className="w-4 h-4 text-orange-600 border-gray-300 rounded focus:ring-orange-500 mt-1"
                    />
                    <div>
                      <span className="text-sm font-medium text-gray-700">Preparing</span>
                      <p className="text-xs text-gray-500 mt-1">Customers get "food is being prepared" updates + prep time tracking</p>
                    </div>
                  </div>
                  
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={formData.stages.packaging}
                      onChange={(e) => handleStageChange('packaging', e.target.checked)}
                      className="w-4 h-4 text-orange-600 border-gray-300 rounded focus:ring-orange-500 mt-1"
                    />
                    <div>
                      <span className="text-sm font-medium text-gray-700">Packaging</span>
                      <p className="text-xs text-gray-500 mt-1">Customers get "order ready for pickup/delivery" + packaging time reports</p>
                    </div>
                  </div>
                </div>
              </div>
              
              {/* Workflow Preview */}
              <div className="p-4 bg-orange-50 rounded-lg border border-orange-200">
                <div className="mb-3">
                  <p className="text-sm font-semibold text-orange-800 mb-1">
                    📱 Customer Experience:
                  </p>
                  <p className="text-xs text-orange-700">
                    Your workflow: Pending → 
                    {formData.stages.preparing && ' Preparing →'}
                    {formData.stages.packaging && ' Packaging →'}
                    {' '}Completed
                  </p>
                </div>
                <div>
                  <p className="text-sm font-semibold text-orange-800 mb-1">
                    📊 Business Benefits:
                  </p>
                  <p className="text-xs text-orange-700">
                    • Real-time customer notifications for each stage<br />
                    • Detailed time tracking and performance reports<br />
                    • Better customer satisfaction with transparency
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

export default Settings;
