import { ArrowUpRight, ArrowDownRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * StatCard — a single KPI tile.
 *
 *   <StatCard
 *     label="Gross sales"
 *     value={formatMoney(482000, { currency, locale })}
 *     delta={12.4}                // positive => green up, negative => red down
 *     deltaLabel="vs last week"
 *     icon={DollarSign}
 *   />
 *
 * `value` may be any node. Pass `loading` to show a skeleton. The icon sits in
 * a soft branded chip; the whole tile lifts subtly on hover.
 */
export function StatCard({
  label,
  value,
  delta,
  deltaLabel,
  icon: Icon,
  hint,
  loading = false,
  className,
  iconClassName,
  ...props
}) {
  const hasDelta = delta !== undefined && delta !== null && delta !== "";
  const deltaNum = typeof delta === "number" ? delta : parseFloat(delta);
  const isUp = Number.isFinite(deltaNum) ? deltaNum >= 0 : true;

  return (
    <Card
      variant="interactive"
      className={cn("p-5", className)}
      {...props}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        {Icon && (
          <span
            className={cn(
              "flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/10",
              iconClassName
            )}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
          </span>
        )}
      </div>

      <div className="mt-3">
        {loading ? (
          <Skeleton className="h-8 w-28" />
        ) : (
          <p className="font-display text-[1.7rem] font-semibold leading-none tracking-tight text-foreground sm:text-3xl">
            {value}
          </p>
        )}
      </div>

      {(hasDelta || hint) && (
        <div className="mt-3 flex items-center gap-2">
          {hasDelta && !loading && (
            <span
              className={cn(
                "inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-semibold",
                isUp
                  ? "bg-emerald-50 text-emerald-700"
                  : "bg-rose-50 text-rose-700"
              )}
            >
              {isUp ? (
                <ArrowUpRight className="h-3 w-3" />
              ) : (
                <ArrowDownRight className="h-3 w-3" />
              )}
              {typeof delta === "number"
                ? `${Math.abs(delta).toFixed(1)}%`
                : delta}
            </span>
          )}
          {deltaLabel && !loading && (
            <span className="text-xs text-muted-foreground">{deltaLabel}</span>
          )}
          {hint && !hasDelta && (
            <span className="text-xs text-muted-foreground">{hint}</span>
          )}
        </div>
      )}
    </Card>
  );
}

export default StatCard;
