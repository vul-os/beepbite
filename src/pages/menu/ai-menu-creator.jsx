import React, { useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/services/supabase-client';
import { useAuth } from '@/context/auth-context';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Textarea } from '../../components/ui/textarea';
import { Badge } from '../../components/ui/badge';
import { Progress } from '../../components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Checkbox } from '../../components/ui/checkbox';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { 
  Upload, 
  Camera, 
  FileText, 
  File, 
  Loader2, 
  CheckCircle, 
  AlertCircle,
  Edit,
  Trash2,
  Plus,
  ArrowLeft,
  RefreshCw,
  Sparkles,
  Zap,
  Target,
  Clock,
  Tag,
  XCircle
} from 'lucide-react';

const AIMenuCreator = () => {
  const { user, activeLocation } = useAuth();
  const navigate = useNavigate();
  const fileInputRef = useRef(null);
  
  // State management
  const [currentStep, setCurrentStep] = useState(1); // 1: Input, 2: Review & Confirm, 3: Results
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  
  // Input data
  const [attachedFiles, setAttachedFiles] = useState([]);
  const [textContent, setTextContent] = useState('');
  
  // Generated data
  const [suggestions, setSuggestions] = useState([]);
  const [stats, setStats] = useState({});
  const [decisions, setDecisions] = useState({});
  
  // Results data (Step 3)
  const [successfulItems, setSuccessfulItems] = useState([]);
  const [failedItems, setFailedItems] = useState([]);
  const [resultsStats, setResultsStats] = useState({});
  
  // UI state
  const [editingItems, setEditingItems] = useState({});
  const [filterRecommendation, setFilterRecommendation] = useState('all');
  const [processingStep, setProcessingStep] = useState('');

  // File upload handler
  const handleFileUpload = (files) => {
    const fileArray = Array.from(files);
    
    fileArray.forEach(file => {
      if (file.type.startsWith('image/')) {
        // Handle image files
        const reader = new FileReader();
        reader.onload = (e) => {
          setAttachedFiles(prev => [...prev, {
            file,
            preview: e.target.result,
            name: file.name,
            type: file.type
          }]);
        };
        reader.readAsDataURL(file);
      } else if (
        file.type === 'application/pdf' ||
        file.type === 'text/plain'
      ) {
        // Handle PDF and text files
        const reader = new FileReader();
        reader.onload = (e) => {
          setAttachedFiles(prev => [...prev, {
            file,
            preview: e.target.result,
            name: file.name,
            type: file.type
          }]);
        };
        
        if (file.type === 'text/plain') {
          reader.readAsText(file);
        } else {
          reader.readAsDataURL(file);
        }
      } else {
        alert(`File type "${file.type}" is not supported. Please upload images (JPG, PNG), PDFs, or text files only.`);
      }
    });
  };

  // Drag and drop handlers
  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDragEnter = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    const files = e.dataTransfer.files;
    handleFileUpload(files);
  };

  // Enhanced error handling utilities
  const getErrorMessage = (error) => {
    if (!error) return 'An unknown error occurred';
    
    // Handle structured error responses from backend
    if (error.error_code) {
      switch (error.error_code) {
        case 'INVALID_JSON':
          return 'Request format error. Please refresh the page and try again.';
        case 'MISSING_LOCATION_ID':
        case 'LOCATION_NOT_FOUND':
          return 'Please select a valid location from the header and try again.';
        case 'INVALID_ACTION':
          return 'Invalid request. Please refresh the page and try again.';
        case 'DATABASE_ERROR':
        case 'DATABASE_CONNECTION_ERROR':
          return 'Database connection failed. Please check your internet connection and try again.';
        case 'MISSING_INPUT':
        case 'MISSING_CONTENT':
          return 'Please provide menu content (text or files) before continuing.';
        case 'INVALID_IMAGES':
          return 'Invalid file format. Please upload valid menu files (images, PDFs, or text files) and try again.';
        case 'INVALID_TEXT':
          return 'Please provide valid menu text content.';
        case 'MISSING_API_KEY':
          return 'AI service configuration error. Please contact support.';
        case 'AI_SERVICE_ERROR':
          return 'AI service is temporarily unavailable. Please try again in a few moments.';
        case 'PROCESSING_ERROR':
          return 'Unable to process the menu content. Please try with clearer files or better formatted text.';
        case 'GENERATION_ERROR':
          return 'Failed to generate menu items. Please try again with different content.';
        case 'MISSING_DECISIONS':
        case 'EMPTY_DECISIONS':
          return 'Please make at least one selection before confirming.';
        case 'INVALID_DECISIONS_FORMAT':
          return 'Invalid request format. Please refresh the page and try again.';
        case 'PERMISSION_DENIED':
          return 'Permission denied. Please check your access rights or contact your administrator.';
        case 'DUPLICATE_ITEMS':
          return 'Some items already exist. Please refresh the page and try again.';
        case 'UPDATE_ERROR':
          return 'Failed to update menu items. Please try again.';
        case 'VALIDATION_ERROR':
          return 'Some items have invalid data. Please check that all items have valid names, prices, and categories.';
        case 'INTERNAL_ERROR':
          return 'An unexpected error occurred. Please try again or contact support.';
        default:
          return error.error || 'An unexpected error occurred.';
      }
    }
    
    // Legacy error message handling
    if (error.message?.includes('fetch')) {
      return 'Network connection failed. Please check your internet connection and try again.';
    }
    
    if (error.message?.includes('timeout')) {
      return 'Request timed out. This usually happens with large files or slow connections. Please try again.';
    }
    
    // API specific errors
    if (error.message?.includes('Gemini API error')) {
      return 'AI service is temporarily unavailable. Please try again in a few moments.';
    }
    
    if (error.message?.includes('GEMINI_API_KEY')) {
      return 'AI service configuration error. Please contact support.';
    }
    
    if (error.message?.includes('location_id')) {
      return 'Please select a valid location and try again.';
    }
    
    // File related errors
    if (error.message?.includes('No valid input')) {
      return 'Please provide menu text or upload at least one image.';
    }
    
    // Default to the original error message if it's user-friendly
    if (error.message && error.message.length < 100 && !error.message.includes('stack')) {
      return error.message;
    }
    
    return 'Something went wrong. Please try again or contact support if the problem persists.';
  };

  // Generate menu suggestions (Step 1) - Simplified
  const generateMenu = async () => {
    if (!activeLocation?.id) {
      setError('Please select a location from the header to continue');
      return;
    }

    if (attachedFiles.length === 0 && !textContent.trim()) {
      setError('Please enter menu text or upload at least one file');
      return;
    }

    setLoading(true);
    setError('');
    setProcessingStep('Analyzing menu content...');

    try {
      // Prepare input data
      let input;
      if (attachedFiles.length > 0) {
        // Separate files by type
        const imageFiles = attachedFiles.filter(file => file.type.startsWith('image/'));
        const documentFiles = attachedFiles.filter(file => !file.type.startsWith('image/'));
        
        if (imageFiles.length > 0) {
          // If we have images, use the images input type (prioritize images)
          input = {
            type: 'images',
            content: imageFiles.map(file => file.preview)
          };
        } else if (documentFiles.length > 0) {
          // For other file types, determine the appropriate input type
          const firstFile = documentFiles[0];
          if (firstFile.type === 'application/pdf') {
            input = {
              type: 'pdf',
              content: firstFile.preview,
              filename: firstFile.name
            };
          } else if (firstFile.type === 'text/plain') {
            input = {
              type: 'text',
              content: firstFile.preview
            };
          }
        }
        
        // If text is also provided, add it as additional context
        if (textContent.trim()) {
          input.additional_text = textContent.trim();
        }
      } else if (textContent.trim()) {
        input = {
          type: 'text',
          content: textContent
        };
      }

      setProcessingStep('Generating menu items...');

      // Call the AI menu creator API
      const { data, error } = await supabase.functions.invoke('ai-menu-creator', {
        body: {
          action: 'generate',
          location_id: activeLocation.id,
          input: input
        }
      });

      if (error) {
        throw error;
      }
      
      if (!data?.success) {
        // Handle structured error responses
        const errorData = data || {};
        const structuredError = {
          message: errorData.error || 'Failed to generate menu. Please try again.',
          error_code: errorData.error_code
        };
        throw structuredError;
      }

      // Process the response
      setSuggestions(data.suggestions || []);
      setStats(data.stats || {});
      
      // Initialize decisions with all recommendations (no filtering)
      const initialDecisions = {};
      data.suggestions?.forEach((suggestion, index) => {
        initialDecisions[index] = {
          generated_item: suggestion.generated_item,
          action: suggestion.recommendation,
          existing_item_id: suggestion.similar_items?.[0]?.existing_item?.id || null,
          modifications: {}
        };
      });
      setDecisions(initialDecisions);

      setProcessingStep('Complete!');
      const validItemsCount = data.stats?.generated_items || 0;
      setSuccess(
        `Generated ${validItemsCount} menu items with ${data.stats?.suggestions || 0} suggestions` +
        (suggestions.reduce((count, s) => count + (s.generated_item.variations?.length || 0), 0) > 0 
          ? ` and ${suggestions.reduce((count, s) => count + (s.generated_item.variations?.length || 0), 0)} variations`
          : '')
      );
      setCurrentStep(2);
      setError(''); // Clear any previous errors
      
    } catch (err) {
      console.error('Generate menu error:', err);
      const errorMessage = getErrorMessage(err);
      setError(errorMessage);
      setProcessingStep('');
    } finally {
      setLoading(false);
    }
  };

  // Confirm and write to database (Step 2) - Simplified without timeout/retry
  const confirmMenu = async () => {
    setLoading(true);
    setError('');
    setProcessingStep('Creating menu items...');

    try {
      // Debug: Log the current decisions
      console.log('Current decisions object:', decisions);
      console.log('All decision values:', Object.values(decisions));
      
      // Convert decisions to API format (send all items, let backend validate)
      const apiDecisions = Object.values(decisions).filter(decision => decision.action !== 'skip');
      
      console.log('Filtered API decisions:', apiDecisions);
      console.log('API decisions length:', apiDecisions.length);

      if (apiDecisions.length === 0) {
        // Check if we have any decisions at all
        const allDecisions = Object.values(decisions);
        if (allDecisions.length === 0) {
          throw new Error('No menu items found. Please go back and generate menu items first.');
        } else {
          throw new Error(`All ${allDecisions.length} items are marked as "skip". Please select at least one item to create or update.`);
        }
      }

      // Call the API
      const { data, error } = await supabase.functions.invoke('ai-menu-creator', {
        body: {
          action: 'confirm',
          location_id: activeLocation.id,
          decisions: apiDecisions
        }
      });

      if (error) {
        throw error;
      }
      
      if (!data?.success) {
        // Handle structured error responses
        const errorData = data || {};
        const structuredError = {
          message: errorData.error || 'Failed to update menu. Please try again.',
          error_code: errorData.error_code
        };
        throw structuredError;
      }

      setProcessingStep('Complete!');
      setSuccessfulItems(data.successful_items || []);
      setFailedItems(data.failed_items || []);
      setResultsStats(data.stats || {});
      
      if (data.has_failures) {
        setSuccess(
          `Menu partially updated! ` +
          `Created: ${data.stats?.items_created || 0}, ` +
          `Updated: ${data.stats?.items_updated || 0}, ` +
          `Failed: ${data.stats?.items_failed || 0}`
        );
      } else {
        setSuccess(
          `Menu updated successfully! ` +
          `Created: ${data.stats?.items_created || 0}, ` +
          `Updated: ${data.stats?.items_updated || 0}, ` +
          `Skipped: ${data.stats?.items_skipped || 0}`
        );
      }
      
      setError(''); // Clear any previous errors
      
      // Navigate to results step
      setCurrentStep(3);

    } catch (err) {
      console.error('Confirm menu error:', err);
      const errorMessage = getErrorMessage(err);
      setError(errorMessage);
      setProcessingStep('');
    } finally {
      setLoading(false);
    }
  };

  // Update decision for a suggestion
  const updateDecision = (index, updates) => {
    setDecisions(prev => ({
      ...prev,
      [index]: {
        ...prev[index],
        ...updates
      }
    }));
  };

  // Filter suggestions based on recommendation (no validation filtering)
  const filteredSuggestions = suggestions.filter(suggestion => {
    // Filter by recommendation only
    if (filterRecommendation === 'all') return true;
    return suggestion.recommendation === filterRecommendation;
  });

  // Group suggestions by category hierarchy (no validation filtering)
  const groupSuggestionsByCategory = (suggestions) => {
    const grouped = {};
    
    suggestions.forEach((suggestion, index) => {
      const categoryPath = suggestion.generated_item?.category_path || ['Uncategorized'];
      const mainCategory = categoryPath[0];
      const subCategory = categoryPath[1] || null;
      
      if (!grouped[mainCategory]) {
        grouped[mainCategory] = {
          mainCategory,
          subcategories: {},
          items: []
        };
      }
      
      if (subCategory) {
        if (!grouped[mainCategory].subcategories[subCategory]) {
          grouped[mainCategory].subcategories[subCategory] = [];
        }
        grouped[mainCategory].subcategories[subCategory].push({ ...suggestion, originalIndex: index });
      } else {
        grouped[mainCategory].items.push({ ...suggestion, originalIndex: index });
      }
    });
    
    return grouped;
  };

  const groupedSuggestions = groupSuggestionsByCategory(filteredSuggestions);

  // Get recommendation color
  const getRecommendationColor = (recommendation) => {
    switch (recommendation) {
      case 'update': return 'bg-orange-100 text-orange-800 border-orange-200';
      case 'create_new': return 'bg-green-100 text-green-800 border-green-200';
      case 'skip': return 'bg-gray-100 text-gray-800 border-gray-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  // Get similarity badge color
  const getSimilarityColor = (score) => {
    if (score >= 0.9) return 'bg-red-100 text-red-800';
    if (score >= 0.75) return 'bg-orange-100 text-orange-800';
    if (score >= 0.6) return 'bg-yellow-100 text-yellow-800';
    return 'bg-gray-100 text-gray-800';
  };

  // Helper function to safely format prices
  const formatPrice = (price) => {
    if (price === null || price === undefined || isNaN(price)) {
      return '0.00';
    }
    return `${parseFloat(price).toFixed(2)}`;
  };

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-4 mb-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate('/menu')}
              className="text-orange-600 hover:text-orange-700 hover:bg-orange-50"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Menu
            </Button>
          </div>
          
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-orange-500 text-white rounded-lg">
              <Sparkles className="h-6 w-6" />
            </div>
            <h1 className="text-3xl font-bold text-gray-900">AI Menu Creator</h1>
          </div>
          
          <p className="text-gray-600 text-lg">
            Upload menu files or paste text to automatically create your digital menu
          </p>
          
          {/* Progress indicator */}
          <div className="mt-6 flex items-center gap-4">
            <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-sm font-medium ${
              currentStep === 1 ? 'bg-orange-500 text-white' : currentStep > 1 ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-500'
            }`}>
              <span className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center text-xs">
                {currentStep > 1 ? '✓' : '1'}
              </span>
              Generate Menu
            </div>
            <div className="h-px bg-gray-300 w-8"></div>
            <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-sm font-medium ${
              currentStep === 2 ? 'bg-orange-500 text-white' : currentStep > 2 ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-500'
            }`}>
              <span className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center text-xs">
                {currentStep > 2 ? '✓' : '2'}
              </span>
              Review & Confirm
            </div>
            <div className="h-px bg-gray-300 w-8"></div>
            <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-sm font-medium ${
              currentStep === 3 ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-500'
            }`}>
              <span className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center text-xs">3</span>
              Results
            </div>
          </div>
        </div>

        {/* Error/Success Messages */}
        {error && (
          <Alert className="mb-6 border-red-200 bg-red-50">
            <AlertCircle className="h-4 w-4 text-red-600" />
            <div className="flex-1">
              <AlertDescription className="text-red-800 mb-3">
                <div className="font-medium mb-1">Something went wrong</div>
                {error}
              </AlertDescription>
              
              {/* Simple Try Again Button */}
              <div className="flex items-center gap-3 mt-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (currentStep === 1) {
                      generateMenu();
                    } else if (currentStep === 2) {
                      confirmMenu();
                    }
                  }}
                  disabled={loading}
                  className="border-red-200 text-red-700 hover:bg-red-50"
                >
                  <RefreshCw className="h-3 w-3 mr-2" />
                  Try Again
                </Button>
                
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setError('')}
                  className="text-red-600 hover:bg-red-50 h-8"
                >
                  <XCircle className="h-3 w-3 mr-1" />
                  Dismiss
                </Button>
              </div>
              
              {/* Helpful tips based on error type */}
              {(() => {
                // Use the stored error object for more accurate tips
                const errorObj = (typeof error === 'string' ? { message: error } : error);
                
                if (errorObj.message?.includes('network')) {
                  return (
                    <div className="mt-3 p-3 bg-red-25 rounded-md border border-red-100">
                      <p className="text-xs text-red-700">
                        💡 <strong>Tips:</strong> Check your internet connection, try a different network, or contact your IT administrator if you're on a corporate network.
                      </p>
                    </div>
                  );
                }
                
                if (errorObj.message?.includes('timeout')) {
                  return (
                    <div className="mt-3 p-3 bg-red-25 rounded-md border border-red-100">
                      <p className="text-xs text-red-700">
                        💡 <strong>Tips:</strong> Try uploading fewer or smaller files, or ensure you have a stable internet connection.
                      </p>
                    </div>
                  );
                }
                
                if (errorObj.message?.includes('AI service')) {
                  return (
                    <div className="mt-3 p-3 bg-red-25 rounded-md border border-red-100">
                      <p className="text-xs text-red-700">
                        💡 <strong>Tips:</strong> This is usually temporary. Please wait a few moments and try again.
                      </p>
                    </div>
                  );
                }
                
                return null;
              })()}
            </div>
          </Alert>
        )}
        
        {success && (
          <Alert className="mb-6 border-green-200 bg-green-50">
            <CheckCircle className="h-4 w-4 text-green-600" />
            <AlertDescription className="text-green-800">{success}</AlertDescription>
          </Alert>
        )}

        {/* Processing indicator */}
        {loading && (
          <Card className="mb-6 border-orange-200">
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <Loader2 className="h-5 w-5 animate-spin text-orange-500" />
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <p className="font-medium text-gray-900">{processingStep}</p>
                  </div>
                  <Progress value={33} className="mt-2" />
                  
                  {/* Additional context during processing */}
                  <div className="mt-2 text-xs text-gray-500">
                    {processingStep.includes('Analyzing') && (
                      <p>🔍 Our AI is reading your menu content...</p>
                    )}
                    {processingStep.includes('Generating') && (
                      <p>✨ Creating menu items and finding similar existing items...</p>
                    )}
                    {processingStep.includes('Creating') && (
                      <p>💾 Updating your menu database...</p>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 1: Input */}
        {currentStep === 1 && (
          <Card className="border-orange-200 shadow-lg">
            <CardHeader className="bg-gradient-to-r from-orange-500 to-amber-500 text-white">
              <CardTitle className="flex items-center gap-2">
                <Zap className="h-5 w-5" />
                Step 1: Input Your Menu
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6 space-y-6">
              {/* Location Selection */}
              <div>
                <Label className="text-sm font-medium text-gray-700 mb-2 block">
                  Current Location:
                </Label>
                <Badge className="bg-orange-100 text-orange-800 border-orange-200 text-sm font-medium">
                  {activeLocation?.name || 'No location selected'}
                </Badge>
                {!activeLocation && (
                  <p className="text-sm text-red-600 mt-2">Please select a location from the header to continue</p>
                )}
              </div>

              {/* Menu Input Interface */}
              <div className="space-y-4">
                <Label className="text-sm font-medium text-gray-700 block">
                  Menu Content
                </Label>
                
                {/* Main Input Area */}
                <div 
                  className="border-2 border-dashed border-orange-200 rounded-lg bg-white hover:border-orange-300 transition-colors"
                  onDragOver={handleDragOver}
                  onDragEnter={handleDragEnter}
                  onDrop={handleDrop}
                >
                  {/* Text Input */}
                  <Textarea
                    value={textContent}
                    onChange={(e) => setTextContent(e.target.value)}
                    placeholder="Paste your menu text here or attach menu files below...&#10;&#10;Example:&#10;APPETIZERS&#10;Caesar Salad - R12.99&#10;Fresh romaine lettuce, parmesan cheese, croutons&#10;&#10;Buffalo Wings - R14.99&#10;Spicy wings with blue cheese dip"
                    className="min-h-[200px] border-0 border-b border-gray-200 focus:border-orange-400 resize-none rounded-b-none bg-transparent"
                  />
                  
                  {/* Attachment Bar */}
                  <div className="p-4 bg-gray-50 rounded-b-lg border-t border-gray-100">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => fileInputRef.current?.click()}
                          className="border-orange-200 text-orange-600 hover:bg-orange-50 h-8"
                        >
                          <Upload className="h-4 w-4 mr-2" />
                          Images & PDFs
                        </Button>
               
                        <input
                          type="file"
                          ref={fileInputRef}
                          onChange={(e) => handleFileUpload(e.target.files)}
                          accept="image/*,application/pdf,text/plain"
                          multiple
                          className="hidden"
                        />
                      </div>
                      
                      <div className="text-xs text-gray-500">
                        {textContent.length > 0 && `${textContent.length} characters`}
                        {attachedFiles.length > 0 && textContent.length > 0 && ' • '}
                        {attachedFiles.length > 0 && `${attachedFiles.length} file${attachedFiles.length > 1 ? 's' : ''} attached`}
                      </div>
                    </div>
                    
                    {/* Helper Text */}
                    <p className="text-xs text-gray-500 mt-2">
                      💡 You can paste menu text, upload images/PDFs, or combine both for best results
                    </p>
                  </div>
                </div>
                
                {/* Attachments Display */}
                {attachedFiles.length > 0 && (
                  <div className="space-y-3">
                    <Label className="text-sm font-medium text-gray-700">
                      Attached Files ({attachedFiles.length})
                    </Label>
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                      {attachedFiles.map((file, index) => (
                        <div key={index} className="relative group">
                          <div className="relative rounded-lg overflow-hidden border border-gray-200 bg-white shadow-sm">
                            {file.type.startsWith('image/') ? (
                              <img
                                src={file.preview}
                                alt={`File ${index + 1}`}
                                className="w-full h-24 object-cover"
                              />
                            ) : (
                              <div className="w-full h-24 flex flex-col items-center justify-center bg-gray-50 text-gray-500">
                                {file.type === 'application/pdf' && <FileText className="h-8 w-8 mb-1 text-red-500" />}
                                {file.type === 'text/plain' && <FileText className="h-8 w-8 mb-1 text-gray-500" />}
                                {!['application/pdf', 'text/plain'].includes(file.type) && 
                                  <File className="h-8 w-8 mb-1" />}
                                <p className="text-xs text-center px-1">{file.name.split('.').pop()?.toUpperCase()}</p>
                              </div>
                            )}
                            <button
                              onClick={() => setAttachedFiles(prev => prev.filter((_, i) => i !== index))}
                              className="absolute top-1 right-1 bg-red-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity shadow-sm"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                            
                            {/* File info overlay */}
                            <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white p-1">
                              <p className="text-xs truncate">{file.name}</p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Generate Button */}
              <Button
                onClick={generateMenu}
                disabled={loading || !activeLocation?.id || (attachedFiles.length === 0 && !textContent.trim())}
                className="w-full bg-orange-500 hover:bg-orange-600 text-white font-medium py-3 text-lg"
              >
                {loading ? (
                  <>
                    <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                    Generating Menu...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-5 w-5 mr-2" />
                    Generate Menu
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Step 2: Review & Confirm */}
        {currentStep === 2 && (
          <div className="space-y-6">
            {/* Stats Summary */}
            <Card className="border-orange-200 bg-gradient-to-r from-orange-50 to-amber-50">
              <CardContent className="p-6">
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                  <div className="text-center">
                    <div className="text-2xl font-bold text-orange-600">{stats.generated_items || 0}</div>
                    <div className="text-sm text-gray-600">Items Generated</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-green-600">{stats.existing_items || 0}</div>
                    <div className="text-sm text-gray-600">Existing Items</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-blue-600">{suggestions.filter(s => s.recommendation === 'update').length}</div>
                    <div className="text-sm text-gray-600">Updates</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-purple-600">{suggestions.filter(s => s.recommendation === 'create_new').length}</div>
                    <div className="text-sm text-gray-600">New Items</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-indigo-600">
                      {suggestions.reduce((count, s) => count + (s.generated_item.variations?.length || 0), 0)}
                    </div>
                    <div className="text-sm text-gray-600">Variations</div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Filters */}
            <Card className="border-orange-200">
              <CardContent className="p-4">
                <div className="flex items-center gap-4">
                  <Label className="text-sm font-medium text-gray-700">Filter by:</Label>
                  <Select value={filterRecommendation} onValueChange={setFilterRecommendation}>
                    <SelectTrigger className="w-48 border-orange-200">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Suggestions</SelectItem>
                      <SelectItem value="update">Updates Only</SelectItem>
                      <SelectItem value="create_new">New Items Only</SelectItem>
                      <SelectItem value="skip">Skipped Items</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>

            {/* Suggestions List */}
            <div className="space-y-6">
              {Object.entries(groupedSuggestions).map(([mainCategory, categoryData]) => (
                <div key={mainCategory} className="space-y-4">
                  {/* Main Category Header */}
                  <div className="border-b border-orange-200 pb-2">
                    <h3 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                      <div className="w-1 h-6 bg-orange-500 rounded-full"></div>
                      {mainCategory}
                    </h3>
                  </div>
                  
                  {/* Subcategories */}
                  {categoryData.subcategories && Object.entries(categoryData.subcategories).length > 0 && (
                    <div className="space-y-4">
                      {Object.entries(categoryData.subcategories).map(([subCategory, subCategoryItems]) => (
                        <div key={subCategory} className="ml-4">
                          <h4 className="font-semibold text-lg text-gray-800 mb-3 flex items-center gap-2">
                            <div className="w-0.5 h-4 bg-orange-300 rounded-full"></div>
                            {subCategory}
                          </h4>
                          <div className="space-y-3 ml-4">
                            {subCategoryItems.map((suggestion, index) => (
                              <Card key={suggestion.originalIndex} className="border-orange-200 shadow-sm">
                                <CardContent className="p-6">
                                  <div className="flex items-start gap-4">
                                    {/* Item Info */}
                                    <div className="flex-1">
                                      <div className="flex items-center gap-3 mb-2">
                                        <h3 className="font-semibold text-lg text-gray-900">
                                          {suggestion.generated_item.name}
                                        </h3>
                                        <Badge className={`${getRecommendationColor(suggestion.recommendation)} text-xs`}>
                                          {suggestion.recommendation.replace('_', ' ')}
                                        </Badge>
                                      </div>
                                      
                                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                                        <div className="flex items-center gap-2 text-sm text-gray-600">
                                          <span className="font-medium text-orange-600">R</span>
                                          {suggestion.generated_item.price?.toFixed(2) || '0.00'}
                                        </div>
                                        <div className="flex items-center gap-2 text-sm text-gray-600">
                                          <Clock className="h-4 w-4" />
                                          {suggestion.generated_item.preparation_time || 15} min
                                        </div>
                                        <div className="flex items-center gap-2 text-sm text-gray-600">
                                          <Tag className="h-4 w-4" />
                                          {suggestion.generated_item.category_path?.join(' > ') || 'Uncategorized'}
                                        </div>
                                      </div>

                                      {suggestion.generated_item.description && (
                                        <p className="text-sm text-gray-600 mb-4">
                                          {suggestion.generated_item.description}
                                        </p>
                                      )}

                                      {/* Variations Display */}
                                      {suggestion.generated_item.variations && suggestion.generated_item.variations.length > 0 && (
                                        <div className="mb-4 p-3 bg-blue-50 rounded-lg border border-blue-200">
                                          <h5 className="font-medium text-sm text-blue-800 mb-2 flex items-center gap-2">
                                            <span className="w-1.5 h-1.5 bg-blue-500 rounded-full"></span>
                                            Variations ({suggestion.generated_item.variations.length})
                                          </h5>
                                          <div className="space-y-2">
                                            {suggestion.generated_item.variations.map((variation, varIndex) => (
                                              <div key={varIndex} className="text-sm">
                                                <div className="flex items-center gap-2 mb-1">
                                                  <span className="font-medium text-gray-700">{variation.name}</span>
                                                  <Badge className={`text-xs ${
                                                    variation.is_required 
                                                      ? 'bg-red-100 text-red-700 border-red-200' 
                                                      : 'bg-gray-100 text-gray-700 border-gray-200'
                                                  }`}>
                                                    {variation.is_required ? 'Required' : 'Optional'}
                                                  </Badge>
                                                </div>
                                                <div className="ml-2 space-y-1">
                                                  {variation.options.map((option, optIndex) => (
                                                    <div key={optIndex} className="flex items-center justify-between text-xs text-gray-600">
                                                      <span className="flex items-center gap-1">
                                                        {option.is_default && <span className="w-1 h-1 bg-green-500 rounded-full"></span>}
                                                        {option.name}
                                                        {option.is_default && <span className="text-green-600 font-medium">(default)</span>}
                                                      </span>
                                                      <span className="font-medium">
                                                        {option.price_modifier === 0 ? 'R0.00' : 
                                                         option.price_modifier > 0 ? `+R${option.price_modifier.toFixed(2)}` : 
                                                         `R${option.price_modifier.toFixed(2)}`}
                                                      </span>
                                                    </div>
                                                  ))}
                                                </div>
                                              </div>
                                            ))}
                                          </div>
                                        </div>
                                      )}

                                      <p className="text-sm text-orange-600 font-medium">
                                        {suggestion.recommendation_reason}
                                      </p>

                                      {/* Similar Items */}
                                      {suggestion.similar_items?.length > 0 && (
                                        <div className="mt-4 p-3 bg-gray-50 rounded-lg">
                                          <h4 className="font-medium text-sm text-gray-700 mb-2">Similar Existing Items:</h4>
                                          <div className="space-y-2">
                                            {suggestion.similar_items.slice(0, 2).map((match, matchIndex) => (
                                              <div key={matchIndex} className="flex items-center justify-between text-sm">
                                                <span className="text-gray-600">
                                                  {match.existing_item.name} - R{formatPrice(match.existing_item.price)}
                                                </span>
                                                <Badge className={`${getSimilarityColor(match.similarity_score)} text-xs`}>
                                                  {Math.round(match.similarity_score * 100)}% match
                                                </Badge>
                                              </div>
                                            ))}
                                          </div>
                                        </div>
                                      )}
                                    </div>

                                    {/* Actions */}
                                    <div className="flex flex-col gap-2">
                                      {suggestion.similar_items && suggestion.similar_items.length > 0 ? (
                                        <Select
                                          value={decisions[suggestion.originalIndex]?.action || suggestion.recommendation}
                                          onValueChange={(value) => updateDecision(suggestion.originalIndex, { action: value })}
                                        >
                                          <SelectTrigger className="w-36 border-orange-200">
                                            <SelectValue />
                                          </SelectTrigger>
                                          <SelectContent>
                                            <SelectItem value="update">Update Existing</SelectItem>
                                            <SelectItem value="create_new">Create New</SelectItem>
                                            <SelectItem value="skip">Skip</SelectItem>
                                          </SelectContent>
                                        </Select>
                                      ) : (
                                        <div className="flex items-center gap-2">
                                          <Badge className="bg-green-100 text-green-800 border-green-200 text-xs px-2 py-1">
                                            Create New
                                          </Badge>
                                          <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => updateDecision(suggestion.originalIndex, { action: 'skip' })}
                                            className="border-red-200 text-red-600 hover:bg-red-50 text-xs px-2 py-1"
                                          >
                                            Skip
                                          </Button>
                                        </div>
                                      )}
                                      
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => setEditingItems(prev => ({ ...prev, [suggestion.originalIndex]: !prev[suggestion.originalIndex] }))}
                                        className="border-orange-200 text-orange-600 hover:bg-orange-50"
                                      >
                                        <Edit className="h-4 w-4 mr-1" />
                                        {editingItems[suggestion.originalIndex] ? 'Cancel' : 'Edit'}
                                      </Button>
                                    </div>
                                  </div>

                                  {/* Expanded Preview */}
                                  {editingItems[suggestion.originalIndex] && (
                                    <div className="mt-4 p-4 bg-orange-50 rounded-lg border border-orange-200">
                                      <h4 className="font-medium text-sm text-gray-700 mb-3">Edit Item:</h4>
                                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                                        <div>
                                          <label className="block text-gray-600 mb-1">Name:</label>
                                          <Input
                                            value={decisions[suggestion.originalIndex]?.modifications?.name || suggestion.generated_item.name}
                                            onChange={(e) => updateDecision(suggestion.originalIndex, {
                                              modifications: {
                                                ...decisions[suggestion.originalIndex]?.modifications,
                                                name: e.target.value
                                              }
                                            })}
                                            className="h-8 text-sm"
                                          />
                                        </div>
                                        <div>
                                          <label className="block text-gray-600 mb-1">Price (R):</label>
                                          <Input
                                            type="number"
                                            step="0.01"
                                            value={decisions[suggestion.originalIndex]?.modifications?.price || suggestion.generated_item.price || ''}
                                            onChange={(e) => updateDecision(suggestion.originalIndex, {
                                              modifications: {
                                                ...decisions[suggestion.originalIndex]?.modifications,
                                                price: parseFloat(e.target.value) || 0
                                              }
                                            })}
                                            className="h-8 text-sm"
                                          />
                                        </div>
                                        <div className="md:col-span-2">
                                          <label className="block text-gray-600 mb-1">Description:</label>
                                          <Textarea
                                            value={decisions[suggestion.originalIndex]?.modifications?.description || suggestion.generated_item.description || ''}
                                            onChange={(e) => updateDecision(suggestion.originalIndex, {
                                              modifications: {
                                                ...decisions[suggestion.originalIndex]?.modifications,
                                                description: e.target.value
                                              }
                                            })}
                                            className="h-16 text-sm"
                                            rows={2}
                                          />
                                        </div>
                                        <div>
                                          <label className="block text-gray-600 mb-1">Prep Time (min):</label>
                                          <Input
                                            type="number"
                                            value={decisions[suggestion.originalIndex]?.modifications?.preparation_time || suggestion.generated_item.preparation_time || 15}
                                            onChange={(e) => updateDecision(suggestion.originalIndex, {
                                              modifications: {
                                                ...decisions[suggestion.originalIndex]?.modifications,
                                                preparation_time: parseInt(e.target.value) || 15
                                              }
                                            })}
                                            className="h-8 text-sm"
                                          />
                                        </div>
                                        <div className="flex items-end">
                                          <Button
                                            size="sm"
                                            onClick={() => setEditingItems(prev => ({ ...prev, [suggestion.originalIndex]: false }))}
                                            className="bg-orange-500 hover:bg-orange-600 text-white"
                                          >
                                            Save Changes
                                          </Button>
                                        </div>
                                      </div>
                                    </div>
                                  )}
                                </CardContent>
                              </Card>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  
                  {/* Direct category items */}
                  {categoryData.items.length > 0 && (
                    <div className="space-y-3 ml-4">
                      {categoryData.items.map((suggestion, index) => (
                        <Card key={suggestion.originalIndex} className="border-orange-200 shadow-sm">
                          <CardContent className="p-6">
                            <div className="flex items-start gap-4">
                              {/* Item Info */}
                              <div className="flex-1">
                                <div className="flex items-center gap-3 mb-2">
                                  <h3 className="font-semibold text-lg text-gray-900">
                                    {suggestion.generated_item.name}
                                  </h3>
                                  <Badge className={`${getRecommendationColor(suggestion.recommendation)} text-xs`}>
                                    {suggestion.recommendation.replace('_', ' ')}
                                  </Badge>
                                </div>
                                
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                                  <div className="flex items-center gap-2 text-sm text-gray-600">
                                    <span className="font-medium text-orange-600">R</span>
                                    {suggestion.generated_item.price?.toFixed(2) || '0.00'}
                                  </div>
                                  <div className="flex items-center gap-2 text-sm text-gray-600">
                                    <Clock className="h-4 w-4" />
                                    {suggestion.generated_item.preparation_time || 15} min
                                  </div>
                                  <div className="flex items-center gap-2 text-sm text-gray-600">
                                    <Tag className="h-4 w-4" />
                                    {suggestion.generated_item.category_path?.join(' > ') || 'Uncategorized'}
                                  </div>
                                </div>

                                {suggestion.generated_item.description && (
                                  <p className="text-sm text-gray-600 mb-4">
                                    {suggestion.generated_item.description}
                                  </p>
                                )}

                                {/* Variations Display */}
                                {suggestion.generated_item.variations && suggestion.generated_item.variations.length > 0 && (
                                  <div className="mb-4 p-3 bg-blue-50 rounded-lg border border-blue-200">
                                    <h5 className="font-medium text-sm text-blue-800 mb-2 flex items-center gap-2">
                                      <span className="w-1.5 h-1.5 bg-blue-500 rounded-full"></span>
                                      Variations ({suggestion.generated_item.variations.length})
                                    </h5>
                                    <div className="space-y-2">
                                      {suggestion.generated_item.variations.map((variation, varIndex) => (
                                        <div key={varIndex} className="text-sm">
                                          <div className="flex items-center gap-2 mb-1">
                                            <span className="font-medium text-gray-700">{variation.name}</span>
                                            <Badge className={`text-xs ${
                                              variation.is_required 
                                                ? 'bg-red-100 text-red-700 border-red-200' 
                                                : 'bg-gray-100 text-gray-700 border-gray-200'
                                            }`}>
                                              {variation.is_required ? 'Required' : 'Optional'}
                                            </Badge>
                                          </div>
                                          <div className="ml-2 space-y-1">
                                            {variation.options.map((option, optIndex) => (
                                              <div key={optIndex} className="flex items-center justify-between text-xs text-gray-600">
                                                <span className="flex items-center gap-1">
                                                  {option.is_default && <span className="w-1 h-1 bg-green-500 rounded-full"></span>}
                                                  {option.name}
                                                  {option.is_default && <span className="text-green-600 font-medium">(default)</span>}
                                                </span>
                                                <span className="font-medium">
                                                  {option.price_modifier === 0 ? 'R0.00' : 
                                                   option.price_modifier > 0 ? `+R${option.price_modifier.toFixed(2)}` : 
                                                   `R${option.price_modifier.toFixed(2)}`}
                                                </span>
                                              </div>
                                            ))}
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}

                                <p className="text-sm text-orange-600 font-medium">
                                  {suggestion.recommendation_reason}
                                </p>

                                {/* Similar Items */}
                                {suggestion.similar_items?.length > 0 && (
                                  <div className="mt-4 p-3 bg-gray-50 rounded-lg">
                                    <h4 className="font-medium text-sm text-gray-700 mb-2">Similar Existing Items:</h4>
                                    <div className="space-y-2">
                                      {suggestion.similar_items.slice(0, 2).map((match, matchIndex) => (
                                        <div key={matchIndex} className="flex items-center justify-between text-sm">
                                          <span className="text-gray-600">
                                            {match.existing_item.name} - R{formatPrice(match.existing_item.price)}
                                          </span>
                                          <Badge className={`${getSimilarityColor(match.similarity_score)} text-xs`}>
                                            {Math.round(match.similarity_score * 100)}% match
                                          </Badge>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>

                              {/* Actions */}
                              <div className="flex flex-col gap-2">
                                {suggestion.similar_items && suggestion.similar_items.length > 0 ? (
                                  <Select
                                    value={decisions[suggestion.originalIndex]?.action || suggestion.recommendation}
                                    onValueChange={(value) => updateDecision(suggestion.originalIndex, { action: value })}
                                  >
                                    <SelectTrigger className="w-36 border-orange-200">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="update">Update Existing</SelectItem>
                                      <SelectItem value="create_new">Create New</SelectItem>
                                      <SelectItem value="skip">Skip</SelectItem>
                                    </SelectContent>
                                  </Select>
                                ) : (
                                  <div className="flex items-center gap-2">
                                    <Badge className="bg-green-100 text-green-800 border-green-200 text-xs px-2 py-1">
                                      Create New
                                    </Badge>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => updateDecision(suggestion.originalIndex, { action: 'skip' })}
                                      className="border-red-200 text-red-600 hover:bg-red-50 text-xs px-2 py-1"
                                    >
                                      Skip
                                    </Button>
                                  </div>
                                )}
                                
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => setEditingItems(prev => ({ ...prev, [suggestion.originalIndex]: !prev[suggestion.originalIndex] }))}
                                  className="border-orange-200 text-orange-600 hover:bg-orange-50"
                                >
                                  <Edit className="h-4 w-4 mr-1" />
                                  {editingItems[suggestion.originalIndex] ? 'Cancel' : 'Edit'}
                                </Button>
                              </div>
                            </div>

                            {/* Expanded Edit Form */}
                            {editingItems[suggestion.originalIndex] && (
                              <div className="mt-4 p-4 bg-orange-50 rounded-lg border border-orange-200">
                                <h4 className="font-medium text-sm text-gray-700 mb-3">Edit Item:</h4>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                                  <div>
                                    <label className="block text-gray-600 mb-1">Name:</label>
                                    <Input
                                      value={decisions[suggestion.originalIndex]?.modifications?.name || suggestion.generated_item.name}
                                      onChange={(e) => updateDecision(suggestion.originalIndex, {
                                        modifications: {
                                          ...decisions[suggestion.originalIndex]?.modifications,
                                          name: e.target.value
                                        }
                                      })}
                                      className="h-8 text-sm"
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-gray-600 mb-1">Price (R):</label>
                                    <Input
                                      type="number"
                                      step="0.01"
                                      value={decisions[suggestion.originalIndex]?.modifications?.price || suggestion.generated_item.price || ''}
                                      onChange={(e) => updateDecision(suggestion.originalIndex, {
                                        modifications: {
                                          ...decisions[suggestion.originalIndex]?.modifications,
                                          price: parseFloat(e.target.value) || 0
                                        }
                                      })}
                                      className="h-8 text-sm"
                                    />
                                  </div>
                                  <div className="md:col-span-2">
                                    <label className="block text-gray-600 mb-1">Description:</label>
                                    <Textarea
                                      value={decisions[suggestion.originalIndex]?.modifications?.description || suggestion.generated_item.description || ''}
                                      onChange={(e) => updateDecision(suggestion.originalIndex, {
                                        modifications: {
                                          ...decisions[suggestion.originalIndex]?.modifications,
                                          description: e.target.value
                                        }
                                      })}
                                      className="h-16 text-sm"
                                      rows={2}
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-gray-600 mb-1">Prep Time (min):</label>
                                    <Input
                                      type="number"
                                      value={decisions[suggestion.originalIndex]?.modifications?.preparation_time || suggestion.generated_item.preparation_time || 15}
                                      onChange={(e) => updateDecision(suggestion.originalIndex, {
                                        modifications: {
                                          ...decisions[suggestion.originalIndex]?.modifications,
                                          preparation_time: parseInt(e.target.value) || 15
                                        }
                                      })}
                                      className="h-8 text-sm"
                                    />
                                  </div>
                                  <div className="flex items-end">
                                    <Button
                                      size="sm"
                                      onClick={() => setEditingItems(prev => ({ ...prev, [suggestion.originalIndex]: false }))}
                                      className="bg-orange-500 hover:bg-orange-600 text-white"
                                    >
                                      Save Changes
                                    </Button>
                                  </div>
                                </div>
                              </div>
                            )}
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Confirm Button */}
            <Card className="border-orange-200 bg-gradient-to-r from-orange-50 to-amber-50">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold text-lg text-gray-900">Ready to Update Menu?</h3>
                    <p className="text-sm text-gray-600 mt-1">
                      {Object.values(decisions).filter(d => d.action === 'create_new').length} new items, {' '}
                      {Object.values(decisions).filter(d => d.action === 'update').length} updates, {' '}
                      {Object.values(decisions).filter(d => d.action === 'skip').length} skipped
                    </p>
                  </div>
                  <div className="flex gap-3">
                    <Button
                      variant="outline"
                      onClick={() => setCurrentStep(1)}
                      disabled={loading}
                      className="border-orange-200 text-orange-600 hover:bg-orange-50"
                    >
                      <ArrowLeft className="h-4 w-4 mr-2" />
                      Back
                    </Button>
                    <Button
                      onClick={confirmMenu}
                      disabled={loading}
                      className="bg-orange-500 hover:bg-orange-600 text-white font-medium px-6"
                    >
                      {loading ? (
                        <>
                          <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                          Updating Menu...
                        </>
                      ) : (
                        <>
                          <Target className="h-5 w-5 mr-2" />
                          Confirm & Update Menu
                        </>
                      )}
                    </Button>
                  </div>
                </div>
                
                {/* Debug Section */}
                <details className="mt-4 p-3 bg-gray-100 rounded-lg">
                  <summary className="text-sm font-medium text-gray-700 cursor-pointer">
                    🐛 Debug Info (Click to expand)
                  </summary>
                  <div className="mt-3 space-y-2 text-xs">
                    <div>
                      <strong>Total Decisions:</strong> {Object.keys(decisions).length}
                    </div>
                    <div>
                      <strong>Non-Skip Decisions:</strong> {Object.values(decisions).filter(d => d.action !== 'skip').length}
                    </div>
                    <div>
                      <strong>Decisions by Action:</strong>
                      <ul className="ml-4 mt-1">
                        <li>Create New: {Object.values(decisions).filter(d => d.action === 'create_new').length}</li>
                        <li>Update: {Object.values(decisions).filter(d => d.action === 'update').length}</li>
                        <li>Skip: {Object.values(decisions).filter(d => d.action === 'skip').length}</li>
                      </ul>
                    </div>
                    <div>
                      <strong>Sample Decision:</strong>
                      <pre className="bg-gray-200 p-2 rounded text-xs overflow-auto">
                        {JSON.stringify(Object.values(decisions)[0] || {}, null, 2)}
                      </pre>
                    </div>
                  </div>
                </details>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Step 3: Results */}
        {currentStep === 3 && (
          <div className="space-y-6">
            {/* Summary */}
            <Card className="border-orange-200 bg-gradient-to-r from-orange-50 to-amber-50">
              <CardContent className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-2xl font-bold text-gray-900">Processing Complete!</h2>
                  <Badge className={`${failedItems.length === 0 ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'} text-sm`}>
                    {failedItems.length === 0 ? 'All Success' : 'Partial Success'}
                  </Badge>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="text-center">
                    <div className="text-2xl font-bold text-green-600">{resultsStats.items_created || 0}</div>
                    <div className="text-sm text-gray-600">Items Created</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-blue-600">{resultsStats.items_updated || 0}</div>
                    <div className="text-sm text-gray-600">Items Updated</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-red-600">{resultsStats.items_failed || 0}</div>
                    <div className="text-sm text-gray-600">Items Failed</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-gray-600">{resultsStats.items_skipped || 0}</div>
                    <div className="text-sm text-gray-600">Items Skipped</div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Successful Items */}
            {successfulItems.length > 0 && (
              <Card className="border-green-200">
                <CardHeader className="bg-green-100 text-green-800">
                  <CardTitle className="flex items-center gap-2">
                    <CheckCircle className="h-5 w-5" />
                    Successfully Processed Items ({successfulItems.length})
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {successfulItems.map((decision, index) => {
                      // Fix: Use the same logic as backend - properly check if modifications has actual properties
                      const hasModifications = decision.modifications && Object.keys(decision.modifications).length > 0;
                      const item = hasModifications 
                        ? { ...decision.generated_item, ...decision.modifications }
                        : decision.generated_item;
                      
                      return (
                        <div key={index} className="bg-white p-4 rounded-lg shadow-sm border border-green-200">
                          <h4 className="font-medium text-lg text-green-800 mb-2">{item.name}</h4>
                          <p className="text-sm text-green-600 mb-1">
                            Action: {decision.action === 'create_new' ? 'Created' : decision.action === 'update' ? 'Updated' : 'Skipped'}
                          </p>
                          <p className="text-sm text-gray-600 mb-1">
                            Price: R{formatPrice(item.price)}
                          </p>
                          {item.description && (
                            <p className="text-xs text-gray-500 mb-1">
                              {item.description}
                            </p>
                          )}
                          <p className="text-xs text-gray-500">
                            Category: {item.category_path?.join(' > ') || 'Uncategorized'}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Failed Items with Edit Options */}
            {failedItems.length > 0 && (
              <Card className="border-red-200">
                <CardHeader className="bg-red-100 text-red-800">
                  <CardTitle className="flex items-center gap-2">
                    <AlertCircle className="h-5 w-5" />
                    Failed to Process Items ({failedItems.length})
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-6">
                  <div className="mb-4 p-3 bg-red-50 rounded-lg border border-red-200">
                    <p className="text-sm text-red-700">
                      💡 <strong>Fix and retry:</strong> Edit the items below to fix any validation issues, then click "Retry Failed Items" to process them again.
                    </p>
                  </div>
                  <div className="grid grid-cols-1 gap-4">
                    {failedItems.map((decision, index) => {
                      // Fix: Use the same logic as backend - properly check if modifications has actual properties
                      const hasModifications = decision.modifications && Object.keys(decision.modifications).length > 0;
                      const item = hasModifications 
                        ? { ...decision.generated_item, ...decision.modifications }
                        : decision.generated_item;
                      
                      const isEditing = editingItems[`failed_${index}`];
                      return (
                        <div key={index} className="bg-white p-4 rounded-lg shadow-sm border border-red-200">
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <h4 className="font-medium text-lg text-red-800 mb-2">{item.name}</h4>
                              <p className="text-sm text-red-600 mb-1">
                                Failed Reason: {!item.name || item.name.trim() === '' ? 'Missing name; ' : ''}
                                {!item.price || isNaN(item.price) ? 'Invalid price; ' : ''}
                                {!item.category_path || item.category_path.length === 0 ? 'Missing category; ' : ''}
                              </p>
                              <p className="text-sm text-gray-600 mb-1">
                                Price: R{formatPrice(item.price)} {(!item.price || isNaN(item.price)) && <span className="text-red-500">(Invalid)</span>}
                              </p>
                              {item.description && (
                                <p className="text-xs text-gray-500 mb-1">
                                  {item.description}
                                </p>
                              )}
                              <p className="text-xs text-gray-500">
                                Category: {item.category_path?.join(' > ') || 'Uncategorized'}
                              </p>
                            </div>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setEditingItems(prev => ({ ...prev, [`failed_${index}`]: !prev[`failed_${index}`] }))}
                              className="border-orange-200 text-orange-600 hover:bg-orange-50"
                            >
                              <Edit className="h-4 w-4 mr-1" />
                              {isEditing ? 'Cancel' : 'Edit'}
                            </Button>
                          </div>

                          {/* Edit Form for Failed Items */}
                          {isEditing && (
                            <div className="mt-4 p-4 bg-orange-50 rounded-lg border border-orange-200">
                              <h5 className="font-medium text-sm text-gray-700 mb-3">Fix Item Issues:</h5>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                                <div>
                                  <label className="block text-gray-600 mb-1">Name:</label>
                                  <Input
                                    value={failedItems[index].modifications?.name || failedItems[index].generated_item?.name || ''}
                                    onChange={(e) => {
                                      const updatedFailedItems = [...failedItems];
                                      updatedFailedItems[index] = {
                                        ...updatedFailedItems[index],
                                        modifications: {
                                          ...updatedFailedItems[index].modifications,
                                          name: e.target.value
                                        }
                                      };
                                      setFailedItems(updatedFailedItems);
                                    }}
                                    className="h-8 text-sm"
                                    placeholder="Enter item name"
                                  />
                                </div>
                                <div>
                                  <label className="block text-gray-600 mb-1">Price (R):</label>
                                  <Input
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    value={failedItems[index].modifications?.price || failedItems[index].generated_item?.price || ''}
                                    onChange={(e) => {
                                      const updatedFailedItems = [...failedItems];
                                      updatedFailedItems[index] = {
                                        ...updatedFailedItems[index],
                                        modifications: {
                                          ...updatedFailedItems[index].modifications,
                                          price: parseFloat(e.target.value) || 0
                                        }
                                      };
                                      setFailedItems(updatedFailedItems);
                                    }}
                                    className="h-8 text-sm"
                                    placeholder="0.00"
                                  />
                                </div>
                                <div className="md:col-span-2">
                                  <label className="block text-gray-600 mb-1">Description:</label>
                                  <Textarea
                                    value={failedItems[index].modifications?.description || failedItems[index].generated_item?.description || ''}
                                    onChange={(e) => {
                                      const updatedFailedItems = [...failedItems];
                                      updatedFailedItems[index] = {
                                        ...updatedFailedItems[index],
                                        modifications: {
                                          ...updatedFailedItems[index].modifications,
                                          description: e.target.value
                                        }
                                      };
                                      setFailedItems(updatedFailedItems);
                                    }}
                                    className="h-16 text-sm"
                                    rows={2}
                                    placeholder="Enter item description"
                                  />
                                </div>
                                <div className="flex items-end">
                                  <Button
                                    size="sm"
                                    onClick={() => setEditingItems(prev => ({ ...prev, [`failed_${index}`]: false }))}
                                    className="bg-orange-500 hover:bg-orange-600 text-white"
                                  >
                                    Save Changes
                                  </Button>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Retry Failed Items Button */}
                  <div className="mt-6 flex justify-center">
                    <Button
                      onClick={async () => {
                        // Retry only the failed items
                        setLoading(true);
                        setError('');
                        setProcessingStep('Retrying failed items...');

                        try {
                          // Call the API with only failed items
                          const { data, error } = await supabase.functions.invoke('ai-menu-creator', {
                            body: {
                              action: 'confirm',
                              location_id: activeLocation.id,
                              decisions: failedItems // Send the updated failed items
                            }
                          });

                          if (error) {
                            throw error;
                          }
                          
                          if (!data?.success) {
                            throw new Error(data?.error || 'Failed to retry items');
                          }

                          // Update the results - move successful items from failed to successful
                          if (data.successful_items && data.successful_items.length > 0) {
                            setSuccessfulItems(prev => [...prev, ...data.successful_items]);
                          }
                          
                          // Update failed items to only include items that still failed
                          setFailedItems(data.failed_items || []);
                          
                          // Update stats
                          setResultsStats(prev => ({
                            ...prev,
                            items_created: (prev.items_created || 0) + (data.stats?.items_created || 0),
                            items_updated: (prev.items_updated || 0) + (data.stats?.items_updated || 0),
                            items_failed: data.failed_items?.length || 0,
                            items_successful: (prev.items_successful || 0) + (data.successful_items?.length || 0)
                          }));

                          if (data.failed_items && data.failed_items.length > 0) {
                            setSuccess(`Retry partially successful! ${data.successful_items?.length || 0} items processed, ${data.failed_items.length} still failed.`);
                          } else {
                            setSuccess(`All failed items processed successfully! ${data.successful_items?.length || 0} items updated.`);
                          }

                        } catch (err) {
                          console.error('Retry failed items error:', err);
                          setError(`Failed to retry items: ${err.message}`);
                        } finally {
                          setLoading(false);
                          setProcessingStep('');
                        }
                      }}
                      className="bg-red-500 hover:bg-red-600 text-white font-medium px-6"
                      disabled={loading}
                    >
                      {loading ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Retrying...
                        </>
                      ) : (
                        <>
                          <RefreshCw className="h-4 w-4 mr-2" />
                          Retry Failed Items
                        </>
                      )}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Navigation Options */}
            <Card className="border-orange-200 bg-gradient-to-r from-orange-50 to-amber-50">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold text-lg text-gray-900">What's Next?</h3>
                    <p className="text-sm text-gray-600 mt-1">
                      {failedItems.length === 0 
                        ? 'All items processed successfully! You can go back to the menu or dashboard.'
                        : `${successfulItems.length} items processed successfully. Fix and retry the ${failedItems.length} failed items above.`
                      }
                    </p>
                  </div>
                  <div className="flex gap-3">
                    <Button
                      variant="outline"
                      onClick={() => navigate('/menu')}
                      className="border-orange-200 text-orange-600 hover:bg-orange-50"
                    >
                      <ArrowLeft className="h-4 w-4 mr-2" />
                      Back to Menu
                    </Button>
                    <Button
                      onClick={() => navigate('/')}
                      className="bg-orange-500 hover:bg-orange-600 text-white font-medium px-6"
                    >
                      <CheckCircle className="h-4 w-4 mr-2" />
                      Done
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
};

export default AIMenuCreator;
