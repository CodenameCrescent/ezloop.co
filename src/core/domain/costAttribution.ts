import { addCents, assertCents, type Cents } from "./money";
import type { CostNature } from "./costNature";

/**
 * How much of a period's cost actually reached a client — and how much did not.
 *
 * ── The failure this exists to prevent ─────────────────────────────────────
 *
 * Client profitability reads `transaction_lines.target_id`. Until splitting
 * shipped, nothing ever wrote it, so every client's cost to serve was Rs 0 —
 * and a zero that means "nobody filled this in" is indistinguishable from a
 * zero that means "this client really is free to serve beyond labour". The
 * second is a fact; the first is a confident lie, and it quietly inflates the
 * contribution figure sitting next to it.
 *
 * ── Why the gate is on the PERIOD, not the client ──────────────────────────
 *
 * Nulling a client's cost when they have none would be the wrong fix. Hours
 * are always consumed, so no hours logged can never mean zero hours — that is
 * why labour is nulled per client. Direct costs are different: a client with
 * no subcontractor and no bought-in software genuinely costs nothing beyond
 * labour, and blanking that would suppress a correct figure for the majority
 * to hedge against a minority.
 *
 * So the question is asked once, of the period: **is there any cost here that
 * could have named a client and didn't?** If not, every zero on the page is
 * true and nothing needs saying. If so, the amount is reported separately and
 * the page states that client contribution excludes it.
 *
 * ── Why "never split" is its own bucket ────────────────────────────────────
 *
 * Rent, wages and software are fixed costs, and fixed costs are NEVER
 * allocated per client or per item (CLAUDE.md). Folding them into the
 * untargeted pool would report ~89% of a real business's costs as unassigned
 * every month, forever — a number that can never reach zero, so it stops being
 * read — and it would imply the owner ought to split rent across clients,
 * which is the exact thing splitting deliberately refuses to do.
 *
 * Naming them apart keeps the middle number honest: it is work with an end.
 */

/** Which of the three a cost line belongs to. */
export type CostAttribution = "targeted" | "splittable" | "never_split";

/** The subset of a line this classification needs. */
export interface AttributionLine {
  /** True when the line carries both a target type and id. */
  targeted: boolean;
  /**
   * The line's cost nature, or null when nothing classifies it — a label-only
   * line, or an expense item with no nature set.
   */
  costNature: CostNature | null;
  /**
   * True for a fee on a refund or chargeback. It is a real period expense, but
   * adjustments cannot carry a target, so it can never be pointed anywhere.
   */
  isAdjustmentFee?: boolean;
  /**
   * True for a cost recorded on a transaction that also has a sale. It belongs
   * to that job at contribution level and the ledger refuses to target it.
   */
  insideSale?: boolean;
}

export interface CostAttributionTotals {
  /** Reached a client, an offer, or an internal bucket. */
  targetedCents: Cents;
  /**
   * Could have named a target and did not. **The pool the gate watches** — the
   * only one of the three that clearing actually drives to zero.
   */
  untargetedSplittableCents: Cents;
  /**
   * Never split by client, on purpose: fixed and semi-variable overheads, fees
   * on adjustments, and costs already booked against a sale.
   */
  neverSplitCents: Cents;
}

/**
 * Where one cost line belongs.
 *
 * Unclassified counts as SPLITTABLE, not as overhead. "We do not know what
 * this is" is exactly the state the owner should be nudged to look at, and
 * quietly filing unknowns under fixed would hide them behind the one bucket
 * that is never expected to reach zero.
 */
export function classifyCostLine(line: AttributionLine): CostAttribution {
  if (line.targeted) return "targeted";
  if (line.isAdjustmentFee || line.insideSale) return "never_split";
  // Semi-variable sits with fixed for the same reason break-even puts it
  // there: splitting the fixed base from the usage part needs machinery that
  // does not exist yet, and erring toward "not splittable" understates how
  // much is missing rather than overstating it.
  if (line.costNature === "fixed" || line.costNature === "semi_variable") return "never_split";
  return "splittable";
}

/** Total a period's cost lines into the three buckets. */
export function totalCostAttribution(
  lines: Array<AttributionLine & { spendCents: Cents }>,
): CostAttributionTotals {
  const totals: CostAttributionTotals = {
    targetedCents: 0,
    untargetedSplittableCents: 0,
    neverSplitCents: 0,
  };
  for (const line of lines) {
    assertCents(line.spendCents, "totalCostAttribution");
    switch (classifyCostLine(line)) {
      case "targeted":
        totals.targetedCents = addCents(totals.targetedCents, line.spendCents);
        break;
      case "splittable":
        totals.untargetedSplittableCents = addCents(totals.untargetedSplittableCents, line.spendCents);
        break;
      case "never_split":
        totals.neverSplitCents = addCents(totals.neverSplitCents, line.spendCents);
        break;
    }
  }
  return totals;
}

/**
 * THE gate. True when every cost that could have named a client did.
 *
 * When this holds, a client showing zero cost to serve is stating a fact, and
 * the page needs no caveat. When it does not, the page must say what is
 * missing — because the zeros are then unreadable.
 */
export function isFullyAttributed(totals: CostAttributionTotals): boolean {
  return totals.untargetedSplittableCents === 0;
}

/**
 * The three buckets must be the period's expenses, exactly.
 *
 * Stated as a function so a test can assert it directly, and asserted by the
 * caller against the ladder. Writing this check is what surfaced that a
 * chargeback fee fell outside all three buckets — a cost that would otherwise
 * have gone silently missing from the page's own accounting of itself.
 */
export function attributionReconciles(
  totals: CostAttributionTotals,
  periodExpensesCents: Cents,
): boolean {
  const sum = totals.targetedCents + totals.untargetedSplittableCents + totals.neverSplitCents;
  return sum === periodExpensesCents;
}
