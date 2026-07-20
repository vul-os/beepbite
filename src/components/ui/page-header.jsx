import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * PageContainer — vertical rhythm wrapper for a page's content. The horizontal
 * max-width + gutters already come from MainLayout; this just provides
 * consistent vertical spacing between stacked sections.
 */
export function PageContainer({ className, children, ...props }) {
  return (
    <div className={cn("space-y-6 sm:space-y-8", className)} {...props}>
      {children}
    </div>
  );
}

/**
 * PageHeader — the standard page title block.
 *
 *   <PageHeader
 *     eyebrow="Operations"
 *     title="Menu"
 *     description="Manage what your customers can order."
 *     actions={<Button>New item</Button>}
 *   />
 *
 * The title renders in Inter at display weight (font-display), matching the rest of the app.
 * `icon` (a lucide component) renders in a soft branded chip to the left.
 */
export function PageHeader({
  title,
  description,
  eyebrow,
  icon: Icon,
  actions,
  className,
  titleClassName,
  ...props
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between",
        className
      )}
      {...props}
    >
      <div className="flex items-start gap-3 min-w-0">
        {Icon && (
          <span className="mt-0.5 flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary ring-1 ring-primary/15">
            <Icon className="h-5 w-5" aria-hidden="true" />
          </span>
        )}
        <div className="min-w-0">
          {eyebrow && (
            <p className="mb-1 text-xs font-semibold uppercase tracking-[0.12em] text-primary">
              {eyebrow}
            </p>
          )}
          <h1
            className={cn(
              "font-display text-2xl font-semibold leading-tight tracking-tight text-foreground sm:text-3xl text-balance",
              titleClassName
            )}
          >
            {title}
          </h1>
          {description && (
            <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground sm:text-[0.95rem] text-pretty">
              {description}
            </p>
          )}
        </div>
      </div>
      {actions && (
        <div className="flex flex-shrink-0 flex-wrap items-center gap-2">{actions}</div>
      )}
    </div>
  );
}

export default PageHeader;
