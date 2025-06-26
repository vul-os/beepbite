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
  CheckCircle 
} from 'lucide-react';
import { supabase } from '@/services/supabase-client';
import { useAuth } from '@/context/auth-context';

const CreateBiteModal = ({ isOpen, onClose, onBiteCreated }) => {
  const { user } = useAuth();
  const [orderNumber, setOrderNumber] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [activeInput, setActiveInput] = useState('order'); // 'order' or 'phone'
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [currentBistro, setCurrentBistro] = useState(null);

  // Fetch current user's bistro
  useEffect(() => {
    const fetchCurrentBistro = async () => {
      if (!user) return;

      try {
        const { data, error } = await supabase
          .from('bistro_members')
          .select(`
            bistro_id,
            role,
            bistros (
              id,
              name
            )
          `)
          .eq('profile_id', user.id)
          .single();

        if (error) throw error;
        setCurrentBistro(data.bistros);
      } catch (error) {
        console.error('Error fetching bistro:', error);
        setError('Unable to load restaurant information');
      }
    };

    if (isOpen) {
      fetchCurrentBistro();
    }
  }, [user, isOpen]);

  // Keypad numbers and special keys
  const keypadNumbers = [
    ['1', '2', '3'],
    ['4', '5', '6'], 
    ['7', '8', '9'],
    ['*', '0', '#']
  ];

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
    if (!currentBistro) {
      setError('No restaurant found for your account');
      return false;
    }
    if (!orderNumber.trim()) {
      setError('Order number is required');
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
      // Check if order number already exists for this bistro
      const { data: existingOrder, error: checkError } = await supabase
        .from('bites')
        .select('id')
        .eq('bistro_id', currentBistro.id)
        .eq('order_number', orderNumber.trim())
        .single();

      if (checkError && checkError.code !== 'PGRST116') { // PGRST116 is "no rows returned"
        throw checkError;
      }

      if (existingOrder) {
        setError('An order with this number already exists');
        setIsSubmitting(false);
        return;
      }

      // Create the bite using SQL function (handles customer creation automatically)
      // Use original phone number to preserve format for consent tracking
      const { data, error: supabaseError } = await supabase
        .rpc('create_bite_with_customer', {
          p_bistro_id: currentBistro.id,
          p_order_number: orderNumber.trim(),
          p_original_number: phoneNumber.trim(),
          p_customer_display_name: null, // Could add a customer name field later
          p_status: 'pending'
        });

      if (supabaseError) throw supabaseError;
      
      setSuccess(true);
      
      // Reset form after short delay
      setTimeout(() => {
        setOrderNumber('');
        setPhoneNumber('');
        setActiveInput('order');
        setSuccess(false);
        onClose();
        onBiteCreated?.();
      }, 1500);
      
    } catch (error) {
      console.error('Error creating bite:', error);
      setError(error.message || 'Failed to create order. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    if (!isSubmitting) {
      setOrderNumber('');
      setPhoneNumber('');
      setActiveInput('order');
      setError('');
      setSuccess(false);
      onClose();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="w-[95vw] max-w-lg mx-auto max-h-[95vh] overflow-y-auto">
        <DialogHeader className="pb-4">
          <DialogTitle className="text-center text-xl sm:text-2xl font-bold">
            Create New Bite
          </DialogTitle>
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
          <div className="space-y-4 sm:space-y-6">
            {/* Error Alert */}
            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription className="text-sm">{error}</AlertDescription>
              </Alert>
            )}

            {/* Input Fields */}
            <div className="space-y-3 sm:space-y-4">
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
                    className={`pl-9 sm:pl-10 h-10 sm:h-12 text-base sm:text-lg ${
                      activeInput === 'order' ? 'ring-2 ring-orange-500 border-orange-500' : ''
                    }`}
                  />
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
                    className={`pl-9 sm:pl-10 h-10 sm:h-12 text-base sm:text-lg ${
                      activeInput === 'phone' ? 'ring-2 ring-orange-500 border-orange-500' : ''
                    }`}
                  />
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  Use keyboard or press * on keypad for + symbol (international numbers)
                </p>
              </div>
            </div>

            {/* Active Input Indicator */}
            <div className="flex items-center justify-center space-x-2 sm:space-x-4 py-2">
              <button
                onClick={() => setActiveInput('order')}
                className={`px-3 py-1.5 sm:px-4 sm:py-2 rounded-full text-xs sm:text-sm font-medium transition-colors ${
                  activeInput === 'order'
                    ? 'bg-orange-100 text-orange-800 border-2 border-orange-200'
                    : 'bg-gray-100 text-gray-600 border-2 border-transparent hover:bg-gray-200'
                }`}
              >
                Order Number
              </button>
              <button
                onClick={() => setActiveInput('phone')}
                className={`px-3 py-1.5 sm:px-4 sm:py-2 rounded-full text-xs sm:text-sm font-medium transition-colors ${
                  activeInput === 'phone'
                    ? 'bg-orange-100 text-orange-800 border-2 border-orange-200'
                    : 'bg-gray-100 text-gray-600 border-2 border-transparent hover:bg-gray-200'
                }`}
              >
                Phone Number
              </button>
            </div>

            {/* Keypad */}
            <div className="bg-gray-50 rounded-lg p-3 sm:p-4">
              <div className="grid grid-cols-3 gap-2 sm:gap-3">
                {keypadNumbers.flat().map((number) => (
                  <Button
                    key={number}
                    variant="outline"
                    size="lg"
                    onClick={() => handleKeypadPress(number)}
                    className="h-10 sm:h-14 text-lg sm:text-xl font-semibold bg-white hover:bg-orange-50 hover:border-orange-300 transition-all duration-200"
                    disabled={isSubmitting}
                  >
                    {number}
                  </Button>
                ))}
              </div>
              
              {/* Keypad Action Buttons */}
              <div className="grid grid-cols-2 gap-2 sm:gap-3 mt-2 sm:mt-3">
                <Button
                  variant="outline"
                  onClick={handleBackspace}
                  className="h-10 sm:h-12 bg-white hover:bg-red-50 hover:border-red-300 transition-all duration-200"
                  disabled={isSubmitting}
                >
                  <Delete className="w-4 h-4 sm:w-5 sm:h-5" />
                </Button>
                <Button
                  variant="outline"
                  onClick={handleClear}
                  className="h-10 sm:h-12 bg-white hover:bg-gray-100 transition-all duration-200 text-sm sm:text-base"
                  disabled={isSubmitting}
                >
                  Clear
                </Button>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-2 sm:gap-3 pt-2 sm:pt-4">
              <Button
                variant="outline"
                onClick={handleClose}
                className="flex-1 h-10 sm:h-11"
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={isSubmitting || !orderNumber.trim() || !phoneNumber.trim()}
                className="flex-1 h-10 sm:h-11 beepbite-gradient text-white"
              >
                {isSubmitting ? (
                  <div className="flex items-center space-x-2">
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    <span className="text-sm sm:text-base">Creating...</span>
                  </div>
                ) : (
                  <span className="text-sm sm:text-base">Create Bite</span>
                )}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default CreateBiteModal; 