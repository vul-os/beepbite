import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/auth-context';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from '@/hooks/use-toast';
import { Loader2, AlertCircle, Lock } from "lucide-react";
import Logo from '@/components/logo';

const MINIMUM_PASSWORD_LENGTH = 8;

const UpdatePassword = () => {
  const { updateUserPassword } = useAuth();
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [validationError, setValidationError] = useState('');
  const navigate = useNavigate();
  const { toast } = useToast();

  const validatePassword = (password) => {
    if (password.length < MINIMUM_PASSWORD_LENGTH) {
      return `Password must be at least ${MINIMUM_PASSWORD_LENGTH} characters long`;
    }
    if (!/[A-Z]/.test(password)) {
      return 'Password must contain at least one uppercase letter';
    }
    if (!/[a-z]/.test(password)) {
      return 'Password must contain at least one lowercase letter';
    }
    if (!/[0-9]/.test(password)) {
      return 'Password must contain at least one number';
    }
    if (!/[^A-Za-z0-9]/.test(password)) {
      return 'Password must contain at least one special character';
    }
    return '';
  };

  const handlePasswordChange = (e) => {
    const password = e.target.value;
    setNewPassword(password);
    setValidationError(validatePassword(password));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    
    // Clear any existing validation errors
    setValidationError('');

    // Validate password
    const passwordError = validatePassword(newPassword);
    if (passwordError) {
      setValidationError(passwordError);
      return;
    }

    // Check if passwords match
    if (newPassword !== confirmNewPassword) {
      setValidationError('New password and confirmation do not match');
      return;
    }

    setIsLoading(true);
    try {
      const { error } = await updateUserPassword(newPassword);
      
      if (error) throw error;

      toast({
        title: "Success",
        description: "Your password has been successfully updated.",
        duration: 5000,
      });

      // Redirect to login after successful password update
      setTimeout(() => navigate('/signin'), 1500);
    } catch (error) {
      toast({
        title: "Update Failed",
        description: error.message || "Failed to update password. Please try again.",
        variant: "destructive",
        duration: 5000,
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-gray-50 to-gray-100 px-4 py-6 sm:py-12">
      <div className="w-full max-w-md space-y-6 sm:space-y-8">
        {/* Logo/Brand */}
        <Logo />

        <Card className="border-none shadow-lg bg-white/80 backdrop-blur-sm">
          <CardHeader className="space-y-1 pb-8">
            <CardTitle className="text-2xl font-serif font-semibold tracking-tight text-gray-900">
              Update your password
            </CardTitle>
            <CardDescription className="text-gray-600 font-medium">
            Choose a strong password that meets all the requirements below
          </CardDescription>
        </CardHeader>
        <CardContent>
            <form onSubmit={handleSubmit} className="space-y-5">
            {validationError && (
                <Alert variant="destructive" className="border-l-4 border-red-500 bg-red-50">
                <AlertCircle className="h-4 w-4" />
                  <AlertDescription className="font-medium">{validationError}</AlertDescription>
              </Alert>
            )}
            
            <div className="space-y-2">
                <label htmlFor="newPassword" className="text-sm font-medium text-gray-700 tracking-wide">
                New Password
              </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-3 h-5 w-5 text-gray-400" />
              <Input
                id="newPassword"
                type="password"
                value={newPassword}
                onChange={handlePasswordChange}
                disabled={isLoading}
                required
                    className="pl-10 h-11 bg-white border-gray-200 focus:border-gray-900 focus:ring-gray-900"
                placeholder="Enter your new password"
              />
                </div>
            </div>

            <div className="space-y-2">
                <label htmlFor="confirmNewPassword" className="text-sm font-medium text-gray-700 tracking-wide">
                Confirm New Password
              </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-3 h-5 w-5 text-gray-400" />
              <Input
                id="confirmNewPassword"
                type="password"
                value={confirmNewPassword}
                onChange={(e) => setConfirmNewPassword(e.target.value)}
                disabled={isLoading}
                required
                    className="pl-10 h-11 bg-white border-gray-200 focus:border-gray-900 focus:ring-gray-900"
                placeholder="Confirm your new password"
              />
                </div>
            </div>

              <div className="rounded-lg bg-gray-50 p-4 border border-gray-200">
                <p className="text-sm font-medium text-gray-700 mb-2">Password requirements:</p>
                <ul className="text-sm text-gray-600 space-y-1.5">
                  <li className="flex items-center gap-2">
                    <svg className={`h-4 w-4 ${newPassword.length >= MINIMUM_PASSWORD_LENGTH ? 'text-green-500' : 'text-gray-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={newPassword.length >= MINIMUM_PASSWORD_LENGTH ? "M5 13l4 4L19 7" : "M6 18L18 6M6 6l12 12"} />
                    </svg>
                    At least {MINIMUM_PASSWORD_LENGTH} characters long
                  </li>
                  <li className="flex items-center gap-2">
                    <svg className={`h-4 w-4 ${/[A-Z]/.test(newPassword) ? 'text-green-500' : 'text-gray-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={/[A-Z]/.test(newPassword) ? "M5 13l4 4L19 7" : "M6 18L18 6M6 6l12 12"} />
                    </svg>
                    One uppercase letter
                  </li>
                  <li className="flex items-center gap-2">
                    <svg className={`h-4 w-4 ${/[a-z]/.test(newPassword) ? 'text-green-500' : 'text-gray-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={/[a-z]/.test(newPassword) ? "M5 13l4 4L19 7" : "M6 18L18 6M6 6l12 12"} />
                    </svg>
                    One lowercase letter
                  </li>
                  <li className="flex items-center gap-2">
                    <svg className={`h-4 w-4 ${/[0-9]/.test(newPassword) ? 'text-green-500' : 'text-gray-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={/[0-9]/.test(newPassword) ? "M5 13l4 4L19 7" : "M6 18L18 6M6 6l12 12"} />
                    </svg>
                    One number
                  </li>
                  <li className="flex items-center gap-2">
                    <svg className={`h-4 w-4 ${/[^A-Za-z0-9]/.test(newPassword) ? 'text-green-500' : 'text-gray-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={/[^A-Za-z0-9]/.test(newPassword) ? "M5 13l4 4L19 7" : "M6 18L18 6M6 6l12 12"} />
                    </svg>
                    One special character
                  </li>
              </ul>
            </div>

            <Button 
              type="submit" 
                className="w-full h-11 bg-gray-900 hover:bg-gray-800 text-white font-medium tracking-wide transition-colors duration-200"
              disabled={isLoading || !!validationError}
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Updating password...
                </>
              ) : (
                  'Update password'
              )}
            </Button>

            <Button 
              variant="outline" 
                className="w-full h-11 border-gray-200 hover:bg-gray-50 font-medium"
              onClick={() => navigate('/signin')}
              disabled={isLoading}
              type="button"
            >
                Back to sign in
            </Button>
          </form>
        </CardContent>
      </Card>

        {/* Footer */}
        <div className="text-center text-sm text-gray-500 font-medium tracking-wide">
          © {new Date().getFullYear()} CaseOn. All rights reserved.
        </div>
      </div>
    </div>
  );
};

export default UpdatePassword;