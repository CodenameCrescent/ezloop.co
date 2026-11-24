import Decimal from "decimal.js";
import { formatMoney } from "./money";
import type { RecurInterval } from "./recurrence";

/**
 * Subscription economics — MRR, movement, churn, net revenue retention. The
 * event stream (created / activated / payment_posted / canceled …) is the
 * source; these are the derived business numbers, each shipping a plain-English
 * sentence a non-technical owner can read.
 */

const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

/** Months covered by one billing period, e.g. weekly ≈ 12/52 of a month. */
export function monthsPerPeriod(interval: RecurInterval, intervalCount = 1): Decimal {
  const perUnit: Record<RecurInterval, Decimal> = {
    daily: new D(12).div(365),
    weekly: new D(12).div(52),
    monthly: new D(1),
    quarterly: new D(3),
    yearly: new D(12),
  };
  return perUnit[interval].mul(Math.max(1, intervalCount));
}

/** One subscription's contribution to MRR: period amount normalised to a month. */
export function normalizedMrrCents(amountCents: number, interval: RecurInterval, intervalCount = 1): number {
  return new D(amountCents).div(monthsPerPeriod(interval, intervalCount)).toDecimalPlaces(0).toNumber();
}

export interface ActiveSubMrr {
  amountCents: number;
  interval: RecurInterval;
  intervalCount?: number;
}

/** Total MRR across the active subscriptions (integer cents). */
export function computeMrr(subs: ActiveSubMrr[]): number {
  return subs.reduce((sum, s) => sum + normalizedMrrCents(s.amountCents, s.interval, s.intervalCount ?? 1), 0);
}

export interface MrrMovementSub {
  /** This sub's MRR at the start of the period (0 if it didn't exist yet). */
  mrrBeforeCents: number;
  /** This sub's MRR at the end of the period (0 if canceled during it). */
  mrrAfterCents: number;
  startedInPeriod: boolean;
  canceledInPeriod: boolean;
}

export interface MrrMovement {
  newMrrCents: number;
  expansionCents: number;
  contractionCents: number;
  churnedCents: number;
  netCents: number;
}

/** New / expansion / contraction / churned MRR movement over a period. */
export function computeMrrMovement(subs: MrrMovementSub[]): MrrMovement {
  let newMrr = 0;
  let expansion = 0;
  let contraction = 0;
  let churned = 0;

  for (const s of subs) {
    if (s.canceledInPeriod) {
      churned -= s.mrrBeforeCents;
      continue;
    }
    if (s.startedInPeriod) {
      newMrr += s.mrrAfterCents;
      continue;
    }
    const delta = s.mrrAfterCents - s.mrrBeforeCents;
    if (delta > 0) expansion += delta;
    else if (delta < 0) contraction += delta; // already negative
  }

  return {
    newMrrCents: newMrr,
    expansionCents: expansion,
    contractionCents: contraction,
    churnedCents: churned,
    netCents: newMrr + expansion + contraction + churned,
  };
}

export interface ChurnResult {
  churnedCount: number;
  activeAtStartCount: number;
  /** 0–100. */
  ratePct: number;
}

/** Customer churn = subscriptions canceled ÷ active at the period's start. */
export function computeChurnRate(activeAtStartCount: number, churnedCount: number): ChurnResult {
  const ratePct = activeAtStartCount > 0 ? (churnedCount / activeAtStartCount) * 100 : 0;
  return { churnedCount, activeAtStartCount, ratePct };
}

/**
 * Net revenue retention: how the starting cohort's MRR evolved (expansion up,
 * contraction + churn down), EXCLUDING new subscriptions. 100 = held flat.
 */
export function computeNetRevenueRetention(startingMrrCents: number, movement: MrrMovement): number {
  if (startingMrrCents <= 0) return 0;
  const retained = startingMrrCents + movement.expansionCents + movement.contractionCents + movement.churnedCents;
  return new D(retained).div(startingMrrCents).mul(100).toDecimalPlaces(1).toNumber();
}

// ── Plain-English sentences ─────────────────────────────────────────────────

// App-wide display currency is Rs today (matches the frontend formatCents);
// threading real per-business currency is future work.
const money = (cents: number) => formatMoney(Math.abs(cents), { symbol: "Rs " });

export function mrrSentence(mrrCents: number): string {
  return `Your subscriptions bring in ${money(mrrCents)} a month in recurring revenue.`;
}

export function churnSentence(churn: ChurnResult, churnedMrrCents: number): string {
  if (churn.churnedCount === 0) return "No subscribers canceled this period — nothing walked out the door.";
  const plural = churn.churnedCount === 1 ? "subscriber" : "subscribers";
  return `You lost ${churn.churnedCount} ${plural} this period (${churn.ratePct.toFixed(0)}% churn) — ${money(churnedMrrCents)}/mo walked out the door.`;
}

export function movementSentence(m: MrrMovement): string {
  const dir = m.netCents >= 0 ? "grew" : "shrank";
  return `Recurring revenue ${dir} by ${money(m.netCents)}/mo: ${money(m.newMrrCents)} new, ${money(m.expansionCents)} expansion, ${money(m.contractionCents)} contraction, ${money(m.churnedCents)} churned.`;
}
