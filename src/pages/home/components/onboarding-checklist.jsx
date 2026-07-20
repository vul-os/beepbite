import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import {
  Building2,
  MapPin,
  UtensilsCrossed,
  Users,
  ShoppingBag,
  CheckCircle2,
  Circle,
  ChevronRight,
  Sparkles,
  Store,
} from 'lucide-react';
import { useAuth } from '@/context/auth-context';
import { supabase } from '@/services/supabase-client';
import { cn } from '@/lib/utils';
import AddLocationModal from './add-location-modal';

// ---------------------------------------------------------------------------
// Service-style localStorage helpers
// ---------------------------------------------------------------------------
function getServiceStyleLS(locId) {
  if (!locId) return null; // null means "not chosen yet"
  try {
    const v = localStorage.getItem(`bb_service_style_${locId}`);
    return v === 'takeaway' || v === 'dine_in' ? v : null;
  } catch {
    return null;
  }
}
function setServiceStyleLS(locId, value) {
  if (!locId) return;
  try { localStorage.setItem(`bb_service_style_${locId}`, value); } catch { /* ignore */ }
}

// Individual step definitions — completion is computed dynamically
const STEP_KEYS = {
  ORG: 'org',
  LOCATION: 'location',
  SERVICE_STYLE: 'service_style',
  MENU: 'menu',
  TEAM: 'team',
  ORDER: 'order',
};

