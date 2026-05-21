/**
 * OrderStatusSteps — horizontal/vertical progress stepper showing the four
 * stages of a delivery order.  The active step is highlighted in orange; all
 * prior steps are shown as completed.
 */
import React from 'react';
import { cn } from '@/lib/utils';
import { CheckCircle2, Circle, ChefHat, Bike, MapPin, ShoppingBag } from 'lucide-react';

const STEPS = [
  { key: 'placed',           label: 'Order placed',     Icon: ShoppingBag },
  { key: 'preparing',        label: 'Preparing',         Icon: ChefHat },
  { key: 'out_for_delivery', label: 'Out for delivery',  Icon: Bike },
  { key: 'delivered',        label: 'Delivered',         Icon: MapPin },
];

// Maps backend status string → step index (0-based).
const STATUS_INDEX = {
  placed:           0,
  preparing:        1,
  out_for_delivery: 2,
  delivered:        3,
  canceled:         -1,
};

export default function OrderStatusSteps({ status }) {
  const activeIdx = STATUS_INDEX[status] ?? 0;
  const isCanceled = status === 'canceled';

  if (isCanceled) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3">
        <Circle className="h-4 w-4 text-destructive shrink-0" />
        <p className="text-sm font-medium text-destructive">Order canceled</p>
      </div>
    );
  }

  return (
    <div className="w-full">
      {/* Desktop: horizontal row */}
      <div className="hidden sm:flex items-start">
        {STEPS.map((step, i) => {
          const done = i < activeIdx;
          const active = i === activeIdx;
          return (
            <React.Fragment key={step.key}>
              <div className="flex flex-col items-center flex-1 min-w-0">
                <div
                  className={cn(
                    'flex items-center justify-center w-9 h-9 rounded-full border-2 transition-colors',
                    done   && 'bg-orange-500 border-orange-500 text-white',
                    active && 'border-orange-500 text-orange-500 bg-orange-50',
                    !done && !active && 'border-muted-foreground/30 text-muted-foreground/40 bg-background',
                  )}
                >
                  {done
                    ? <CheckCircle2 className="h-5 w-5" />
                    : <step.Icon className="h-4 w-4" />
                  }
                </div>
                <p
                  className={cn(
                    'mt-1.5 text-xs text-center font-medium',
                    active && 'text-orange-600',
                    done   && 'text-orange-500',
                    !done && !active && 'text-muted-foreground/50',
                  )}
                >
                  {step.label}
                </p>
              </div>

              {/* Connector line between steps */}
              {i < STEPS.length - 1 && (
                <div className="flex-1 mt-4 h-0.5 max-w-[60px] mx-1">
                  <div
                    className={cn(
                      'h-full rounded-full transition-colors',
                      i < activeIdx ? 'bg-orange-400' : 'bg-muted-foreground/20',
                    )}
                  />
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>

      {/* Mobile: vertical list */}
      <div className="flex flex-col gap-0 sm:hidden">
        {STEPS.map((step, i) => {
          const done = i < activeIdx;
          const active = i === activeIdx;
          const last = i === STEPS.length - 1;
          return (
            <div key={step.key} className="flex items-start gap-3">
              {/* Icon column */}
              <div className="flex flex-col items-center">
                <div
                  className={cn(
                    'flex items-center justify-center w-8 h-8 rounded-full border-2 shrink-0 transition-colors',
                    done   && 'bg-orange-500 border-orange-500 text-white',
                    active && 'border-orange-500 text-orange-500 bg-orange-50',
                    !done && !active && 'border-muted-foreground/30 text-muted-foreground/40 bg-background',
                  )}
                >
                  {done
                    ? <CheckCircle2 className="h-4 w-4" />
                    : <step.Icon className="h-3.5 w-3.5" />
                  }
                </div>
                {!last && (
                  <div
                    className={cn(
                      'w-0.5 flex-1 min-h-[20px] my-1 rounded-full',
                      i < activeIdx ? 'bg-orange-400' : 'bg-muted-foreground/20',
                    )}
                  />
                )}
              </div>

              {/* Label */}
              <p
                className={cn(
                  'pt-1 text-sm font-medium',
                  active && 'text-orange-600',
                  done   && 'text-orange-500',
                  !done && !active && 'text-muted-foreground/50',
                )}
              >
                {step.label}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
