import Decimal from "decimal.js";
import type { Cents } from "./money";
import type { WorkType } from "./clientProfitability";
import { agreedHourlyRate, scaleAgreedHours, type AgreedPeriod, type AgreedRateReason } from "./agreedPeriod";

/**
 * Three things the hours reveal that a profit figure alone does not.
 *
 * SCOPE CREEP  — the client is over the hours agreed, so the rate they think
 *                they are paying and the rate you are actually earning have
 *                quietly come apart.
 * UTILIZATION  — how much of the paid day is billable. The gap is real cost
 *                earning nothing.
 * CONCENTRATION— how much of the business rests on one client.
 *
 * Every one of them returns null rather than a zero when the inputs are
 * missing, for the same reason profit does: a made-up figure stops the owner
 * looking, and these are exactly the numbers worth looking at.
 */

const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

const pct = (part: Decimal, whole: Decimal) =>
  Number(part.div(whole).times(100).toDecimalPlaces(1, Decimal.ROUND_HALF_UP));

// ---------------------------------------------------------------------------
// Scope creep
// ---------------------------------------------------------------------------

export interface ScopeCreepInput {
  /** Decimal string. Null when nothing was agreed — then there is no creep. */
  agreedHours: string | null;
  /** What was agreed for the job, if a figure was set. */
  agreedAmountCents: Cents | null;
  actualHours: string;
  /** What they have actually paid in the period. */
  revenueCents: Cents;
  /** Whether the hours above are for the whole job or per month. Defaults to whole. */
  agreedHoursPeriod?: AgreedPeriod;
  /** Whether the amount above is the whole fee or a monthly one. Defaults to whole. */
  agreedAmountPeriod?: AgreedPeriod;
  /** Months the report window is worth. Needed only for a monthly hours figure. */
  periodMonths?: string | null;
  /** Months between the engagement's own dates. Needed only when the two bases differ. */
  contractMonths?: string | null;
}

export interface ScopeCreep {
  /** Restated for the window: a monthly figure multiplied up, a total left alone. */
  agreedHours: string | null;
  /** Exactly what the owner typed, so the screen can show both figures. */
  agreedHoursPerPeriod: string | null;
  agreedHoursPeriod: AgreedPeriod;
  periodMonths: string | null;
  actualHours: string;
  /** Hours beyond what was agreed. Negative means still under. */
  overHours: string | null;
  /** How far over, as a percentage. 47 means 47% more hours than agreed. */
  overPct: number | null;
  /** What they believe they are paying: agreed amount ÷ agreed hours. */
  agreedHourlyRateCents: Cents | null;
  /** Why there is no hourly price, when there isn't one. */
  rateReason: AgreedRateReason;
  /** What you are actually earning: revenue ÷ actual hours. */
  effectiveHourlyRateCents: Cents | null;
  /** The gap between the two, which is what scope creep really costs. */
  rateGapCents: Cents | null;
  isOver: boolean;
}

/**
 * Actual hours against agreed, and the two hourly rates that pull apart.
 *
 * The number that lands is not the percentage — it is the pair of rates. "47%
 * over" is abstract; "you are earning Rs 1,705 an hour on a job priced at
 * Rs 2,500" is the thing that changes what the owner charges next time.
 */
export function computeScopeCreep(input: ScopeCreepInput): ScopeCreep {
  const actual = new D(input.actualHours || "0");
  const effectiveHourlyRateCents = actual.greaterThan(0)
    ? Number(new D(input.revenueCents).div(actual).toDecimalPlaces(0, Decimal.ROUND_HALF_UP))
    : null;

  const hoursPeriod = input.agreedHoursPeriod ?? "total";
  const amountPeriod = input.agreedAmountPeriod ?? "total";
  const periodMonths = input.periodMonths ?? null;

  /**
   * The price is computed from the RAW pair, never the scaled one.
   *
   * It is a ratio — money ÷ hours — so when both figures share a basis the
   * multiplier cancels. Applying it anyway would round the money and make the
   * "you priced this at Rs 2,500 an hour" figure move every time the date
   * filter moved, which is exactly the nonsense this is here to prevent.
   */
  const rate = agreedHourlyRate({
    agreedAmountCents: input.agreedAmountCents,
    agreedHours: input.agreedHours,
    amountPeriod,
    hoursPeriod,
    contractMonths: input.contractMonths ?? null,
  });

  // The comparison, unlike the price, DOES need the window: forty hours a month
  // against a quarter of logged time is a hundred and twenty, not forty.
  const scaled = scaleAgreedHours(input.agreedHours, hoursPeriod, periodMonths);

  const absent = {
    agreedHours: null,
    agreedHoursPerPeriod: input.agreedHours ?? null,
    agreedHoursPeriod: hoursPeriod,
    periodMonths,
    actualHours: input.actualHours,
    overHours: null,
    overPct: null,
    agreedHourlyRateCents: rate.cents,
    rateReason: rate.reason,
    effectiveHourlyRateCents,
    rateGapCents: null,
    isOver: false,
  };

  // No agreement means there is nothing to be over. Not zero creep — none.
  // A monthly figure with no window lands here too: unknowable, so unstated.
  if (!scaled) return absent;

  const agreed = new D(scaled);
  if (agreed.lessThanOrEqualTo(0)) return absent;

  const overHours = actual.minus(agreed);

  return {
    ...absent,
    agreedHours: agreed.toString(),
    overHours: overHours.toDecimalPlaces(2).toString(),
    overPct: pct(overHours, agreed),
    rateGapCents:
      rate.cents !== null && effectiveHourlyRateCents !== null ? rate.cents - effectiveHourlyRateCents : null,
    isOver: overHours.greaterThan(0),
  };
}

