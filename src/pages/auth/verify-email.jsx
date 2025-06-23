import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Mail, CheckCircle, AlertCircle } from 'lucide-react';
import Logo from '@/components/logo';
import { supabase } from '@/services/supabase-client';

const VerifyEmailPage = () => {
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const handleResendVerification = async () => {
    const email = localStorage.getItem('pendingVerificationEmail');
    
    if (!email) {
      setError('No email found. Please sign up again.');
      return;
    }

    setIsLoading(true);
    setError('');
    setMessage('');

    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: email,
        options: {
          emailRedirectTo: `${window.location.origin}/search`,
        }
      });

      if (error) throw error;
      
      setMessage('Verification email sent successfully! Please check your inbox.');
    } catch (error) {
      setError(error.message || 'Failed to resend verification email. Please try again.');
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
            <div className="flex items-center justify-center mb-4">
              <div className="rounded-full bg-blue-100 p-3">
                <Mail className="h-8 w-8 text-blue-600" />
              </div>
            </div>
            <CardTitle className="text-2xl font-serif font-semibold tracking-tight text-gray-900 text-center">
              Check your email
            </CardTitle>
            <CardDescription className="text-gray-600 font-medium text-center">
              We've sent a verification link to your email address
            </CardDescription>
          </CardHeader>
          <CardContent>
            {error && (
              <Alert variant="destructive" className="mb-6 border-l-4 border-red-500 bg-red-50">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription className="font-medium">{error}</AlertDescription>
              </Alert>
            )}

            {message && (
              <Alert className="mb-6 border-l-4 border-green-500 bg-green-50">
                <CheckCircle className="h-4 w-4 text-green-600" />
                <AlertDescription className="font-medium text-green-800">{message}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-6">
              <div className="text-center space-y-3">
                <p className="text-sm text-gray-600 leading-relaxed">
                  Please click the verification link in your email to activate your account. 
                  If you don't see the email, check your spam folder.
                </p>
              </div>

              <div className="space-y-4">
                <Button 
                  variant="outline" 
                  className="w-full flex items-center justify-center gap-2 h-12 border-gray-200 bg-white hover:bg-gray-50 transition-colors duration-200 font-medium"
                  onClick={handleResendVerification}
                  disabled={isLoading}
                >
                  <Mail className="h-4 w-4" />
                  {isLoading ? 'Sending...' : 'Resend verification email'}
                </Button>

                <Button 
                  className="w-full h-11 bg-gray-900 hover:bg-gray-800 text-white font-medium tracking-wide transition-colors duration-200"
                  onClick={() => navigate('/signin')}
                  disabled={isLoading}
                >
                  Back to sign in
                </Button>
              </div>

              <div className="text-center pt-2">
                <span className="text-sm text-gray-600 font-medium">Need help?{' '}</span>
                <Button
                  variant="link"
                  className="text-gray-900 hover:text-gray-700 p-0 h-auto font-medium"
                  onClick={() => navigate('/docs/contact')}
                  disabled={isLoading}
                >
                  Contact support
                </Button>
              </div>
            </div>
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

export default VerifyEmailPage; 