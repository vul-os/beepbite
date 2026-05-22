import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from '@/context/auth-context';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Mail, Lock, AlertCircle, Utensils, Bell } from 'lucide-react';

const SignInPage = () => {
  const navigate = useNavigate();
  const { signIn, signInWithGoogle } = useAuth();
  const [errors, setErrors] = useState({});
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState({
    email: '',
    password: '',
  });

  const validateForm = () => {
    const newErrors = {};
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(formData.email)) {
      newErrors.email = 'Please enter a valid email address';
    }
    if (!formData.password) {
      newErrors.password = 'Password is required';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    if (errors[name]) {
      setErrors(prev => ({ ...prev, [name]: undefined }));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (validateForm()) {
      setIsLoading(true);
      try {
        await signIn(formData.email, formData.password);
      } catch (error) {
        setErrors(prev => ({ ...prev, submit: error.message }));
      } finally {
        setIsLoading(false);
      }
    }
  };

  const handleGoogleSignIn = async () => {
    try {
      setIsLoading(true);
      await signInWithGoogle();
    } catch (error) {
      setErrors(prev => ({ ...prev, submit: error.message }));
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
          <CardHeader className="pb-4 pt-6 px-6 text-center space-y-1">
            <CardTitle className="text-xl font-bold text-gray-900">Welcome back</CardTitle>
            <CardDescription className="text-sm text-gray-500">
              Sign in to manage your restaurant
            </CardDescription>
          </CardHeader>

          <CardContent className="px-6 pb-6 space-y-4">
            {/* Submit error — aria-live so screen readers announce it */}
            <div aria-live="assertive" aria-atomic="true">
              {errors.submit && (
                <Alert variant="destructive" className="border-l-4 border-red-500 bg-red-50">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <AlertDescription className="text-sm">{errors.submit}</AlertDescription>
                </Alert>
              )}
            </div>

            {/* Google SSO */}
            <Button
              variant="outline"
              className="w-full h-11 flex items-center justify-center gap-2 border-gray-300 bg-white hover:bg-gray-50 text-sm font-medium shadow-sm transition-all"
              onClick={handleGoogleSignIn}
              disabled={isLoading}
              aria-label="Continue with Google"
            >
              <img src="/google.png" alt="" aria-hidden="true" className="w-4 h-4" />
              Continue with Google
            </Button>

            {/* Divider */}
            <div className="relative flex items-center">
              <span className="flex-1 border-t border-gray-200" />
              <span className="px-3 text-xs text-gray-400 font-medium">or</span>
              <span className="flex-1 border-t border-gray-200" />
            </div>

            {/* Email / password form */}
            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
              <div className="space-y-1.5">
                <Label htmlFor="signin-email" className="text-sm font-medium text-gray-700">
                  Email address
                </Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" aria-hidden="true" />
                  <Input
                    id="signin-email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    placeholder="you@restaurant.com"
                    value={formData.email}
                    onChange={handleInputChange}
                    disabled={isLoading}
                    required
                    aria-invalid={!!errors.email}
                    aria-describedby={errors.email ? 'signin-email-error' : undefined}
                    className={`pl-10 h-11 text-base border-gray-300 focus-visible:ring-orange-500 focus-visible:border-orange-500 transition-colors ${errors.email ? 'border-red-400 bg-red-50/30' : ''}`}
                  />
                </div>
                <div aria-live="polite" aria-atomic="true">
                  {errors.email && (
                    <p id="signin-email-error" className="text-xs text-red-500 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3 shrink-0" aria-hidden="true" />
                      {errors.email}
                    </p>
                  )}
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="signin-password" className="text-sm font-medium text-gray-700">
                    Password
                  </Label>
                  <button
                    type="button"
                    className="text-xs text-orange-500 hover:text-orange-700 font-medium underline underline-offset-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-orange-500 rounded"
                    onClick={() => navigate('/forgot-password')}
                    disabled={isLoading}
                  >
                    Forgot password?
                  </button>
                </div>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" aria-hidden="true" />
                  <Input
                    id="signin-password"
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    placeholder="Enter your password"
                    value={formData.password}
                    onChange={handleInputChange}
                    disabled={isLoading}
                    required
                    aria-invalid={!!errors.password}
                    aria-describedby={errors.password ? 'signin-password-error' : undefined}
                    className={`pl-10 h-11 text-base border-gray-300 focus-visible:ring-orange-500 focus-visible:border-orange-500 transition-colors ${errors.password ? 'border-red-400 bg-red-50/30' : ''}`}
                  />
                </div>
                <div aria-live="polite" aria-atomic="true">
                  {errors.password && (
                    <p id="signin-password-error" className="text-xs text-red-500 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3 shrink-0" aria-hidden="true" />
                      {errors.password}
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
                    Signing in…
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <Utensils className="w-4 h-4" aria-hidden="true" />
                    Sign in to Dashboard
                  </span>
                )}
              </Button>
            </form>

            {/* Switch to sign-up */}
            <p className="text-center text-sm text-gray-500">
              Don't have an account?{' '}
              <button
                type="button"
                className="text-orange-500 hover:text-orange-700 font-semibold underline underline-offset-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-orange-500 rounded"
                onClick={() => navigate('/signup')}
                disabled={isLoading}
              >
                Create one free
              </button>
            </p>
          </CardContent>
        </Card>

        {/* Footer */}
        <footer className="text-center space-y-1">
          <div className="flex items-center justify-center gap-4 text-xs text-gray-400">
            <span className="flex items-center gap-1">
              <Bell className="w-3 h-3 text-orange-400" aria-hidden="true" />
              Instant Alerts
            </span>
            <span className="flex items-center gap-1">
              <Utensils className="w-3 h-3 text-orange-400" aria-hidden="true" />
              Order Management
            </span>
          </div>
          <p className="text-xs text-gray-400">© {new Date().getFullYear()} BeepBite</p>
        </footer>
      </div>
    </div>
  );
};

export default SignInPage;
