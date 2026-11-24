import { allocateProportionally, assertCents, type Cents } from "./money";

/**
 * Spreading a cost over the months it actually covers.
 *
 * A year of insurance paid in March is not a March problem, and a kiln bought
 * in April is not an April problem — but recorded as one lump they look exactly
 * like one. The demo dataset proved the damage: a Rs 95,000 kiln deposit landed
 * whole in April, crushed the margin to 4%, and the app dutifully reported
 * "you sold more and kept less". True to the cent, and completely misleading:
 * nothing had gone wrong, they had bought a kiln.
 *
 * ── How it works, and why it is shaped this way ────────────────────────────
 *
 * The purchase stays ONE transaction, on the day it happened, for the amount
 * that actually left. That keeps the cash-basis view honest — the money really
 * did go out in April. What changes is the ACCRUAL view: the purchase line is
 * marked capitalised and contributes nothing to that month's expenses, while N
 * generated slice transactions carry the cost across the months it covers.
 *
 * So the two bases say two true things:
 *   cash    — "Rs 95,000 left the bank in April"
 *   accrual — "this kiln costs you Rs 3,958 a month for two years"
 *
 * ── The rule that cannot bend ──────────────────────────────────────────────
 *
 * **The slices sum EXACTLY to the original.** Not to within a cent. The
 * split uses `allocateProportionally` — the same largest-remainder allocator
 * the order-discount split uses — so no money is invented or lost, and
 * `spreadReconciles` states the property for a test to assert directly.
 */

/** One spread is at least two months; anything less is just an expense. */
export const MIN_SPREAD_MONTHS = 2;

/**
 * Ten years. Long enough for any equipment a small business buys, short enough
 * that a typo cannot generate a thousand rows.
 */
export const MAX_SPREAD_MONTHS = 120;

export interface SpreadSlice {
  /** 0-based month offset from the month the cost was incurred. */
  monthOffset: number;
  /** First moment of the month this slice belongs to. */
  occursAt: Date;
  amountCents: Cents;
}

/**
 * Split `totalCents` across `months`, starting in the month `start` falls in.
 *
 * Slices are equal-weighted, so the remainder lands on the earliest months
 * rather than the last — a business that stops using the thing early has
 * already recognised slightly more of it, which is the conservative direction.
 */
export function buildSpread(totalCents: Cents, start: Date, months: number): SpreadSlice[] {
  assertCents(totalCents, "buildSpread");
  if (!Number.isInteger(months) || months < MIN_SPREAD_MONTHS) {
    throw new RangeError(`buildSpread: months must be a whole number of at least ${MIN_SPREAD_MONTHS}`);
  }
  if (months > MAX_SPREAD_MONTHS) {
    throw new RangeError(`buildSpread: months cannot exceed ${MAX_SPREAD_MONTHS}`);
  }

  const parts = allocateProportionally(totalCents, new Array(months).fill(1));

  return parts.map((amountCents, monthOffset) => ({
    monthOffset,
    // The first of each month, in UTC, so a slice never drifts across a month
    // boundary on a timezone the server happens to be in.
    occursAt: new Date(
      Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + monthOffset, 1, 12, 0, 0, 0),
    ),
    amountCents,
  }));
}

/**
 * Executable statement of the contract: the slices add up to what was spent.
 *
 * Exported so a test can assert the property directly rather than inferring it
 * from the code that produces it — the same shape as `waterfallReconciles` and
 * `breakEvenReconciles`.
 */
export function spreadReconciles(totalCents: Cents, slices: SpreadSlice[]): boolean {
  return slices.reduce((sum, s) => sum + s.amountCents, 0) === totalCents;
}

/**
 * How the spread reads on screen, in the owner's words.
 *
 * "Rs 3,958.33 a month for 24 months" is the fact they need; the arithmetic
 * behind it is not interesting until something looks wrong.
 */
export function describeSpread(
  totalCents: Cents,
  months: number,
  money: (cents: Cents) => string,
): string {
  const slices = buildSpread(totalCents, new Date(), months);
  // Every slice bar the remainder ones is the same, so the first is the figure
  // worth quoting.
  return `${money(slices[slices.length - 1].amountCents)} a month for ${months} months`;
}

/** True when this line's cost belongs to later months rather than this one. */
export function isCapitalised(spreadMonths: number | null | undefined): boolean {
  return typeof spreadMonths === "number" && spreadMonths >= MIN_SPREAD_MONTHS;
}
