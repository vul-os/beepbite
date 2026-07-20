/**
 * EtaCard — compact card showing estimated arrival time and a pulsing
 * "live" indicator.  Rendered below the map / in the no-location fallback.
 */
import React from 'react';
import { Clock, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function EtaCard({ etaMinutes, status, lastUpdated }) {
  const isDelivered = status === 'delivered' || status === 'completed';
  const isCancelled = status === 'cancelled';
  const isLive = !isDelivered && !isCancelled;

  const etaLabel = React.useMemo(() => {
    if (isDelivered)            return 'Order delivered';
    if (isCancelled)            return 'Order cancelled';
    if (etaMinutes == null)     return 'Calculating ETA…';
    if (etaMinutes <= 1)        return 'Arriving any moment';
    return `~${etaMinutes} min away`;
  }, [etaMinutes, status]);

  const updatedLabel = React.useMemo(() => {
    if (!lastUpdated) return null;
    const diff = Math.round((Date.now() - lastUpdated) / 1000);
    if (diff < 60) return `Updated just now`;
    return `Updated ${Math.round(diff / 60)}m ago`;
  }, [lastUpdated]);

  return (
    <div
      className={cn(
        'flex items-center justify-between gap-4 rounded-2xl border px-4 py-4 shadow-sm transition-colors',
        isDelivered
          ? 'bg-green-50 border-green-200'
          : isCancelled
            ? 'bg-muted border-border'
            : 'bg-card border-border/60',
      )}
    >
      <div className="flex items-center gap-3">
        <div
          className={cn(
            'flex h-11 w-11 shrink-0 items-center justify-center rounded-full',
            isDelivered
              ? 'bg-green-100'
              : isCancelled
                ? 'bg-muted-foreground/10'
                : 'bg-orange-100',
          )}
        >
          <Clock
            className={cn(
              'h-5 w-5',
              isDelivered
                ? 'text-green-600'
                : isCancelled
                  ? 'text-muted-foreground'
                  : 'text-orange-600',
            )}
            aria-hidden="true"
          />
        </div>
        <div>
          <p
            className={cn(
              'text-base font-bold leading-tight',
              isDelivered ? 'text-green-700' : 'text-foreground',
            )}
          >
            {etaLabel}
          </p>
          {updatedLabel && (
            <p className="text-xs text-muted-foreground mt-0.5">{updatedLabel}</p>
          )}
        </div>
      </div>

      {isLive && (
        <div className="flex items-center gap-1.5 shrink-0 bg-orange-50 border border-orange-200 rounded-full px-2.5 py-1">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-orange-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-orange-500" />
          </span>
          <span className="text-xs font-semibold text-orange-600">Live</span>
        </div>
      )}

      {!isLive && (
        <RefreshCw
          className={cn(
            'h-4 w-4 shrink-0',
            isDelivered ? 'text-green-500' : 'text-muted-foreground',
          )}
          aria-hidden="true"
        />
      )}
    </div>
  );
}
