import { allocateProportionally, assertCents, type Cents } from "./money";

/**
 * Assets — the big things the business owns, and what is left of them.
 *
 * ── There is no assets table, and there should not be ───────────────────────
 *
 * Every purchase already spread over months IS an asset record. It has a date,
 * an amount, a life in months, and a schedule of slices carrying its cost
 * across that life. A separate table would be a second copy of facts the ledger
 * already holds, and the copy would be the one that goes stale.
 *
 * So this module derives what an owner wants to see — what a machine has used
 * up and what is left of it — from `spread_months` and the purchase date. It
 * reads; it stores nothing.
 *
 * ── Straight line, said plainly ─────────────────────────────────────────────
 *
 * Value drains evenly across the months the purchase covers. That is exactly
 * what spreading already means for the profit ladder, so the Assets screen and
 * the P&L cannot disagree — the alternative would be a second depreciation
 * method producing a second, conflicting answer about the same kiln.
 */

/** Whole calendar months from one date to another. Never negative. */
export function monthsBetween(from: Date, to: Date): number {
  const months =
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
  return Math.max(0, months);
}

export interface AssetLifeInput {
  purchaseCents: Cents;
  /** How many months the purchase was spread over. */
  spreadMonths: number;
  purchasedAt: Date;
  asOf: Date;
}

export interface AssetLife {
  monthsUsed: number;
  monthsLeft: number;
  /** What has been charged to profit so far. */
  usedCents: Cents;
  /** What is still to come. Never negative. */
  remainingCents: Cents;
  /** How far through its life, 0–100. */
  usedPct: number;
  fullyUsed: boolean;
}

export function assetLife(input: AssetLifeInput): AssetLife {
  assertCents(input.purchaseCents, "assetLife.purchaseCents");
  if (input.spreadMonths < 1) throw new RangeError("assetLife: an asset lasts at least one month");

  const monthsUsed = Math.min(input.spreadMonths, monthsBetween(input.purchasedAt, input.asOf));
  const monthsLeft = input.spreadMonths - monthsUsed;

  /**
   * The SAME allocator the spread schedule uses, so the figure here is the sum
   * of the slices that have actually posted — to the paisa. Dividing and
   * multiplying instead would drift from the ledger on any awkward division,
   * and "used" plus "left" would stop adding up to what the thing cost.
   */
  const slices = allocateProportionally(
    input.purchaseCents,
    Array.from({ length: input.spreadMonths }, () => 1),
  );
  const usedCents = slices.slice(0, monthsUsed).reduce((sum, slice) => sum + slice, 0);

  return {
    monthsUsed,
    monthsLeft,
    usedCents,
    remainingCents: input.purchaseCents - usedCents,
    usedPct: Math.round((monthsUsed / input.spreadMonths) * 1000) / 10,
    fullyUsed: monthsLeft === 0,
  };
}
