import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ChevronLeft, Mail, AlertCircle, CheckCircle2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/api-client';
import AuthLayout from './auth-layout';

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
    <AuthLayout>
      <Card variant="elevated" className="w-full">
        <CardHeader className="pb-2 pt-6 px-7 space-y-1">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-3 w-fit focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded transition-colors"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            Back
          </button>
          <CardTitle className="text-2xl font-display font-semibold text-foreground">
            Reset your password
          </CardTitle>
          <CardDescription className="text-sm text-muted-foreground">
            Enter your email and we'll send a reset link
          </CardDescription>
        </CardHeader>

        <CardContent className="px-7 pb-7 pt-4">
          {!isSubmitted ? (
            <div className="space-y-5">
              {/* Error */}
              <div aria-live="assertive" aria-atomic="true">
                {error && (
                  <Alert variant="destructive" className="border-l-4 border-destructive bg-destructive/5">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    <AlertDescription className="text-sm">{error}</AlertDescription>
                  </Alert>
                )}
              </div>

              <form onSubmit={handleSubmit} className="space-y-4" noValidate>
                <div className="space-y-1.5">
                  <Label htmlFor="forgot-email" className="text-sm font-medium text-foreground">
                    Email address
                  </Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" aria-hidden="true" />
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
                      className={`pl-10 h-11 rounded-xl text-base transition-colors ${error ? 'border-destructive bg-destructive/5' : ''}`}
                    />
                  </div>
                  <div aria-live="polite" aria-atomic="true">
                    {error && (
                      <p id="forgot-email-error" className="text-xs text-destructive flex items-center gap-1">
                        <AlertCircle className="w-3 h-3 shrink-0" aria-hidden="true" />
                        {error}
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

              <p className="text-center text-sm text-muted-foreground">
                Remember your password?{' '}
                <button
                  type="button"
                  className="text-primary hover:text-primary/80 font-semibold underline underline-offset-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded"
                  onClick={() => navigate('/signin')}
                  disabled={isLoading}
                >
                  Sign in
                </button>
              </p>
            </div>
          ) : (
            /* Success state */
            <div className="space-y-6" role="status" aria-live="polite">
              <div className="flex flex-col items-center gap-4 py-3">
                <div className="w-16 h-16 rounded-2xl bg-success/15 flex items-center justify-center">
                  <CheckCircle2 className="w-8 h-8 text-success" aria-hidden="true" />
                </div>
                <div className="text-center space-y-1.5">
                  <h2 className="font-display font-semibold text-foreground text-lg">Check your inbox</h2>
                  <p className="text-sm text-muted-foreground">
                    We've sent a reset link to{' '}
                    <span className="font-medium text-foreground">{email}</span>.
                    The link expires in 1 hour.
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Can't find it? Check your spam folder.
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <Button
                  className="w-full h-11 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-semibold shadow-glow transition-all text-sm"
                  onClick={() => setIsSubmitted(false)}
                >
                  Try a different email
                </Button>
                <Button
                  variant="outline"
                  className="w-full h-11 rounded-xl border-border hover:bg-muted font-medium text-sm"
                  onClick={() => navigate('/signin')}
                >
                  Back to Sign In
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </AuthLayout>
  );
};

export default ForgotPasswordPage;
