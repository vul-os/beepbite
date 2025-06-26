import React, { useState, useEffect, useCallback } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import Stepper from "@/components/ui/stepper";
import { useAuth } from '@/context/auth-context';
import { supabase } from '@/services/supabase-client';
import { 
  Building2, 
  FileText, 
  CheckCircle,
  X,
  ArrowRight,
  ArrowLeft,
  Loader2,
  Settings
} from 'lucide-react';
import { cn } from "@/lib/utils";

const BistroSetupPopup = ({ isOpen, onClose }) => {
  const { activeBistro, checkBistroSetupCompleted } = useAuth();
  const [currentStep, setCurrentStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [autoSaving, setAutoSaving] = useState(false);
  const [formData, setFormData] = useState({
    bistro_name: '',
    description: '',
    cell_number: '',
    address: '',
    company_name: '',
    company_reg_identifier: '',
    stages: {
      pending: true,      // Always enabled
      preparing: false,   // Optional
      packaging: false,   // Optional
      completed: true     // Always enabled
    }
  });

  // Setup steps
  const setupSteps = [
    {
      title: "Business Information",
      description: "Tell us about your bistro",
      icon: Building2,
      fields: ['bistro_name', 'description', 'cell_number', 'address'],
      details: "Provide your basic business information including name, description, contact details, and location."
    },
    {
      title: "Business Details",
      description: "PTY company information",
      icon: FileText,
      fields: ['company_name', 'company_reg_identifier'],
      details: "Provide your official PTY company details as registered with CIPC for legal and tax compliance."
    },
    {
      title: "Order Stages",
      description: "Configure your workflow",
      icon: Settings,
      fields: [], // No required fields for this step
      details: "Choose which stages you want in your order workflow. Customers will be notified for each stage, and you'll get detailed reporting for each stage to track your performance."
    },
    {
      title: "Complete",
      description: "You're all set!",
      icon: CheckCircle,
      fields: [],
      details: "Your bistro setup is complete and ready to start taking orders."
    }
  ];

  // Load existing data when popup opens
  useEffect(() => {
    if (isOpen && activeBistro) {
      loadExistingData();
    }
  }, [isOpen, activeBistro]);

  const loadExistingData = async () => {
    if (!activeBistro) return;
    
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
      
      if (settingsError && settingsError.code !== 'PGRST116') { // PGRST116 = no rows returned
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
          pending: true, // Always true
          preparing: settingsData.stages.preparing || false,
          packaging: settingsData.stages.packaging || false,
          completed: true // Always true
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
      
      // Determine current step based on filled data
      let step = 0;
      if (bistroData?.name && settingsData?.description && settingsData?.cell_number && settingsData?.address) step = 1;
      if (settingsData?.company_name && settingsData?.company_reg_identifier) step = 2;
      if (settingsData?.stages) step = 3;
      
      setCurrentStep(step);
    } catch (error) {
      console.error('Error loading existing data:', error);
    }
  };

  // Helper function to normalize phone numbers (remove + prefix)
  const normalizePhoneNumber = (phone) => {
    if (!phone) return phone;
    const trimmed = phone.trim();
    return trimmed.startsWith('+') ? trimmed.substring(1) : trimmed;
  };

  // Auto-save function with debouncing
  const autoSave = useCallback(async (dataToSave) => {
    if (!activeBistro) return;
    
    setAutoSaving(true);
    try {
      // Update bistro name in bistros table if it changed
      if (dataToSave.bistro_name && dataToSave.bistro_name !== activeBistro.name) {
        const { error: bistroError } = await supabase
          .from('bistros')
          .update({ name: dataToSave.bistro_name })
          .eq('id', activeBistro.id);
        
        if (bistroError) throw bistroError;
      }

      // Normalize phone number before saving
      const normalizedCellNumber = dataToSave.cell_number ? normalizePhoneNumber(dataToSave.cell_number) : null;

      // Update bistro settings
      const { error: settingsError } = await supabase.rpc('update_bistro_details', {
        p_bistro_id: activeBistro.id,
        p_description: dataToSave.description || null,
        p_cell_number: normalizedCellNumber,
        p_address: dataToSave.address || null,
        p_company_name: dataToSave.company_name || null,
        p_company_reg_identifier: dataToSave.company_reg_identifier || null,
        p_stages: dataToSave.stages ? JSON.stringify(dataToSave.stages) : null
      });
      
      if (settingsError) throw settingsError;
    } catch (error) {
      console.error('Error auto-saving:', error);
    } finally {
      setAutoSaving(false);
    }
  }, [activeBistro]);

  // Debounced auto-save effect
  useEffect(() => {
    // Don't auto-save immediately after loading data
    if (!activeBistro || (!formData.bistro_name && !formData.description && !formData.cell_number && !formData.address && !formData.company_name && !formData.company_reg_identifier)) {
      return;
    }

    const timeoutId = setTimeout(() => {
      autoSave(formData);
    }, 1000); // Auto-save after 1 second of no changes

    return () => clearTimeout(timeoutId);
  }, [formData, autoSave, activeBistro]);

  const handleInputChange = (field, value) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleStageChange = (stage, checked) => {
    setFormData(prev => ({
      ...prev,
      stages: {
        ...prev.stages,
        [stage]: checked
      }
    }));
  };

  const validateCurrentStep = () => {
    const currentStepFields = setupSteps[currentStep]?.fields || [];
    return currentStepFields.every(field => formData[field]?.trim());
  };

  const handleNext = async () => {
    if (currentStep < setupSteps.length - 1) {
      setCurrentStep(prev => prev + 1);
    } else {
      await completeSetup();
    }
  };

  const handlePrevious = () => {
    if (currentStep > 0) {
      setCurrentStep(prev => prev - 1);
    }
  };

  const completeSetup = async () => {
    if (!activeBistro) return;
    
    setLoading(true);
    try {
      // Update bistro name in bistros table
      if (formData.bistro_name) {
        const { error: bistroError } = await supabase
          .from('bistros')
          .update({ name: formData.bistro_name })
          .eq('id', activeBistro.id);
        
        if (bistroError) throw bistroError;
      }

      // Normalize phone number before saving
      const normalizedCellNumber = formData.cell_number ? normalizePhoneNumber(formData.cell_number) : null;

      // Save final data and mark as completed
      const { error } = await supabase.rpc('update_bistro_details', {
        p_bistro_id: activeBistro.id,
        p_description: formData.description,
        p_cell_number: normalizedCellNumber,
        p_address: formData.address,
        p_company_name: formData.company_name,
        p_company_reg_identifier: formData.company_reg_identifier,
        p_stages: JSON.stringify(formData.stages)
      });
      
      if (error) throw error;
      
      // Mark setup as completed
      const { error: updateError } = await supabase
        .from('bistro_settings')
        .update({ completed: true })
        .eq('bistro_id', activeBistro.id);
      
      if (updateError) throw updateError;
      
      // Refresh setup status in auth context
      await checkBistroSetupCompleted(activeBistro.id);
      
      // Close popup
      onClose();
    } catch (error) {
      console.error('Error completing setup:', error);
      alert('Failed to complete setup. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const renderStepContent = () => {
    const currentStepData = setupSteps[currentStep];
    
    switch (currentStep) {
      case 0: // Business Information
        return (
          <div className="space-y-4">
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
                Bistro Description
              </label>
              <Textarea
                placeholder="Tell customers about your bistro, cuisine, and what makes you special..."
                value={formData.description}
                onChange={(e) => handleInputChange('description', e.target.value)}
                rows={4}
                className="w-full"
              />
            </div>
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
                Customers will use this number to contact you directly
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
                rows={3}
                className="w-full"
              />
              <p className="text-xs text-gray-500 mt-1">
                Include full address
              </p>
            </div>
          </div>
        );
        
      case 1: // Business Details
        return (
          <div className="space-y-4">
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
                Your official company name as registered with CIPC
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
                Company registration number from CIPC (Companies and Intellectual Property Commission)
              </p>
            </div>
          </div>
        );
        
      case 2: // Order Stages
        return (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-4">
                Order Workflow Stages
              </h3>
              <p className="text-sm text-gray-600 mb-6">
                Choose which stages you want in your order workflow. Customers will be notified for each stage, and you'll get detailed reporting for each stage to track your performance.
              </p>
              
              <div className="space-y-4">
                {/* Always Included Stages */}
                <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                  <h4 className="text-sm font-semibold text-gray-700 mb-3">Always Included</h4>
                  
                  <div className="space-y-3">
                    <div className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={true}
                        disabled={true}
                        className="w-4 h-4 text-orange-600 border-gray-300 rounded focus:ring-orange-500 opacity-50"
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
                        className="w-4 h-4 text-orange-600 border-gray-300 rounded focus:ring-orange-500 opacity-50"
                      />
                      <div>
                        <span className="text-sm font-medium text-gray-700">Completed</span>
                        <p className="text-xs text-gray-500">Orders end here - customers get completion notification</p>
                      </div>
                    </div>
                  </div>
                </div>
                
                {/* Optional Stages */}
                <div className="bg-white rounded-lg p-4 border border-gray-200">
                  <h4 className="text-sm font-semibold text-gray-700 mb-3">Optional Stages</h4>
                  
                  <div className="space-y-3">
                    <div className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={formData.stages.preparing}
                        onChange={(e) => handleStageChange('preparing', e.target.checked)}
                        className="w-4 h-4 text-orange-600 border-gray-300 rounded focus:ring-orange-500"
                      />
                      <div>
                        <span className="text-sm font-medium text-gray-700">Preparing</span>
                        <p className="text-xs text-gray-500">Customers get "food is being prepared" updates + prep time tracking</p>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={formData.stages.packaging}
                        onChange={(e) => handleStageChange('packaging', e.target.checked)}
                        className="w-4 h-4 text-orange-600 border-gray-300 rounded focus:ring-orange-500"
                      />
                      <div>
                        <span className="text-sm font-medium text-gray-700">Packaging</span>
                        <p className="text-xs text-gray-500">Customers get "order ready for pickup/delivery" + packaging time reports</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              
              <div className="mt-6 p-4 bg-orange-50 rounded-lg border border-orange-200">
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
                    • Real-time customer notifications for each stage
                    • Detailed time tracking and performance reports
                    • Better customer satisfaction with transparency
                  </p>
                </div>
              </div>
            </div>
          </div>
        );
        
      case 3: // Complete
        return (
          <div className="text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mx-auto">
              <CheckCircle className="w-8 h-8 text-gray-600" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                Setup Complete!
              </h3>
              <p className="text-gray-600">
                Your bistro is now ready to start taking orders. You can always update these details later in your settings.
              </p>
            </div>
          </div>
        );
        
      default:
        return null;
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-4xl max-h-[90vh] overflow-hidden border-gray-200 shadow-2xl">
        <CardHeader className="border-b border-gray-200 bg-white sticky top-0 z-10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg beepbite-gradient flex items-center justify-center">
                <Building2 className="w-5 h-5 text-white" />
              </div>
              <div>
                <CardTitle className="text-xl text-gray-900">
                  Complete Your Bistro Setup
                </CardTitle>
                <p className="text-sm text-gray-600 mt-1">
                  {activeBistro?.name} • Step {currentStep + 1} of {setupSteps.length}
                  {autoSaving && (
                    <span className="ml-2 text-orange-600 text-xs">
                      • Auto-saving...
                    </span>
                  )}
                </p>
              </div>
            </div>
            
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600"
            >
              <X className="w-5 h-5" />
            </Button>
          </div>
        </CardHeader>
        
        <CardContent className="overflow-y-auto max-h-[calc(90vh-8rem)]">
          <div className="space-y-8 py-6">
            {/* Stepper */}
            <Stepper
              steps={setupSteps}
              currentStep={currentStep}
              showStepNumbers={true}
            />
            
            {/* Current Step Content */}
            <div className="max-w-2xl mx-auto">
              <div className="text-center mb-8">
                <h2 className="text-2xl font-bold text-gray-900 mb-2">
                  {setupSteps[currentStep]?.title}
                </h2>
                <p className="text-gray-600">
                  {setupSteps[currentStep]?.details}
                </p>
              </div>
              
              {/* Form Content */}
              <div className="bg-gray-50 rounded-lg p-6">
                {renderStepContent()}
              </div>
            </div>
            
            {/* Action Buttons */}
            <div className="flex justify-between items-center max-w-2xl mx-auto pt-6 border-t border-gray-200">
              <Button
                variant="outline"
                onClick={handlePrevious}
                disabled={currentStep === 0}
                className="flex items-center gap-2"
              >
                <ArrowLeft className="w-4 h-4" />
                Previous
              </Button>
              
              <Button
                onClick={handleNext}
                disabled={currentStep < setupSteps.length - 1 && !validateCurrentStep()}
                className={cn(
                  "flex items-center gap-2",
                  currentStep === setupSteps.length - 1 
                    ? "beepbite-gradient text-white" 
                    : "bg-orange-500 hover:bg-orange-600 text-white"
                )}
              >
                {loading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : currentStep === setupSteps.length - 1 ? (
                  'Complete Setup'
                ) : (
                  <>
                    Next
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default BistroSetupPopup; 