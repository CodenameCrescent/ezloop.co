/**
 * The app's motion vocabulary. One file, so nothing invents its own timing.
 *
 * Two rules govern everything here:
 *
 *  1. MOTION EXPLAINS, IT DOES NOT DECORATE. A thing moves to say where it came
 *     from (a panel rises into place), to say a number changed (it counts), or
 *     to say what is selected now (the indicator slides). Nothing moves just to
 *     be seen moving.
 *  2. IF THE MACHINE ASKED FOR LESS, IT GETS NONE. `useMotionPrefs` returns
 *     zero-duration transitions when `prefers-reduced-motion` is set, so a
 *     component keeps one code path instead of two.
 *
 * The durations mirror --pl-dur-* in index.css. Change one, change both.
 */
import { useReducedMotion, type Transition, type Variants } from "framer-motion";

/** cubic-bezier(.22,.61,.36,1) — the standard "settle". */
export const EASE = [0.22, 0.61, 0.36, 1] as const;
/** cubic-bezier(.16,1,.3,1) — a long, soft landing. Entrances and counts. */
export const EASE_OUT = [0.16, 1, 0.3, 1] as const;

export const DUR = {
  fast: 0.14,
  base: 0.22,
  slow: 0.42,
  /** How long a hero figure takes to count up to itself. */
  count: 0.9,
} as const;

/** Distance a revealed block travels. Small — this is a settle, not a slide. */
const RISE = 10;

/**
 * True when the user has asked for reduced motion, plus ready-made transitions
 * that are already zeroed when they have.
 */
export function useMotionPrefs() {
  const reduced = useReducedMotion() ?? false;
  const t = (duration: number, delay = 0): Transition =>
    reduced
      ? { duration: 0, delay: 0 }
      : { duration, delay, ease: EASE_OUT };
  return { reduced, t };
}

/**
 * Entrance for a block of content. Used by Reveal; exported so a page can hand
 * it to a motion element directly when Reveal's wrapper div would break a grid.
 */
export function revealVariants(reduced: boolean): Variants {
  return {
    hidden: { opacity: 0, y: reduced ? 0 : RISE },
    visible: { opacity: 1, y: 0 },
  };
}

/** Parent that lets its Reveal children arrive one after another. */
export function staggerVariants(reduced: boolean, step = 0.05): Variants {
  return {
    hidden: {},
    visible: {
      transition: { staggerChildren: reduced ? 0 : step },
    },
  };
}

/** Page-level cross-fade. Deliberately quicker than a section reveal. */
export function pageVariants(reduced: boolean): Variants {
  return {
    hidden: { opacity: 0, y: reduced ? 0 : 6 },
    visible: { opacity: 1, y: 0 },
    exit: { opacity: 0 },
  };
}
