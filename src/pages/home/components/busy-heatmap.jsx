import React, { useMemo, useState, useId } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatPrice } from '@/lib/currency';
import { cn } from '@/lib/utils';
import { Flame } from 'lucide-react';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const HOURS = Array.from({ length: 24 }, (_, h) => {
  if (h === 0) return '12a';
  if (h < 12) return `${h}a`;
  if (h === 12) return '12p';
  return `${h - 12}p`;
});

// Map a normalised value [0,1] to an rgba orange colour.
function cellBg(norm) {
  if (norm === 0) return 'hsl(var(--muted))';
  const alpha = 0.15 + norm * 0.85;
  return `rgba(249,115,22,${alpha.toFixed(2)})`;
}

function cellText(norm) {
  return norm > 0.55 ? '#fff' : 'hsl(var(--foreground))';
}

function HeatmapSkeleton() {
  return (
    <div className="space-y-2" aria-label="Loading heatmap" aria-busy="true">
      {Array.from({ length: 7 }).map((_, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <Skeleton className="w-8 h-4 flex-shrink-0" />
          <Skeleton className="h-5 flex-1 rounded-md" />
        </div>
      ))}
    </div>
  );
}

export default function BusyHeatmap({ cells = [], currency = 'USD', loading }) {
  const tooltipId = useId();
  const [tooltip, setTooltip] = useState(null); // { dow, hour, count, sales }

  // Build a 7×24 lookup and find max for normalisation.
  const { grid, maxCount } = useMemo(() => {
    const map = new Map();
    let max = 0;
    for (const c of cells) {
      const key = `${c.dow}_${c.hour}`;
      map.set(key, c);
      if ((c.order_count ?? 0) > max) max = c.order_count;
    }
    // Build 7 rows × 24 columns
    const grid = Array.from({ length: 7 }, (_, dow) =>
      Array.from({ length: 24 }, (_, hour) =>
        map.get(`${dow}_${hour}`) ?? { dow, hour, order_count: 0, sales_cents: 0 }
      )
    );
    return { grid, maxCount: max };
  }, [cells]);

  return (
    <Card variant="elevated" className="overflow-hidden">
      <CardHeader className="pb-2 px-6 pt-6">
        <CardTitle className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Flame className="h-4 w-4" aria-hidden="true" />
          </span>
          <span>Busy Days &amp; Hours</span>
          <span className="text-xs font-normal text-muted-foreground ml-1 hidden sm:inline">
            — trailing 12 weeks
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-5 pb-6 pt-3">
        {loading ? (
          <HeatmapSkeleton />
        ) : cells.length === 0 && maxCount === 0 ? (
          <div
            className="flex flex-col items-center justify-center h-36 gap-3"
            role="status"
            aria-label="No activity data"
          >
            <div className="w-14 h-14 rounded-2xl bg-muted flex items-center justify-center">
              <Flame className="w-6 h-6 text-muted-foreground/40" aria-hidden="true" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-muted-foreground">No activity data yet</p>
              <p className="text-xs text-muted-foreground/60 mt-0.5">Data appears after your first orders</p>
            </div>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto -mx-1 px-1">
              <div
                className="min-w-[420px]"
                role="img"
                aria-label="Order activity heatmap by day and hour"
              >
                {/* Hour axis header */}
                <div className="flex items-center mb-1.5" aria-hidden="true">
                  <div className="w-8 flex-shrink-0" />
                  {HOURS.map((h, i) => (
                    <div
                      key={i}
                      className="flex-1 text-center text-[9px] text-muted-foreground leading-tight"
                      style={{ minWidth: 0 }}
                    >
                      {i % 3 === 0 ? h : ''}
                    </div>
                  ))}
                </div>

                {/* Rows: one per day */}
                {grid.map((row, dow) => (
                  <div key={dow} className="flex items-center mb-1 gap-px">
                    <div
                      className="w-8 flex-shrink-0 text-[10px] text-muted-foreground font-medium text-right pr-2"
                      aria-hidden="true"
                    >
                      {DAYS[dow]}
                    </div>
                    {row.map((cell, hour) => {
                      const norm = maxCount > 0 ? cell.order_count / maxCount : 0;
                      const isHovered = tooltip?.dow === dow && tooltip?.hour === hour;
                      const hasActivity = cell.order_count > 0;
                      return (
                        <div
                          key={hour}
                          role="gridcell"
                          aria-label={
                            hasActivity
                              ? `${DAYS[dow]} ${HOURS[hour]}: ${cell.order_count} orders`
                              : `${DAYS[dow]} ${HOURS[hour]}: no activity`
                          }
                          className={cn(
                            'flex-1 rounded-sm cursor-default transition-all duration-100',
                            isHovered && 'ring-1 ring-primary ring-offset-0 scale-110 z-10 relative'
                          )}
                          style={{
                            minWidth: 0,
                            height: 18,
                            backgroundColor: cellBg(norm),
                          }}
                          onMouseEnter={() =>
                            setTooltip({
                              dow,
                              hour,
                              count: cell.order_count,
                              sales: cell.sales_cents,
                            })
                          }
                          onMouseLeave={() => setTooltip(null)}
                          onFocus={() =>
                            setTooltip({
                              dow,
                              hour,
                              count: cell.order_count,
                              sales: cell.sales_cents,
                            })
                          }
                          onBlur={() => setTooltip(null)}
                          tabIndex={hasActivity ? 0 : -1}
                          aria-describedby={isHovered ? tooltipId : undefined}
                        />
                      );
                    })}
                  </div>
                ))}

                {/* Legend */}
                <div className="flex items-center gap-1.5 mt-3 justify-end" aria-hidden="true">
                  <span className="text-[10px] text-muted-foreground">Less</span>
                  {[0, 0.2, 0.4, 0.6, 0.8, 1].map((v) => (
                    <div
                      key={v}
                      className="rounded-sm"
                      style={{ width: 14, height: 14, backgroundColor: cellBg(v) }}
                    />
                  ))}
                  <span className="text-[10px] text-muted-foreground">More</span>
                </div>
              </div>
            </div>

            {/* Tooltip strip — always reserves space to prevent layout jump */}
            <div
              id={tooltipId}
              role="status"
              aria-live="polite"
              className={cn(
                'mt-3 px-4 py-2.5 rounded-xl text-xs flex items-center gap-3 transition-all duration-150',
                tooltip
                  ? 'bg-primary/5 border border-primary/15 opacity-100'
                  : 'opacity-0 pointer-events-none bg-transparent border border-transparent'
              )}
              style={{ minHeight: 38 }}
            >
              {tooltip && (
                <>
                  <span className="font-semibold text-foreground">
                    {DAYS[tooltip.dow]} {HOURS[tooltip.hour]}
                  </span>
                  <span className="text-primary font-bold">
                    {tooltip.count.toLocaleString()} orders
                  </span>
                  <span className="text-muted-foreground">
                    {formatPrice(tooltip.sales, currency)}
                  </span>
                </>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
