import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

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
      className="inline-flex rounded-lg border border-primary/20 bg-card p-0.5 gap-0.5 shadow-sm"
    >
      {PERIODS.map((p) => (
        <Button
          key={p.value}
          type="button"
          size="sm"
          variant={value === p.value ? 'default' : 'ghost'}
          onClick={() => onChange(p.value)}
          aria-pressed={value === p.value}
          aria-label={`Show ${p.label} stats`}
          className={cn(
            // Ensure ≥44px touch target on small screens
            'h-auto px-3 py-2.5 sm:py-1.5 text-sm font-medium rounded-md shadow-none',
            'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
            value !== p.value && 'text-muted-foreground hover:bg-primary/10 hover:text-primary'
          )}
        >
          {p.label}
        </Button>
      ))}
    </div>
  );
}
