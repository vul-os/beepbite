import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva } from "class-variance-authority";

import { cn } from "@/lib/utils"

// Button variants for a touch-first POS, not a marketing site:
//   - Every size clears (or nearly clears) the 44x44 CSS-px touch target;
//     `touch` and `xl` exist specifically for till/KDS/kiosk primary actions
//     tapped fast, under pressure, with wet or gloved hands.
//   - `destructive` is not "primary but red" — it gets a sharper corner
//     radius (rounded-sm vs rounded-md) so an irreversible action is a
//     different *shape*, not just a different colour, one tap away from a
//     safe one. Pair the most irreversible actions (full void, hard delete)
//     with the .hazard-stripe utility from index.css on top of this.
//   - `warning` is a third, distinct signal for "needs a second look but is
//     not destructive" (manager override, apply discount) — never reuse
//     destructive styling for these, or staff stop trusting the colour.
//   - Focus rings are `ring-2` with an offset, not shadcn's default `ring-1`
//     — visible under kitchen-window glare and usable by counter staff
//     driving the till from a keyboard/barcode scanner.
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-semibold transition-[background-color,border-color,color] duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 active:bg-primary/95",
        destructive:
          "rounded-sm bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90 active:bg-destructive/95 focus-visible:ring-destructive",
        warning:
          "bg-warning text-warning-foreground shadow-sm hover:bg-warning/90 active:bg-warning/95 focus-visible:ring-warning",
        success:
          "bg-success text-success-foreground shadow-sm hover:bg-success/90 active:bg-success/95 focus-visible:ring-success",
        outline:
          "border-2 border-input bg-background hover:bg-accent hover:text-accent-foreground",
        secondary:
          "bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/85",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3 text-xs",
        lg: "h-11 rounded-md px-8",
        icon: "h-10 w-10",
        // Till / KDS / kiosk primary actions — big, thumb-reachable, tapped
        // under pressure. Text scales up too; these are never fine print.
        touch: "h-14 px-6 text-base [&_svg]:size-5",
        "touch-icon": "h-14 w-14 [&_svg]:size-6",
        xl: "h-16 px-8 text-lg [&_svg]:size-6",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

const Button = React.forwardRef(({ className, variant, size, asChild = false, ...props }, ref) => {
  const Comp = asChild ? Slot : "button"
  return (
    (<Comp
      className={cn(buttonVariants({ variant, size, className }))}
      ref={ref}
      {...props} />)
  );
})
Button.displayName = "Button"

export { Button, buttonVariants }
