import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Mail, RefreshCw, CheckCircle2, AlertCircle } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '@/lib/api-client';

const VerifyEmailPage = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState('');
  const [isResending, setIsResending] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [successMessage, setSuccessMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  // confirmed = true when ?token= was validated successfully
  const [confirmed, setConfirmed] = useState(false);
  const [confirming, setConfirming] = useState(false);

  // If arriving with ?token= auto-submit the confirmation.
  useEffect(() => {
    const token = searchParams.get('token');
    if (token) {
      setConfirming(true);
      api.request('POST', '/auth/verify/confirm', {
        auth: false,
        body: { token },
      }).then(({ error }) => {
        setConfirming(false);
        if (error) {
          const msg =
            error.status === 410
              ? 'This verification link has already been used or has expired. Use the button below to resend.'
              : (error.message || 'Verification failed. Please request a new link.');
          setErrorMessage(msg);
        } else {
          setConfirmed(true);
        }
      }).catch(() => {
        setConfirming(false);
        setErrorMessage('Verification failed. Please try again.');
      });
    } else {
      const pendingEmail = localStorage.getItem('pendingVerificationEmail');
      if (pendingEmail) {
        setEmail(pendingEmail);
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
    setErrorMessage('');
    try {
      const body = email ? { email } : {};
      await api.request('POST', '/auth/verify/send', {
        auth: false,
        body,
      });
      setSuccessMessage('Verification email sent! Check your inbox.');
      setResendCooldown(60);
    } catch (error) {
      console.error('Failed to resend verification email:', error);
      setErrorMessage('Failed to resend. Please try again.');
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
          {confirmed ? (
            /* ── Confirmed success state ── */
            <>
              <CardHeader className="pb-4 pt-6 px-6 text-center space-y-3">
                <div className="mx-auto w-14 h-14 rounded-full bg-green-100 flex items-center justify-center">
                  <CheckCircle2 className="w-7 h-7 text-green-600" aria-hidden="true" />
                </div>
                <div className="space-y-1">
                  <CardTitle className="text-xl font-bold text-gray-900">Email verified!</CardTitle>
                  <CardDescription className="text-sm text-gray-500">
                    Your email address has been confirmed. You can now sign in.
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent className="px-6 pb-6">
                <Button
                  className="w-full h-11 bg-orange-500 hover:bg-orange-600 text-white font-semibold shadow-md transition-all text-sm"
                  onClick={() => navigate('/signin')}
                >
                  Sign In to Dashboard
                </Button>
              </CardContent>
            </>
          ) : confirming ? (
            /* ── Auto-confirming spinner ── */
            <CardContent className="px-6 py-10 flex flex-col items-center gap-3">
              <span className="w-8 h-8 border-4 border-orange-200 border-t-orange-500 rounded-full animate-spin" aria-hidden="true" />
              <p className="text-sm text-gray-500">Verifying your email…</p>
            </CardContent>
          ) : (
            /* ── Default: check-your-inbox / resend state ── */
            <>
              <CardHeader className="pb-4 pt-6 px-6 text-center space-y-3">
                {/* Mail icon */}
                <div className="mx-auto w-14 h-14 rounded-full bg-orange-100 flex items-center justify-center">
                  <Mail className="w-7 h-7 text-orange-500" aria-hidden="true" />
                </div>
                <div className="space-y-1">
                  <CardTitle className="text-xl font-bold text-gray-900">Check your email</CardTitle>
                  <CardDescription className="text-sm text-gray-500">
                    We've sent a verification link to{' '}
                    <strong className="text-gray-700 font-semibold">{email || 'your email address'}</strong>
                  </CardDescription>
                </div>
              </CardHeader>

              <CardContent className="px-6 pb-6 space-y-4">
                {/* Feedback — aria-live regions */}
                <div aria-live="polite" aria-atomic="true">
                  {successMessage && (
                    <Alert className="border-l-4 border-green-500 bg-green-50">
                      <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" aria-hidden="true" />
                      <AlertDescription className="text-sm text-green-800">
                        {successMessage}
                      </AlertDescription>
                    </Alert>
                  )}
                  {errorMessage && (
                    <Alert variant="destructive" className="border-l-4 border-red-500 bg-red-50">
                      <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
                      <AlertDescription className="text-sm">{errorMessage}</AlertDescription>
                    </Alert>
                  )}
                </div>

                {/* Instructional info box */}
                <div className="rounded-lg bg-blue-50 border border-blue-100 px-4 py-3 space-y-1.5">
                  <p className="text-sm font-medium text-blue-900">Next steps</p>
                  <ol className="text-sm text-blue-800 space-y-1 list-decimal list-inside">
                    <li>Open the email from BeepBite</li>
                    <li>Click the <strong>Verify email</strong> link</li>
                    <li>You'll be redirected to your dashboard</li>
                  </ol>
                  <p className="text-xs text-blue-700 pt-1">
                    Can't find it? Check your spam or junk folder.
                  </p>
                </div>

                {/* Actions */}
                <div className="space-y-2">
                  <Button
                    onClick={handleResendEmail}
                    disabled={isResending || resendCooldown > 0}
                    className="w-full h-11 bg-orange-500 hover:bg-orange-600 active:bg-orange-700 text-white font-semibold shadow-md hover:shadow-lg transition-all text-sm"
                    aria-label={resendCooldown > 0 ? `Resend available in ${resendCooldown} seconds` : 'Resend verification email'}
                  >
                    {isResending ? (
                      <span className="flex items-center gap-2">
                        <RefreshCw className="w-4 h-4 animate-spin" aria-hidden="true" />
                        Sending…
                      </span>
                    ) : resendCooldown > 0 ? (
                      `Resend in ${resendCooldown}s`
                    ) : (
                      <span className="flex items-center gap-2">
                        <RefreshCw className="w-4 h-4" aria-hidden="true" />
                        Resend Verification Email
                      </span>
                    )}
                  </Button>

                  <Button
                    variant="outline"
                    onClick={handleChangeEmail}
                    className="w-full h-11 border-gray-300 hover:bg-gray-50 font-medium text-sm"
                  >
                    Use a Different Email
                  </Button>

                  <Button
                    variant="ghost"
                    onClick={() => navigate('/signin')}
                    className="w-full h-11 text-gray-500 hover:text-gray-800 hover:bg-gray-50 font-medium text-sm"
                  >
                    Back to Sign In
                  </Button>
                </div>

                <p className="text-center text-xs text-gray-400">
                  After verifying you'll be taken straight to your BeepBite dashboard.
                </p>
              </CardContent>
            </>
          )}
        </Card>

        {/* Footer */}
        <footer className="text-center">
          <p className="text-xs text-gray-400">
            © {new Date().getFullYear()} BeepBite. Streamlining restaurant operations.
          </p>
        </footer>
      </div>
    </div>
  );
};

export default VerifyEmailPage;
