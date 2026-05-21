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
 */
export default function PeriodFilter({ value, onChange }) {
  return (
    <div className="inline-flex rounded-lg border border-orange-200 bg-white p-0.5 gap-0.5 shadow-sm">
      {PERIODS.map((p) => (
        <button
          key={p.value}
          type="button"
          onClick={() => onChange(p.value)}
          className={cn(
            'px-3 py-1 text-sm font-medium rounded-md transition-all duration-150',
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
