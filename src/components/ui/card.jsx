import * as React from "react"
import { cva } from "class-variance-authority"

import { cn } from "@/lib/utils"

// Card variants. `default` preserves the original look so existing usages are
// unaffected; the new variants add depth, hover lift, and the brand gradient.
const cardVariants = cva(
  "text-card-foreground",
  {
    variants: {
      variant: {
        default: "rounded-xl border bg-card shadow-card",
        elevated: "rounded-2xl border border-border/60 bg-card shadow-elevated",
        interactive:
          "rounded-2xl border border-border/70 bg-card shadow-card card-interactive hover:border-border",
        feature:
          "rounded-2xl border border-border/60 bg-gradient-to-br from-card to-muted/50 shadow-card",
        glass:
          "rounded-2xl border border-white/40 bg-white/70 shadow-card backdrop-blur-xl",
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
