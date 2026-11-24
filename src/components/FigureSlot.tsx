import type { ReactNode } from "react";
import { FIGURE_STATE_COPY, type FigureState } from "@/lib/figureState";

/**
 * What stands in a figure's place when there is no figure.
 *
 * The words live in `FIGURE_STATE_COPY` so no two screens describe the same
 * state differently; this is the same idea one level up, so no two screens
 * *render* it differently either. Before it, every tile and total on a page
 * carried its own three-way ternary, and the differences between them were
 * accidental rather than meant.
 *
 * Three rules it exists to hold:
 *
 * - **A dash means settled.** The server answered and the answer was nothing.
 *   It is not the fallback for "we could not ask" — that was the whole bug
 *   (DECISIONS.md, 2026-08-28).
 * - **Amber, never red or green.** Colour in this app means money (DESIGN.md
 *   §2) and a request that did not land is not money lost.
 * - **No `tabular-nums`, and no size or weight of its own.** This is words in a
 *   slot built for digits. It inherits the surrounding type so it sits right,
 *   but it deliberately does not inherit the figure's tabular styling — giving
 *   it the typography of a number is how it starts being read as one.
 */
export function FigureSlot({
  state,
  loading,
  children,
}: {
  state: FigureState;
  /** Shown while the figure is in flight. A dash unless the caller has a skeleton. */
  loading?: ReactNode;
  /** The figure itself. Rendered ONLY when the request settled. */
  children: ReactNode;
}) {
  if (state === "settled") return <>{children}</>;
  if (state === "loading") return <>{loading ?? <span className="t-secondary">—</span>}</>;
  return <span className="text-[color:var(--pl-amber)]">{FIGURE_STATE_COPY[state].slot}</span>;
}
