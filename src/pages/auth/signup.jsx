import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useAuth } from '@/context/auth-context';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Mail, Lock, AlertCircle, Utensils, CheckCircle2 } from 'lucide-react';
import AuthLayout from './auth-layout';

const SignUpPage = () => {
  const navigate = useNavigate();
  const { signUp } = useAuth();
  const [errors, setErrors] = useState({});
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    agreeToTerms: false,
  });

  // Live password requirement checks for visual feedback
  const pwChecks = {
    length: formData.password.length >= 8,
    upper: /[A-Z]/.test(formData.password),
    number: /\d/.test(formData.password),
  };
  const pwStarted = formData.password.length > 0;

  const validateForm = () => {
    const newErrors = {};
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(formData.email)) {
      newErrors.email = 'Please enter a valid email address';
    }
    const passwordRegex = /^(?=.*[A-Z])(?=.*\d).{8,}$/;
    if (!passwordRegex.test(formData.password)) {
      newErrors.password = 'Password must be at least 8 characters with 1 number and 1 uppercase letter';
    }
    if (!formData.agreeToTerms) {
      newErrors.agreeToTerms = 'You must accept the terms and conditions';
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
        await signUp(formData.email, formData.password);
        // signUp() calls the Go backend which issues tokens immediately.
        // Navigation is handled by auth context after SIGNED_IN event.
      } catch (error) {
        setErrors(prev => ({ ...prev, submit: error.message }));
      } finally {
        setIsLoading(false);
      }
    }
  };

  return (
    <AuthLayout>
      <Card variant="elevated" className="w-full">
        <CardHeader className="pb-2 pt-7 px-7 text-center space-y-1">
          <CardTitle className="text-2xl font-display font-semibold text-foreground">
            Create your account
          </CardTitle>
          <CardDescription className="text-sm text-muted-foreground">
            Join thousands of restaurants using BeepBite
          </CardDescription>
        </CardHeader>

        <CardContent className="px-7 pb-7 pt-5 space-y-5">
          {/* Submit error */}
          <div aria-live="assertive" aria-atomic="true">
            {errors.submit && (
              <Alert variant="destructive" className="border-l-4 border-destructive bg-destructive/5">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <AlertDescription className="text-sm">{errors.submit}</AlertDescription>
              </Alert>
            )}
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            {/* Email */}
            <div className="space-y-1.5">
              <Label htmlFor="signup-email" className="text-sm font-medium text-foreground">
                Email address
              </Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" aria-hidden="true" />
                <Input
                  id="signup-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@restaurant.com"
                  value={formData.email}
                  onChange={handleInputChange}
                  disabled={isLoading}
                  required
                  aria-invalid={!!errors.email}
                  aria-describedby={errors.email ? 'signup-email-error' : undefined}
                  className={`pl-10 h-11 rounded-xl text-base transition-colors ${errors.email ? 'border-destructive bg-destructive/5' : ''}`}
                />
              </div>
              <div aria-live="polite" aria-atomic="true">
                {errors.email && (
                  <p id="signup-email-error" className="text-xs text-destructive flex items-center gap-1">
                    <AlertCircle className="w-3 h-3 shrink-0" aria-hidden="true" />
                    {errors.email}
                  </p>
                )}
              </div>
            </div>

            {/* Password */}
            <div className="space-y-1.5">
              <Label htmlFor="signup-password" className="text-sm font-medium text-foreground">
                Password
              </Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" aria-hidden="true" />
                <Input
                  id="signup-password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  placeholder="Create a secure password"
                  value={formData.password}
                  onChange={handleInputChange}
                  disabled={isLoading}
                  required
                  aria-invalid={!!errors.password}
                  aria-describedby="signup-password-reqs"
                  className={`pl-10 h-11 rounded-xl text-base transition-colors ${errors.password ? 'border-destructive bg-destructive/5' : ''}`}
                />
              </div>

              {/* Live password strength checklist */}
              <ul id="signup-password-reqs" className="space-y-0.5" aria-label="Password requirements">
                {[
                  { key: 'length', label: 'At least 8 characters', met: pwChecks.length },
                  { key: 'upper', label: '1 uppercase letter', met: pwChecks.upper },
                  { key: 'number', label: '1 number', met: pwChecks.number },
                ].map(({ key, label, met }) => (
                  <li key={key} className={`text-xs flex items-center gap-1.5 transition-colors ${pwStarted ? (met ? 'text-green-600' : 'text-destructive') : 'text-muted-foreground'}`}>
                    <CheckCircle2 className={`w-3 h-3 shrink-0 transition-colors ${pwStarted && met ? 'text-green-500' : 'text-muted-foreground/50'}`} aria-hidden="true" />
                    {label}
                  </li>
                ))}
              </ul>

              <div aria-live="polite" aria-atomic="true">
                {errors.password && (
                  <p id="signup-password-error" className="text-xs text-destructive flex items-center gap-1">
                    <AlertCircle className="w-3 h-3 shrink-0" aria-hidden="true" />
                    {errors.password}
                  </p>
                )}
              </div>
            </div>

            {/* Terms checkbox */}
            <div className="space-y-1">
              <div className="flex items-start gap-3">
                <Checkbox
                  id="signup-terms"
                  checked={formData.agreeToTerms}
                  onCheckedChange={(checked) => {
                    setFormData(prev => ({ ...prev, agreeToTerms: checked }));
                    if (errors.agreeToTerms) {
                      setErrors(prev => ({ ...prev, agreeToTerms: undefined }));
                    }
                  }}
                  disabled={isLoading}
                  aria-invalid={!!errors.agreeToTerms}
                  aria-describedby={errors.agreeToTerms ? 'signup-terms-error' : undefined}
                  className={`mt-0.5 ${errors.agreeToTerms ? 'border-destructive' : ''}`}
                />
                <Label htmlFor="signup-terms" className="text-sm text-foreground leading-relaxed cursor-pointer font-normal">
                  I agree to the{' '}
                  <a href="/docs/terms" className="text-primary hover:text-primary/80 font-medium underline underline-offset-1">Terms</a>
                  {' '}and{' '}
                  <a href="/docs/privacy" className="text-primary hover:text-primary/80 font-medium underline underline-offset-1">Privacy Policy</a>
                </Label>
              </div>
              <div aria-live="polite" aria-atomic="true">
                {errors.agreeToTerms && (
                  <p id="signup-terms-error" className="text-xs text-destructive flex items-center gap-1 ml-7">
                    <AlertCircle className="w-3 h-3 shrink-0" aria-hidden="true" />
                    {errors.agreeToTerms}
                  </p>
                )}
              </div>
            </div>

            <Button
              type="submit"
              disabled={isLoading}
              className="w-full h-11 rounded-xl bg-primary hover:bg-primary/90 active:bg-primary/80 text-primary-foreground font-semibold shadow-glow hover:shadow-glow transition-all text-sm"
            >
              {isLoading ? (
                <span className="flex items-center gap-2">
                  <span className="w-4 h-4 border-2 border-primary-foreground/40 border-t-primary-foreground rounded-full animate-spin" aria-hidden="true" />
                  Creating account…
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <Utensils className="w-4 h-4" aria-hidden="true" />
                  Create Account
                </span>
              )}
            </Button>
          </form>

          {/* Links */}
          <div className="text-center space-y-1.5">
            <p className="text-sm text-muted-foreground">
              Already have an account?{' '}
              <button
                type="button"
                className="text-primary hover:text-primary/80 font-semibold underline underline-offset-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded"
                onClick={() => navigate('/signin')}
                disabled={isLoading}
              >
                Sign in
              </button>
            </p>
            <p className="text-xs">
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground underline underline-offset-1 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded"
                onClick={() => navigate('/forgot-password')}
                disabled={isLoading}
              >
                Forgot your password?
              </button>
            </p>
          </div>
        </CardContent>
      </Card>
    </AuthLayout>
  );
};

export default SignUpPage;
