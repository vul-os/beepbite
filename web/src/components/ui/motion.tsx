import * as React from "react";
import { motion, useReducedMotion } from "framer-motion";

// Tasteful, reduced-motion-aware entrance helpers used across the app.
// Reveal: fades + lifts content into view once. Stagger/StaggerItem: a
// container that cascades its children. When the user prefers reduced motion
// these render static (no transform/opacity animation).

const EASE = [0.22, 1, 0.36, 1];

// `as` picks both the motion.* component used for the animated path and the
// plain intrinsic tag used for the reduced-motion static path. No caller in
// this app currently passes anything but the "div" default, and a wider
// union (any JSX.IntrinsicElements key) doesn't type-check here — each
// motion.<tag> has a differently-shaped prop type (SVGMotionProps vs
// HTMLMotionProps), so a value that's generic over the tag can't satisfy
// all of them at once. Narrowed to the one literal actually used; widen
// this (and the runtime prop plumbing) together if a caller needs another
// tag.
type MotionTagName = "div";

// framer-motion's HTMLMotionProps<"div"> redefines a handful of DOM event
// props (drag/animation/transition lifecycle) with its own gesture-aware
// signatures, which collide with the plain React.ComponentProps<"div">
// versions of the same names. None of these three components are ever
// called with those props (checked: every call site passes only children,
// className, and this file's own delay/y/once/... props), so they're
// omitted from the base rather than reconciled — reconcile for real if a
// caller ever needs to pass one through.
type DivPropsSansMotionConflicts = Omit<
  React.ComponentProps<"div">,
  "onDrag" | "onDragStart" | "onDragEnd" | "onAnimationStart" | "onAnimationEnd"
>;

interface RevealProps extends DivPropsSansMotionConflicts {
  delay?: number;
  y?: number;
  once?: boolean;
  inView?: boolean;
  as?: MotionTagName;
}

/**
 * Reveal — animate a block into view on mount or when scrolled into view.
 * Props: delay (s), y (px), once (bool), inView (bool, default true), as.
 */
export function Reveal({
  children,
  delay = 0,
  y = 12,
  once = true,
  inView = true,
  as = "div",
  className,
  ...props
}: RevealProps) {
  const reduce = useReducedMotion();
  const MotionTag = motion[as] || motion.div;

  if (reduce) {
    const Tag = as;
    return (
      <Tag className={className} {...props}>
        {children}
      </Tag>
    );
  }

  const animateProps = inView
    ? { whileInView: { opacity: 1, y: 0 }, viewport: { once, margin: "-60px" } }
    : { animate: { opacity: 1, y: 0 } };

  return (
    <MotionTag
      className={className}
      initial={{ opacity: 0, y }}
      transition={{ duration: 0.5, ease: EASE, delay }}
      {...animateProps}
      {...props}
    >
      {children}
    </MotionTag>
  );
}

interface StaggerProps extends DivPropsSansMotionConflicts {
  delayChildren?: number;
  stagger?: number;
  once?: boolean;
  as?: MotionTagName;
}

/**
 * Stagger — container that cascades its <StaggerItem> children into view.
 */
export function Stagger({
  children,
  className,
  delayChildren = 0.05,
  stagger = 0.07,
  once = true,
  as = "div",
  ...props
}: StaggerProps) {
  const reduce = useReducedMotion();
  const MotionTag = motion[as] || motion.div;

  if (reduce) {
    const Tag = as;
    return (
      <Tag className={className} {...props}>
        {children}
      </Tag>
    );
  }

  return (
    <MotionTag
      className={className}
      initial="hidden"
      whileInView="show"
      viewport={{ once, margin: "-60px" }}
      variants={{
        hidden: {},
        show: { transition: { staggerChildren: stagger, delayChildren } },
      }}
      {...props}
    >
      {children}
    </MotionTag>
  );
}

interface StaggerItemProps extends DivPropsSansMotionConflicts {
  y?: number;
  as?: MotionTagName;
}

export function StaggerItem({ children, className, y = 14, as = "div", ...props }: StaggerItemProps) {
  const reduce = useReducedMotion();
  const MotionTag = motion[as] || motion.div;

  if (reduce) {
    const Tag = as;
    return (
      <Tag className={className} {...props}>
        {children}
      </Tag>
    );
  }

  return (
    <MotionTag
      className={className}
      variants={{
        hidden: { opacity: 0, y },
        show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE } },
      }}
      {...props}
    >
      {children}
    </MotionTag>
  );
}

export default Reveal;
