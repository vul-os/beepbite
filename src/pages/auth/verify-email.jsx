import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Mail, RefreshCw, Utensils } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import Logo from '@/components/ui/logo';

const VerifyEmailPage = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [isResending, setIsResending] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [successMessage, setSuccessMessage] = useState('');

  useEffect(() => {
    // Get email from localStorage (set during signup)
    const pendingEmail = localStorage.getItem('pendingVerificationEmail');
    if (pendingEmail) {
      setEmail(pendingEmail);
    } else {
      // If no email found, redirect to signup
      navigate('/signup');
    }
  }, [navigate]);

  useEffect(() => {
    let timer;
    if (resendCooldown > 0) {
      timer = setTimeout(() => setResendCooldown(resendCooldown - 1), 1000);
    }
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  const handleResendEmail = async () => {
    setIsResending(true);
    setSuccessMessage('');
    
    try {
      // Here you would typically make an API call to resend verification email
      await new Promise(resolve => setTimeout(resolve, 1000)); // Simulate API call
      
      setSuccessMessage('Verification email sent successfully!');
      setResendCooldown(60); // 60 second cooldown
    } catch (error) {
      console.error('Failed to resend verification email:', error);
    } finally {
      setIsResending(false);
    }
  };

  const handleChangeEmail = () => {
    localStorage.removeItem('pendingVerificationEmail');
    localStorage.removeItem('pendingUserData');
    navigate('/signup');
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-white to-slate-100 px-4 py-8 relative overflow-hidden">
      {/* Background decorations - more subtle */}
      <div className="absolute inset-0 bg-grid-pattern opacity-3"></div>
      <div className="absolute top-10 left-10 w-20 h-20 bg-primary/5 rounded-full opacity-50"></div>
      <div className="absolute bottom-10 right-10 w-16 h-16 bg-primary/5 rounded-full opacity-50"></div>
      <div className="absolute top-1/2 right-20 w-12 h-12 bg-primary/10 rounded-full opacity-30"></div>
      
      <div className="w-full max-w-lg space-y-6 relative z-10">
        {/* Logo/Brand */}
        <div className="flex justify-center mb-4">
          <Logo />
        </div>

        <Card className="border border-gray-200 shadow-xl bg-white/95 backdrop-blur-sm">
          <CardHeader className="space-y-3 pb-6 text-center">
            <div className="mx-auto w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center">
              <Mail className="w-8 h-8 text-primary" />
            </div>
            <CardTitle className="text-2xl font-bold tracking-tight text-gray-900">
              Check Your Email
            </CardTitle>
            <CardDescription className="text-sm text-gray-600">
              We've sent a verification link to your restaurant email address
            </CardDescription>
          </CardHeader>
          <CardContent className="px-6 pb-6">
            <div className="space-y-5">
              {successMessage && (
                <Alert className="border-l-4 border-green-500 bg-green-50/80">
                  <Mail className="h-4 w-4 text-green-600" />
                  <AlertDescription className="text-sm text-green-800">
                    {successMessage}
                  </AlertDescription>
                </Alert>
              )}

              <div className="rounded-lg bg-blue-50/80 p-4 border border-blue-200/60">
                <div className="flex">
                  <div className="flex-shrink-0">
                    <Mail className="h-5 w-5 text-blue-500" />
                  </div>
                  <div className="ml-3">
                    <h3 className="text-sm font-medium text-blue-900">Verification email sent</h3>
                    <div className="mt-2 text-sm text-blue-800">
                      <p>
                        We've sent a verification link to{' '}
                        <span className="font-medium text-blue-900">{email}</span>. Click the link in the email to verify your restaurant account.
                      </p>
                      <p className="mt-2">
                        <strong>Can't find the email?</strong> Check your spam folder or try resending it.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <Button 
                  onClick={handleResendEmail}
                  disabled={isResending || resendCooldown > 0}
                  className="w-full h-11 bg-primary hover:bg-primary/90 text-white font-medium shadow-lg hover:shadow-xl transition-all duration-300"
                >
                  {isResending ? (
                    <div className="flex items-center space-x-2">
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Sending...</span>
                    </div>
                  ) : resendCooldown > 0 ? (
                    `Resend in ${resendCooldown}s`
                  ) : (
                    <div className="flex items-center space-x-2">
                      <RefreshCw className="w-4 h-4" />
                      <span>Resend Verification Email</span>
                    </div>
                  )}
                </Button>
                
                <Button
                  variant="outline"
                  onClick={handleChangeEmail}
                  className="w-full h-11 border-gray-300 hover:bg-gray-50 font-medium"
                >
                  Use Different Email
                </Button>
                
                <Button
                  variant="ghost"
                  onClick={() => navigate('/signin')}
                  className="w-full h-11 text-gray-600 hover:text-gray-900 hover:bg-gray-50 font-medium"
                >
                  Back to Sign In
                </Button>
              </div>

              <div className="text-center pt-2">
                <p className="text-sm text-gray-600">
                  After clicking the verification link, you'll be able to access your BeepBite restaurant dashboard.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Features preview - more compact */}
        <div className="text-center space-y-3">
          <div className="flex items-center justify-center space-x-6 text-sm text-gray-600">
            <div className="flex items-center space-x-2">
              <Utensils className="w-4 h-4 text-primary" />
              <span>Restaurant Dashboard Awaits</span>
            </div>
          </div>
          <p className="text-xs text-gray-500">
            © {new Date().getFullYear()} BeepBite. Streamlining restaurant operations worldwide.
          </p>
        </div>
      </div>
    </div>
  );
};

export default VerifyEmailPage; 