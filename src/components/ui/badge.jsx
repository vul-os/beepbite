import { cva } from "class-variance-authority";

import { cn } from "@/lib/utils"

// Status badges. `success` / `warning` / `destructive` are three genuinely
// distinct signals (paid/ready, needs-attention, irreversible-or-failed) —
// never reuse one hue for two meanings across the POS/KDS/orders surfaces.
const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary text-primary-foreground",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground",
        destructive:
          "border-transparent bg-destructive text-destructive-foreground",
        warning:
          "border-transparent bg-warning text-warning-foreground",
        success:
          "border-transparent bg-success text-success-foreground",
        outline: "text-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant,
  ...props
}) {
  return (<div className={cn(badgeVariants({ variant }), className)} {...props} />);
}

export { Badge, badgeVariants }
