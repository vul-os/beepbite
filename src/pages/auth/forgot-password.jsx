import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ChevronLeft, Mail, AlertCircle, Utensils } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import Logo from '@/components/ui/logo';

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
    <div className="h-screen flex flex-col justify-center bg-gradient-to-br from-slate-50 via-white to-slate-100 px-4 py-4 relative overflow-hidden">
      {/* Background decorations - mobile optimized */}
      <div className="absolute inset-0 bg-grid-pattern opacity-3"></div>
      <div className="absolute top-10 left-10 w-12 sm:w-20 h-12 sm:h-20 bg-primary/5 rounded-full opacity-50"></div>
      <div className="absolute bottom-10 right-10 w-10 sm:w-16 h-10 sm:h-16 bg-primary/5 rounded-full opacity-50"></div>
      <div className="absolute top-1/2 left-20 w-8 sm:w-12 h-8 sm:h-12 bg-primary/10 rounded-full opacity-30"></div>
      
      <div className="w-full max-w-sm mx-auto space-y-4 relative z-10">
        {/* Mobile-optimized Logo */}
        <div className="flex justify-center mb-2">
          <div className="text-center">
            <div className="flex justify-center items-center mb-2">
              <div className="w-12 sm:w-16 h-12 sm:h-16 beepbite-gradient rounded-xl sm:rounded-2xl flex items-center justify-center shadow-lg border-2 sm:border-4 border-white">
                <img 
                  src="/icon.svg" 
                  alt="BeepBite" 
                  className="w-6 sm:w-10 h-6 sm:h-10 filter brightness-0 invert"
                />
                <div className="absolute -top-0.5 sm:-top-1 -right-0.5 sm:-right-1 w-3 sm:w-4 h-3 sm:h-4 bg-red-500 rounded-full animate-pulse shadow-lg"></div>
              </div>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
              <span className="beepbite-gradient-text">Beep</span>
              <span className="text-gray-900">Bite</span>
            </h1>
            <p className="text-xs sm:text-sm text-gray-600 font-medium">Restaurant Management</p>
          </div>
        </div>

        <Card className="border border-gray-200 shadow-xl bg-white/95 backdrop-blur-sm">
          <CardHeader className="space-y-1 pb-4 px-4 pt-4">
            <Button 
              variant="ghost" 
              className="w-fit -ml-2 mb-2 text-gray-600 hover:text-gray-900 hover:bg-gray-50"
              onClick={() => navigate(-1)}
            >
              <ChevronLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
            <CardTitle className="text-xl sm:text-2xl font-bold tracking-tight text-gray-900">
              Reset Your Password
            </CardTitle>
            <CardDescription className="text-sm text-gray-600">
              Enter your restaurant email to receive a password reset link
            </CardDescription>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {!isSubmitted ? (
              <div className="space-y-4">
                {error && (
                  <Alert variant="destructive" className="border-l-4 border-red-500 bg-red-50/80">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription className="text-sm">{error}</AlertDescription>
                  </Alert>
                )}

                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="space-y-1.5">
                    <div className="relative">
                      <Mail className="absolute left-3 top-3.5 h-4 w-4 text-gray-400" />
                      <Input
                        type="email"
                        placeholder="your.email@restaurant.com"
                        className={`pl-10 h-11 bg-white border-gray-300 focus:border-primary focus:ring-1 focus:ring-primary transition-all duration-200 text-base ${error ? "border-red-400" : ""}`}
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
                    className="w-full h-11 bg-primary hover:bg-primary/90 text-white font-medium shadow-lg hover:shadow-xl transition-all duration-300 text-base"
                    disabled={isLoading}
                  >
                    {isLoading ? (
                      <div className="flex items-center space-x-2">
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                        <span>Sending reset link...</span>
                      </div>
                    ) : (
                      'Send Reset Link'
                    )}
                  </Button>
                </form>

                <div className="text-center pt-2">
                  <span className="text-sm text-gray-600">Remember your password?{' '}</span>
                  <Button
                    variant="link"
                    className="text-primary hover:text-primary/80 p-0 h-auto font-medium underline text-sm"
                    onClick={() => navigate('/signin')}
                    disabled={isLoading}
                  >
                    Sign in
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="rounded-lg bg-green-50/80 p-4 border border-green-200/60">
                  <div className="flex">
                    <div className="flex-shrink-0">
                      <svg className="h-5 w-5 text-green-500" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                      </svg>
                    </div>
                    <div className="ml-3">
                      <h3 className="text-sm font-medium text-green-900">Check your email</h3>
                      <div className="mt-2 text-sm text-green-800">
                        <p>
                          We've sent a password reset link to <span className="font-medium text-green-900">{email}</span>. 
                          The link will expire in 1 hour. Check your spam folder if you don't see it.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
                
                <div className="space-y-3">
                  <Button 
                    className="w-full h-11 bg-primary hover:bg-primary/90 text-white font-medium shadow-lg hover:shadow-xl transition-all duration-300"
                    onClick={() => setIsSubmitted(false)}
                  >
                    Try Another Email
                  </Button>
                  <Button
                    variant="outline"
                    className="w-full h-11 border-gray-300 hover:bg-gray-50 font-medium"
                    onClick={() => navigate('/signin')}
                  >
                    Back to Sign In
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Mobile-optimized footer */}
        <div className="text-center space-y-2">
          <div className="flex items-center justify-center space-x-4 text-xs text-gray-600">
            <div className="flex items-center space-x-1.5">
              <Utensils className="w-3 h-3 text-primary" />
              <span>Restaurant Management</span>
            </div>
          </div>
          <p className="text-xs text-gray-500">
            © {new Date().getFullYear()} BeepBite
          </p>
        </div>
      </div>
    </div>
  );
};

export default ForgotPasswordPage;