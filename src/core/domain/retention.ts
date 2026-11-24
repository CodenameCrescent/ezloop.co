import Decimal from "decimal.js";
import { assertCents, type Cents } from "./money";

/**
 * Retention — money the customer keeps back until the work is signed off.
 *
 * Standard in construction: bill a million, get nine hundred thousand now and
 * the last hundred thousand when the defects period ends, often a year later.
 *
 * ── Why this is a SPLIT and not a part-payment ──────────────────────────────
 *
 * The obvious model is one invoice that is partly paid, which would need
 * per-transaction payment storage the app does not have. It is also the wrong
 * model. Retention is not a customer paying late — it is two separate promises
 * agreed at the same moment, with two different dates, one of which is not owed
 * yet and should not be chased.
 *
 * So a retained bill is written as TWO ordinary receivables through the
 * ordinary `createTransaction` path: the main amount on normal terms, and the
 * held-back amount due on the release date. Both appear on the owed list, each
 * with its own honest state. No new table, no new money path, nothing
 * downstream has to learn a thing.
 *
 * ── The rule that cannot bend ───────────────────────────────────────────────
 *
 * **The two parts sum EXACTLY to the bill.** They are real ledger rows and a
 * rounding gap between them is money invented or lost somewhere nobody would
 * ever look — both rows render as perfectly ordinary invoices.
 */

/**
 * Ten percent is the common figure and twenty is high. Fifty is not a retention,
 * it is a dispute, and a number that large is far more likely to be a typo.
 */
export const MAX_RETENTION_PCT = 50;

export interface RetentionSplit {
  /** Due on the ordinary terms. */
  nowCents: Cents;
  /** Held back until sign-off, and due on its own date. */
  heldBackCents: Cents;
  /** The percentage as agreed, carried through for the note on the row. */
  pct: string;
}

export function buildRetentionSplit(totalCents: Cents, retentionPct: string): RetentionSplit {
  assertCents(totalCents, "buildRetentionSplit");
  if (totalCents <= 0) {
    throw new RangeError("buildRetentionSplit: a bill of nothing cannot hold anything back");
  }

  let pct: Decimal;
  try {
    pct = new Decimal(retentionPct);
  } catch {
    throw new RangeError(`buildRetentionSplit: "${retentionPct}" is not a percentage`);
  }
  if (!pct.isFinite() || pct.lessThanOrEqualTo(0)) {
    throw new RangeError("buildRetentionSplit: a retention of nothing is not a retention");
  }
  if (pct.greaterThan(MAX_RETENTION_PCT)) {
    throw new RangeError(
      `buildRetentionSplit: ${retentionPct}% is too much to hold back — the most is ${MAX_RETENTION_PCT}%`,
    );
  }

  /**
   * The retention is computed and the remainder falls to the immediate amount,
   * rather than the other way round. Deliberate: the held-back figure is the one
   * both sides will check against the contract when it is released, so it gets
   * the clean number and the payment due now absorbs the odd paisa.
   */
  const heldBackCents = Number(
    new Decimal(totalCents).times(pct).div(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP),
  );
  const nowCents = totalCents - heldBackCents;

  if (nowCents <= 0) {
    throw new RangeError("buildRetentionSplit: holding back the whole bill leaves nothing to invoice");
  }

  return { nowCents, heldBackCents, pct: pct.toString() };
}

/** The property a test can assert directly: the parts add back to the bill. */
export function retentionReconciles(totalCents: Cents, split: RetentionSplit): boolean {
  return split.nowCents + split.heldBackCents === totalCents;
}

/** "Rs 900,000.00 due now, Rs 100,000.00 held back until sign-off." */
export function describeRetention(split: RetentionSplit, money: (cents: Cents) => string): string {
  return `${money(split.nowCents)} due now, ${money(split.heldBackCents)} held back until sign-off.`;
}
