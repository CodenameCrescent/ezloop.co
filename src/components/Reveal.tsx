import * as React from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { DUR, revealVariants, staggerVariants, useMotionPrefs } from "@/lib/motion";

/**
 * A block that arrives instead of appearing.
 *
 * Ten pixels and a fade. That is the whole effect, and it is deliberate: the
 * point is to give the eye an order to read the page in, not to put on a show.
 *
 * Two ways to use it:
 *
 *   <Reveal>…</Reveal>                 one block, arrives immediately
 *   <Stagger><Reveal/><Reveal/></…>    siblings arrive 50ms apart, in order
 *
 * Inside a Stagger, a Reveal inherits the parent's timing and ignores `delay`.
 */
export function Reveal({
  children,
  delay = 0,
  className,
  as = "div",
  ...rest
}: {
  children: React.ReactNode;
  /** Seconds. Ignored inside a Stagger, which does the ordering itself. */
  delay?: number;
  className?: string;
  as?: "div" | "section" | "article" | "li";
} & Omit<React.HTMLAttributes<HTMLDivElement>, "children">) {
  const { reduced } = useMotionPrefs();
  const Component = motion[as];

  return (
    <Component
      variants={revealVariants(reduced)}
      transition={{ duration: reduced ? 0 : DUR.slow, delay: reduced ? 0 : delay, ease: [0.16, 1, 0.3, 1] }}
      className={cn(className)}
      {...(rest as Record<string, unknown>)}
    >
      {children}
    </Component>
  );
}

/**
 * Orders its Reveal children. Renders as a plain block by default, so it can
 * carry the `space-y-*` or `grid` classes the layout already needed — it does
 * not add a wrapper you have to design around.
 */
export function Stagger({
  children,
  step = 0.05,
  className,
  as = "div",
  ...rest
}: {
  children: React.ReactNode;
  /** Seconds between siblings. */
  step?: number;
  className?: string;
  as?: "div" | "section" | "ul";
} & Omit<React.HTMLAttributes<HTMLDivElement>, "children">) {
  const { reduced } = useMotionPrefs();
  const Component = motion[as];

  return (
    <Component
      initial="hidden"
      animate="visible"
      variants={staggerVariants(reduced, step)}
      className={cn(className)}
      {...(rest as Record<string, unknown>)}
    >
      {children}
    </Component>
  );
}

/**
 * A Reveal that does its own arriving, for when there is no Stagger above it.
 * Same visual result; it just does not wait to be told.
 */
export function RevealOnMount(props: React.ComponentProps<typeof Reveal>) {
  return (
    <Stagger step={0}>
      <Reveal {...props} />
    </Stagger>
  );
}
