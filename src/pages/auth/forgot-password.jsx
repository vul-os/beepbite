import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ChevronLeft, Mail, AlertCircle, CheckCircle2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/api-client';

const ForgotPasswordPage = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const validateEmail = (val) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val);

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
      // Always returns 200 — backend never reveals whether email exists.
      await api.request('POST', '/auth/password/forgot', {
        auth: false,
        body: { email },
      });
      setIsSubmitted(true);
    } catch (err) {
      setError('Failed to send reset link. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col justify-center bg-gradient-to-br from-slate-50 via-white to-orange-50 px-4 py-8 relative overflow-hidden">
      {/* Subtle background blobs */}
      <div aria-hidden="true" className="absolute top-0 left-0 w-64 h-64 bg-orange-100 rounded-full opacity-30 -translate-x-1/2 -translate-y-1/2 pointer-events-none" />
      <div aria-hidden="true" className="absolute bottom-0 right-0 w-80 h-80 bg-orange-50 rounded-full opacity-40 translate-x-1/3 translate-y-1/3 pointer-events-none" />

      <div className="w-full max-w-sm mx-auto space-y-6 relative z-10">

        {/* Brand mark */}
        <div className="flex flex-col items-center gap-2">
          <div className="relative">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-orange-500 to-orange-600 flex items-center justify-center shadow-lg">
              <img src="/icon.svg" alt="" aria-hidden="true" className="w-8 h-8 filter brightness-0 invert" />
            </div>
            <span aria-hidden="true" className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-red-500 rounded-full border-2 border-white animate-pulse" />
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold tracking-tight leading-none">
              <span className="text-orange-500">Beep</span><span className="text-gray-900">Bite</span>
            </p>
            <p className="text-xs text-gray-500 mt-0.5">Restaurant Management</p>
          </div>
        </div>

        {/* Card */}
        <Card className="border border-gray-200 shadow-xl bg-white">
          <CardHeader className="pb-4 pt-5 px-6 space-y-1">
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 mb-2 w-fit focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-orange-500 rounded"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              Back
            </button>
            <CardTitle className="text-xl font-bold text-gray-900">Reset your password</CardTitle>
            <CardDescription className="text-sm text-gray-500">
              Enter your email and we'll send a reset link
            </CardDescription>
          </CardHeader>

          <CardContent className="px-6 pb-6">
            {!isSubmitted ? (
              <div className="space-y-4">
                {/* Error */}
                <div aria-live="assertive" aria-atomic="true">
                  {error && (
                    <Alert variant="destructive" className="border-l-4 border-red-500 bg-red-50">
                      <AlertCircle className="h-4 w-4 shrink-0" />
                      <AlertDescription className="text-sm">{error}</AlertDescription>
                    </Alert>
                  )}
                </div>

                <form onSubmit={handleSubmit} className="space-y-4" noValidate>
                  <div className="space-y-1.5">
                    <Label htmlFor="forgot-email" className="text-sm font-medium text-gray-700">
                      Email address
                    </Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" aria-hidden="true" />
                      <Input
                        id="forgot-email"
                        type="email"
                        autoComplete="email"
                        placeholder="you@restaurant.com"
                        value={email}
                        onChange={(e) => {
                          setEmail(e.target.value);
                          if (error) setError('');
                        }}
                        disabled={isLoading}
                        required
                        aria-invalid={!!error}
                        aria-describedby={error ? 'forgot-email-error' : undefined}
                        className={`pl-10 h-11 text-base border-gray-300 focus-visible:ring-orange-500 focus-visible:border-orange-500 transition-colors ${error ? 'border-red-400 bg-red-50/30' : ''}`}
                      />
                    </div>
                    <div aria-live="polite" aria-atomic="true">
                      {error && (
                        <p id="forgot-email-error" className="text-xs text-red-500 flex items-center gap-1">
                          <AlertCircle className="w-3 h-3 shrink-0" aria-hidden="true" />
                          {error}
                        </p>
                      )}
                    </div>
                  </div>

                  <Button
                    type="submit"
                    disabled={isLoading}
                    className="w-full h-11 bg-orange-500 hover:bg-orange-600 active:bg-orange-700 text-white font-semibold shadow-md hover:shadow-lg transition-all text-sm"
                  >
                    {isLoading ? (
                      <span className="flex items-center gap-2">
                        <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" aria-hidden="true" />
                        Sending reset link…
                      </span>
                    ) : (
                      <span className="flex items-center gap-2">
                        <Mail className="w-4 h-4" aria-hidden="true" />
                        Send Reset Link
                      </span>
                    )}
                  </Button>
                </form>

                <p className="text-center text-sm text-gray-500">
                  Remember your password?{' '}
                  <button
                    type="button"
                    className="text-orange-500 hover:text-orange-700 font-semibold underline underline-offset-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-orange-500 rounded"
                    onClick={() => navigate('/signin')}
                    disabled={isLoading}
                  >
                    Sign in
                  </button>
                </p>
              </div>
            ) : (
              /* Success state */
              <div className="space-y-5" role="status" aria-live="polite">
                <div className="flex flex-col items-center gap-3 py-2">
                  <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center">
                    <CheckCircle2 className="w-7 h-7 text-green-600" aria-hidden="true" />
                  </div>
                  <div className="text-center space-y-1">
                    <h2 className="font-semibold text-gray-900">Check your inbox</h2>
                    <p className="text-sm text-gray-600">
                      We've sent a reset link to{' '}
                      <span className="font-medium text-gray-900">{email}</span>.
                      The link expires in 1 hour.
                    </p>
                    <p className="text-xs text-gray-500">
                      Can't find it? Check your spam folder.
                    </p>
                  </div>
                </div>

                <div className="space-y-2">
                  <Button
                    className="w-full h-11 bg-orange-500 hover:bg-orange-600 text-white font-semibold shadow-md transition-all text-sm"
                    onClick={() => setIsSubmitted(false)}
                  >
                    Try a different email
                  </Button>
                  <Button
                    variant="outline"
                    className="w-full h-11 border-gray-300 hover:bg-gray-50 font-medium text-sm"
                    onClick={() => navigate('/signin')}
                  >
                    Back to Sign In
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Footer */}
        <footer className="text-center">
          <p className="text-xs text-gray-400">© {new Date().getFullYear()} BeepBite</p>
        </footer>
      </div>
    </div>
  );
};

export default ForgotPasswordPage;
