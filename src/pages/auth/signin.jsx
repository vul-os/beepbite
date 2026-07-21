import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from '@/context/auth-context';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Mail, Lock, AlertCircle, Utensils } from 'lucide-react';
import AuthLayout from './auth-layout';

const SignInPage = () => {
  const navigate = useNavigate();
  const { signIn } = useAuth();
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

  return (
    <AuthLayout>
      <Card variant="elevated" className="w-full">
        <CardHeader className="pb-2 pt-7 px-7 text-center space-y-1">
          <CardTitle className="text-2xl font-display font-semibold text-foreground">
            Welcome back
          </CardTitle>
          <CardDescription className="text-sm text-muted-foreground">
            Sign in to manage your restaurant
          </CardDescription>
        </CardHeader>

        <CardContent className="px-7 pb-7 pt-5 space-y-5">
          {/* Submit error — aria-live so screen readers announce it */}
          <div aria-live="assertive" aria-atomic="true">
            {errors.submit && (
              <Alert variant="destructive" className="border-l-4 border-destructive bg-destructive/5">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <AlertDescription className="text-sm">{errors.submit}</AlertDescription>
              </Alert>
            )}
          </div>

          {/* Email / password form */}
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div className="space-y-1.5">
              <Label htmlFor="signin-email" className="text-sm font-medium text-foreground">
                Email address
              </Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" aria-hidden="true" />
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
                  className={`pl-10 h-11 rounded-xl text-base transition-colors ${errors.email ? 'border-destructive bg-destructive/5' : ''}`}
                />
              </div>
              <div aria-live="polite" aria-atomic="true">
                {errors.email && (
                  <p id="signin-email-error" className="text-xs text-destructive flex items-center gap-1">
                    <AlertCircle className="w-3 h-3 shrink-0" aria-hidden="true" />
                    {errors.email}
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="signin-password" className="text-sm font-medium text-foreground">
                  Password
                </Label>
                <button
                  type="button"
                  className="text-xs text-primary hover:text-primary/80 font-medium underline underline-offset-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded"
                  onClick={() => navigate('/forgot-password')}
                  disabled={isLoading}
                >
                  Forgot password?
                </button>
              </div>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" aria-hidden="true" />
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
                  className={`pl-10 h-11 rounded-xl text-base transition-colors ${errors.password ? 'border-destructive bg-destructive/5' : ''}`}
                />
              </div>
              <div aria-live="polite" aria-atomic="true">
                {errors.password && (
                  <p id="signin-password-error" className="text-xs text-destructive flex items-center gap-1">
                    <AlertCircle className="w-3 h-3 shrink-0" aria-hidden="true" />
                    {errors.password}
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
          <p className="text-center text-sm text-muted-foreground">
            Don't have an account?{' '}
            <button
              type="button"
              className="text-primary hover:text-primary/80 font-semibold underline underline-offset-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded"
              onClick={() => navigate('/signup')}
              disabled={isLoading}
            >
              Create one free
            </button>
          </p>
        </CardContent>
      </Card>
    </AuthLayout>
  );
};

export default SignInPage;
