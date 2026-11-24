import Decimal from "decimal.js";

/**
 * Money math for the whole app. Amounts are ALWAYS integers in minor units
 * (cents/paisa) — floats are banned from money math (see CLAUDE.md). Rates and
 * quantities travel as decimal strings and are computed with decimal.js;
 * every function returns exact integer cents, rounded half-up.
 */

// Local Decimal clone so we never mutate the global decimal.js config.
const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export type Cents = number;

/**
 * Exported so other domain modules can guard their own money inputs and name
 * THEMSELVES in the error. Routing every check through `addCents` worked but
 * reported "addCents" as the culprit, which sent the reader to the wrong file.
 */
export function assertCents(value: number, context: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`${context}: money must be a safe integer in minor units, got ${value}`);
  }
}

function toResultCents(value: Decimal, context: string): Cents {
  const rounded = value.toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  const result = rounded.toNumber();
  if (!Number.isSafeInteger(result)) {
    throw new RangeError(`${context}: result ${rounded.toString()} is outside the safe integer range`);
  }
  return result;
}

/** Sums integer cent amounts, rejecting any non-integer input. */
export function addCents(...values: Cents[]): Cents {
  let sum = 0;
  for (const value of values) {
    assertCents(value, "addCents");
    sum += value;
  }
  if (!Number.isSafeInteger(sum)) {
    throw new RangeError(`addCents: sum is outside the safe integer range`);
  }
  return sum;
}

/**
 * Multiplies a cent amount by a quantity given as a decimal string
 * (e.g. mulCentsQty(1050, "2.5") → 2625). Rounds half-up to whole cents.
 */
export function mulCentsQty(cents: Cents, quantity: string): Cents {
  assertCents(cents, "mulCentsQty");
  return toResultCents(new D(cents).mul(new D(quantity)), "mulCentsQty");
}

/**
 * Takes a percentage of a cent amount; the rate is a decimal string of
 * percentage points (e.g. percentOfCents(1000, "17.5") → 175).
 * Rounds half-up to whole cents.
 */
export function percentOfCents(cents: Cents, rate: string): Cents {
  assertCents(cents, "percentOfCents");
  return toResultCents(new D(cents).mul(new D(rate)).div(100), "percentOfCents");
}

/**
 * Formats integer cents for display, e.g. formatMoney(123456, { symbol: "$" })
 * → "$1,234.56". Pure integer math — no float division of money.
 */
export function formatMoney(
  cents: Cents,
  options: { symbol?: string; locale?: string; minorUnitDigits?: number } = {},
): string {
  assertCents(cents, "formatMoney");
  const { symbol = "", locale = "en-US", minorUnitDigits = 2 } = options;
  const scale = 10 ** minorUnitDigits;
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.trunc(abs / scale);
  const fraction = String(abs % scale).padStart(minorUnitDigits, "0");
  const grouped = new Intl.NumberFormat(locale).format(whole);
  const digits = minorUnitDigits > 0 ? `${grouped}.${fraction}` : grouped;
  return `${negative ? "-" : ""}${symbol}${digits}`;
}

/**
 * Splits a total proportionally to `weights` using the largest-remainder
 * method, so the parts ALWAYS sum exactly to the total (no lost or invented
 * cents). Zero-weight entries receive 0; if every weight is 0 the total is
 * split equally. Negative totals are allocated symmetrically.
 */
export function allocateProportionally(totalCents: Cents, weights: number[]): Cents[] {
  assertCents(totalCents, "allocateProportionally");
  if (weights.length === 0) {
    if (totalCents !== 0) {
      throw new RangeError("allocateProportionally: cannot allocate a non-zero total across zero lines");
    }
    return [];
  }
  for (const weight of weights) {
    if (!Number.isFinite(weight) || weight < 0) {
      throw new RangeError(`allocateProportionally: weights must be finite and non-negative, got ${weight}`);
    }
  }

  if (totalCents < 0) {
    return allocateProportionally(-totalCents, weights).map((part) => -part);
  }

  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const effectiveWeights = totalWeight === 0 ? weights.map(() => 1) : weights;
  const effectiveTotal = totalWeight === 0 ? weights.length : totalWeight;

  const total = new D(totalCents);
  const parts: number[] = [];
  const remainders: { index: number; remainder: Decimal }[] = [];
  let allocated = 0;
  for (let index = 0; index < effectiveWeights.length; index += 1) {
    const exact = total.mul(effectiveWeights[index]).div(effectiveTotal);
    const floor = exact.floor();
    parts.push(floor.toNumber());
    allocated += floor.toNumber();
    remainders.push({ index, remainder: exact.minus(floor) });
  }

  // Hand the leftover cents to the largest fractional remainders (ties keep
  // input order), guaranteeing the parts sum exactly to the total.
  let leftover = totalCents - allocated;
  remainders.sort((a, b) => b.remainder.comparedTo(a.remainder) || a.index - b.index);
  for (let i = 0; leftover > 0; i = (i + 1) % remainders.length, leftover -= 1) {
    parts[remainders[i].index] += 1;
  }

  return parts;
}
