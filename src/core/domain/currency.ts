import Decimal from "decimal.js";
import type { Cents } from "./money";

/**
 * Foreign currency, converted at a rate FROZEN on the transaction.
 *
 * A transaction stores its amounts in the currency they were actually in, plus
 * the rate to the business's base currency as it stood that day. Every profit
 * number is then computed in base currency using that stored rate — never
 * today's rate. This is the same principle as a frozen cost snapshot: the
 * dollar you earned in March is a March dollar forever, and a rate move in
 * July must not silently rewrite March's profit.
 *
 * Amounts stay integer minor units on both sides; the rate is a decimal string
 * computed with decimal.js, per the money rules in CLAUDE.md.
 */

const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

/** A rate of exactly one — the overwhelmingly common single-currency case. */
export const IDENTITY_FX_RATE = "1";

/** Positive decimal string, e.g. "280.5". Zero and negatives are not rates. */
export function isValidFxRate(rate: unknown): rate is string {
  if (typeof rate !== "string" || !/^\d+(\.\d+)?$/.test(rate)) return false;
  return new D(rate).greaterThan(0);
}

export function assertFxRate(rate: string): string {
  if (!isValidFxRate(rate)) {
    throw new TypeError(`fx rate "${rate}" must be a positive decimal string`);
  }
  return rate;
}

/** True when no conversion is needed, so amounts can pass through untouched. */
export function isIdentityRate(rate: string): boolean {
  return isValidFxRate(rate) && new D(rate).equals(1);
}

/**
 * Convert an amount into base currency at the transaction's frozen rate.
 * Rounds half-up to whole minor units, like every other money conversion here.
 */
export function toBaseCents(cents: Cents, fxRateToBase: string): Cents {
  if (!Number.isSafeInteger(cents)) {
    throw new TypeError(`toBaseCents: money must be a safe integer in minor units, got ${cents}`);
  }
  assertFxRate(fxRateToBase);
  if (isIdentityRate(fxRateToBase)) return cents;

  const negative = cents < 0;
  // Convert the magnitude so half-up rounding is symmetric about zero: a
  // refund of X must convert to exactly the negation of a sale of X, or
  // refunds would fail to cancel the sales they reverse.
  const converted = new D(Math.abs(cents)).times(fxRateToBase).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  const result = converted.toNumber() * (negative ? -1 : 1);
  if (!Number.isSafeInteger(result)) {
    throw new RangeError(`toBaseCents: result ${converted.toString()} is outside the safe integer range`);
  }
  return result;
}
