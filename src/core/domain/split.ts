import Decimal from "decimal.js";
import { allocateProportionally, assertCents, type Cents } from "./money";

/**
 * Splitting one bill across the several things it was really for.
 *
 * A designer invoices Rs 30,000 for work on three clients. A courier bills one
 * monthly total covering every order. Recorded as one lump against nobody, the
 * money is in the ledger and in True profit — correct at the business level,
 * and useless the moment anyone asks "what did Acme actually cost me?". Client
 * profitability reads `transaction_lines.target_id`, so an untargeted bill
 * shows every client as costing nothing.
 *
 * ── The shape, and why it is this shape ────────────────────────────────────
 *
 * A split is N LINES on the same transaction, not a new table. The ledger
 * already carries many lines per transaction; a line already has exactly one
 * target; and every read path already totals per line via `expenseLineSpends`.
 * An allocations table would be a second money path that every one of those
 * read paths would have to learn about separately — which is the mistake the
 * ad-spend table made, and the reason it no longer exists.
 *
 * So this module does one job: turn a total and a set of weights into exact
 * per-target amounts. The ledger writes them as ordinary lines and everything
 * downstream needs to know nothing at all.
 *
 * ── What this deliberately does NOT do ─────────────────────────────────────
 *
 * It does not split by revenue share at query time. "Allocate the rent across
 * clients in proportion to what they earned" is fixed-cost allocation, which
 * the profit ladder forbids: fixed costs are never allocated per unit or per
 * item, and item-level screens stop at contribution profit. A split here is
 * always a statement of FACT the owner is making — "this bill was for these
 * three, in these proportions" — never a formula the app invents.
 *
 * ── The rule that cannot bend ──────────────────────────────────────────────
 *
 * **The parts sum EXACTLY to the bill.** `allocateProportionally` is the same
 * largest-remainder allocator the order discount and the spread schedule use,
 * so no money is invented or lost, and `splitReconciles` states the property
 * for a test to assert directly.
 */

/** A split of one is not a split; below two parts, just target the line. */
export const MIN_SPLIT_PARTS = 2;

/**
 * Twenty ways. Far beyond any bill a small business really divides by hand,
 * and low enough that a paste accident cannot generate hundreds of lines.
 */
export const MAX_SPLIT_PARTS = 20;

/**
 * What a line can be booked against. `project` arrived with Stage 2 and needs
 * no other change here: this module turns a total into shares and never asks
 * what a target IS.
 */
export type SplitTargetType = "client" | "revenue_item" | "internal" | "project";

/** One share of a bill: who it was for, and how much of it. */
export interface SplitPart {
  targetType: SplitTargetType;
  targetId: string;
  /**
   * Decimal string. Read as a RELATIVE weight, so "50/30/20" and "5/3/2" mean
   * the same thing — the owner types percentages because that is how people
   * think, and nothing breaks if they do not quite add to 100.
   */
  weight: string;
}

export interface SplitShare extends SplitPart {
  amountCents: Cents;
}

/** `${targetType}:${targetId}` — the key every read path already groups by. */
export function splitTargetKey(part: Pick<SplitPart, "targetType" | "targetId">): string {
  return `${part.targetType}:${part.targetId}`;
}

/**
 * Divide `totalCents` between `parts` in proportion to their weights.
 *
 * Weights are relative on purpose. Insisting they total exactly 100 would mean
 * rejecting "a third each", which is a real way to split a bill and not
 * expressible in whole percentage points. What the owner is stating is the
 * ratio; the app is responsible for the arithmetic.
 */
export function buildSplit(totalCents: Cents, parts: SplitPart[]): SplitShare[] {
  assertCents(totalCents, "buildSplit");
  assertValidParts(parts);

  // Weights become integer thousandths before allocation, so "33.333" is
  // carried at the precision it was typed at rather than rounded to a whole
  // number first — three-way splits are the common case and the one most
  // likely to expose sloppy rounding.
  const weights = parts.map((part) => new Decimal(part.weight).times(1000).toDecimalPlaces(0).toNumber());
  const amounts = allocateProportionally(totalCents, weights);

  return parts.map((part, i) => ({ ...part, amountCents: amounts[i] }));
}

/**
 * The property a test can assert directly: the parts add back to the bill.
 *
 * Stated as a function rather than left implicit because it is the whole
 * safety claim. A split that does not reconcile has invented or lost money in
 * a place nobody looks — the lines are ordinary lines, so nothing downstream
 * would ever notice.
 */
export function splitReconciles(totalCents: Cents, shares: SplitShare[]): boolean {
  return shares.reduce((sum, share) => sum + share.amountCents, 0) === totalCents;
}

/**
 * "Rs 30,000.00 split 3 ways — Acme Rs 15,000.00, Belmont Rs 9,000.00, …"
 *
 * `money` is passed in because formatting is the caller's business: the domain
 * knows nothing about currency symbols or locale.
 */
export function describeSplit(
  totalCents: Cents,
  shares: SplitShare[],
  labelFor: (part: SplitPart) => string,
  money: (cents: Cents) => string,
): string {
  const parts = shares.map((share) => `${labelFor(share)} ${money(share.amountCents)}`).join(", ");
  return `${money(totalCents)} split ${shares.length} ways — ${parts}.`;
}

/**
 * Every way a split can be nonsense, in one place.
 *
 * Thrown rather than returned: these are all programmer or input errors the
 * ledger must refuse before writing anything, and a half-valid split that
 * silently dropped a part would be the worst outcome of the three.
 */
function assertValidParts(parts: SplitPart[]): void {
  if (parts.length < MIN_SPLIT_PARTS) {
    throw new RangeError(`buildSplit: a split needs at least ${MIN_SPLIT_PARTS} parts`);
  }
  if (parts.length > MAX_SPLIT_PARTS) {
    throw new RangeError(`buildSplit: a split takes at most ${MAX_SPLIT_PARTS} parts`);
  }

  const seen = new Set<string>();
  for (const part of parts) {
    if (!part.targetId) throw new RangeError("buildSplit: every part needs a target");

    const key = splitTargetKey(part);
    // Two shares of the same client would produce two lines that both say
    // "Acme", which is not wrong so much as pointless — and it hides a real
    // mistake, which is that the owner meant to pick someone else.
    if (seen.has(key)) throw new RangeError(`buildSplit: ${key} appears twice in one split`);
    seen.add(key);

    let weight: Decimal;
    try {
      weight = new Decimal(part.weight);
    } catch {
      throw new RangeError(`buildSplit: "${part.weight}" is not a number`);
    }
    if (!weight.isFinite() || weight.lte(0)) {
      throw new RangeError("buildSplit: every share must be greater than zero");
    }
  }
}
