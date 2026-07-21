import { motion, useReducedMotion } from "framer-motion";

// Tasteful, reduced-motion-aware entrance helpers used across the app.
// Reveal: fades + lifts content into view once. Stagger/StaggerItem: a
// container that cascades its children. When the user prefers reduced motion
// these render static (no transform/opacity animation).

const EASE = [0.22, 1, 0.36, 1];

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
}) {
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
}) {
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

export function StaggerItem({ children, className, y = 14, as = "div", ...props }) {
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
