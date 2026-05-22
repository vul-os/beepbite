import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Lock, AlertCircle, Eye, EyeOff, CheckCircle2, Utensils } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '@/lib/api-client';

const UpdatePasswordPage = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [formData, setFormData] = useState({ password: '', confirmPassword: '' });
  const [errors, setErrors] = useState({});
  const [isLoading, setIsLoading] = useState(false);
  const [isUpdated, setIsUpdated] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // Live requirement checks
  const pwChecks = {
    length: formData.password.length >= 8,
    upper: /[A-Z]/.test(formData.password),
    number: /\d/.test(formData.password),
  };
  const pwStarted = formData.password.length > 0;
  const confirmStarted = formData.confirmPassword.length > 0;
  const passwordsMatch = formData.password === formData.confirmPassword;

  const validateForm = () => {
    const newErrors = {};
    const passwordRegex = /^(?=.*[A-Z])(?=.*\d).{8,}$/;
    if (!passwordRegex.test(formData.password)) {
      newErrors.password = 'Password must be at least 8 characters with 1 number and 1 uppercase letter';
    }
    if (formData.password !== formData.confirmPassword) {
      newErrors.confirmPassword = 'Passwords do not match';
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
    if (!validateForm()) return;

    setIsLoading(true);
    try {
      const token = searchParams.get('token');
      if (!token) {
        setErrors(prev => ({ ...prev, submit: 'Reset link is missing or invalid. Please request a new one.' }));
        return;
      }
      const { error } = await api.request('POST', '/auth/password/reset', {
        auth: false,
        body: { token, new_password: formData.password },
      });
      if (error) {
        const msg =
          error.status === 410
            ? 'This reset link has already been used or has expired. Please request a new one.'
            : (error.message || 'Failed to update password. Please try again.');
        setErrors(prev => ({ ...prev, submit: msg }));
        return;
      }
      setIsUpdated(true);
    } catch (err) {
      setErrors(prev => ({ ...prev, submit: 'Failed to update password. Please try again.' }));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col justify-center bg-gradient-to-br from-slate-50 via-white to-orange-50 px-4 py-8 relative overflow-hidden">
      {/* Subtle background blobs */}
      <div aria-hidden="true" className="absolute top-0 right-0 w-64 h-64 bg-orange-100 rounded-full opacity-30 translate-x-1/2 -translate-y-1/2 pointer-events-none" />
      <div aria-hidden="true" className="absolute bottom-0 left-0 w-80 h-80 bg-orange-50 rounded-full opacity-40 -translate-x-1/3 translate-y-1/3 pointer-events-none" />

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
            <CardTitle className="text-xl font-bold text-gray-900">Update your password</CardTitle>
            <CardDescription className="text-sm text-gray-500">
              Choose a strong new password for your account
            </CardDescription>
          </CardHeader>

          <CardContent className="px-6 pb-6">
            {!isUpdated ? (
              <div className="space-y-4">
                {/* Submit error */}
                <div aria-live="assertive" aria-atomic="true">
                  {errors.submit && (
                    <Alert variant="destructive" className="border-l-4 border-red-500 bg-red-50">
                      <AlertCircle className="h-4 w-4 shrink-0" />
                      <AlertDescription className="text-sm">{errors.submit}</AlertDescription>
                    </Alert>
                  )}
                </div>

                <form onSubmit={handleSubmit} className="space-y-4" noValidate>
                  {/* New password */}
                  <div className="space-y-1.5">
                    <Label htmlFor="update-password" className="text-sm font-medium text-gray-700">
                      New password
                    </Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" aria-hidden="true" />
                      <Input
                        id="update-password"
                        name="password"
                        type={showPassword ? 'text' : 'password'}
                        autoComplete="new-password"
                        placeholder="Enter new password"
                        value={formData.password}
                        onChange={handleInputChange}
                        disabled={isLoading}
                        aria-invalid={!!errors.password}
                        aria-describedby="update-password-reqs"
                        className={`pl-10 pr-10 h-11 text-base border-gray-300 focus-visible:ring-orange-500 focus-visible:border-orange-500 transition-colors ${errors.password ? 'border-red-400 bg-red-50/30' : ''}`}
                      />
                      <button
                        type="button"
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-orange-500 rounded"
                        onClick={() => setShowPassword(!showPassword)}
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
                      </button>
                    </div>

                    {/* Live requirement checklist */}
                    <ul id="update-password-reqs" className="space-y-0.5" aria-label="Password requirements">
                      {[
                        { label: 'At least 8 characters', met: pwChecks.length },
                        { label: '1 uppercase letter', met: pwChecks.upper },
                        { label: '1 number', met: pwChecks.number },
                      ].map(({ label, met }) => (
                        <li key={label} className={`text-xs flex items-center gap-1.5 transition-colors ${pwStarted ? (met ? 'text-green-600' : 'text-red-500') : 'text-gray-400'}`}>
                          <CheckCircle2 className={`w-3 h-3 shrink-0 ${pwStarted && met ? 'text-green-500' : 'text-gray-300'}`} aria-hidden="true" />
                          {label}
                        </li>
                      ))}
                    </ul>

                    <div aria-live="polite" aria-atomic="true">
                      {errors.password && (
                        <p className="text-xs text-red-500 flex items-center gap-1">
                          <AlertCircle className="w-3 h-3 shrink-0" aria-hidden="true" />
                          {errors.password}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Confirm password */}
                  <div className="space-y-1.5">
                    <Label htmlFor="update-confirm-password" className="text-sm font-medium text-gray-700">
                      Confirm new password
                    </Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" aria-hidden="true" />
                      <Input
                        id="update-confirm-password"
                        name="confirmPassword"
                        type={showConfirmPassword ? 'text' : 'password'}
                        autoComplete="new-password"
                        placeholder="Confirm new password"
                        value={formData.confirmPassword}
                        onChange={handleInputChange}
                        disabled={isLoading}
                        aria-invalid={!!errors.confirmPassword}
                        aria-describedby={errors.confirmPassword ? 'update-confirm-error' : undefined}
                        className={`pl-10 pr-10 h-11 text-base border-gray-300 focus-visible:ring-orange-500 focus-visible:border-orange-500 transition-colors ${errors.confirmPassword ? 'border-red-400 bg-red-50/30' : (confirmStarted && passwordsMatch ? 'border-green-400' : '')}`}
                      />
                      <button
                        type="button"
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-orange-500 rounded"
                        onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                        aria-label={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
                      >
                        {showConfirmPassword ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
                      </button>
                    </div>
                    <div aria-live="polite" aria-atomic="true">
                      {errors.confirmPassword ? (
                        <p id="update-confirm-error" className="text-xs text-red-500 flex items-center gap-1">
                          <AlertCircle className="w-3 h-3 shrink-0" aria-hidden="true" />
                          {errors.confirmPassword}
                        </p>
                      ) : confirmStarted && passwordsMatch ? (
                        <p className="text-xs text-green-600 flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3 shrink-0" aria-hidden="true" />
                          Passwords match
                        </p>
                      ) : null}
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
                        Updating password…
                      </span>
                    ) : (
                      <span className="flex items-center gap-2">
                        <Lock className="w-4 h-4" aria-hidden="true" />
                        Update Password
                      </span>
                    )}
                  </Button>
                </form>
              </div>
            ) : (
              /* Success state */
              <div className="space-y-5" role="status" aria-live="polite">
                <div className="flex flex-col items-center gap-3 py-2">
                  <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center">
                    <CheckCircle2 className="w-7 h-7 text-green-600" aria-hidden="true" />
                  </div>
                  <div className="text-center space-y-1">
                    <h2 className="font-semibold text-gray-900">Password updated!</h2>
                    <p className="text-sm text-gray-600">
                      Your password has been changed. You can now sign in with your new credentials.
                    </p>
                  </div>
                </div>

                <Button
                  className="w-full h-11 bg-orange-500 hover:bg-orange-600 text-white font-semibold shadow-md transition-all text-sm"
                  onClick={() => navigate('/signin')}
                >
                  <span className="flex items-center gap-2">
                    <Utensils className="w-4 h-4" aria-hidden="true" />
                    Sign In to Dashboard
                  </span>
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Footer */}
        <footer className="text-center">
          <p className="text-xs text-gray-400">© {new Date().getFullYear()} BeepBite. Secure restaurant management.</p>
        </footer>
      </div>
    </div>
  );
};

export default UpdatePasswordPage;
