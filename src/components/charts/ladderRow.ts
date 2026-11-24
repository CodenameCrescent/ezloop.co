/**
 * How one rung of a ladder is written down: its colour, its label, its figure.
 *
 * Three decisions that LOOK like one and are not, which is how they got tangled.
 * A ladder's steps are operations — take this off that — except the last, which
 * is a RESULT. Every step but the last carries its direction in `kind` and a
 * positive `value`; the last carries a signed value and no operation at all.
 *
 * The bug this module exists to prevent: a negative result was re-labelled as a
 * deduction so it would draw in the loss colour, and that borrowed the
 * deduction's "− " label prefix along with the colour. So a loss-making month
 * printed `− True profit   Rs 600,050.83` — the minus sitting on the label where
 * it reads as "subtract this too", and the figure itself unsigned. Read down the
 * column it said 67,434.82 − 667,485.65 − 600,050.83, while the hero figure at
 * the top of the same screen correctly said -Rs 600,051.
 *
 * So: `fillKind` is the colour question and may borrow. `prefix` is the
 * operation question and never may — a result is not an instruction. `signed`
 * is whether the figure carries its own minus, which DESIGN.md §3a requires of
 * money regardless, because green and red do not separate under colour
 * blindness.
 *
 * Pure and separate from the component so it can be checked without rendering,
 * the same reason `inOutScale.ts` sits beside it.
 */

export type LadderKind = "start" | "deduction" | "credit" | "end";

export type LadderRowPresentation = {
  /** Which colour this rung draws in — a negative result borrows the loss tone. */
  fillKind: LadderKind;
  /** The operator shown before the LABEL. Empty for anything that is a result. */
  prefix: "" | "− " | "+ ";
  /** True when the figure must print its own minus sign. */
  signed: boolean;
};

export function ladderRowPresentation(kind: LadderKind, value: number): LadderRowPresentation {
  // A negative end is a loss and must not draw in the profit green.
  const isLoss = kind === "end" && value < 0;
  return {
    fillKind: isLoss ? "deduction" : kind,
    // Keyed off the ORIGINAL kind, never the borrowed one.
    prefix: kind === "deduction" ? "− " : kind === "credit" ? "+ " : "",
    signed: kind === "end" && value < 0,
  };
}

/**
 * The figure as it is printed, given the caller's own money formatter.
 *
 * The formatter is handed a positive number and the sign is put back here, so
 * the two pages using this keep the formatters they already had — one speaks
 * rupees, the other cents — and neither has to grow a signed variant.
 */
export function ladderRowFigure(
  value: number,
  signed: boolean,
  format: (value: number) => string,
): string {
  const body = format(Math.abs(value));
  return signed ? `-${body}` : body;
}
