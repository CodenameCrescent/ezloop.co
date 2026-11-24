import Decimal from "decimal.js";
import type { Cents } from "./money";
import { DEFAULT_BILLABLE_TARGET_HOURS, type TeamCostType } from "./clientProfitability";

/**
 * What an hour of someone's time costs the business.
 *
 * This is the number every client-profitability figure is built on, which is
 * why it gets its own module and its own tests. Get it wrong and every client
 * looks more or less profitable than they are, consistently and invisibly.
 *
 * ── The two halves ──────────────────────────────────────────────────────────
 *
 * What you PAY them, per hour:
 *   salaried              → monthly salary ÷ billable target hours
 *   hourly / contractor   → the agreed hourly rate, no division needed
 *
 * Plus their share of what it costs to HAVE them — rent, software, admin —
 * which is a monthly figure and so is divided by the same target:
 *   overhead share ÷ billable target hours
 *
 * The overhead half feeds only the secondary, clearly-labelled "after overhead"
 * figure. Allocating fixed costs per item is forbidden in the primary
 * contribution number (CLAUDE.md), which is why the two halves are returned
 * separately rather than as one blended rate.
 */

const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export interface TeamCostInput {
  costType: TeamCostType;
  /** Salary or retainer. Used for `salaried`; ignored otherwise. */
  monthlyCostCents: Cents;
  /** The agreed rate. Used for `hourly`/`contractor`; ignored otherwise. */
  hourlyRateCents: Cents | null;
  /** Their share of rent, software and admin, per month. */
  overheadShareCents: Cents;
  /** Decimal string. Hours a month you can realistically bill for. */
  billableTargetHours: string;
}

export interface TeamCost {
  /** What you pay them, per hour. The half that belongs in contribution. */
  payHourlyCents: Cents;
  /** Their overhead, per hour. The half that is an allocation, never profit. */
  overheadHourlyCents: Cents;
  /** The two added — the fully-loaded rate. Stored on the rate row. */
  effectiveHourlyCostCents: Cents;
}

export function isValidBillableTarget(hours: unknown): hours is string {
  if (typeof hours !== "string" || !/^\d+(\.\d+)?$/.test(hours)) return false;
  return new D(hours).greaterThan(0);
}

function assertCents(value: number, field: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`teamCost: ${field} must be integer minor units, got ${value}`);
  }
}

/** Round a per-month figure down to a per-hour one, half-up to whole cents. */
function perHour(monthlyCents: Cents, targetHours: string): Cents {
  return Number(new D(monthlyCents).div(targetHours).toDecimalPlaces(0, Decimal.ROUND_HALF_UP));
}

export function computeTeamCost(input: TeamCostInput): TeamCost {
  assertCents(input.monthlyCostCents, "monthlyCostCents");
  assertCents(input.overheadShareCents, "overheadShareCents");
  if (input.hourlyRateCents !== null) assertCents(input.hourlyRateCents, "hourlyRateCents");
  if (!isValidBillableTarget(input.billableTargetHours)) {
    // Zero would divide by zero and produce an infinite hourly cost; the form
    // must not be able to reach this, and the service rejects it before here.
    throw new TypeError(`teamCost: billableTargetHours "${input.billableTargetHours}" must be a positive decimal string`);
  }

  const payHourlyCents =
    input.costType === "salaried"
      ? perHour(input.monthlyCostCents, input.billableTargetHours)
      : input.hourlyRateCents ?? 0;

  const overheadHourlyCents = perHour(input.overheadShareCents, input.billableTargetHours);

  return {
    payHourlyCents,
    overheadHourlyCents,
    effectiveHourlyCostCents: payHourlyCents + overheadHourlyCents,
  };
}

/**
 * The starting point for a new team member's billable target.
 *
 * 130, not 160. A full month of working hours assumes every hour is billable,
 * which nobody achieves — and the flattering hourly cost that falls out makes
 * every client look better than they are.
 */
export const DEFAULT_TARGET = DEFAULT_BILLABLE_TARGET_HOURS;

/**
 * Why an overhead default could not be worked out. The UI states the reason
 * rather than pre-filling a zero — a silent zero understates every cost rate in
 * the system, and the owner has no way to notice.
 */
export type OverheadDefaultReason = "ok" | "no_team" | "no_fixed_costs";

export interface OverheadDefault {
  /** Per person, per month. Null unless reason is "ok". */
  perPersonCents: Cents | null;
  /** The pool it came out of, so the UI can show its working. */
  fixedCostPoolCents: Cents;
  headcount: number;
  reason: OverheadDefaultReason;
}

/**
 * Splits a month of fixed operating costs across the team.
 *
 * The caller is responsible for excluding PAYROLL from the pool before calling
 * — salaries are already each person's `monthlyCostCents`, so leaving them in
 * would hand everyone a slice of everyone's salary on top of their own.
 */
export function overheadPerHead(fixedCostPoolCents: Cents, headcount: number): OverheadDefault {
  assertCents(fixedCostPoolCents, "fixedCostPoolCents");

  if (headcount <= 0) {
    return { perPersonCents: null, fixedCostPoolCents, headcount: 0, reason: "no_team" };
  }
  if (fixedCostPoolCents <= 0) {
    // Nothing to share is a real answer, but it must not read as "overhead is
    // zero, carry on" — it usually means the expenses are not classified yet.
    return { perPersonCents: null, fixedCostPoolCents, headcount, reason: "no_fixed_costs" };
  }

  const perPersonCents = Number(
    new D(fixedCostPoolCents).div(headcount).toDecimalPlaces(0, Decimal.ROUND_HALF_UP),
  );
  return { perPersonCents, fixedCostPoolCents, headcount, reason: "ok" };
}
