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
  BookOpen,
  Store,
} from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { useAuth } from '@/context/auth-context';
import { getProgress, putProgress, getStatus } from '@/services/onboarding';

// ---------------------------------------------------------------------------
// Service-style localStorage helpers (shared key with workspace + settings)
// ---------------------------------------------------------------------------
function getServiceStyleForOnboard(locId) {
  if (!locId) return null;
  try {
    const v = localStorage.getItem(`bb_service_style_${locId}`);
    return v === 'takeaway' || v === 'dine_in' ? v : null;
  } catch { return null; }
}
function setServiceStyleForOnboard(locId, value) {
  if (!locId) return;
  try { localStorage.setItem(`bb_service_style_${locId}`, value); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Step definitions
// ---------------------------------------------------------------------------

const STEPS = [
  {
    key: 'email',
    icon: Mail,
    title: 'Verify your email',
    description:
      'Confirm your email address so we can send you important notifications about your account.',
    hint: 'Check your inbox for a verification link from BeepBite. Once verified, continue to the next step.',
    actionLabel: null,
    actionPath: null,
    statusKey: null,
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
    key: 'service_style',
    icon: Store,
    title: 'How do you serve customers?',
    description:
      'Tell BeepBite your service style so it shows the right features — floor plan and dine-in seating for restaurants, or a clean counter flow for market stalls and takeaway counters.',
    hint: 'Pick the style that best describes this location. You can always change it later in Settings → Location → Status.',
    actionLabel: null,
    actionPath: null,
    statusKey: null,
    isServiceStyleStep: true,
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

  const refreshStatus = useCallback(async () => {
    setStatusLoading(true);
    const { data, error } = await getStatus();
    if (!error && data) {
      setStatus(data);
    }
    setStatusLoading(false);
    return data;
  }, []);

  useEffect(() => {
    if (!loading) {
      refreshStatus();
    }
  }, [loading, refreshStatus]);

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
// Small presentational helpers
// ---------------------------------------------------------------------------

/** Shared brand mark used in the loading screen */
function BrandMark() {
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative">
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-orange-500 to-orange-600 flex items-center justify-center shadow">
          <img src="/icon.svg" alt="" aria-hidden="true" className="w-7 h-7 filter brightness-0 invert" />
        </div>
        <span aria-hidden="true" className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full border-2 border-white animate-pulse" />
      </div>
      <p className="text-lg font-bold tracking-tight leading-none">
        <span className="text-orange-500">Beep</span><span className="text-gray-900">Bite</span>
      </p>
    </div>
  );
}

/** Step number badge in the sidebar list */
function StepBadge({ index, done, isCurrent }) {
  if (done) {
    return (
      <span className="w-6 h-6 rounded-full flex items-center justify-center bg-green-100 shrink-0">
        <CheckCircle2 className="w-4 h-4 text-green-600" aria-hidden="true" />
      </span>
    );
  }
  return (
    <span
      className={cn(
        'w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 border',
        isCurrent
          ? 'bg-orange-500 text-white border-orange-500'
          : 'bg-white text-gray-400 border-gray-300'
      )}
      aria-hidden="true"
    >
      {index + 1}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Wizard page component
// ---------------------------------------------------------------------------

export default function OnboardPage() {
  const navigate = useNavigate();
  const { activeOrganization, locations } = useAuth();

  // Service style for the first location
  const firstLocationId = locations?.[0]?.id;
  const [serviceStyle, setServiceStyleState] = useState(() =>
    getServiceStyleForOnboard(firstLocationId)
  );
  useEffect(() => {
    setServiceStyleState(getServiceStyleForOnboard(firstLocationId));
  }, [firstLocationId]);

  const handlePickServiceStyle = useCallback((style) => {
    setServiceStyleForOnboard(firstLocationId, style);
    setServiceStyleState(style);
  }, [firstLocationId]);

  const serviceStyleChosen = serviceStyle === 'dine_in' || serviceStyle === 'takeaway';

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

  const isStepDone = useCallback(
    (stepKey, stepIndex) => {
      if (stepKey === 'email') return true;
      if (stepKey === 'service_style') return serviceStyleChosen;
      const def = STEPS[stepIndex];
      if (def.statusKey && status) {
        return !!status[def.statusKey];
      }
      return completedSteps.includes(stepKey);
    },
    [status, completedSteps, serviceStyleChosen]
  );

  const doneCount = STEPS.filter((s, i) => isStepDone(s.key, i)).length;
  const totalCount = STEPS.length;
  const progressPct = Math.round((doneCount / totalCount) * 100);
  const allDone = doneCount === totalCount;

  const handleMarkDoneAndNext = useCallback(async () => {
    const currentKey = STEPS[step]?.key;
    const newCompleted = completedSteps.includes(currentKey)
      ? completedSteps
      : [...completedSteps, currentKey];
    const nextStep = Math.min(step + 1, totalCount - 1);
    await advanceTo(nextStep, newCompleted);
    await refreshStatus();
  }, [step, completedSteps, advanceTo, refreshStatus, totalCount]);

  const handleBack = useCallback(async () => {
    const prevStep = Math.max(step - 1, 0);
    await advanceTo(prevStep, completedSteps);
  }, [step, completedSteps, advanceTo]);

  const handleJumpTo = useCallback(async (idx) => {
    await advanceTo(idx, completedSteps);
  }, [completedSteps, advanceTo]);

  const handleNavigate = useCallback((path) => {
    navigate(path);
  }, [navigate]);

  // ── Loading screen ──────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-gradient-to-br from-slate-50 via-white to-orange-50">
        <BrandMark />
        <div className="flex items-center gap-2 text-gray-500 text-sm">
          <Loader2 className="w-4 h-4 animate-spin text-orange-500" aria-hidden="true" />
          Loading your setup progress…
        </div>
      </div>
    );
  }

  const currentStepDef = STEPS[step];
  const StepIcon = currentStepDef?.icon || Sparkles;
  const stepDone = isStepDone(currentStepDef?.key, step);

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-white to-orange-50 pt-6 pb-16 px-4">
      <div className="max-w-2xl mx-auto space-y-5">

        {/* ── Hero / progress card ─────────────────────────────────────────── */}
        <Card className="border-0 shadow-lg overflow-hidden">
          <div className="bg-gradient-to-r from-orange-500 to-orange-600 text-white relative">
            {/* Decorative circle */}
            <div aria-hidden="true" className="absolute top-0 right-0 w-48 h-48 rounded-full bg-white/10 -translate-y-1/2 translate-x-1/4" />

            <div className="relative p-6 sm:p-8">
              {/* Header row */}
              <div className="flex items-start gap-3 mb-5">
                <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center shrink-0" aria-hidden="true">
                  <Sparkles className="w-5 h-5 text-white" />
                </div>
                <div className="min-w-0">
                  <h1 className="text-lg sm:text-xl font-bold leading-snug">
                    {allDone
                      ? `${activeOrganization?.name || 'Your business'} is ready!`
                      : `Set up ${activeOrganization?.name || 'your business'}`}
                  </h1>
                  <p className="text-orange-100 text-sm mt-0.5">
                    {allDone
                      ? 'All steps complete. You can start taking orders.'
                      : 'Complete each step to unlock the full BeepBite experience.'}
                  </p>
                </div>
              </div>

              {/* Progress bar */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-orange-100">Setup progress</span>
                  <span className="font-semibold tabular-nums">
                    {doneCount} / {totalCount} complete
                  </span>
                </div>
                <div
                  className="h-2.5 rounded-full bg-white/25 overflow-hidden"
                  role="progressbar"
                  aria-valuenow={doneCount}
                  aria-valuemin={0}
                  aria-valuemax={totalCount}
                  aria-label={`${doneCount} of ${totalCount} steps complete`}
                >
                  <div
                    className="h-full rounded-full bg-white transition-all duration-700 ease-out"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
              </div>

              {/* All-done CTA */}
              {allDone && (
                <button
                  type="button"
                  onClick={() => navigate('/pos')}
                  className="mt-4 w-full sm:w-auto flex items-center justify-center gap-2 text-sm font-semibold bg-white text-orange-600 rounded-lg px-5 py-2.5 hover:bg-orange-50 transition-colors shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                >
                  <ShoppingBag className="w-4 h-4" aria-hidden="true" />
                  Open POS and start serving
                  <ChevronRight className="w-4 h-4" aria-hidden="true" />
                </button>
              )}
            </div>
          </div>

          {/* Resumability cue */}
          <div className="bg-orange-50 border-t border-orange-100 px-6 py-2.5 flex items-center gap-2 text-xs text-orange-700">
            <CheckCircle2 className="w-3.5 h-3.5 text-orange-500 shrink-0" aria-hidden="true" />
            <span>Your progress is automatically saved — you can leave and come back anytime.</span>
          </div>
        </Card>

        {/* ── Step list (nav overview) ──────────────────────────────────────── */}
        <nav aria-label="Onboarding steps">
          <ol className="space-y-2">
            {STEPS.map((s, idx) => {
              const done = isStepDone(s.key, idx);
              const isCurrent = idx === step;
              const Icon = s.icon;

              return (
                <li key={s.key}>
                  <button
                    type="button"
                    onClick={() => handleJumpTo(idx)}
                    disabled={saving}
                    aria-current={isCurrent ? 'step' : undefined}
                    aria-label={`Step ${idx + 1}: ${s.title}${done ? ' (complete)' : isCurrent ? ' (current)' : ''}`}
                    className={cn(
                      'w-full text-left rounded-xl border px-4 py-3 flex items-center gap-3 transition-all duration-150 group',
                      isCurrent
                        ? 'border-orange-300 bg-white shadow-md ring-2 ring-orange-100'
                        : done
                        ? 'border-green-200 bg-green-50/70 hover:bg-green-50'
                        : 'border-gray-200 bg-white opacity-75 hover:opacity-100 hover:border-gray-300',
                      saving && 'cursor-not-allowed opacity-60'
                    )}
                  >
                    {/* Step number / check */}
                    <StepBadge index={idx} done={done} isCurrent={isCurrent} />

                    {/* Step icon + title */}
                    <span className={cn(
                      'flex items-center gap-2 flex-1 min-w-0 text-sm',
                      done ? 'text-green-700' : isCurrent ? 'text-gray-900 font-semibold' : 'text-gray-500'
                    )}>
                      <Icon className={cn('w-4 h-4 shrink-0', done ? 'text-green-500' : isCurrent ? 'text-orange-500' : 'text-gray-400')} aria-hidden="true" />
                      <span className="truncate">{s.title}</span>
                    </span>

                    {/* Right-side indicator */}
                    {done && !isCurrent && (
                      <span className="text-xs text-green-600 font-medium shrink-0">Done</span>
                    )}
                    {isCurrent && (
                      <span className="text-xs font-semibold text-orange-600 bg-orange-100 px-2 py-0.5 rounded-full shrink-0">
                        Current
                      </span>
                    )}
                    {!done && !isCurrent && (
                      <ChevronRight className="w-3.5 h-3.5 text-gray-300 shrink-0 group-hover:text-gray-400 transition-colors" aria-hidden="true" />
                    )}
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        {/* ── Active step detail card ───────────────────────────────────────── */}
        {currentStepDef && (
          <Card className={cn(
            'border shadow-sm transition-all',
            stepDone ? 'border-green-200' : 'border-orange-200'
          )}>
            <CardContent className="p-6 space-y-5">
              {/* Step header */}
              <div className="flex items-start gap-3">
                <div className={cn(
                  'flex items-center justify-center w-11 h-11 rounded-xl shrink-0',
                  stepDone ? 'bg-green-100' : 'bg-orange-100'
                )}>
                  <StepIcon className={cn('w-5 h-5', stepDone ? 'text-green-600' : 'text-orange-600')} aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="font-semibold text-gray-900">
                      Step {step + 1} — {currentStepDef.title}
                    </h2>
                    {stepDone && (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-700 bg-green-100 px-2 py-0.5 rounded-full">
                        <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
                        Complete
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-600 mt-1 leading-relaxed">
                    {currentStepDef.description}
                  </p>
                </div>
              </div>

              {/* Hint box — hidden for service style step (the picker replaces it) */}
              {!currentStepDef.isServiceStyleStep && (
                <div className="rounded-lg bg-orange-50 border border-orange-100 px-4 py-3">
                  <p className="text-xs font-semibold text-orange-700 uppercase tracking-wide mb-1">How to complete this step</p>
                  <p className="text-sm text-orange-800 leading-relaxed">{currentStepDef.hint}</p>
                </div>
              )}

              {/* Service style picker — shown inline for the service_style step */}
              {currentStepDef.isServiceStyleStep && (
                <div className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => handlePickServiceStyle('dine_in')}
                      className={cn(
                        'flex items-start gap-3 rounded-xl border-2 p-4 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400',
                        serviceStyle === 'dine_in'
                          ? 'border-orange-400 bg-orange-50'
                          : 'border-gray-200 bg-white hover:border-orange-300 hover:bg-orange-50/50'
                      )}
                    >
                      <span className={cn(
                        'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                        serviceStyle === 'dine_in' ? 'bg-orange-100 text-orange-600' : 'bg-gray-100 text-gray-500'
                      )}>
                        <UtensilsCrossed className="h-4 w-4" />
                      </span>
                      <div>
                        <p className="text-sm font-semibold text-gray-900">Dine-in restaurant or café</p>
                        <p className="mt-0.5 text-xs text-gray-500">I have tables. I want a floor plan and dine-in seating in the POS.</p>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => handlePickServiceStyle('takeaway')}
                      className={cn(
                        'flex items-start gap-3 rounded-xl border-2 p-4 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400',
                        serviceStyle === 'takeaway'
                          ? 'border-orange-400 bg-orange-50'
                          : 'border-gray-200 bg-white hover:border-orange-300 hover:bg-orange-50/50'
                      )}
                    >
                      <span className={cn(
                        'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                        serviceStyle === 'takeaway' ? 'bg-orange-100 text-orange-600' : 'bg-gray-100 text-gray-500'
                      )}>
                        <ShoppingBag className="h-4 w-4" />
                      </span>
                      <div>
                        <p className="text-sm font-semibold text-gray-900">Takeaway, counter or market stall</p>
                        <p className="mt-0.5 text-xs text-gray-500">No tables needed. Customers order at the counter. The POS goes straight to order entry.</p>
                      </div>
                    </button>
                  </div>
                  {serviceStyleChosen && (
                    <p className="text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2 flex items-center gap-2">
                      <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                      Great choice — you can change this any time in Settings → Location.
                    </p>
                  )}
                  {!serviceStyleChosen && (
                    <p className="text-xs text-gray-500">Pick one to continue. This just personalises the POS — you can switch later.</p>
                  )}
                </div>
              )}

              {/* Live status indicator */}
              {currentStepDef.statusKey && status && (
                <div
                  className={cn(
                    'flex items-center gap-2 rounded-lg px-4 py-3 text-sm font-medium border',
                    stepDone
                      ? 'bg-green-50 text-green-700 border-green-200'
                      : 'bg-amber-50 text-amber-700 border-amber-200'
                  )}
                  role="status"
                  aria-live="polite"
                >
                  {stepDone ? (
                    <CheckCircle2 className="w-4 h-4 shrink-0 text-green-600" aria-hidden="true" />
                  ) : (
                    <Circle className="w-4 h-4 shrink-0 text-amber-500" aria-hidden="true" />
                  )}
                  <span className="flex-1">
                    {stepDone
                      ? 'Verified — this step is complete based on your account data.'
                      : 'Not yet complete — follow the instructions above, then refresh to check.'}
                  </span>
                  <button
                    type="button"
                    onClick={refreshStatus}
                    disabled={statusLoading}
                    className="ml-auto flex items-center gap-1 text-xs opacity-70 hover:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-current rounded"
                    aria-label="Re-check status"
                  >
                    <RefreshCw className={cn('w-3.5 h-3.5', statusLoading && 'animate-spin')} aria-hidden="true" />
                    Refresh
                  </button>
                </div>
              )}

              {/* Empty / next-step encouragement when not done — hidden for the service style step
                  since its inline picker replaces the normal "go here and do X" pattern */}
              {!stepDone && !currentStepDef.isServiceStyleStep && (
                <div className="rounded-lg bg-gray-50 border border-gray-200 px-4 py-3 text-sm text-gray-600">
                  <p>
                    <span className="font-medium text-gray-800">Not done yet?</span>{' '}
                    {currentStepDef.actionPath
                      ? 'Use the button below to go to the right place, complete the task, then come back and mark it done.'
                      : 'Complete the step above then click "Mark done & continue".'}
                  </p>
                </div>
              )}

              {/* Action row */}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                {step > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleBack}
                    disabled={saving}
                    className="gap-1 border-gray-300 text-gray-600 hover:bg-gray-50"
                  >
                    <ChevronLeft className="w-4 h-4" aria-hidden="true" />
                    Back
                  </Button>
                )}

                {currentStepDef.actionPath && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleNavigate(currentStepDef.actionPath)}
                    className="gap-1 border-orange-300 text-orange-700 hover:bg-orange-50"
                  >
                    {currentStepDef.actionLabel}
                    <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                  </Button>
                )}

                <div className="ml-auto">
                  {step < totalCount - 1 ? (
                    <Button
                      size="sm"
                      onClick={handleMarkDoneAndNext}
                      disabled={saving || (currentStepDef.isServiceStyleStep && !serviceStyleChosen)}
                      className="gap-1.5 bg-orange-500 hover:bg-orange-600 active:bg-orange-700 text-white font-semibold shadow-sm"
                    >
                      {saving ? (
                        <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <>
                          {stepDone ? 'Continue' : currentStepDef.isServiceStyleStep ? 'Confirm & continue' : 'Mark done & continue'}
                          <ChevronRight className="w-4 h-4" aria-hidden="true" />
                        </>
                      )}
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      onClick={() => navigate('/pos')}
                      className="gap-1.5 bg-orange-500 hover:bg-orange-600 active:bg-orange-700 text-white font-semibold shadow-sm"
                    >
                      <ShoppingBag className="w-4 h-4" aria-hidden="true" />
                      Open POS
                      <ChevronRight className="w-4 h-4" aria-hidden="true" />
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Help footer ──────────────────────────────────────────────────── */}
        <footer className="text-center space-y-1 px-4">
          <p className="text-xs text-gray-400">
            Need help?{' '}
            <a
              href="/docs/getting-started"
              className="inline-flex items-center gap-1 underline hover:text-orange-500 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-orange-500 rounded"
            >
              <BookOpen className="w-3 h-3" aria-hidden="true" />
              Read the Getting Started guide
            </a>
          </p>
          <p className="text-xs text-gray-400">
            You can return to this wizard any time from your dashboard.
          </p>
        </footer>
      </div>
    </div>
  );
}
