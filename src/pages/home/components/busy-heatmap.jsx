import React, { useMemo, useState } from 'react';
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

// Map a normalised value [0,1] to an orange scale class.
// Using inline style for dynamic intensity.
function cellBg(norm) {
  if (norm === 0) return '#f9fafb'; // gray-50 — empty
  // Interpolate from orange-100 to orange-600
  const r = Math.round(249 + (234 - 249) * norm);
  const g = Math.round(250 + (88 - 250) * norm * norm);
  const b = Math.round(250 + (12 - 250) * norm * norm * norm);
  const alpha = 0.15 + norm * 0.85;
  return `rgba(249,115,22,${alpha.toFixed(2)})`;
}

function cellText(norm) {
  return norm > 0.55 ? '#fff' : '#374151';
}

export default function BusyHeatmap({ cells = [], currency = 'USD', loading }) {
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
      Array.from({ length: 24 }, (_, hour) => map.get(`${dow}_${hour}`) ?? { dow, hour, order_count: 0, sales_cents: 0 })
    );
    return { grid, maxCount: max };
  }, [cells]);

  return (
    <Card className="border border-orange-100 shadow-sm">
      <CardHeader className="pb-2 px-4 pt-4">
        <CardTitle className="text-sm font-semibold text-gray-700 flex items-center gap-2">
          <Flame className="w-4 h-4 text-orange-500" />
          Busy Days &amp; Hours
          <span className="text-xs font-normal text-gray-400 ml-1">(trailing 12 weeks)</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 7 }).map((_, i) => (
              <Skeleton key={i} className="h-6 w-full rounded" />
            ))}
          </div>
        ) : cells.length === 0 && maxCount === 0 ? (
          <div className="flex items-center justify-center h-32 text-gray-400 text-sm">
            No activity data yet
          </div>
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[480px]">
              {/* Hour axis header */}
              <div className="flex items-center mb-1">
                <div className="w-8 flex-shrink-0" /> {/* day label spacer */}
                {HOURS.map((h, i) => (
                  <div
                    key={i}
                    className="flex-1 text-center text-[9px] text-gray-400 leading-tight"
                    style={{ minWidth: 0 }}
                  >
                    {i % 3 === 0 ? h : ''}
                  </div>
                ))}
              </div>

              {/* Rows: one per day */}
              {grid.map((row, dow) => (
                <div key={dow} className="flex items-center mb-0.5 gap-0.5">
                  <div className="w-8 flex-shrink-0 text-[10px] text-gray-500 font-medium text-right pr-1.5">
                    {DAYS[dow]}
                  </div>
                  {row.map((cell, hour) => {
                    const norm = maxCount > 0 ? (cell.order_count / maxCount) : 0;
                    const isHovered = tooltip?.dow === dow && tooltip?.hour === hour;
                    return (
                      <div
                        key={hour}
                        className={cn(
                          'flex-1 rounded-sm cursor-default transition-all duration-100',
                          isHovered && 'ring-1 ring-orange-400 ring-offset-0 scale-110 z-10 relative'
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
                      />
                    );
                  })}
                </div>
              ))}

              {/* Legend */}
              <div className="flex items-center gap-2 mt-3 justify-end">
                <span className="text-[10px] text-gray-400">Less</span>
                {[0, 0.2, 0.4, 0.6, 0.8, 1].map((v) => (
                  <div
                    key={v}
                    className="rounded-sm"
                    style={{ width: 14, height: 14, backgroundColor: cellBg(v) }}
                  />
                ))}
                <span className="text-[10px] text-gray-400">More</span>
              </div>
            </div>

            {/* Tooltip */}
            {tooltip && (
              <div className="mt-2 px-3 py-2 bg-orange-50 border border-orange-200 rounded-lg text-xs text-gray-700 flex items-center gap-3">
                <span className="font-semibold text-gray-900">
                  {DAYS[tooltip.dow]} {HOURS[tooltip.hour]}
                </span>
                <span className="text-orange-600 font-bold">
                  {tooltip.count.toLocaleString()} orders
                </span>
                <span className="text-gray-500">
                  {formatPrice(tooltip.sales, currency)} sales
                </span>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
