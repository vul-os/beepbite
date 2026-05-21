/**
 * EtaCard — compact card showing estimated arrival time and a pulsing
 * "live" indicator.  Rendered below the map / in the no-location fallback.
 */
import React from 'react';
import { Clock, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function EtaCard({ etaMinutes, status, lastUpdated }) {
  const isLive = status !== 'delivered' && status !== 'canceled';

  const etaLabel = React.useMemo(() => {
    if (status === 'delivered') return 'Order delivered';
    if (status === 'canceled')  return 'Order canceled';
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
    <div className="flex items-center justify-between gap-4 rounded-xl border bg-card px-4 py-3 shadow-sm">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-orange-100">
          <Clock className="h-4.5 w-4.5 text-orange-600" />
        </div>
        <div>
          <p className="text-sm font-semibold leading-tight">{etaLabel}</p>
          {updatedLabel && (
            <p className="text-xs text-muted-foreground mt-0.5">{updatedLabel}</p>
          )}
        </div>
      </div>

      {isLive && (
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-orange-400 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-orange-500" />
          </span>
          <span className="text-xs font-medium text-orange-600">Live</span>
        </div>
      )}

      {!isLive && (
        <RefreshCw
          className={cn(
            'h-4 w-4 shrink-0',
            status === 'delivered' ? 'text-green-500' : 'text-muted-foreground',
          )}
        />
      )}
    </div>
  );
}
