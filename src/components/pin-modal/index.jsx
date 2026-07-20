// pin-modal/index.jsx
//
// Modal that prompts for a staff PIN without losing in-progress work.
// It renders as an overlay on top of whatever the user was doing (cart /
// ticket state is untouched in React — only this layer is added to the DOM).
//
// Two modes:
//   Normal re-auth  — actor session expired; asks for the CURRENT actor's PIN.
//   Manager override — a capability is missing; asks for a MANAGER's PIN for
//                      a single one-shot request.
//
// The modal is opened imperatively via the PinModalContext / usePinModal hook.

/* eslint-disable react/prop-types */
import React, {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, ShieldCheck, User } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';

import PinKeypad from './pin-keypad';
import { pinLogin } from '@/services/staff-pin';
import { useActor } from '@/context/actor-token-context';

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const PinModalContext = createContext(undefined);

export function usePinModalContext() {
  const ctx = useContext(PinModalContext);
  if (ctx === undefined) {
    throw new Error('usePinModalContext must be used within PinModalProvider');
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// Provider — wraps the app (or just the POS subtree) once
// ---------------------------------------------------------------------------

export function PinModalProvider({ children }) {
  // Queue of pending requests: { resolve, reject, reason, isManagerOverride }
  const queueRef = useRef([]);
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState(null); // current queue head

  const openNext = useCallback(() => {
    if (queueRef.current.length === 0) {
      setOpen(false);
      setCurrent(null);
      return;
    }
    const head = queueRef.current[0];
    setCurrent(head);
    setOpen(true);
  }, []);

  /**
   * requestPin({ reason, isManagerOverride }) → Promise<actor|one-shot-token>
   *
   * If an identical request is already pending (same isManagerOverride flag),
   * we reuse the existing promise so multiple callers don't stack up modals.
   */
  const requestPin = useCallback(({ reason = '', isManagerOverride = false } = {}) => {
    return new Promise((resolve, reject) => {
      queueRef.current.push({ resolve, reject, reason, isManagerOverride });
      // If the modal is already open for a different request, don't re-open.
      if (!open) openNext();
    });
  }, [open, openNext]);

  const resolveHead = useCallback((value) => {
    const head = queueRef.current.shift();
    if (head) head.resolve(value);
    openNext();
  }, [openNext]);

  const rejectHead = useCallback((reason) => {
    const head = queueRef.current.shift();
    if (head) head.reject(reason || new Error('PIN modal cancelled'));
    openNext();
  }, [openNext]);

  return (
    <PinModalContext.Provider value={{ requestPin }}>
      {children}
      <PinModalDialog
        open={open}
        current={current}
        onSuccess={resolveHead}
        onCancel={rejectHead}
      />
    </PinModalContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Inner dialog — owns all UI + submission state
// ---------------------------------------------------------------------------

function PinModalDialog({ open, current, onSuccess, onCancel }) {
  const navigate = useNavigate();
  const { actor, setActor } = useActor();

  const isManagerOverride = current?.isManagerOverride ?? false;

  // When the current actor is known, pre-fill username and lock the field.
  // In manager-override mode the actor field is blank — someone else must log in.
  const prefilledUsername = !isManagerOverride && actor?.display_name ? actor.display_name : '';

  const [username, setUsername] = useState('');
  const [usernameError, setUsernameError] = useState('');
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [loading, setLoading] = useState(false);

  // Reset state every time the dialog opens.
  const prevOpen = useRef(false);
  if (open !== prevOpen.current) {
    prevOpen.current = open;
    if (open) {
      setUsername('');
      setUsernameError('');
      setPin('');
      setPinError('');
      setSubmitError('');
      setLoading(false);
    }
  }

  // ---- PIN helpers ----------------------------------------------------------

  const appendDigit = (d) => {
    setPin((prev) => (prev.length >= 6 ? prev : prev + d));
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

  // ---- submit ---------------------------------------------------------------

  const handleSubmit = useCallback(async () => {
    const effectiveUsername = isManagerOverride
      ? username.trim()
      : (prefilledUsername || username.trim());

    let valid = true;
    if (!effectiveUsername) {
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
      // We need a location_id. In normal re-auth it comes from the current actor
      // (which may be null if expired — fall back to the staff session from
      // localStorage via readStaffSession). In manager-override the actor might
      // be a different person so we still use the current session's location.
      const { readStaffSession } = await import('@/services/pos');
      const session = readStaffSession();
      const locationId =
        actor?.location_id ||
        session?.staff?.location_id ||
        session?.location_id ||
        '';

      if (!locationId) {
        setSubmitError('Cannot determine your store location. Please sign in again.');
        return;
      }

      const result = await pinLogin(effectiveUsername, pin, locationId);

      if (!result.ok) {
        setSubmitError(result.error || 'Invalid username or PIN.');
        clearPin();
        return;
      }

      if (isManagerOverride) {
        // Manager override: do NOT call setActor (don't permanently switch).
        // Return the raw one-shot token to the caller.
        const oneShotToken = result.data?.access_token ?? result.data?.token ?? '';
        onSuccess(oneShotToken);
      } else {
        // Normal re-auth: store the new actor and return the actor object.
        setActor(result.data);
        onSuccess(result.data);
      }
    } catch (err) {
      setSubmitError(err?.message || 'Something went wrong. Try again.');
      clearPin();
    } finally {
      setLoading(false);
    }
  }, [isManagerOverride, username, prefilledUsername, pin, actor, setActor, onSuccess]);

  // Auto-submit at 6 digits.
  React.useEffect(() => {
    if (pin.length === 6 && open && !loading) {
      handleSubmit();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin]);

  // ---- cancel ---------------------------------------------------------------

  const handleCancel = () => {
    onCancel(new Error('PIN cancelled'));
    if (!isManagerOverride) {
      // The user chose not to re-auth → kick back to the PIN login page.
      navigate('/pos/login', { replace: true });
    }
  };

  // ---- render ---------------------------------------------------------------

  const title = isManagerOverride
    ? 'Manager override'
    : 'Confirm your PIN to continue';

  const description = isManagerOverride
    ? (current?.reason
        ? `A manager PIN is required to: ${current.reason}`
        : 'This action requires a manager PIN. Your session will not change.')
    : 'Your session has expired. Re-enter your PIN to pick up where you left off.';

  const needsUsernameField = isManagerOverride || !prefilledUsername;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) handleCancel();
      }}
    >
      <DialogContent
        className="sm:max-w-[400px] p-0 overflow-hidden"
        // Prevent closing by clicking the overlay so the user must make a choice.
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader className="px-6 pt-6 pb-4 space-y-1.5">
          <div className="flex items-center gap-2">
            {isManagerOverride ? (
              <ShieldCheck className="w-5 h-5 text-amber-500 shrink-0" />
            ) : (
              <User className="w-5 h-5 text-primary shrink-0" />
            )}
            <DialogTitle className="text-lg font-bold text-foreground leading-tight">
              {title}
            </DialogTitle>
          </div>
          <DialogDescription className="text-sm text-muted-foreground leading-snug">
            {description}
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 pb-6 space-y-4">
          {submitError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-sm">{submitError}</AlertDescription>
            </Alert>
          )}

          {/* Username — pre-filled and read-only for normal re-auth */}
          {needsUsernameField ? (
            <div className="space-y-1.5">
              <Label htmlFor="pm-username" className="text-sm font-medium text-foreground">
                {isManagerOverride ? "Manager's username" : 'Username'}
              </Label>
              <div className="relative">
                <User className="absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" />
                <Input
                  id="pm-username"
                  type="text"
                  autoComplete="username"
                  placeholder="Enter username"
                  value={username}
                  onChange={(e) => {
                    setUsername(e.target.value);
                    if (usernameError) setUsernameError('');
                    if (submitError) setSubmitError('');
                  }}
                  disabled={loading}
                  className={`pl-10 h-11 focus:border-primary transition-all text-base ${usernameError ? 'border-destructive' : ''}`}
                />
              </div>
              {usernameError && (
                <p className="text-xs text-destructive">{usernameError}</p>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted border border-border">
              <User className="w-4 h-4 text-muted-foreground shrink-0" />
              <span className="text-sm font-medium text-foreground">{prefilledUsername}</span>
              <span className="ml-auto text-[11px] text-muted-foreground uppercase tracking-wide">current session</span>
            </div>
          )}

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
            submitLabel={isManagerOverride ? 'Authorise' : 'Continue'}
          />

          <Button
            type="button"
            variant="ghost"
            className="w-full h-10 text-sm text-muted-foreground hover:text-foreground"
            onClick={handleCancel}
            disabled={loading}
          >
            {isManagerOverride ? 'Cancel' : 'Sign out instead'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default PinModalProvider;
