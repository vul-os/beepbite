/**
 * Onboarding wizard — /onboard
 *
 * A six-step resumable setup guide for new organisations:
 *   0  Verify email
 *   1  Create first store (location)
 *   2  Add 5 menu items
 *   3  Invite staff / driver
 *   4  Connect payment provider or set on-delivery
 *   5  Ship a test order
 *
 * Progress is persisted per-org via PUT /onboarding/progress after every step
 * advance, and resumed on load via GET /onboarding/progress.
 * Real completion state is checked via GET /onboarding/status so the wizard
 * reflects actual DB state, not just what the user clicked.
 *
 * Each step delegates action to EXISTING routes / endpoints — this wizard
 * provides navigation and progress tracking only; it does not re-implement
 * data creation logic.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CheckCircle2,
  Circle,
  ChevronRight,
  ChevronLeft,
  Mail,
  MapPin,
  UtensilsCrossed,
  Users,
  CreditCard,
  ShoppingBag,
  Loader2,
  ExternalLink,
  Sparkles,
  RefreshCw,
} from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';

import { useAuth } from '@/context/auth-context';
import { getProgress, putProgress, getStatus } from '@/services/onboarding';

// ---------------------------------------------------------------------------
// Step definitions
// ---------------------------------------------------------------------------

const STEP_KEYS = ['email', 'location', 'menu', 'staff', 'payment', 'order'];

const STEPS = [
  {
    key: 'email',
    icon: Mail,
    title: 'Verify your email',
    description:
      'Confirm your email address so we can send you important notifications about your account.',
    hint: 'Check your inbox for a verification link from BeepBite. Once verified, continue to the next step.',
    actionLabel: null,      // no external navigation needed
    actionPath: null,
    statusKey: null,        // no live status for email (always starts done once logged in)
  },
  {
    key: 'location',
    icon: MapPin,
    title: 'Create your first store',
    description:
      'Add a location — a physical store, kitchen or service point. You need at least one to start taking orders.',
    hint: 'Go to Settings → Locations → Add location. Fill in your store name, slug and city.',
    actionLabel: 'Go to Settings',
    actionPath: '/settings',
    statusKey: 'has_location',
  },
  {
    key: 'menu',
    icon: UtensilsCrossed,
    title: 'Add 5 menu items',
    description:
      'Add the items you sell — food, drinks, products or services. You need at least 5 active items to start selling.',
    hint: 'Go to Menu → Categories, create a category, then add items with names and prices.',
    actionLabel: 'Go to Menu',
    actionPath: '/menu',
    statusKey: 'has_five_items',
  },
  {
    key: 'staff',
    icon: Users,
    title: 'Invite a staff member or driver',
    description:
      'Add at least one team member so they can take orders, manage the kitchen or make deliveries.',
    hint: 'Go to Staff → Add staff member, enter their name and PIN. For drivers use the Drivers section.',
    actionLabel: 'Go to Staff',
    actionPath: '/staff',
    statusKey: 'has_staff_or_driver',
  },
  {
    key: 'payment',
    icon: CreditCard,
    title: 'Connect a payment provider',
    description:
      'Connect Paystack, Stripe, Yoco or Zapper — or enable cash / on-delivery so customers can pay.',
    hint: 'Go to Settings → Location → Payments. Alternatively, on-delivery orders work without an online provider.',
    actionLabel: 'Go to Payment Settings',
    actionPath: '/settings',
    statusKey: 'has_payment',
  },
  {
    key: 'order',
    icon: ShoppingBag,
    title: 'Ship a test order',
    description:
      'Open the POS, add items to a cart and complete a sale. This confirms your full setup is working.',
    hint: 'Open the POS from the sidebar, select items, choose a payment method and complete the order.',
    actionLabel: 'Open POS',
    actionPath: '/pos',
    statusKey: 'has_order',
  },
];

// ---------------------------------------------------------------------------
// Hook: load + persist progress
// ---------------------------------------------------------------------------

function useOnboardingProgress() {
  const [step, setStep] = useState(0);
  const [completedSteps, setCompletedSteps] = useState([]);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [statusLoading, setStatusLoading] = useState(false);

  // Load saved progress on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await getProgress();
      if (!cancelled) {
        if (!error && data) {
          setStep(data.step ?? 0);
          setCompletedSteps(data.completed_steps ?? []);
        }
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Fetch live status from the backend.
  const refreshStatus = useCallback(async () => {
    setStatusLoading(true);
    const { data, error } = await getStatus();
    if (!error && data) {
      setStatus(data);
    }
    setStatusLoading(false);
    return data;
  }, []);

  // Load status once progress has loaded.
  useEffect(() => {
    if (!loading) {
      refreshStatus();
    }
  }, [loading, refreshStatus]);

  // Advance to a step and persist.
  const advanceTo = useCallback(async (newStep, newCompleted) => {
    setSaving(true);
    const { data, error } = await putProgress({
      step: newStep,
      completed_steps: newCompleted,
    });
    if (!error && data) {
      setStep(data.step);
      setCompletedSteps(data.completed_steps ?? []);
    }
    setSaving(false);
    return !error;
  }, []);

  return {
    step,
    completedSteps,
    status,
    loading,
    saving,
    statusLoading,
    advanceTo,
    refreshStatus,
  };
}

// ---------------------------------------------------------------------------
// Wizard page component
// ---------------------------------------------------------------------------

export default function OnboardPage() {
  const navigate = useNavigate();
  const { activeOrganization, user } = useAuth();

  const {
    step,
    completedSteps,
    status,
    loading,
    saving,
    statusLoading,
    advanceTo,
    refreshStatus,
  } = useOnboardingProgress();

  // Derive which steps are actually done using live status where available.
  const isStepDone = useCallback(
    (stepKey, stepIndex) => {
      // Email step: always done once the user is logged in (JWT implies verified).
      if (stepKey === 'email') return true;
      // Check live status first.
      const def = STEPS[stepIndex];
      if (def.statusKey && status) {
        return !!status[def.statusKey];
      }
      // Fall back to completed_steps array.
      return completedSteps.includes(stepKey);
    },
    [status, completedSteps]
  );

  const doneCount = STEPS.filter((s, i) => isStepDone(s.key, i)).length;
  const totalCount = STEPS.length;
  const progressPct = Math.round((doneCount / totalCount) * 100);
  const allDone = doneCount === totalCount;

  // Mark current step complete and advance.
  const handleMarkDoneAndNext = useCallback(async () => {
    const currentKey = STEPS[step]?.key;
    const newCompleted = completedSteps.includes(currentKey)
      ? completedSteps
      : [...completedSteps, currentKey];
    const nextStep = Math.min(step + 1, totalCount - 1);
    await advanceTo(nextStep, newCompleted);
    await refreshStatus();
  }, [step, completedSteps, advanceTo, refreshStatus, totalCount]);

  // Go back.
  const handleBack = useCallback(async () => {
    const prevStep = Math.max(step - 1, 0);
    await advanceTo(prevStep, completedSteps);
  }, [step, completedSteps, advanceTo]);

  // Jump to any step.
  const handleJumpTo = useCallback(async (idx) => {
    await advanceTo(idx, completedSteps);
  }, [completedSteps, advanceTo]);

  // Navigate to the action path for the current step.
  const handleNavigate = useCallback((path) => {
    navigate(path);
  }, [navigate]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-orange-500" />
      </div>
    );
  }

  const currentStepDef = STEPS[step];
  const StepIcon = currentStepDef?.icon || Sparkles;

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-white to-orange-50 pt-8 pb-16 px-4">
      <div className="max-w-2xl mx-auto space-y-6">

        {/* ── Hero / progress card ── */}
        <Card className="border-0 shadow-lg bg-gradient-to-r from-orange-500 to-orange-600 text-white overflow-hidden relative">
          <div className="absolute inset-0 opacity-10">
            <div className="absolute top-0 right-0 w-64 h-64 rounded-full bg-white -translate-y-1/2 translate-x-1/2" />
          </div>
          <CardContent className="p-6 sm:p-8 relative">
            <div className="flex items-start gap-3 mb-4">
              <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-white/20 backdrop-blur-sm shrink-0">
                <Sparkles className="w-5 h-5 text-white" />
              </div>
              <div className="min-w-0">
                <h1 className="text-xl sm:text-2xl font-bold leading-tight">
                  {allDone
                    ? `${activeOrganization?.name || 'Your business'} is ready!`
                    : `Set up ${activeOrganization?.name || 'your business'}`}
                </h1>
                <p className="text-orange-100 text-sm mt-1">
                  {allDone
                    ? 'All steps complete. You can start taking orders.'
                    : 'Complete each step to unlock the full BeepBite experience.'}
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-orange-100">Setup progress</span>
                <span className="font-semibold tabular-nums">
                  {doneCount} of {totalCount} complete
                </span>
              </div>
              <div className="h-2.5 rounded-full bg-white/20 overflow-hidden">
                <div
                  className="h-full rounded-full bg-white transition-all duration-700 ease-out"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>

            {allDone && (
              <div className="mt-4 flex items-center gap-2 text-sm font-medium bg-white/20 rounded-lg px-4 py-2">
                <CheckCircle2 className="w-4 h-4" />
                All set! Head to the POS to start serving customers.
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Step list (overview) ── */}
        <div className="space-y-2">
          {STEPS.map((s, idx) => {
            const done = isStepDone(s.key, idx);
            const isCurrent = idx === step;
            const Icon = s.icon;

            return (
              <button
                key={s.key}
                type="button"
                onClick={() => handleJumpTo(idx)}
                disabled={saving}
                className={cn(
                  'w-full text-left rounded-xl border px-4 py-3 flex items-center gap-3 transition-all duration-150',
                  isCurrent
                    ? 'border-orange-300 bg-white shadow-md ring-1 ring-orange-100'
                    : done
                    ? 'border-green-200 bg-green-50/60'
                    : 'border-gray-200 bg-white opacity-70 hover:opacity-100',
                  saving && 'cursor-not-allowed'
                )}
              >
                <span className="shrink-0">
                  {done ? (
                    <CheckCircle2 className="w-5 h-5 text-green-500" />
                  ) : (
                    <Circle
                      className={cn(
                        'w-5 h-5',
                        isCurrent ? 'text-orange-400' : 'text-gray-300'
                      )}
                    />
                  )}
                </span>
                <span
                  className={cn(
                    'flex items-center gap-2 flex-1 min-w-0',
                    done ? 'text-green-700' : isCurrent ? 'text-gray-900 font-semibold' : 'text-gray-600'
                  )}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="text-sm truncate">{s.title}</span>
                </span>
                {isCurrent && (
                  <Badge className="bg-orange-100 text-orange-700 border-orange-200 border text-xs shrink-0">
                    Current
                  </Badge>
                )}
              </button>
            );
          })}
        </div>

        {/* ── Active step detail card ── */}
        {currentStepDef && (
          <Card className="border border-orange-200 shadow-sm">
            <CardContent className="p-6 space-y-4">
              <div className="flex items-start gap-3">
                <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-orange-100 shrink-0">
                  <StepIcon className="w-5 h-5 text-orange-600" />
                </div>
                <div>
                  <h2 className="font-semibold text-gray-900 text-base">
                    Step {step + 1} — {currentStepDef.title}
                  </h2>
                  <p className="text-sm text-gray-600 mt-1 leading-relaxed">
                    {currentStepDef.description}
                  </p>
                </div>
              </div>

              {/* Hint */}
              <div className="rounded-lg bg-orange-50 border border-orange-100 px-4 py-3 text-sm text-orange-800 leading-relaxed">
                {currentStepDef.hint}
              </div>

              {/* Live status indicator */}
              {currentStepDef.statusKey && status && (
                <div
                  className={cn(
                    'flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium',
                    isStepDone(currentStepDef.key, step)
                      ? 'bg-green-50 text-green-700 border border-green-200'
                      : 'bg-yellow-50 text-yellow-700 border border-yellow-200'
                  )}
                >
                  {isStepDone(currentStepDef.key, step) ? (
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                  ) : (
                    <Circle className="w-4 h-4 shrink-0" />
                  )}
                  {isStepDone(currentStepDef.key, step)
                    ? 'Completed — verified from your account data.'
                    : 'Not yet complete — follow the steps above, then refresh.'}
                  <button
                    type="button"
                    onClick={refreshStatus}
                    disabled={statusLoading}
                    className="ml-auto flex items-center gap-1 text-xs opacity-70 hover:opacity-100"
                    title="Re-check status"
                  >
                    <RefreshCw className={cn('w-3 h-3', statusLoading && 'animate-spin')} />
                    Refresh
                  </button>
                </div>
              )}

              {/* Actions */}
              <div className="flex flex-wrap items-center gap-3 pt-1">
                {/* Back */}
                {step > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleBack}
                    disabled={saving}
                    className="gap-1"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    Back
                  </Button>
                )}

                {/* External action link */}
                {currentStepDef.actionPath && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleNavigate(currentStepDef.actionPath)}
                    className="gap-1"
                  >
                    {currentStepDef.actionLabel}
                    <ExternalLink className="w-3.5 h-3.5" />
                  </Button>
                )}

                {/* Mark done / continue */}
                {step < totalCount - 1 ? (
                  <Button
                    size="sm"
                    onClick={handleMarkDoneAndNext}
                    disabled={saving}
                    className="gap-1 bg-orange-500 hover:bg-orange-600 text-white ml-auto"
                  >
                    {saving ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <>
                        Mark done &amp; continue
                        <ChevronRight className="w-4 h-4" />
                      </>
                    )}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    onClick={() => navigate('/pos')}
                    className="gap-1 bg-orange-500 hover:bg-orange-600 text-white ml-auto"
                  >
                    Open POS
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Help footer ── */}
        <p className="text-center text-xs text-gray-400 px-4">
          Need help?{' '}
          <a
            href="/docs/getting-started"
            className="underline hover:text-orange-500"
          >
            Read the Getting Started guide
          </a>
          . You can return to this wizard any time.
        </p>
      </div>
    </div>
  );
}
