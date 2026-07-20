// src/pages/staff-pin/index.jsx
// Route: /s/:slug
// Marketplace-scoped staff PIN login — resolves a store by slug, then lets a
// staff member enter their username + PIN without any org-level context leak.

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { User, AlertCircle, Loader2, Store } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

import PinKeypad from './components/pin-keypad';
import { resolveStore, pinVerifyOverlay, pinLogin } from '@/services/staff-pin';
import { useActor } from '@/context/actor-token-context';

/**
 * Determine post-login destination based on staff role / capabilities.
 * Kitchen-only staff → /work (Kitchen tab defaults to kitchen)
 * Everyone else      → /pos/workspace
 */
function resolvePostLoginPath(payload) {
  const role = payload?.role ?? payload?.staff?.role ?? '';
  const caps = Array.isArray(payload?.capabilities) ? payload.capabilities : [];
  const hasPos = caps.includes('can_pos');
  const hasKitchen = caps.includes('can_kitchen');
  const kitchenOnly = role === 'kitchen' || (!hasPos && hasKitchen);
  return kitchenOnly ? '/work' : '/pos/workspace';
}

// ---------------------------------------------------------------------------
// 404 page shown when the slug cannot be resolved
// ---------------------------------------------------------------------------
function StoreNotFound() {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-slate-50 via-white to-slate-100 dark:from-gray-950 dark:via-gray-900 dark:to-gray-950 px-4 py-8">
      <div className="w-full max-w-sm mx-auto text-center space-y-5">
        <div className="flex justify-center">
          <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center shadow-inner">
            <Store className="w-8 h-8 text-muted-foreground" />
          </div>
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground mb-2">Store not found</h1>
          <p className="text-sm text-muted-foreground">
            We couldn&apos;t find the store you&apos;re looking for. Double-check the link and try again.
          </p>
        </div>
        <Button
          type="button"
          variant="link"
          onClick={() => navigate('/pos/login')}
          className="text-sm font-semibold text-orange-600 hover:text-orange-700 h-auto p-0"
        >
          Go to staff login &rarr;
        </Button>
        <p className="text-xs text-muted-foreground">&copy; {new Date().getFullYear()} BeepBite</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading skeleton shown while resolving the slug
// ---------------------------------------------------------------------------
function LoadingScreen() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-slate-50 via-white to-slate-100 dark:from-gray-950 dark:via-gray-900 dark:to-gray-950 px-4">
      <Loader2 className="w-8 h-8 text-primary animate-spin" />
      <p className="mt-3 text-sm text-muted-foreground">Loading store…</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------
const StaffPinPage = () => {
  const { slug } = useParams();
  const navigate = useNavigate();
  const { setActor } = useActor();

  // ---- store resolution state ----
  const [storeState, setStoreState] = useState('loading'); // 'loading' | 'found' | 'not_found' | 'error'
  const [store, setStore] = useState(null); // { location_id, display_name }

  // ---- form state ----
  const [username, setUsername] = useState('');
  const [usernameError, setUsernameError] = useState('');
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [loading, setLoading] = useState(false);

  const usernameRef = useRef(null);

  // ---- resolve slug on mount ----
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const result = await resolveStore(slug);
      if (cancelled) return;

      if (result.ok) {
        setStore(result.data);
        setStoreState('found');
        // Auto-focus username field after store resolves
        setTimeout(() => usernameRef.current?.focus(), 100);
      } else if (result.notFound) {
        setStoreState('not_found');
      } else {
        setStoreState('error');
      }
    })();

    return () => { cancelled = true; };
  }, [slug]);

  // ---- physical keyboard support for PIN ----
  useEffect(() => {
    if (storeState !== 'found') return;

    const handleKey = (e) => {
      // Only handle digit keys when focus is NOT on the username input
      if (document.activeElement === usernameRef.current) return;

      if (e.key >= '0' && e.key <= '9') {
        appendDigit(e.key);
      } else if (e.key === 'Backspace') {
        deleteDigit();
      } else if (e.key === 'Enter') {
        handleSubmit();
      }
    };

    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeState, pin, username, loading]);

  // ---- PIN helpers ----
  const appendDigit = (d) => {
    setPin((prev) => {
      if (prev.length >= 6) return prev;
      return prev + d;
    });
    setPinError('');
    setSubmitError('');
  };

  const deleteDigit = () => {
    setPin((prev) => prev.slice(0, -1));
    setPinError('');
    setSubmitError('');
  };

  const clearPin = () => {
    setPin('');
    setPinError('');
    setSubmitError('');
  };

  // ---- auto-submit at 6 digits ----
  useEffect(() => {
    if (pin.length === 6) {
      handleSubmit();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin]);

  // ---- submit ----
  const handleSubmit = useCallback(async () => {
    // Validate
    let valid = true;
    if (!username.trim()) {
      setUsernameError('Username is required');
      valid = false;
    }
    if (pin.length < 4) {
      setPinError('PIN must be 4–6 digits');
      valid = false;
    }
    if (!valid) return;

    setLoading(true);
    setSubmitError('');

    try {
      // Try the new actor-overlay endpoint first. It requires an existing
      // member bearer token in localStorage (the device owner's session).
      // If the device has no member session yet, fall back to the legacy
      // full-session PIN login so the flow degrades gracefully.
      let result = await pinVerifyOverlay(username.trim(), pin, store.location_id, slug);

      if (!result.ok && result.error && /401|unauthorized|not authenticated/i.test(result.error)) {
        // Device is not authenticated as a member — fall back to legacy login.
        result = await pinLogin(username.trim(), pin, store.location_id);
        if (!result.ok) {
          setSubmitError(result.error);
          clearPin();
          return;
        }
        // Legacy path: persist full session token.
        if (result.data?.access_token) {
          localStorage.setItem('bb.auth', JSON.stringify(result.data));
        }
        navigate(resolvePostLoginPath(result.data));
        return;
      }

      if (!result.ok) {
        setSubmitError(result.error);
        clearPin();
        return;
      }

      // Overlay path: set actor in memory, do NOT touch localStorage.
      setActor(result.data);
      navigate(resolvePostLoginPath(result.data));
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username, pin, store, navigate, setActor, slug]);

  // ---- render guards ----
  if (storeState === 'loading') return <LoadingScreen />;
  if (storeState === 'not_found') return <StoreNotFound />;
  if (storeState === 'error') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-slate-50 via-white to-slate-100 dark:from-gray-950 dark:via-gray-900 dark:to-gray-950 px-4 py-8">
        <div className="w-full max-w-sm mx-auto text-center space-y-4">
          <AlertCircle className="w-10 h-10 text-red-400 mx-auto" />
          <h1 className="text-xl font-bold text-foreground">Something went wrong</h1>
          <p className="text-sm text-muted-foreground">
            We couldn&apos;t reach the server. Check your connection and refresh the page.
          </p>
          <Button
            type="button"
            variant="link"
            onClick={() => window.location.reload()}
            className="text-sm font-semibold text-orange-600 hover:text-orange-700 h-auto p-0"
          >
            Retry
          </Button>
        </div>
      </div>
    );
  }

  // ---- main PIN login UI ----
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-slate-50 via-white to-slate-100 dark:from-gray-950 dark:via-gray-900 dark:to-gray-950 px-4 py-8 relative overflow-hidden">
      {/* Subtle background blobs */}
      <div className="absolute top-10 left-8 w-20 h-20 bg-primary/5 rounded-full opacity-50 pointer-events-none" />
      <div className="absolute bottom-10 right-8 w-16 h-16 bg-primary/5 rounded-full opacity-50 pointer-events-none" />

      <div className="w-full max-w-[360px] mx-auto space-y-5 relative z-10">
        {/* Brand + store name header */}
        <div className="text-center space-y-1">
          <div className="flex justify-center mb-2">
            <div className="relative w-14 h-14 beepbite-gradient rounded-2xl flex items-center justify-center shadow-lg border-4 border-white">
              <img
                src="/icon.svg"
                alt="BeepBite"
                className="w-8 h-8 filter brightness-0 invert"
              />
              <div className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full animate-pulse shadow-lg" />
            </div>
          </div>
          <h1 className="text-3xl font-bold tracking-tight">
            <span className="beepbite-gradient-text">Beep</span>
            <span className="text-foreground">Bite</span>
          </h1>
          {/* Store display name — the key branding for this scoped route */}
          <p className="text-sm font-semibold text-foreground/80 truncate px-2">
            {store.display_name}
          </p>
          <p className="text-xs text-muted-foreground">Staff PIN Login</p>
        </div>

        <Card className="border border-border shadow-xl bg-card/95 backdrop-blur-sm">
          <CardHeader className="space-y-0.5 pb-2 text-center px-5 pt-5">
            <CardTitle className="text-lg font-bold text-foreground">Welcome</CardTitle>
            <CardDescription className="text-sm text-muted-foreground">
              Enter your username and PIN
            </CardDescription>
          </CardHeader>

          <CardContent className="px-5 pb-6 space-y-4">
            {/* Global submit error */}
            {submitError && (
              <Alert variant="destructive" className="border-l-4 border-red-500 bg-red-50/80">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription className="text-sm">{submitError}</AlertDescription>
              </Alert>
            )}

            {/* Username field */}
            <div className="space-y-1.5">
              <Label htmlFor="sp-username" className="text-sm font-medium text-foreground">
                Username
              </Label>
              <div className="relative">
                <User className="absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" />
                <Input
                  id="sp-username"
                  ref={usernameRef}
                  type="text"
                  autoComplete="username"
                  placeholder="Enter your username"
                  value={username}
                  onChange={(e) => {
                    setUsername(e.target.value);
                    if (usernameError) setUsernameError('');
                    if (submitError) setSubmitError('');
                  }}
                  onKeyDown={(e) => {
                    // Prevent Enter from being swallowed by the keydown listener
                    if (e.key === 'Enter') e.preventDefault();
                  }}
                  disabled={loading}
                  className={`pl-10 h-11 bg-background border-border focus:border-primary transition-all text-base ${usernameError ? 'border-red-400' : ''}`}
                />
              </div>
              {usernameError && (
                <p className="text-xs text-red-500">{usernameError}</p>
              )}
            </div>

            {/* PIN keypad */}
            <PinKeypad
              pin={pin}
              maxLength={6}
              minLength={4}
              onDigit={appendDigit}
              onDelete={deleteDigit}
              onClear={clearPin}
              onSubmit={handleSubmit}
              loading={loading}
              error={pinError}
            />
          </CardContent>
        </Card>

        {/* Escape hatch for owners / managers */}
        <div className="text-center">
          <p className="text-xs text-muted-foreground">
            Owner or admin?{' '}
            <Button
              type="button"
              variant="link"
              onClick={() => navigate('/signin?next=/pos/workspace')}
              className="font-semibold text-orange-600 hover:text-orange-700 h-auto p-0 text-xs"
            >
              Sign in with email &rarr;
            </Button>
          </p>
        </div>

        <p className="text-center text-xs text-muted-foreground">
          &copy; {new Date().getFullYear()} BeepBite &mdash; Staff Terminal
        </p>
      </div>
    </div>
  );
};

export default StaffPinPage;