export function scopeCreepSentence(name: string, creep: ScopeCreep): string | null {
  if (!creep.isOver || creep.overPct === null) return null;
  if (creep.agreedHourlyRateCents === null || creep.effectiveHourlyRateCents === null) {
    return `${name} is ${creep.overPct.toFixed(0)}% over the hours agreed.`;
  }
  return `${name} is ${creep.overPct.toFixed(0)}% over the hours agreed, so you are earning less per hour than the job was priced at.`;
}

// ---------------------------------------------------------------------------
// Utilization
// ---------------------------------------------------------------------------

export interface Utilization {
  billableHours: string;
  totalHours: string;
  nonBillableHours: string;
  /** Billable ÷ total, 0–100. Null when nothing was logged. */
  pct: number | null;
}

/**
 * How much of the time you pay for is time you can bill.
 *
 * The gap is not waste by definition — pitching and admin have to happen — but
 * it is real money earning nothing, and it is invisible in a profit figure.
 */
export function computeUtilization(billableHours: string, totalHours: string): Utilization {
  const billable = new D(billableHours || "0");
  const total = new D(totalHours || "0");
  const nonBillable = total.minus(billable);

  return {
    billableHours: billable.toString(),
    totalHours: total.toString(),
    nonBillableHours: nonBillable.toDecimalPlaces(2).toString(),
    // Nothing logged means unknown, not 0% — 0% would read as "nobody billed
    // anything", which is a different and much worse claim.
    pct: total.greaterThan(0) ? pct(billable, total) : null,
  };
}

// ---------------------------------------------------------------------------
// Concentration
// ---------------------------------------------------------------------------

export interface ConcentrationSlice {
  label: string;
  revenueCents: Cents;
  sharePct: number;
}

export interface Concentration {
  slices: ConcentrationSlice[];
  totalRevenueCents: Cents;
  /** The largest single client's share. Null when there is no revenue. */
  topSharePct: number | null;
  topLabel: string | null;
  /** Losing the biggest client would cost this much of the book. */
  risk: "none" | "watch" | "high" | null;
}

/**
 * How much of the business rests on one client.
 *
 * The service equivalent of product concentration: one client at 57% of revenue
 * is not a good client, it is a single point of failure. Built standalone —
 * there is no Profit Quality Score in this codebase to feed.
 */
export function computeConcentration(
  clients: Array<{ label: string; revenueCents: Cents }>,
): Concentration {
  const withRevenue = clients.filter((c) => c.revenueCents > 0);
  const totalRevenueCents = withRevenue.reduce((sum, c) => sum + c.revenueCents, 0);

  if (totalRevenueCents <= 0) {
    return { slices: [], totalRevenueCents: 0, topSharePct: null, topLabel: null, risk: null };
  }

  const slices = withRevenue
    .map((c) => ({
      label: c.label,
      revenueCents: c.revenueCents,
      sharePct: pct(new D(c.revenueCents), new D(totalRevenueCents)),
    }))
    .sort((a, b) => b.revenueCents - a.revenueCents);

  const topSharePct = slices[0].sharePct;
  return {
    slices,
    totalRevenueCents,
    topSharePct,
    topLabel: slices[0].label,
    // Thresholds chosen to be conservative: a third of the book on one client
    // is worth watching, half is a genuine risk to the business.
    risk: topSharePct >= 50 ? "high" : topSharePct >= 33 ? "watch" : "none",
  };
}

export function concentrationSentence(c: Concentration): string | null {
  if (c.topSharePct === null || c.topLabel === null) return null;
  const share = c.topSharePct.toFixed(0);

  if (c.risk === "high") {
    // State the actual share rather than a stock phrase: at 100% "half your
    // income" would be flatly wrong, and the whole point is to be believed.
    const consequence =
      c.topSharePct >= 99
        ? "Losing them would leave you with nothing."
        : `Losing them would take ${share}% of your income with them.`;
    return `${c.topLabel} is ${share}% of everything you earn. ${consequence}`;
  }
  if (c.risk === "watch") {
    return `${c.topLabel} is ${share}% of everything you earn — worth keeping an eye on.`;
  }
  return `Your biggest client is ${share}% of what you earn, which is a healthy spread.`;
}

// ---------------------------------------------------------------------------
// Where the hours went
// ---------------------------------------------------------------------------

export interface WorkTypeSlice {
  workType: WorkType;
  hours: string;
  sharePct: number;
}

/**
 * Hours split by what they were spent doing.
 *
 * `rework` is the one that matters most and is invisible in a plain total: high
 * rework means a client who cannot settle on a brief, and it is the leading
 * indicator of one who will keep costing more than they pay.
 */
export function splitByWorkType(entries: Array<{ workType: WorkType; hours: string }>): WorkTypeSlice[] {
  const byType = new Map<WorkType, Decimal>();
  let total = new D(0);
  for (const e of entries) {
    const hours = new D(e.hours || "0");
    byType.set(e.workType, (byType.get(e.workType) ?? new D(0)).plus(hours));
    total = total.plus(hours);
  }
  if (total.lessThanOrEqualTo(0)) return [];

  return [...byType.entries()]
    .map(([workType, hours]) => ({
      workType,
      hours: hours.toDecimalPlaces(2).toString(),
      sharePct: pct(hours, total),
    }))
    .sort((a, b) => Number(b.hours) - Number(a.hours));
}

/** The rework share on its own — never folded into delivery. */
export function reworkShare(slices: WorkTypeSlice[]): WorkTypeSlice | null {
  return slices.find((s) => s.workType === "rework") ?? null;
}
