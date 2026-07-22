import * as React from "react"
import { cva } from "class-variance-authority"

import { cn } from "@/lib/utils"

// Card variants. Corners are grounded (rounded-lg, not the bubble-SaaS
// rounded-2xl this used to default to everywhere) and borders carry more of
// the definition than shadow does — this reads as a counter/order-pad
// surface under flat kitchen lighting, where a 4px soft drop shadow all but
// disappears.
const cardVariants = cva(
  "text-card-foreground",
  {
    variants: {
      variant: {
        default: "rounded-lg border-2 bg-card shadow-card",
        elevated: "rounded-lg border-2 border-border bg-card shadow-elevated",
        interactive:
          "rounded-lg border-2 border-border bg-card shadow-card card-interactive hover:border-primary/50",
        feature:
          "rounded-lg border-2 border-border bg-gradient-to-br from-card to-muted/50 shadow-card",
        glass:
          "rounded-lg border-2 border-white/40 bg-white/70 shadow-card backdrop-blur-xl",
      },
    },
    defaultVariants: { variant: "default" },
  }
)

const Card = React.forwardRef(({ className, variant, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(cardVariants({ variant }), className)}
    {...props} />
))
Card.displayName = "Card"

const CardHeader = React.forwardRef(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex flex-col space-y-1.5 p-6", className)}
    {...props} />
))
CardHeader.displayName = "CardHeader"

const CardTitle = React.forwardRef(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("font-display text-lg font-semibold leading-tight tracking-tight", className)}
    {...props} />
))
CardTitle.displayName = "CardTitle"

const CardDescription = React.forwardRef(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props} />
))
CardDescription.displayName = "CardDescription"

const CardContent = React.forwardRef(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("p-6 pt-0", className)} {...props} />
))
CardContent.displayName = "CardContent"

const CardFooter = React.forwardRef(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex items-center p-6 pt-0", className)}
    {...props} />
))
CardFooter.displayName = "CardFooter"

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent, cardVariants }