function useOnboardingData(activeOrganization) {
  const { locations } = useAuth();
  const [itemCount, setItemCount] = useState(null);
  const [staffCount, setStaffCount] = useState(null);
  const [loading, setLoading] = useState(true);

  const locationId = locations?.[0]?.id;

  const fetchData = useCallback(async () => {
    if (!activeOrganization?.id) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const promises = [];

      // Items — only if we have a location
      if (locationId) {
        promises.push(
          supabase
            .from('items')
            .select('id')
            .eq('location_id', locationId)
            .eq('is_active', true)
            .limit(1)
            .then(({ data }) => setItemCount((data || []).length))
        );

        // Staff
        promises.push(
          supabase
            .from('staff')
            .select('id')
            .eq('location_id', locationId)
            .limit(1)
            .then(({ data }) => setStaffCount((data || []).length))
        );
      } else {
        setItemCount(0);
        setStaffCount(0);
      }

      await Promise.allSettled(promises);
    } catch (err) {
      console.error('Onboarding data fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [activeOrganization?.id, locationId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { itemCount, staffCount, loading, refetch: fetchData };
}

const OnboardingChecklist = ({ onComplete }) => {
  const navigate = useNavigate();
  const { activeOrganization, locations, fetchLocations } = useAuth();
  const [addLocationOpen, setAddLocationOpen] = useState(false);

  const locationsCount = locations?.length ?? 0;
  const firstLocation = locations?.[0];

  // Service style state — loaded from localStorage for the first location.
  const [serviceStyle, setServiceStyleState] = useState(() =>
    getServiceStyleLS(firstLocation?.id)
  );
  // Keep in sync if the first location id changes after the component mounts.
  useEffect(() => {
    setServiceStyleState(getServiceStyleLS(firstLocation?.id));
  }, [firstLocation?.id]);

  const handlePickServiceStyle = useCallback((style) => {
    setServiceStyleLS(firstLocation?.id, style);
    setServiceStyleState(style);
  }, [firstLocation?.id]);

  const serviceStyleChosen = serviceStyle === 'dine_in' || serviceStyle === 'takeaway';

  const { itemCount, staffCount, loading, refetch } = useOnboardingData(activeOrganization);

  const handleLocationAdded = useCallback(async () => {
    await fetchLocations();
    refetch();
  }, [fetchLocations, refetch]);

  // Steps configuration
  const steps = [
    {
      key: STEP_KEYS.ORG,
      icon: Building2,
      label: 'Create your business',
      description: 'Your organisation account is set up and ready.',
      done: true,
      actionLabel: null,
      onAction: null,
      alwaysDone: true,
    },
    {
      key: STEP_KEYS.LOCATION,
      icon: MapPin,
      label: 'Add your first location',
      description: 'A location is a physical store or service point. You need at least one to start selling.',
      done: locationsCount > 0,
      actionLabel: locationsCount > 0 ? null : 'Add location',
      onAction: locationsCount > 0 ? null : () => setAddLocationOpen(true),
      isPrimary: true,
    },
    {
      key: STEP_KEYS.SERVICE_STYLE,
      icon: Store,
      label: "What's your setup?",
      description: serviceStyleChosen
        ? serviceStyle === 'dine_in'
          ? 'Dine-in with tables — floor plan and seat selection available.'
          : 'Takeaway / counter — no tables needed, straight to orders.'
        : 'Tell BeepBite how you serve customers so it shows the right features.',
      done: serviceStyleChosen,
      actionLabel: null,
      onAction: null,
      disabled: locationsCount === 0,
      disabledHint: 'Add a location first',
      isServiceStyleStep: true,
    },
    {
      key: STEP_KEYS.MENU,
      icon: UtensilsCrossed,
      label: 'Build your menu',
      description: 'Add the items you sell — food, drinks, products or services.',
      done: itemCount != null && itemCount > 0,
      actionLabel: 'Add menu items',
      onAction: () => navigate('/menu'),
      disabled: locationsCount === 0,
      disabledHint: 'Add a location first',
    },
    {
      key: STEP_KEYS.TEAM,
      icon: Users,
      label: 'Invite your team',
      description: 'Add staff members so they can take orders and manage the store.',
      done: staffCount != null && staffCount > 0,
      actionLabel: 'Invite staff',
      onAction: () => navigate('/staff'),
      disabled: locationsCount === 0,
      disabledHint: 'Add a location first',
    },
    {
      key: STEP_KEYS.ORDER,
      icon: ShoppingBag,
      label: 'Take your first order',
      description: 'Everything is set — open the POS and start serving customers.',
      done: false,
      actionLabel: 'Open POS',
      onAction: () => {
        if (onComplete) onComplete();
      },
      disabled: locationsCount === 0 || itemCount === 0,
      disabledHint:
        locationsCount === 0
          ? 'Add a location first'
          : itemCount === 0
          ? 'Add menu items first'
          : null,
    },
  ];

  const doneCount = steps.filter((s) => s.done).length;
  const totalCount = steps.length;
  const progressPct = Math.round((doneCount / totalCount) * 100);
  const allDone = doneCount === totalCount;

  // Loading state while fetching step data
  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-50 via-white to-orange-50 pt-8 pb-16 px-4">
        <div className="max-w-2xl mx-auto space-y-6">
          <div className="h-44 rounded-2xl bg-orange-400/30 animate-pulse" />
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-20 rounded-2xl bg-muted animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="min-h-screen bg-gradient-to-br from-orange-50 via-white to-orange-50 pt-8 pb-16 px-4">
        <div className="max-w-2xl mx-auto space-y-5">

          {/* Hero card */}
          <Card className="border-0 shadow-lg bg-gradient-to-r from-orange-500 to-orange-600 text-white overflow-hidden relative">
            <div className="absolute inset-0 opacity-10" aria-hidden="true">
              <div className="absolute top-0 right-0 w-64 h-64 rounded-full bg-white -translate-y-1/2 translate-x-1/2" />
            </div>
            <CardContent className="p-6 sm:p-8 relative">
              <div className="flex items-start gap-3 mb-5">
                <div
                  className="flex items-center justify-center w-10 h-10 rounded-xl bg-white/20 backdrop-blur-sm shrink-0"
                  aria-hidden="true"
                >
                  <Sparkles className="w-5 h-5 text-white" />
                </div>
                <div className="min-w-0">
                  <h1 className="text-xl sm:text-2xl font-bold leading-tight">
                    Let&apos;s get {activeOrganization?.name || 'your business'} ready to serve
                  </h1>
                  <p className="text-orange-100 text-sm mt-1">
                    Complete the steps below to unlock the full POS experience.
                  </p>
                </div>
              </div>

              {/* Progress */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-orange-100">Setup progress</span>
                  <span className="font-bold tabular-nums">
                    {doneCount}/{totalCount}
                  </span>
                </div>
                <div
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={progressPct}
                  aria-label={`Setup ${progressPct}% complete`}
                  className="h-2.5 rounded-full bg-white/20 overflow-hidden"
                >
                  <div
                    className="h-full rounded-full bg-white transition-all duration-700 ease-out"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
              </div>

              {allDone && (
                <div className="mt-4 flex items-center gap-2 text-sm font-medium bg-white/20 rounded-xl px-4 py-2.5" role="status">
                  <CheckCircle2 className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
                  All set! You can now take orders.
                </div>
              )}
            </CardContent>
          </Card>

          {/* Steps */}
          <ol className="space-y-3 list-none" aria-label="Setup checklist">
            {steps.map((step, idx) => {
              const Icon = step.icon;
              const isDisabled = step.disabled && !step.done;
              const canAct = step.actionLabel && step.onAction && !step.done && !isDisabled;

              return (
                <li key={step.key}>
                  <Card
                    className={cn(
                      'border transition-all duration-200',
                      step.done
                        ? 'border-green-200 bg-green-50/60'
                        : step.isPrimary && !step.done
                        ? 'border-orange-300 bg-card shadow-md ring-1 ring-orange-100'
                        : 'border-border bg-card',
                      isDisabled && 'opacity-60'
                    )}
                    aria-disabled={isDisabled}
                  >
                    <CardContent className="p-4 sm:p-5">
                      <div className="flex items-start gap-3 sm:gap-4">
                        {/* Status icon */}
                        <div className="shrink-0 mt-0.5" aria-hidden="true">
                          {step.done ? (
                            <CheckCircle2 className="w-6 h-6 text-green-500" />
                          ) : (
                            <Circle
                              className={cn(
                                'w-6 h-6',
                                step.isPrimary ? 'text-orange-400' : 'text-muted-foreground'
                              )}
                            />
                          )}
                        </div>

                        {/* Step icon + text */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <div
                              className={cn(
                                'flex items-center justify-center w-7 h-7 rounded-lg shrink-0',
                                step.done
                                  ? 'bg-green-100'
                                  : step.isPrimary
                                  ? 'bg-orange-100'
                                  : 'bg-muted'
                              )}
                              aria-hidden="true"
                            >
                              <Icon
                                className={cn(
                                  'w-4 h-4',
                                  step.done
                                    ? 'text-green-600'
                                    : step.isPrimary
                                    ? 'text-orange-500'
                                    : 'text-muted-foreground'
                                )}
                              />
                            </div>
                            <span
                              className={cn(
                                'font-semibold text-sm',
                                step.done ? 'text-green-800 line-through decoration-green-400' : 'text-foreground'
                              )}
                            >
                              {step.label}
                            </span>
                            {idx === 0 && (
                              <Badge
                                variant="secondary"
                                className="bg-green-100 text-green-700 border-green-200 text-xs"
                              >
                                Done
                              </Badge>
                            )}
                            {step.isPrimary && !step.done && (
                              <Badge className="bg-orange-100 text-orange-700 border-orange-200 text-xs border">
                                Required
                              </Badge>
                            )}
                          </div>

                          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                            {step.done
                              ? step.alwaysDone
                                ? step.description
                                : `Completed — ${step.description.toLowerCase()}`
                              : isDisabled && step.disabledHint
                              ? step.disabledHint
                              : step.description}
                          </p>

                          {/* Service style inline picker */}
                          {step.isServiceStyleStep && !isDisabled && (
                            <div className="mt-3 grid grid-cols-2 gap-2">
                              <Button
                                type="button"
                                variant="outline"
                                onClick={() => handlePickServiceStyle('dine_in')}
                                aria-pressed={serviceStyle === 'dine_in'}
                                className={cn(
                                  'h-auto flex flex-col items-center gap-1.5 rounded-xl border-2 px-3 py-3 text-center text-xs font-semibold whitespace-normal focus-visible:ring-2 focus-visible:ring-orange-400',
                                  serviceStyle === 'dine_in'
                                    ? 'border-orange-400 bg-orange-50 text-orange-700 hover:bg-orange-50'
                                    : 'border-border bg-card text-muted-foreground hover:border-orange-300 hover:bg-orange-50'
                                )}
                              >
                                <UtensilsCrossed className="w-5 h-5" />
                                <span>Dine-in</span>
                                <span className="text-[10px] font-normal text-muted-foreground leading-tight">Tables &amp; floor plan</span>
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                onClick={() => handlePickServiceStyle('takeaway')}
                                aria-pressed={serviceStyle === 'takeaway'}
                                className={cn(
                                  'h-auto flex flex-col items-center gap-1.5 rounded-xl border-2 px-3 py-3 text-center text-xs font-semibold whitespace-normal focus-visible:ring-2 focus-visible:ring-orange-400',
                                  serviceStyle === 'takeaway'
                                    ? 'border-orange-400 bg-orange-50 text-orange-700 hover:bg-orange-50'
                                    : 'border-border bg-card text-muted-foreground hover:border-orange-300 hover:bg-orange-50'
                                )}
                              >
                                <ShoppingBag className="w-5 h-5" />
                                <span>Takeaway</span>
                                <span className="text-[10px] font-normal text-muted-foreground leading-tight">Counter / market stall</span>
                              </Button>
                            </div>
                          )}
                        </div>

                        {/* Action button */}
                        {canAct && (
                          <Button
                            size="sm"
                            onClick={step.onAction}
                            className={cn(
                              'shrink-0 gap-1 h-9 px-3 rounded-lg focus-visible:ring-2 focus-visible:ring-offset-1',
                              step.isPrimary
                                ? 'bg-orange-500 hover:bg-orange-600 text-white focus-visible:ring-orange-400'
                                : 'bg-foreground text-background hover:bg-foreground/90 focus-visible:ring-ring'
                            )}
                          >
                            {step.actionLabel}
                            <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
                          </Button>
                        )}

                        {step.done && !step.alwaysDone && (
                          <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0 mt-0.5" aria-hidden="true" />
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </li>
              );
            })}
          </ol>

          {/* Footer hint */}
          <p className="text-center text-xs text-muted-foreground px-4">
            You can revisit these steps any time from Settings. The checklist disappears once you have at least one location.
          </p>
        </div>
      </div>

      <AddLocationModal
        open={addLocationOpen}
        onOpenChange={setAddLocationOpen}
        onSuccess={handleLocationAdded}
      />
    </>
  );
};

export default OnboardingChecklist;
