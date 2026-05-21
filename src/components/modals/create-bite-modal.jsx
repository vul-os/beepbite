import React, { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { 
  Hash, 
  Phone, 
  Delete, 
  AlertCircle,
  CheckCircle,
  Mail,
  SkipForward,
  User,
  Clock,
  ShoppingBag,
  Loader2
} from 'lucide-react';
import { supabase } from '@/services/supabase-client';
import { useAuth } from '@/context/auth-context';

// 50 most common email domains
const COMMON_EMAIL_DOMAINS = [
  'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com',
  'aol.com', 'protonmail.com', 'live.com', 'msn.com', 'yandex.com',
  'mail.com', 'zoho.com', 'gmx.com', 'fastmail.com', 'tutanota.com',
  'me.com', 'mac.com', 'rocketmail.com', 'hushmail.com', 'inbox.com',
  'mailfence.com', 'startmail.com', 'runbox.com', 'disroot.org', 'guerrillamail.com',
  'temp-mail.org', '10minutemail.com', 'mailinator.com', 'cock.li', 'anonaddy.me',
  'simplelogin.io', 'duck.com', 'hey.com', 'superhuman.com', 'spark.com',
  'webmail.co.za', 'vodamail.co.za', 'telkomsa.net', 'mweb.co.za', 'iafrica.com',
  'lantic.net', 'absamail.co.za', 'fnb.co.za', 'nedbank.co.za', 'standardbank.co.za',
  'gmail.co.za', 'yahoo.co.za', 'hotmail.co.za', 'outlook.co.za', 'live.co.za'
];

const CreateBiteModal = ({ isOpen, onClose, onOrderCreated }) => {
  const { user, activeLocation } = useAuth();
  const [orderNumber, setOrderNumber] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [email, setEmail] = useState('');
  const [showEmailStep, setShowEmailStep] = useState(false);
  const [activeInput, setActiveInput] = useState('order'); // 'order', 'phone', or 'email'
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [customerDetails, setCustomerDetails] = useState(null);
  const [isLookingUpCustomer, setIsLookingUpCustomer] = useState(false);
  const [lookupTimer, setLookupTimer] = useState(null);
  const [isCheckingOrderNumber, setIsCheckingOrderNumber] = useState(false);
  const [orderNumberExists, setOrderNumberExists] = useState(false);
  const [orderCheckTimer, setOrderCheckTimer] = useState(null);
  const [completedOldOrders, setCompletedOldOrders] = useState(0);

  // Lookup customer details when phone number changes
  const lookupCustomerDetails = async (phoneNum) => {
    if (!phoneNum || phoneNum.length < 10) {
      setCustomerDetails(null);
      return;
    }

    setIsLookingUpCustomer(true);
    try {
      const { data, error } = await supabase
        .rpc('lookup_customer_details', {
          input_whatsapp_number: phoneNum
        });

      if (error) throw error;

      const customerData = data?.[0];
      if (customerData?.customer_id) {
        setCustomerDetails(customerData);
        // Autofill email if available and not already filled
        if (customerData.email && !email.trim()) {
          setEmail(customerData.email);
        }
      } else {
        setCustomerDetails(null);
      }
    } catch (error) {
      console.error('Error looking up customer:', error);
      setCustomerDetails(null);
    } finally {
      setIsLookingUpCustomer(false);
    }
  };

  // Check if order number exists within 24 hours
  const checkOrderNumberExists = async (orderNum) => {
    if (!activeLocation || !orderNum.trim()) {
      setOrderNumberExists(false);
      setIsCheckingOrderNumber(false);
      return;
    }

    try {
      // Simple check for existing orders with same number in last 24 hours
      const { data, error } = await supabase
        .from('orders')
        .select('id')
        .eq('location_id', activeLocation.id)
        .eq('order_number', orderNum.trim())
        .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .limit(1);

      if (error) throw error;
      
      setOrderNumberExists(data && data.length > 0);
      setCompletedOldOrders(0); // Reset for now, can implement auto-completion later
    } catch (error) {
      console.error('Error checking order number:', error);
      setOrderNumberExists(false);
    } finally {
      setIsCheckingOrderNumber(false);
    }
  };

  // Debounced order number check
  useEffect(() => {
    if (orderCheckTimer) {
      clearTimeout(orderCheckTimer);
    }

    // Reset state when order number changes
    setOrderNumberExists(false);
    setCompletedOldOrders(0);
    
    // If order number is too short or no bistro, don't check
    if (!orderNumber.trim() || !activeLocation) {
      setIsCheckingOrderNumber(false);
      return;
    }

    // Set loading state
    setIsCheckingOrderNumber(true);
    
    // Set new timer for debounced check
    const timer = setTimeout(() => {
      checkOrderNumberExists(orderNumber);
    }, 500); // 500ms debounce

    setOrderCheckTimer(timer);

    return () => {
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [orderNumber, activeLocation]); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced customer lookup when phone number changes
  useEffect(() => {
    if (lookupTimer) {
      clearTimeout(lookupTimer);
    }

    if (phoneNumber.trim()) {
      const timer = setTimeout(() => {
        lookupCustomerDetails(phoneNumber.trim());
      }, 800); // 800ms delay
      
      setLookupTimer(timer);
    } else {
      setCustomerDetails(null);
    }

    return () => {
      if (lookupTimer) {
        clearTimeout(lookupTimer);
      }
    };
  }, [phoneNumber]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keypad numbers and special keys
  const keypadNumbers = [
    ['1', '2', '3'],
    ['4', '5', '6'], 
    ['7', '8', '9'],
    ['*', '0', '#']
  ];

  // Get filtered email domains based on current input
  const getFilteredDomains = () => {
    if (!email.includes('@')) return [];
    
    const [username, domain] = email.split('@');
    if (!domain) return COMMON_EMAIL_DOMAINS.slice(0, 8); // Show top 8 when just @ is typed
    
    const filtered = COMMON_EMAIL_DOMAINS.filter(d => 
      d.toLowerCase().startsWith(domain.toLowerCase())
    );
    
    return filtered.slice(0, 8); // Limit to 8 suggestions
  };

  // Handle email domain selection
  const handleDomainSelect = (domain) => {
    const [username] = email.split('@');
    setEmail(`${username}@${domain}`);
  };

  // Handle moving to email step
  const handleProceedToEmail = () => {
    if (!phoneNumber.trim()) {
      setError('Please enter a phone number first');
      return;
    }
    if (phoneNumber.length < 10) {
      setError('Please enter a valid phone number');
      return;
    }
    setError('');
    
    // If customer already has a valid email, proceed directly to submission
    if (customerDetails?.email && email.trim() && email.includes('@')) {
      handleSubmit();
      return;
    }
    
    setShowEmailStep(true);
    setActiveInput('email');
  };

  // Handle skipping email step
  const handleSkipEmail = () => {
    setEmail('');
    handleSubmit();
  };

  const handleKeypadPress = (value) => {
    if (activeInput === 'order') {
      if (value === '*' || value === '#') return; // Don't allow special chars in order number
      setOrderNumber(prev => prev + value);
    } else if (activeInput === 'phone') {
      if (value === '*') {
        setPhoneNumber(prev => prev + '+');
      } else {
        setPhoneNumber(prev => prev + value);
      }
    }
  };

  const handleBackspace = () => {
    if (activeInput === 'order') {
      setOrderNumber(prev => prev.slice(0, -1));
    } else if (activeInput === 'phone') {
      setPhoneNumber(prev => prev.slice(0, -1));
    }
  };

  const handleClear = () => {
    if (activeInput === 'order') {
      setOrderNumber('');
    } else if (activeInput === 'phone') {
      setPhoneNumber('');
    }
  };

  const validateForm = () => {
    if (!activeLocation) {
      setError('No location found for your account');
      return false;
    }
    if (!orderNumber.trim()) {
      setError('Order number is required');
      return false;
    }
    if (orderNumberExists) {
      setError(`Order #${orderNumber.trim()} was already created within the last 24 hours. Please use a different order number.`);
      return false;
    }
    if (!phoneNumber.trim()) {
      setError('Customer phone number is required');
      return false;
    }
    if (phoneNumber.length < 10) {
      setError('Please enter a valid phone number');
      return false;
    }
    // Email is optional, but if provided, should be valid
    if (email.trim() && !email.includes('@')) {
      setError('Please enter a valid email address');
      return false;
    }
    return true;
  };

  // Helper function to normalize phone numbers (remove + prefix)
  const normalizePhoneNumber = (phone) => {
    const trimmed = phone.trim();
    return trimmed.startsWith('+') ? trimmed.substring(1) : trimmed;
  };

  const handleSubmit = async () => {
    setError('');
    
    if (!validateForm()) {
      return;
    }

    setIsSubmitting(true);
    
    try {
      // First, create or get customer
      let customerId = customerDetails?.customer_id;
      
      if (!customerId) {
        // Create new customer
        const { data: newCustomer, error: customerError } = await supabase
          .from('customers')
          .insert({
            whatsapp_number: phoneNumber.trim(),
            email: email.trim() || null
          })
          .select('id')
          .single();

        if (customerError) throw customerError;
        customerId = newCustomer.id;
      } else if (email.trim() && email !== customerDetails.email) {
        // Update customer email if changed
        await supabase
          .from('customers')
          .update({ email: email.trim() })
          .eq('id', customerId);
      }

      // Create the order
      const { data: newOrder, error: orderError } = await supabase
        .from('orders')
        .insert({
          location_id: activeLocation.id,
          customer_id: customerId,
          order_number: orderNumber.trim(),
          order_type: 'whatsapp',
          status: 'pending'
        })
        .select('id')
        .single();

      if (orderError) throw orderError;

      setSuccess(true);
      
      // Reset form after short delay
      setTimeout(() => {
        setOrderNumber('');
        setPhoneNumber('');
        setEmail('');
        setShowEmailStep(false);
        setActiveInput('order');
        setSuccess(false);
        setCustomerDetails(null);
        setOrderNumberExists(false);
        setIsCheckingOrderNumber(false);
        setCompletedOldOrders(0);
        if (orderCheckTimer) {
          clearTimeout(orderCheckTimer);
          setOrderCheckTimer(null);
        }
        onClose();
        onOrderCreated?.();
      }, 1500);
      
    } catch (error) {
      console.error('Error creating order:', error);
      
      // Handle specific error cases
      if (error.message && error.message.includes('duplicate key')) {
        setError(`Order #${orderNumber.trim()} already exists. Please use a different order number.`);
      } else {
        setError(error.message || 'Failed to create order. Please try again.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    if (!isSubmitting) {
      setOrderNumber('');
      setPhoneNumber('');
      setEmail('');
      setShowEmailStep(false);
      setActiveInput('order');
      setError('');
      setSuccess(false);
              setCustomerDetails(null);
        setOrderNumberExists(false);
        setIsCheckingOrderNumber(false);
        setCompletedOldOrders(0);
        if (orderCheckTimer) {
          clearTimeout(orderCheckTimer);
          setOrderCheckTimer(null);
        }
        onClose();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="w-[95vw] max-w-lg mx-auto max-h-[95vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create New Order</DialogTitle>
        </DialogHeader>
        
        {success ? (
          <div className="py-6 text-center">
            <div className="w-12 h-12 sm:w-16 sm:h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
              <CheckCircle className="w-6 h-6 sm:w-8 sm:h-8 text-green-600" />
            </div>
            <h3 className="text-base sm:text-lg font-semibold text-green-600 mb-2">Order Created!</h3>
            <p className="text-sm text-gray-600">Order #{orderNumber} has been added to your dashboard.</p>
          </div>
        ) : (
          <div className="space-y-3 sm:space-y-4">
            {/* Error Alert */}
            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription className="text-sm">{error}</AlertDescription>
              </Alert>
            )}

            {/* Input Fields */}
            <div className="space-y-2 sm:space-y-3">
              <div>
                <Label htmlFor="orderNumber" className="text-sm font-medium">
                  Order Number
                </Label>
                <div className="relative mt-1">
                  <Hash className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4 sm:w-5 sm:h-5" />
                  <Input
                    id="orderNumber"
                    value={orderNumber}
                    onChange={(e) => setOrderNumber(e.target.value)}
                    onFocus={() => setActiveInput('order')}
                    placeholder="Enter order number (keyboard or keypad)"
                    className={`pl-9 sm:pl-10 h-9 sm:h-10 text-sm sm:text-base ${
                      activeInput === 'order' ? 'ring-2 ring-orange-500 border-orange-500' : ''
                    } ${orderNumberExists ? 'border-red-300 ring-2 ring-red-100' : ''}`}
                  />
                </div>
                <div className="flex items-center justify-between mt-1">
                  <p className="text-xs text-gray-500">
                    Used within 24 hours will be blocked
                  </p>
                  {isCheckingOrderNumber && orderNumber.trim() && (
                    <div className="flex items-center text-xs text-gray-500">
                      <Loader2 className="w-3 h-3 animate-spin mr-1" />
                      Checking...
                    </div>
                  )}
                  {!isCheckingOrderNumber && orderNumber.trim() && orderNumberExists && (
                    <div className="text-xs text-red-600 font-medium">
                      ⚠️ Already used (24h)
                    </div>
                  )}
                  {!isCheckingOrderNumber && orderNumber.trim() && !orderNumberExists && activeLocation && (
                    <div className="text-xs text-green-600">
                      ✅ Available
                      {completedOldOrders > 0 && (
                        <span className="ml-2 text-blue-600">
                          (Auto-completed {completedOldOrders} old order{completedOldOrders !== 1 ? 's' : ''})
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div>
                <Label htmlFor="phoneNumber" className="text-sm font-medium">
                  Customer Phone Number
                </Label>
                <div className="relative mt-1">
                  <Phone className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4 sm:w-5 sm:h-5" />
                  <Input
                    id="phoneNumber"
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    onFocus={() => setActiveInput('phone')}
                    placeholder="Enter phone number (keyboard or keypad)"
                    className={`pl-9 sm:pl-10 h-9 sm:h-10 text-sm sm:text-base ${
                      activeInput === 'phone' ? 'ring-2 ring-orange-500 border-orange-500' : ''
                    }`}
                  />
                </div>
                <div className="flex items-center justify-between mt-1">
                  <p className="text-xs text-gray-500">
                    Use keyboard or press * on keypad for + symbol (international numbers)
                  </p>
                  {isLookingUpCustomer && (
                    <div className="flex items-center text-xs text-gray-500">
                      <Loader2 className="w-3 h-3 animate-spin mr-1" />
                      Looking up...
                    </div>
                  )}
                  {!isLookingUpCustomer && phoneNumber.length >= 10 && !customerDetails?.customer_id && (
                    <div className="text-xs text-orange-600">
                      New customer
                    </div>
                  )}
                </div>
              </div>

              {/* Customer Information Display */}
              {customerDetails && customerDetails.customer_id && (
                <div className="bg-orange-50 border border-orange-200 rounded-lg p-2">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center">
                      <User className="w-4 h-4 mr-2 text-orange-600" />
                      <span className="text-sm font-medium text-orange-800">
                        {customerDetails.display_name || customerDetails.first_name || 'Existing Customer'}
                      </span>
                    </div>
                    <div className="flex items-center space-x-2">
                      {customerDetails.has_recent_activity && (
                        <div className="flex items-center text-xs text-green-700 bg-green-100 px-2 py-1 rounded-full">
                          <Clock className="w-3 h-3 mr-1" />
                          Active
                        </div>
                      )}
                      {customerDetails.total_orders > 0 && (
                        <div className="flex items-center text-xs text-orange-600 bg-orange-100 px-2 py-1 rounded-full">
                          <ShoppingBag className="w-3 h-3 mr-1" />
                          {customerDetails.total_orders} order{customerDetails.total_orders !== 1 ? 's' : ''}
                        </div>
                      )}
                    </div>
                  </div>
                  
                  {customerDetails.email && (
                    <div className="text-xs mb-2 text-orange-700">
                      📧 {customerDetails.email}
                    </div>
                  )}
                  
                  <div className="text-xs">
                    {customerDetails.has_recent_activity ? (
                      <div className="text-green-700">
                        ✅ Can receive WhatsApp notifications immediately
                      </div>
                    ) : customerDetails.has_chats ? (
                      <div className="space-y-2">
                        <div className="text-orange-700 font-medium">
                          ⏰ WhatsApp window expired (24h rule)
                        </div>
                        <div className="bg-orange-100 border border-orange-300 rounded p-2">
                          <div className="font-medium text-orange-800 mb-1">💡 Quick Fix:</div>
                          <div className="text-orange-700">
                            Ask customer to send "Hi" to BeepBite Bot to reactivate WhatsApp notifications
                          </div>
                        </div>
                        <div className="text-gray-600">
                          📧 Meanwhile: Will receive email/SMS notifications
                        </div>
                      </div>
                    ) : (
                      <div className="text-orange-600">
                        📱 New customer - Will receive consent SMS first
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Email Step */}
              {showEmailStep && (
                <div className="border-t pt-3 mt-3">
                  <div className="flex items-center justify-between mb-2">
                    <Label htmlFor="email" className="text-sm font-medium">
                      Customer Email (Optional)
                      {customerDetails?.email && email === customerDetails.email && (
                        <span className="ml-2 text-xs text-orange-600 bg-orange-100 px-2 py-1 rounded-full">
                          Auto-filled
                        </span>
                      )}
                    </Label>
                    <Button
                      variant="outline" 
                      size="sm"
                      onClick={handleSkipEmail}
                      className="text-orange-600 hover:text-orange-700 hover:bg-orange-50 border-orange-200 h-8 px-3 min-w-[60px]"
                    >
                      <SkipForward className="w-4 h-4 mr-1" />
                      Skip
                    </Button>
                  </div>
                  
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4 sm:w-5 sm:h-5" />
                    <Input
                      id="email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      onFocus={() => setActiveInput('email')}
                      placeholder="Enter customer email"
                      className={`pl-9 sm:pl-10 h-9 sm:h-10 text-sm sm:text-base ${
                        activeInput === 'email' ? 'ring-2 ring-orange-500 border-orange-500' : ''
                      }`}
                    />
                  </div>
                  
                  <p className="text-xs text-gray-500 mt-1">
                    📧 With email: Faster notifications | 📱 Without email: SMS will be sent
                  </p>

                  {/* Email Domain Suggestions */}
                  {email.includes('@') && getFilteredDomains().length > 0 && (
                    <div className="mt-2">
                      <p className="text-xs font-medium text-gray-600 mb-1">Quick domains:</p>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-1">
                        {getFilteredDomains().map((domain) => (
                          <Button
                            key={domain}
                            variant="outline"
                            size="sm"
                            onClick={() => handleDomainSelect(domain)}
                            className="text-xs h-7 bg-orange-50 hover:bg-orange-100 border-orange-200 text-orange-700 justify-start"
                          >
                            @{domain}
                          </Button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Active Input Indicator - Only show when not in email step */}
            {!showEmailStep && (
              <div className="flex items-center justify-center space-x-2 py-1">
                <button
                  onClick={() => setActiveInput('order')}
                  className={`px-2 py-1 sm:px-3 sm:py-1.5 rounded-full text-xs font-medium transition-colors ${
                    activeInput === 'order'
                      ? 'bg-orange-100 text-orange-800 border border-orange-200'
                      : 'bg-gray-100 text-gray-600 border border-transparent hover:bg-gray-200'
                  }`}
                >
                  Order
                </button>
                <button
                  onClick={() => setActiveInput('phone')}
                  className={`px-2 py-1 sm:px-3 sm:py-1.5 rounded-full text-xs font-medium transition-colors ${
                    activeInput === 'phone'
                      ? 'bg-orange-100 text-orange-800 border border-orange-200'
                      : 'bg-gray-100 text-gray-600 border border-transparent hover:bg-gray-200'
                  }`}
                >
                  Phone
                </button>
              </div>
            )}

            {/* Keypad - Only show when not in email step */}
            {!showEmailStep && (
              <div className="bg-gray-50 rounded-lg p-2 sm:p-3">
                <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
                  {keypadNumbers.flat().map((number) => (
                    <Button
                      key={number}
                      variant="outline"
                      size="lg"
                      onClick={() => handleKeypadPress(number)}
                      className="h-9 sm:h-12 text-base sm:text-lg font-semibold bg-white hover:bg-orange-50 hover:border-orange-300 transition-all duration-200"
                      disabled={isSubmitting}
                    >
                      {number}
                    </Button>
                  ))}
                </div>
                
                {/* Keypad Action Buttons */}
                <div className="grid grid-cols-2 gap-1.5 sm:gap-2 mt-1.5 sm:mt-2">
                  <Button
                    variant="outline"
                    onClick={handleBackspace}
                    className="h-8 sm:h-10 bg-white hover:bg-red-50 hover:border-red-300 transition-all duration-200"
                    disabled={isSubmitting}
                  >
                    <Delete className="w-3 h-3 sm:w-4 sm:h-4" />
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handleClear}
                    className="h-8 sm:h-10 bg-white hover:bg-gray-100 transition-all duration-200 text-xs sm:text-sm"
                    disabled={isSubmitting}
                  >
                    Clear
                  </Button>
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex gap-2 sm:gap-3 pt-2 sm:pt-3">
              <Button
                variant="outline"
                onClick={handleClose}
                className="flex-1 h-9 sm:h-10"
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              
              {!showEmailStep ? (
                <Button
                  onClick={handleProceedToEmail}
                  disabled={!orderNumber.trim() || !phoneNumber.trim() || orderNumberExists || isCheckingOrderNumber}
                  className="flex-1 h-9 sm:h-10 beepbite-gradient text-white"
                >
                  {customerDetails?.email && email.trim() && email.includes('@') ? (
                    <span className="text-sm sm:text-base">Create Order</span>
                  ) : (
                    <div className="flex items-center">
                      <span className="text-sm sm:text-base mr-2">Next</span>
                      <Mail className="w-4 h-4" />
                    </div>
                  )}
                </Button>
              ) : (
                <Button
                  onClick={handleSubmit}
                  disabled={isSubmitting || orderNumberExists || isCheckingOrderNumber}
                  className="flex-1 h-9 sm:h-10 beepbite-gradient text-white"
                >
                  {isSubmitting ? (
                    <div className="flex items-center space-x-2">
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      <span className="text-sm sm:text-base">Creating...</span>
                    </div>
                  ) : (
                    <span className="text-sm sm:text-base">Create Order</span>
                  )}
                </Button>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default CreateBiteModal; 