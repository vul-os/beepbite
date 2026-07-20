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
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary to-primary/90 flex items-center justify-center shadow">
          <img src="/icon.svg" alt="" aria-hidden="true" className="w-7 h-7 filter brightness-0 invert" />
        </div>
        <span aria-hidden="true" className="absolute -top-1 -right-1 w-3 h-3 bg-destructive rounded-full border-2 border-background animate-pulse" />
      </div>
      <p className="text-lg font-bold tracking-tight leading-none">
        <span className="text-primary">Beep</span><span className="text-foreground">Bite</span>
      </p>
    </div>
  );
}

/** Step number badge in the sidebar list */
function StepBadge({ index, done, isCurrent }) {
  if (done) {
    return (
      <span className="w-6 h-6 rounded-full flex items-center justify-center bg-beepbite-success/10 shrink-0">
        <CheckCircle2 className="w-4 h-4 text-beepbite-success" aria-hidden="true" />
      </span>
    );
  }
  return (
    <span
      className={cn(
        'w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 border',
        isCurrent
          ? 'bg-primary text-primary-foreground border-primary'
          : 'bg-card text-muted-foreground border-border'
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
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-gradient-to-br from-muted via-background to-primary/5">
        <BrandMark />
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 className="w-4 h-4 animate-spin text-primary" aria-hidden="true" />
          Loading your setup progress…
        </div>
      </div>
    );
  }

  const currentStepDef = STEPS[step];
  const StepIcon = currentStepDef?.icon || Sparkles;
  const stepDone = isStepDone(currentStepDef?.key, step);

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-primary/5 pt-6 pb-16 px-4">
      <div className="max-w-2xl mx-auto space-y-5">

        {/* ── Hero / progress card ─────────────────────────────────────────── */}
        <Card className="border-0 shadow-lg overflow-hidden">
          <div className="bg-gradient-to-r from-primary to-primary/90 text-primary-foreground relative">
            {/* Decorative circle */}
            <div aria-hidden="true" className="absolute top-0 right-0 w-48 h-48 rounded-full bg-primary-foreground/10 -translate-y-1/2 translate-x-1/4" />

            <div className="relative p-6 sm:p-8">
              {/* Header row */}
              <div className="flex items-start gap-3 mb-5">
                <div className="w-10 h-10 rounded-xl bg-primary-foreground/20 flex items-center justify-center shrink-0" aria-hidden="true">
                  <Sparkles className="w-5 h-5 text-primary-foreground" />
                </div>
                <div className="min-w-0">
                  <h1 className="text-lg sm:text-xl font-bold leading-snug">
                    {allDone
                      ? `${activeOrganization?.name || 'Your business'} is ready!`
                      : `Set up ${activeOrganization?.name || 'your business'}`}
                  </h1>
                  <p className="text-primary-foreground/80 text-sm mt-0.5">
                    {allDone
                      ? 'All steps complete. You can start taking orders.'
                      : 'Complete each step to unlock the full BeepBite experience.'}
                  </p>
                </div>
              </div>

              {/* Progress bar */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-primary-foreground/80">Setup progress</span>
                  <span className="font-semibold tabular-nums">
                    {doneCount} / {totalCount} complete
                  </span>
                </div>
                <div
                  className="h-2.5 rounded-full bg-primary-foreground/25 overflow-hidden"
                  role="progressbar"
                  aria-valuenow={doneCount}
                  aria-valuemin={0}
                  aria-valuemax={totalCount}
                  aria-label={`${doneCount} of ${totalCount} steps complete`}
                >
                  <div
                    className="h-full rounded-full bg-primary-foreground transition-all duration-700 ease-out"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
              </div>

              {/* All-done CTA */}
              {allDone && (
                <Button
                  type="button"
                  onClick={() => navigate('/pos')}
                  className="mt-4 w-full sm:w-auto bg-primary-foreground text-primary hover:bg-primary-foreground/90 shadow-sm focus-visible:ring-primary-foreground"
                >
                  <ShoppingBag className="w-4 h-4" aria-hidden="true" />
                  Open POS and start serving
                  <ChevronRight className="w-4 h-4" aria-hidden="true" />
                </Button>
              )}
            </div>
          </div>

          {/* Resumability cue */}
          <div className="bg-primary/5 border-t border-primary/10 px-6 py-2.5 flex items-center gap-2 text-xs text-primary">
            <CheckCircle2 className="w-3.5 h-3.5 text-primary shrink-0" aria-hidden="true" />
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
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => handleJumpTo(idx)}
                    disabled={saving}
                    aria-current={isCurrent ? 'step' : undefined}
                    aria-label={`Step ${idx + 1}: ${s.title}${done ? ' (complete)' : isCurrent ? ' (current)' : ''}`}
                    className={cn(
                      'h-auto w-full justify-start text-left font-normal rounded-xl border px-4 py-3 flex items-center gap-3 transition-all duration-150 group',
                      isCurrent
                        ? 'border-primary/30 bg-card shadow-md ring-2 ring-primary/10 hover:bg-card'
                        : done
                        ? 'border-beepbite-success/20 bg-beepbite-success/5 hover:bg-beepbite-success/10'
                        : 'border-border bg-card opacity-75 hover:opacity-100 hover:border-muted-foreground/30 hover:bg-card',
                      saving && 'cursor-not-allowed opacity-60'
                    )}
                  >
                    {/* Step number / check */}
                    <StepBadge index={idx} done={done} isCurrent={isCurrent} />

                    {/* Step icon + title */}
                    <span className={cn(
                      'flex items-center gap-2 flex-1 min-w-0 text-sm',
                      done ? 'text-beepbite-success' : isCurrent ? 'text-foreground font-semibold' : 'text-muted-foreground'
                    )}>
                      <Icon className={cn('w-4 h-4 shrink-0', done ? 'text-beepbite-success' : isCurrent ? 'text-primary' : 'text-muted-foreground')} aria-hidden="true" />
                      <span className="truncate">{s.title}</span>
                    </span>

                    {/* Right-side indicator */}
                    {done && !isCurrent && (
                      <span className="text-xs text-beepbite-success font-medium shrink-0">Done</span>
                    )}
                    {isCurrent && (
                      <span className="text-xs font-semibold text-primary bg-primary/10 px-2 py-0.5 rounded-full shrink-0">
                        Current
                      </span>
                    )}
                    {!done && !isCurrent && (
                      <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0 group-hover:text-muted-foreground transition-colors" aria-hidden="true" />
                    )}
                  </Button>
                </li>
              );
            })}
          </ol>
        </nav>

        {/* ── Active step detail card ───────────────────────────────────────── */}
        {currentStepDef && (
          <Card className={cn(
            'border shadow-sm transition-all',
            stepDone ? 'border-beepbite-success/30' : 'border-primary/30'
          )}>
            <CardContent className="p-6 space-y-5">
              {/* Step header */}
              <div className="flex items-start gap-3">
                <div className={cn(
                  'flex items-center justify-center w-11 h-11 rounded-xl shrink-0',
                  stepDone ? 'bg-beepbite-success/10' : 'bg-primary/10'
                )}>
                  <StepIcon className={cn('w-5 h-5', stepDone ? 'text-beepbite-success' : 'text-primary')} aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="font-semibold text-foreground">
                      Step {step + 1} — {currentStepDef.title}
                    </h2>
                    {stepDone && (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-beepbite-success bg-beepbite-success/10 px-2 py-0.5 rounded-full">
                        <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
                        Complete
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
                    {currentStepDef.description}
                  </p>
                </div>
              </div>

              {/* Hint box — hidden for service style step (the picker replaces it) */}
              {!currentStepDef.isServiceStyleStep && (
                <div className="rounded-lg bg-primary/5 border border-primary/10 px-4 py-3">
                  <p className="text-xs font-semibold text-primary uppercase tracking-wide mb-1">How to complete this step</p>
                  <p className="text-sm text-primary/90 leading-relaxed">{currentStepDef.hint}</p>
                </div>
              )}

              {/* Service style picker — shown inline for the service_style step */}
              {currentStepDef.isServiceStyleStep && (
                <div className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Button
                      type="button"
                      variant="outline"
                      aria-pressed={serviceStyle === 'dine_in'}
                      onClick={() => handlePickServiceStyle('dine_in')}
                      className={cn(
                        'h-auto justify-start font-normal flex items-start gap-3 rounded-xl border-2 p-4 text-left whitespace-normal focus-visible:ring-2 focus-visible:ring-primary/60',
                        serviceStyle === 'dine_in'
                          ? 'border-primary bg-primary/5 hover:bg-primary/5'
                          : 'border-border bg-card hover:border-primary/50 hover:bg-primary/5'
                      )}
                    >
                      <span className={cn(
                        'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                        serviceStyle === 'dine_in' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
                      )}>
                        <UtensilsCrossed className="h-4 w-4" />
                      </span>
                      <div>
                        <p className="text-sm font-semibold text-foreground">Dine-in restaurant or café</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">I have tables. I want a floor plan and dine-in seating in the POS.</p>
                      </div>
                    </Button>

                    <Button
                      type="button"
                      variant="outline"
                      aria-pressed={serviceStyle === 'takeaway'}
                      onClick={() => handlePickServiceStyle('takeaway')}
                      className={cn(
                        'h-auto justify-start font-normal flex items-start gap-3 rounded-xl border-2 p-4 text-left whitespace-normal focus-visible:ring-2 focus-visible:ring-primary/60',
                        serviceStyle === 'takeaway'
                          ? 'border-primary bg-primary/5 hover:bg-primary/5'
                          : 'border-border bg-card hover:border-primary/50 hover:bg-primary/5'
                      )}
                    >
                      <span className={cn(
                        'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                        serviceStyle === 'takeaway' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
                      )}>
                        <ShoppingBag className="h-4 w-4" />
                      </span>
                      <div>
                        <p className="text-sm font-semibold text-foreground">Takeaway, counter or market stall</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">No tables needed. Customers order at the counter. The POS goes straight to order entry.</p>
                      </div>
                    </Button>
                  </div>
                  {serviceStyleChosen && (
                    <p className="text-xs text-beepbite-success bg-beepbite-success/10 border border-beepbite-success/20 rounded-lg px-3 py-2 flex items-center gap-2">
                      <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                      Great choice — you can change this any time in Settings → Location.
                    </p>
                  )}
                  {!serviceStyleChosen && (
                    <p className="text-xs text-muted-foreground">Pick one to continue. This just personalises the POS — you can switch later.</p>
                  )}
                </div>
              )}

              {/* Live status indicator */}
              {currentStepDef.statusKey && status && (
                <div
                  className={cn(
                    'flex items-center gap-2 rounded-lg px-4 py-3 text-sm font-medium border',
                    stepDone
                      ? 'bg-beepbite-success/10 text-beepbite-success border-beepbite-success/20'
                      : 'bg-beepbite-warning/10 text-beepbite-warning border-beepbite-warning/20'
                  )}
                  role="status"
                  aria-live="polite"
                >
                  {stepDone ? (
                    <CheckCircle2 className="w-4 h-4 shrink-0 text-beepbite-success" aria-hidden="true" />
                  ) : (
                    <Circle className="w-4 h-4 shrink-0 text-beepbite-warning" aria-hidden="true" />
                  )}
                  <span className="flex-1">
                    {stepDone
                      ? 'Verified — this step is complete based on your account data.'
                      : 'Not yet complete — follow the instructions above, then refresh to check.'}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={refreshStatus}
                    disabled={statusLoading}
                    className="ml-auto h-auto gap-1 px-2 py-1 text-xs opacity-70 hover:opacity-100 hover:bg-transparent focus-visible:ring-1 focus-visible:ring-current"
                    aria-label="Re-check status"
                  >
                    <RefreshCw className={cn('w-3.5 h-3.5', statusLoading && 'animate-spin')} aria-hidden="true" />
                    Refresh
                  </Button>
                </div>
              )}

              {/* Empty / next-step encouragement when not done — hidden for the service style step
                  since its inline picker replaces the normal "go here and do X" pattern */}
              {!stepDone && !currentStepDef.isServiceStyleStep && (
                <div className="rounded-lg bg-muted border border-border px-4 py-3 text-sm text-muted-foreground">
                  <p>
                    <span className="font-medium text-foreground">Not done yet?</span>{' '}
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
                    className="gap-1"
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
                    className="gap-1 border-primary/30 text-primary hover:bg-primary/5"
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
                      className="gap-1.5 font-semibold shadow-sm"
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
                      className="gap-1.5 font-semibold shadow-sm"
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
          <p className="text-xs text-muted-foreground">
            Need help?{' '}
            <a
              href="/docs/getting-started"
              className="inline-flex items-center gap-1 underline hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary rounded"
            >
              <BookOpen className="w-3 h-3" aria-hidden="true" />
              Read the Getting Started guide
            </a>
          </p>
          <p className="text-xs text-muted-foreground">
            You can return to this wizard any time from your dashboard.
          </p>
        </footer>
      </div>
    </div>
  );
}
