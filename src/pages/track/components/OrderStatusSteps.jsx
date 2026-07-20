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

// Maps backend status string (see orders.status CHECK constraint) → step
// index (0-based) in STEPS above. 'confirmed' collapses onto 'placed' and
// 'ready'/'completed' collapse onto the adjacent step they most resemble —
// this stepper only shows 4 coarse stages to the customer.
const STATUS_INDEX = {
  pending:          0,
  confirmed:        0,
  preparing:        1,
  ready:            1,
  out_for_delivery: 2,
  delivered:        3,
  completed:        3,
  cancelled:        -1,
};

export default function OrderStatusSteps({ status }) {
  const activeIdx = STATUS_INDEX[status] ?? 0;
  const isCancelled = status === 'cancelled';

  if (isCancelled) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-destructive/20 shrink-0">
          <Circle className="h-4 w-4 text-destructive" aria-hidden="true" />
        </div>
        <div>
          <p className="text-sm font-semibold text-destructive">Order cancelled</p>
          <p className="text-xs text-destructive/70 mt-0.5">This order has been cancelled.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full" role="list" aria-label="Order status">
      {/* Desktop: horizontal row */}
      <div className="hidden sm:flex items-start">
        {STEPS.map((step, i) => {
          const done = i < activeIdx;
          const active = i === activeIdx;
          return (
            <React.Fragment key={step.key}>
              <div className="flex flex-col items-center flex-1 min-w-0" role="listitem">
                <div
                  className={cn(
                    'flex items-center justify-center w-10 h-10 rounded-full border-2 transition-all duration-300',
                    done   && 'bg-orange-500 border-orange-500 text-white shadow-sm shadow-orange-200',
                    active && 'border-orange-500 text-orange-500 bg-orange-50 shadow-md shadow-orange-100',
                    !done && !active && 'border-muted-foreground/25 text-muted-foreground/35 bg-background',
                  )}
                  aria-current={active ? 'step' : undefined}
                >
                  {done
                    ? <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
                    : <step.Icon className="h-4.5 w-4.5" aria-hidden="true" />
                  }
                </div>
                <p
                  className={cn(
                    'mt-2 text-xs text-center font-semibold leading-tight',
                    active && 'text-orange-600',
                    done   && 'text-orange-500',
                    !done && !active && 'text-muted-foreground/40',
                  )}
                >
                  {step.label}
                </p>
              </div>

              {/* Connector line between steps */}
              {i < STEPS.length - 1 && (
                <div className="flex-1 mt-5 h-0.5 max-w-[56px] mx-1">
                  <div
                    className={cn(
                      'h-full rounded-full transition-colors duration-300',
                      i < activeIdx ? 'bg-orange-400' : 'bg-muted-foreground/15',
                    )}
                  />
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>

      {/* Mobile: vertical list (always visible on mobile) */}
      <div className="flex flex-col sm:hidden" role="list" aria-label="Order status steps">
        {STEPS.map((step, i) => {
          const done = i < activeIdx;
          const active = i === activeIdx;
          const last = i === STEPS.length - 1;
          return (
            <div key={step.key} className="flex items-start gap-3.5" role="listitem">
              {/* Icon column */}
              <div className="flex flex-col items-center shrink-0">
                <div
                  className={cn(
                    'flex items-center justify-center w-9 h-9 rounded-full border-2 transition-all duration-300',
                    done   && 'bg-orange-500 border-orange-500 text-white shadow-sm shadow-orange-200',
                    active && 'border-orange-500 text-orange-500 bg-orange-50 shadow-md shadow-orange-100',
                    !done && !active && 'border-muted-foreground/25 text-muted-foreground/35 bg-background',
                  )}
                  aria-current={active ? 'step' : undefined}
                >
                  {done
                    ? <CheckCircle2 className="h-4.5 w-4.5" aria-hidden="true" />
                    : <step.Icon className="h-4 w-4" aria-hidden="true" />
                  }
                </div>
                {!last && (
                  <div
                    className={cn(
                      'w-0.5 flex-1 min-h-[24px] my-1.5 rounded-full transition-colors duration-300',
                      i < activeIdx ? 'bg-orange-400' : 'bg-muted-foreground/15',
                    )}
                  />
                )}
              </div>

              {/* Label + sublabel */}
              <div className={cn('pt-1.5 pb-1', last ? '' : 'min-h-[48px]')}>
                <p
                  className={cn(
                    'text-sm font-semibold leading-tight',
                    active && 'text-orange-600',
                    done   && 'text-orange-500',
                    !done && !active && 'text-muted-foreground/40',
                  )}
                >
                  {step.label}
                </p>
                {active && !last && (
                  <p className="text-xs text-muted-foreground mt-0.5">In progress…</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
