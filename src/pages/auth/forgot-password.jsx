import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ChevronLeft, Mail, AlertCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import Logo from '@/components/logo';

const ForgotPasswordPage = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const validateEmail = (email) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!email.trim()) {
      setError('Email is required');
      return;
    }

    if (!validateEmail(email)) {
      setError('Please enter a valid email address');
      return;
    }

    setIsLoading(true);
    try {
      // Here you would typically make an API call to handle password reset
      await new Promise(resolve => setTimeout(resolve, 1000)); // Simulate API call
      console.log('Password reset requested for:', email);
      setIsSubmitted(true);
    } catch (err) {
      setError('Failed to send reset link. Please try again.');
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
            <Button 
              variant="ghost" 
              className="w-fit -ml-2 mb-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100"
              onClick={() => navigate(-1)}
            >
              <ChevronLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
            <CardTitle className="text-2xl font-serif font-semibold tracking-tight text-gray-900">
              Reset your password
            </CardTitle>
            <CardDescription className="text-gray-600 font-medium">
              Enter your email to receive a password reset link
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!isSubmitted ? (
              <div className="space-y-6">
                {error && (
                  <Alert variant="destructive" className="border-l-4 border-red-500 bg-red-50">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription className="font-medium">{error}</AlertDescription>
                  </Alert>
                )}

                <form onSubmit={handleSubmit} className="space-y-5">
                  <div className="space-y-2">
                    <div className="relative">
                      <Mail className="absolute left-3 top-3 h-5 w-5 text-gray-400" />
                      <Input
                        type="email"
                        placeholder="Enter your email"
                        className={`pl-10 h-11 bg-white border-gray-200 focus:border-gray-900 focus:ring-gray-900 ${error ? "border-red-500" : ""}`}
                        value={email}
                        onChange={(e) => {
                          setEmail(e.target.value);
                          if (error) setError('');
                        }}
                        disabled={isLoading}
                      />
                    </div>
                  </div>

                  <Button 
                    type="submit" 
                    className="w-full h-11 bg-gray-900 hover:bg-gray-800 text-white font-medium tracking-wide transition-colors duration-200"
                    disabled={isLoading}
                  >
                    {isLoading ? 'Sending reset link...' : 'Send reset link'}
                  </Button>
                </form>

                <div className="text-center pt-2">
                  <span className="text-sm text-gray-600 font-medium">Remember your password?{' '}</span>
                  <Button
                    variant="link"
                    className="text-gray-900 hover:text-gray-700 p-0 h-auto font-medium"
                    onClick={() => navigate('/signin')}
                    disabled={isLoading}
                  >
                    Sign in
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-6">
                <div className="rounded-lg bg-green-50 p-4 border border-green-200">
                  <div className="flex">
                    <div className="flex-shrink-0">
                      <svg className="h-5 w-5 text-green-400" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                      </svg>
                    </div>
                    <div className="ml-3">
                      <h3 className="text-sm font-medium text-green-800">Check your email</h3>
                      <div className="mt-2 text-sm text-green-700">
                        <p>
                          We've sent a password reset link to <span className="font-medium">{email}</span>. 
                          The link will expire in 1 hour.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
                
                <div className="space-y-3">
                  <Button 
                    className="w-full h-11 bg-gray-900 hover:bg-gray-800 text-white font-medium tracking-wide transition-colors duration-200"
                    onClick={() => setIsSubmitted(false)}
                  >
                    Try another email
                  </Button>
                  <Button
                    variant="outline"
                    className="w-full h-11 border-gray-200 hover:bg-gray-50 font-medium"
                    onClick={() => navigate('/signin')}
                  >
                    Back to sign in
                  </Button>
                </div>
              </div>
            )}
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

export default ForgotPasswordPage;