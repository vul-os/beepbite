import React, { useState } from 'react';
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

const CreateBiteModal = ({ isOpen, onClose, onBiteCreated }) => {
  const [orderNumber, setOrderNumber] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [activeInput, setActiveInput] = useState('order'); // 'order' or 'phone'
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

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

  const handleSubmit = async () => {
    setError('');
    
    if (!validateForm()) {
      return;
    }

    setIsSubmitting(true);
    
    try {
      // TODO: Replace with actual Supabase call
      // const { data, error: supabaseError } = await supabase
      //   .from('bites')
      //   .insert([
      //     {
      //       order_number: orderNumber.trim(),
      //       whatsapp_number: phoneNumber.trim(),
      //       status: 'pending'
      //     }
      //   ]);

      // if (supabaseError) throw supabaseError;

      // Simulate API call for now
      await new Promise(resolve => setTimeout(resolve, 1000));
      
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
      <DialogContent className="max-w-md mx-auto">
        <DialogHeader>
          <DialogTitle className="text-center text-2xl font-bold">
            Create New Bite
          </DialogTitle>
        </DialogHeader>

        {success ? (
          <div className="py-8 text-center">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle className="w-8 h-8 text-green-600" />
            </div>
            <h3 className="text-lg font-semibold text-green-600 mb-2">Order Created!</h3>
            <p className="text-gray-600">Order #{orderNumber} has been added to your dashboard.</p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Error Alert */}
            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {/* Input Fields */}
            <div className="space-y-4">
              <div>
                <Label htmlFor="orderNumber" className="text-sm font-medium">
                  Order Number
                </Label>
                <div className="relative mt-1">
                  <Hash className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                  <Input
                    id="orderNumber"
                    value={orderNumber}
                    onChange={(e) => setOrderNumber(e.target.value)}
                    onFocus={() => setActiveInput('order')}
                    placeholder="Enter order number"
                    className={`pl-10 h-12 text-lg ${
                      activeInput === 'order' ? 'ring-2 ring-orange-500 border-orange-500' : ''
                    }`}
                    readOnly
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="phoneNumber" className="text-sm font-medium">
                  Customer WhatsApp Number
                </Label>
                <div className="relative mt-1">
                  <Phone className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                  <Input
                    id="phoneNumber"
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    onFocus={() => setActiveInput('phone')}
                    placeholder="Enter phone number"
                    className={`pl-10 h-12 text-lg ${
                      activeInput === 'phone' ? 'ring-2 ring-orange-500 border-orange-500' : ''
                    }`}
                    readOnly
                  />
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  Press * for + symbol (international numbers)
                </p>
              </div>
            </div>

            {/* Active Input Indicator */}
            <div className="flex items-center justify-center space-x-4 py-2">
              <button
                onClick={() => setActiveInput('order')}
                className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                  activeInput === 'order'
                    ? 'bg-orange-100 text-orange-800 border-2 border-orange-200'
                    : 'bg-gray-100 text-gray-600 border-2 border-transparent hover:bg-gray-200'
                }`}
              >
                Order Number
              </button>
              <button
                onClick={() => setActiveInput('phone')}
                className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                  activeInput === 'phone'
                    ? 'bg-orange-100 text-orange-800 border-2 border-orange-200'
                    : 'bg-gray-100 text-gray-600 border-2 border-transparent hover:bg-gray-200'
                }`}
              >
                Phone Number
              </button>
            </div>

            {/* Keypad */}
            <div className="bg-gray-50 rounded-lg p-4">
              <div className="grid grid-cols-3 gap-3">
                {keypadNumbers.flat().map((number) => (
                  <Button
                    key={number}
                    variant="outline"
                    size="lg"
                    onClick={() => handleKeypadPress(number)}
                    className="h-14 text-xl font-semibold bg-white hover:bg-orange-50 hover:border-orange-300 transition-all duration-200"
                    disabled={isSubmitting}
                  >
                    {number}
                  </Button>
                ))}
              </div>
              
              {/* Keypad Action Buttons */}
              <div className="grid grid-cols-2 gap-3 mt-3">
                <Button
                  variant="outline"
                  onClick={handleBackspace}
                  className="h-12 bg-white hover:bg-red-50 hover:border-red-300 transition-all duration-200"
                  disabled={isSubmitting}
                >
                  <Delete className="w-5 h-5" />
                </Button>
                <Button
                  variant="outline"
                  onClick={handleClear}
                  className="h-12 bg-white hover:bg-gray-100 transition-all duration-200"
                  disabled={isSubmitting}
                >
                  Clear
                </Button>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3 pt-4">
              <Button
                variant="outline"
                onClick={handleClose}
                className="flex-1"
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={isSubmitting || !orderNumber.trim() || !phoneNumber.trim()}
                className="flex-1 beepbite-gradient text-white"
              >
                {isSubmitting ? (
                  <div className="flex items-center space-x-2">
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    <span>Creating...</span>
                  </div>
                ) : (
                  'Create Bite'
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