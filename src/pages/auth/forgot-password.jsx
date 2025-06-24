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
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-orange-50 via-white to-orange-100 px-4 py-6 sm:py-12 relative overflow-hidden">
      {/* Background decorations */}
      <div className="absolute inset-0 bg-grid-pattern opacity-5"></div>
      <div className="absolute top-20 left-20 w-32 h-32 beepbite-gradient rounded-full opacity-10 animate-pulse"></div>
      <div className="absolute bottom-20 right-20 w-24 h-24 bg-secondary rounded-full opacity-10"></div>
      <div className="absolute top-1/2 left-10 w-16 h-16 beepbite-gradient rounded-full opacity-20"></div>
      
      <div className="w-full max-w-md space-y-6 sm:space-y-8 relative z-10">
        {/* Logo/Brand */}
        <Logo />

        <Card className="border-0 shadow-2xl glass-effect">
          <CardHeader className="space-y-1 pb-8">
            <Button 
              variant="ghost" 
              className="w-fit -ml-2 mb-2 text-muted-foreground hover:text-foreground hover:bg-muted/50"
              onClick={() => navigate(-1)}
            >
              <ChevronLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
            <CardTitle className="text-2xl font-bold tracking-tight text-foreground">
              Reset Your Password
            </CardTitle>
            <CardDescription className="text-muted-foreground font-medium">
              Enter your restaurant email to receive a password reset link
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
                      <Mail className="absolute left-3 top-3 h-5 w-5 text-muted-foreground" />
                      <Input
                        type="email"
                        placeholder="Enter your restaurant email"
                        className={`pl-10 h-11 bg-white border-border focus:border-primary focus:ring-primary transition-all duration-200 ${error ? "border-red-500" : ""}`}
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
                    className="w-full h-11 beepbite-gradient text-white font-medium hover:shadow-lg transition-all duration-300"
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
                  <span className="text-sm text-muted-foreground">Remember your password?{' '}</span>
                  <Button
                    variant="link"
                    className="text-primary hover:text-primary/80 p-0 h-auto font-medium"
                    onClick={() => navigate('/signin')}
                    disabled={isLoading}
                  >
                    Sign in to dashboard
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
                          The link will expire in 1 hour. Check your spam folder if you don't see it.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
                
                <div className="space-y-3">
                  <Button 
                    className="w-full h-11 beepbite-gradient text-white font-medium hover:shadow-lg transition-all duration-300"
                    onClick={() => setIsSubmitted(false)}
                  >
                    Try Another Email
                  </Button>
                  <Button
                    variant="outline"
                    className="w-full h-11 border-border hover:bg-muted/50 font-medium"
                    onClick={() => navigate('/signin')}
                  >
                    Back to Sign In
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Features preview */}
        <div className="text-center space-y-4">
          <div className="flex items-center justify-center space-x-6 text-sm text-muted-foreground">
            <div className="flex items-center space-x-2">
              <Utensils className="w-4 h-4 text-primary" />
              <span>Restaurant Management</span>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            © {new Date().getFullYear()} BeepBite. Streamlining restaurant operations worldwide.
          </p>
        </div>
      </div>
    </div>
  );
};

export default ForgotPasswordPage;