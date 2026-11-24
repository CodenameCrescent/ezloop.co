import { useSyncExternalStore } from "react";

/**
 * A CSS media query, as a boolean React can read.
 *
 * Almost everything responsive in this app is done in CSS, and should be. This
 * exists for the one case CSS cannot express: two containers that must be
 * MUTUALLY EXCLUSIVE, where one of them portals to the body. A sheet hidden
 * with `lg:hidden` still mounts its overlay over the whole page, so the wide
 * layout would open a slide-over on top of the card it already has.
 *
 * `useSyncExternalStore` rather than an effect, so the first render already has
 * the right answer and the layout never flips after paint.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    // No window on the server; the narrow layout is the safe assumption.
    () => false,
  );
}

/** Tailwind's `lg` breakpoint — where the pinned detail card has room to exist. */
export const LG_UP = "(min-width: 1024px)";
