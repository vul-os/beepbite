import React, { useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle, Lock, User, Hash, Loader2 } from 'lucide-react';
import { api } from '@/lib/api-client';

// ---------------------------------------------------------------------------
// PIN pad digit button
// ---------------------------------------------------------------------------
// eslint-disable-next-line react/prop-types
function PinButton({ children, onClick, disabled }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex items-center justify-center w-16 h-16 rounded-xl text-xl font-semibold bg-card border border-border shadow-sm hover:bg-muted active:scale-95 transition-all duration-100 disabled:opacity-40 disabled:cursor-not-allowed"
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// PIN dot display (shows filled/empty circles for entered digits)
// ---------------------------------------------------------------------------
// eslint-disable-next-line react/prop-types
function PinDots({ length, maxLength }) {
  return (
    <div className="flex items-center justify-center gap-3 my-4">
      {Array.from({ length: maxLength }).map((_, i) => (
        <div
          key={i}
          className={`w-3 h-3 rounded-full border-2 transition-all duration-150 ${
            i < length
              ? 'bg-primary border-primary scale-110'
              : 'bg-transparent border-gray-300'
          }`}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main POS Staff Login page
// ---------------------------------------------------------------------------
const PosLoginPage = () => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('password');

  // -- password tab state --
  const [pwForm, setPwForm] = useState({ username: '', password: '' });
  const [pwErrors, setPwErrors] = useState({});
  const [pwLoading, setPwLoading] = useState(false);

  // -- pin tab state --
  const [pinForm, setPinForm] = useState({ username: '', pin: '' });
  const [pinErrors, setPinErrors] = useState({});
  const [pinLoading, setPinLoading] = useState(false);

  const passwordRef = useRef(null);

  // ---- helpers ----

  const errorMessage = (status) => {
    if (status === 423) return 'Account is locked due to too many failed attempts. Please contact your manager.';
    if (status === 429) return 'Too many login attempts. Please wait a moment and try again.';
    return null;
  };

  /**
   * Determine where to redirect after a successful staff login.
   * - Kitchen-only staff (role === 'kitchen' or only can_kitchen) → /work
   * - Everyone else → /pos/workspace
   */
  const resolvePostLoginPath = (data) => {
    const role = data?.role ?? '';
    const caps = Array.isArray(data?.capabilities) ? data.capabilities : [];
    const hasPos = caps.includes('can_pos');
    const hasKitchen = caps.includes('can_kitchen');
    const kitchenOnly = role === 'kitchen' || (!hasPos && hasKitchen);
    return kitchenOnly ? '/work' : '/pos/workspace';
  };

  // ---- password tab handlers ----

  const handlePwChange = (e) => {
    const { name, value } = e.target;
    setPwForm((prev) => ({ ...prev, [name]: value }));
    if (pwErrors[name] || pwErrors.submit) {
      setPwErrors((prev) => ({ ...prev, [name]: undefined, submit: undefined }));
    }
  };

  const validatePwForm = () => {
    const errs = {};
    if (!pwForm.username.trim()) errs.username = 'Username is required';
    if (!pwForm.password) errs.password = 'Password is required';
    setPwErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handlePwSubmit = useCallback(async (e) => {
    if (e) e.preventDefault();
    if (!validatePwForm()) return;

    setPwLoading(true);
    try {
      const { data, error } = await api.request('POST', '/auth/staff/login', {
        auth: false,
        body: {
          username: pwForm.username.trim(),
          password: pwForm.password,
        },
      });

      if (error) {
        const locked = errorMessage(error.status);
        setPwErrors({ submit: locked || error.message || 'Invalid username or password.' });
        return;
      }

      // api.request does not auto-write staff sessions; persist manually.
      if (data?.access_token) {
        localStorage.setItem('bb.auth', JSON.stringify(data));
      }

      navigate(resolvePostLoginPath(data));
    } finally {
      setPwLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pwForm, navigate]);

  // ---- pin tab handlers ----

  const handlePinUsernameChange = (e) => {
    setPinForm((prev) => ({ ...prev, username: e.target.value }));
    if (pinErrors.username || pinErrors.submit) {
      setPinErrors((prev) => ({ ...prev, username: undefined, submit: undefined }));
    }
  };

  const appendDigit = (digit) => {
    setPinForm((prev) => {
      if (prev.pin.length >= 6) return prev;
      return { ...prev, pin: prev.pin + digit };
    });
    setPinErrors((prev) => ({ ...prev, pin: undefined, submit: undefined }));
  };

  const deleteDigit = () => {
    setPinForm((prev) => ({ ...prev, pin: prev.pin.slice(0, -1) }));
    setPinErrors((prev) => ({ ...prev, pin: undefined, submit: undefined }));
  };

  const clearPin = () => {
    setPinForm((prev) => ({ ...prev, pin: '' }));
  };

  const validatePinForm = () => {
    const errs = {};
    if (!pinForm.username.trim()) errs.username = 'Username is required';
    if (pinForm.pin.length < 4) errs.pin = 'PIN must be 4–6 digits';
    setPinErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handlePinSubmit = useCallback(async () => {
    if (!validatePinForm()) return;

    setPinLoading(true);
    try {
      const { data, error } = await api.request('POST', '/auth/staff/pin-login', {
        auth: false,
        body: {
          username: pinForm.username.trim(),
          pin: pinForm.pin,
        },
      });

      if (error) {
        const locked = errorMessage(error.status);
        setPinErrors({ submit: locked || error.message || 'Invalid username or PIN.' });
        clearPin();
        return;
      }

      if (data?.access_token) {
        localStorage.setItem('bb.auth', JSON.stringify(data));
      }

      navigate(resolvePostLoginPath(data));
    } finally {
      setPinLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinForm, navigate]);

  // Auto-submit PIN once 6 digits entered
  React.useEffect(() => {
    if (pinForm.pin.length === 6) {
      handlePinSubmit();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinForm.pin]);

  // Keyboard Enter on PIN username field → focus pin (handled by numpad)
  const handlePinUsernameKeyDown = (e) => {
    if (e.key === 'Enter') e.preventDefault();
  };

  // ---- render ----

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-slate-50 via-white to-slate-100 px-4 py-8 relative overflow-hidden">
      {/* Background decoration */}
      <div className="absolute top-10 left-10 w-20 h-20 bg-primary/5 rounded-full opacity-50 pointer-events-none" />
      <div className="absolute bottom-10 right-10 w-16 h-16 bg-primary/5 rounded-full opacity-50 pointer-events-none" />

      <div className="w-full max-w-sm mx-auto space-y-5 relative z-10">
        {/* Brand header */}
        <div className="flex justify-center">
          <div className="text-center">
            <div className="flex justify-center items-center mb-2">
              <div className="relative w-14 h-14 beepbite-gradient rounded-2xl flex items-center justify-center shadow-lg border-4 border-white">
                <img
                  src="/icon.svg"
                  alt="BeepBite"
                  className="w-8 h-8 filter brightness-0 invert"
                />
                <div className="absolute -top-1 -right-1 w-4 h-4 bg-destructive rounded-full animate-pulse shadow-lg" />
              </div>
            </div>
            <h1 className="text-3xl font-bold tracking-tight">
              <span className="beepbite-gradient-text">Beep</span>
              <span className="text-gray-900">Bite</span>
            </h1>
            <p className="text-sm text-gray-600 font-medium">Staff Login</p>
          </div>
        </div>

        <Card className="border border-gray-200 shadow-xl bg-white/95 backdrop-blur-sm">
          <CardHeader className="space-y-1 pb-3 text-center px-5 pt-5">
            <CardTitle className="text-xl font-bold text-gray-900">Welcome</CardTitle>
            <CardDescription className="text-sm text-gray-500">
              Sign in to your POS terminal
            </CardDescription>
          </CardHeader>

          <CardContent className="px-5 pb-5">
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
              <TabsList className="w-full mb-4">
                <TabsTrigger value="password" className="flex-1">
                  <Lock className="w-3.5 h-3.5 mr-1.5" />
                  Password
                </TabsTrigger>
                <TabsTrigger value="pin" className="flex-1">
                  <Hash className="w-3.5 h-3.5 mr-1.5" />
                  PIN
                </TabsTrigger>
              </TabsList>

              {/* ---- Password tab ---- */}
              <TabsContent value="password">
                {pwErrors.submit && (
                  <Alert variant="destructive" className="mb-4">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription className="text-sm">{pwErrors.submit}</AlertDescription>
                  </Alert>
                )}

                <form onSubmit={handlePwSubmit} className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="pw-username" className="text-sm font-medium text-gray-700">
                      Username
                    </Label>
                    <div className="relative">
                      <User className="absolute left-3 top-3.5 h-4 w-4 text-gray-400" />
                      <Input
                        id="pw-username"
                        name="username"
                        type="text"
                        autoComplete="username"
                        placeholder="Enter your username"
                        value={pwForm.username}
                        onChange={handlePwChange}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            passwordRef.current?.focus();
                          }
                        }}
                        disabled={pwLoading}
                        className={`pl-10 h-11 bg-white border-gray-300 focus:border-primary transition-all text-base ${pwErrors.username ? 'border-destructive' : ''}`}
                      />
                    </div>
                    {pwErrors.username && (
                      <p className="text-xs text-destructive">{pwErrors.username}</p>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="pw-password" className="text-sm font-medium text-gray-700">
                      Password
                    </Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-3.5 h-4 w-4 text-gray-400" />
                      <Input
                        id="pw-password"
                        name="password"
                        type="password"
                        ref={passwordRef}
                        autoComplete="current-password"
                        placeholder="Enter your password"
                        value={pwForm.password}
                        onChange={handlePwChange}
                        disabled={pwLoading}
                        className={`pl-10 h-11 bg-white border-gray-300 focus:border-primary transition-all text-base ${pwErrors.password ? 'border-destructive' : ''}`}
                      />
                    </div>
                    {pwErrors.password && (
                      <p className="text-xs text-destructive">{pwErrors.password}</p>
                    )}
                  </div>

                  <Button
                    type="submit"
                    className="w-full h-11 bg-primary hover:bg-primary/90 text-white font-medium shadow-lg transition-all duration-200 text-base"
                    disabled={pwLoading}
                  >
                    {pwLoading ? (
                      <span className="flex items-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Signing in...
                      </span>
                    ) : (
                      'Sign In'
                    )}
                  </Button>
                </form>
              </TabsContent>

              {/* ---- PIN tab ---- */}
              <TabsContent value="pin">
                {pinErrors.submit && (
                  <Alert variant="destructive" className="mb-4">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription className="text-sm">{pinErrors.submit}</AlertDescription>
                  </Alert>
                )}

                <div className="space-y-1.5 mb-4">
                  <Label htmlFor="pin-username" className="text-sm font-medium text-gray-700">
                    Username
                  </Label>
                  <div className="relative">
                    <User className="absolute left-3 top-3.5 h-4 w-4 text-gray-400" />
                    <Input
                      id="pin-username"
                      name="pin-username"
                      type="text"
                      autoComplete="username"
                      placeholder="Enter your username"
                      value={pinForm.username}
                      onChange={handlePinUsernameChange}
                      onKeyDown={handlePinUsernameKeyDown}
                      disabled={pinLoading}
                      className={`pl-10 h-11 bg-white border-gray-300 focus:border-primary transition-all text-base ${pinErrors.username ? 'border-destructive' : ''}`}
                    />
                  </div>
                  {pinErrors.username && (
                    <p className="text-xs text-destructive">{pinErrors.username}</p>
                  )}
                </div>

                {/* PIN dot indicator */}
                <PinDots length={pinForm.pin.length} maxLength={6} />
                {pinErrors.pin && (
                  <p className="text-xs text-destructive text-center mb-2">{pinErrors.pin}</p>
                )}

                {/* Numpad */}
                <div className="flex flex-col items-center gap-2 mt-2">
                  {[['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9']].map((row) => (
                    <div key={row.join('')} className="flex gap-2">
                      {row.map((d) => (
                        <PinButton key={d} onClick={() => appendDigit(d)} disabled={pinLoading}>
                          {d}
                        </PinButton>
                      ))}
                    </div>
                  ))}
                  <div className="flex gap-2">
                    <PinButton onClick={clearPin} disabled={pinLoading}>
                      <span className="text-sm text-gray-500">CLR</span>
                    </PinButton>
                    <PinButton onClick={() => appendDigit('0')} disabled={pinLoading}>
                      0
                    </PinButton>
                    <PinButton onClick={deleteDigit} disabled={pinLoading}>
                      <span className="text-base">⌫</span>
                    </PinButton>
                  </div>
                </div>

                <Button
                  type="button"
                  className="w-full h-11 mt-4 bg-primary hover:bg-primary/90 text-white font-medium shadow-lg transition-all duration-200 text-base"
                  disabled={pinLoading || pinForm.pin.length < 4}
                  onClick={handlePinSubmit}
                >
                  {pinLoading ? (
                    <span className="flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Signing in...
                    </span>
                  ) : (
                    'Sign In with PIN'
                  )}
                </Button>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        {/* Owner / admin escape hatch — Supabase email/password login. */}
        <div className="text-center">
          <p className="text-xs text-gray-500">
            Owner or admin?{' '}
            <button
              type="button"
              onClick={() => navigate('/signin?next=/pos/workspace')}
              className="font-semibold text-orange-600 hover:text-orange-700 hover:underline"
            >
              Sign in with email &amp; password →
            </button>
          </p>
        </div>

        <p className="text-center text-xs text-gray-400">
          &copy; {new Date().getFullYear()} BeepBite &mdash; POS Terminal
        </p>
      </div>
    </div>
  );
};

export default PosLoginPage;
