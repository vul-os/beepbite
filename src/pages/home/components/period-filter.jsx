import React from 'react';
import { cn } from '@/lib/utils';

const PERIODS = [
  { value: 'day',   label: 'Today' },
  { value: 'week',  label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'year',  label: 'Year' },
];

/**
 * Segmented period filter — drives the stats summary fetch.
 * Min touch target: 44px height on mobile via py-2.5 (falls back to py-1 on sm+).
 */
export default function PeriodFilter({ value, onChange }) {
  return (
    <div
      role="group"
      aria-label="Time period"
      className="inline-flex rounded-lg border border-orange-200 bg-white p-0.5 gap-0.5 shadow-sm"
    >
      {PERIODS.map((p) => (
        <button
          key={p.value}
          type="button"
          onClick={() => onChange(p.value)}
          aria-pressed={value === p.value}
          aria-label={`Show ${p.label} stats`}
          className={cn(
            // Ensure ≥44px touch target on small screens
            'px-3 py-2.5 sm:py-1.5 text-sm font-medium rounded-md transition-all duration-150',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 focus-visible:ring-offset-1',
            value === p.value
              ? 'bg-orange-500 text-white shadow-sm'
              : 'text-gray-600 hover:bg-orange-50 hover:text-orange-700'
          )}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}
