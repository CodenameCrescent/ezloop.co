import Decimal from "decimal.js";
import type { Cents } from "./money";
import type { TimeTargetType } from "./clientProfitability";

/**
 * Which client, product or subscription is actually worth having.
 *
 * ── The rule this module exists to enforce ──────────────────────────────────
 *
 * A target with revenue and NO HOURS LOGGED has no profit figure. Not zero, not
 * "100% margin" — nothing. `contributionCents` is null and the UI shows a
 * marker.
 *
 * That is not caution, it is the whole point. Labour is the only real cost a
 * service business has. A client with Rs 450 of revenue and no hours against
 * them computes to Rs 450 of profit at 100% margin, which is the most flattering
 * possible lie about the client most likely to be destroying the business. The
 * owner believes it and takes on three more like them.
 *
 * A blank sends someone looking. A confident wrong number stops them looking.
 *
 * ── The two figures ─────────────────────────────────────────────────────────
 *
 * PRIMARY is contribution: revenue − labour − direct costs. For a service
 * business people's time IS the direct cost of delivery, so this sits at the
 * ladder's contribution rung and breaks no invariant.
 *
 * SECONDARY is after-overhead, which allocates fixed costs per target. It is
 * never called profit, never the headline, and never summed into anything that
 * reaches the profit ladder (CLAUDE.md forbids allocating fixed costs per item).
 *
 * Nothing here is added to the ladder at all: attributed labour is a
 * DISTRIBUTION of payroll the ledger already counted.
 */

const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export interface TargetProfitInput {
  targetType: TimeTargetType;
  targetId: string;
  label: string;
  revenueCents: Cents;
  /** What the logged hours cost, from their frozen rates. */
  labourCostCents: Cents;
  /** The overhead half of those hours — the secondary figure only. */
  overheadCostCents: Cents;
  /** Non-labour costs pointed at this target. */
  directCostCents: Cents;
  /** Decimal string. "0" means nothing was logged. */
  hoursLogged: string;
  /** True when any hours at all were logged against this target in the period. */
  hasHours: boolean;
  /** True when any of those hours were estimates rather than entered per day. */
  hasEstimates: boolean;
}

export interface TargetProfit {
  targetType: TimeTargetType;
  targetId: string;
  label: string;
  revenueCents: Cents;
  directCostCents: Cents;
  hoursLogged: string;
  hasEstimates: boolean;
  /** True only when hours exist — the gate every figure below depends on. */
  isCosted: boolean;
  /** Null when uncosted. NEVER zero-as-a-stand-in. */
  labourCostCents: Cents | null;
  contributionCents: Cents | null;
  marginPct: number | null;
  /** Secondary, allocation-based. Null when uncosted. */
  afterOverheadCents: Cents | null;
  /** Revenue ÷ hours — what they are really paying per hour. Null when uncosted. */
  effectiveHourlyRateCents: Cents | null;
}

export function computeTargetProfit(input: TargetProfitInput): TargetProfit {
  const base = {
    targetType: input.targetType,
    targetId: input.targetId,
    label: input.label,
    revenueCents: input.revenueCents,
    directCostCents: input.directCostCents,
    hoursLogged: input.hoursLogged,
    hasEstimates: input.hasEstimates,
  };

  if (!input.hasHours) {
    // Everything derived from labour is absent, not zero. A caller cannot
    // accidentally render a margin, because there is no number to render.
    return {
      ...base,
      isCosted: false,
      labourCostCents: null,
      contributionCents: null,
      marginPct: null,
      afterOverheadCents: null,
      effectiveHourlyRateCents: null,
    };
  }

  const contributionCents = input.revenueCents - input.labourCostCents - input.directCostCents;
  const hours = new D(input.hoursLogged || "0");

  return {
    ...base,
    isCosted: true,
    labourCostCents: input.labourCostCents,
    contributionCents,
    marginPct:
      input.revenueCents > 0
        ? Number(new D(contributionCents).div(input.revenueCents).times(100).toDecimalPlaces(1, Decimal.ROUND_HALF_UP))
        : null,
    afterOverheadCents: contributionCents - input.overheadCostCents,
    effectiveHourlyRateCents: hours.greaterThan(0)
      ? Number(new D(input.revenueCents).div(hours).toDecimalPlaces(0, Decimal.ROUND_HALF_UP))
      : null,
  };
}

/**
 * How much of the picture exists.
 *
 * - `no_hours`    — nothing logged anywhere. Show revenue and direct costs and
 *                   say the figures are incomplete. NO profit or margin, and no
 *                   summary either.
 * - `partial`     — some targets costed, some not. Costed ones show figures;
 *                   the rest show a marker. Any total is scoped to the costed
 *                   ones and labelled as such.
 * - `complete`    — every target that earned money has hours behind it.
 */
export type ProfitDataState = "no_hours" | "partial" | "complete";

export interface ProfitSummary {
  state: ProfitDataState;
  costedCount: number;
  uncostedCount: number;
  /** Targets earning money with no hours — the ones that would have lied. */
  uncostedWithRevenueCount: number;
  /**
   * Totals across the COSTED targets only. Null in `no_hours`, because there is
   * nothing honest to total. Never mixes costed and uncosted revenue: a total
   * that quietly includes uncosted revenue is the same lie at business level.
   */
  costedRevenueCents: Cents | null;
  costedLabourCents: Cents | null;
  costedDirectCents: Cents | null;
  costedContributionCents: Cents | null;
  costedMarginPct: number | null;
  /** Revenue sitting on targets with no hours — shown separately, never blended. */
  uncostedRevenueCents: Cents;
  hasEstimates: boolean;
}

/**
 * Rolls a set of targets into one picture.
 *
 * CALLERS MUST PASS ONE LENS. A sale to a client for a product appears twice in
 * the full row set — once under the client, once under the product — because
 * they answer different questions about the same money. Summing both would
 * double the revenue and halve the margin, which is the same class of lie this
 * module exists to prevent, just at business level.
 *
 * `allTargets` is the OTHER lens as well, and it is used for exactly one thing:
 * deciding whether the page carries estimates. That warning belongs to the
 * whole screen, not to whichever lens the totals were taken from — an estimate
 * on a product would otherwise leave the banner silent while the row beneath it
 * was plainly marked, and the page would be contradicting itself. A boolean is
 * safe to take across both lenses precisely because it is not money and cannot
 * double.
 */
export function summariseTargets(targets: TargetProfit[], allTargets: TargetProfit[] = targets): ProfitSummary {
  const costed = targets.filter((t) => t.isCosted);
  const uncosted = targets.filter((t) => !t.isCosted);
  const uncostedWithRevenue = uncosted.filter((t) => t.revenueCents > 0);
  const uncostedRevenueCents = uncosted.reduce((sum, t) => sum + t.revenueCents, 0);
  const hasEstimates = allTargets.some((t) => t.hasEstimates);

  if (costed.length === 0) {
    return {
      state: "no_hours",
      costedCount: 0,
      uncostedCount: uncosted.length,
      uncostedWithRevenueCount: uncostedWithRevenue.length,
      costedRevenueCents: null,
      costedLabourCents: null,
      costedDirectCents: null,
      costedContributionCents: null,
      costedMarginPct: null,
      uncostedRevenueCents,
      hasEstimates,
    };
  }

  const costedRevenueCents = costed.reduce((s, t) => s + t.revenueCents, 0);
  const costedLabourCents = costed.reduce((s, t) => s + (t.labourCostCents ?? 0), 0);
  const costedDirectCents = costed.reduce((s, t) => s + t.directCostCents, 0);
  const costedContributionCents = costed.reduce((s, t) => s + (t.contributionCents ?? 0), 0);

  return {
    // "Complete" means nothing that EARNED money is missing its cost. An
    // internal bucket with no hours doesn't make the picture incomplete.
    state: uncostedWithRevenue.length === 0 ? "complete" : "partial",
    costedCount: costed.length,
    uncostedCount: uncosted.length,
    uncostedWithRevenueCount: uncostedWithRevenue.length,
    costedRevenueCents,
    costedLabourCents,
    costedDirectCents,
    costedContributionCents,
    costedMarginPct:
      costedRevenueCents > 0
        ? Number(new D(costedContributionCents).div(costedRevenueCents).times(100).toDecimalPlaces(1, Decimal.ROUND_HALF_UP))
        : null,
    uncostedRevenueCents,
    hasEstimates,
  };
}

/** Plain English for each state. The UI never writes its own version. */
export const DATA_STATE_MESSAGE: Record<ProfitDataState, string> = {
  no_hours:
    "No hours logged yet, so there is no profit figure here — only what came in and what was spent. Set up your team and log a week to see which clients are worth having.",
  partial:
    "Some clients have hours behind them and some don't. Totals below cover only the ones that do — anything without hours has no profit figure, because it would read as pure profit.",
  complete: "Every client that earned money has hours behind it, so these figures are complete.",
};

// ---------------------------------------------------------------------------
// Coverage
// ---------------------------------------------------------------------------

export type CoverageReason = "ok" | "no_payroll" | "no_hours";

export interface Coverage {
  /** Attributed labour ÷ actual payroll × 100. Null unless reason is "ok". */
  pct: number | null;
  attributedCents: Cents;
  payrollCents: Cents;
  reason: CoverageReason;
  /** Under 100 is the dangerous direction: margins look better than they are. */
  direction: "under" | "over" | "matched" | null;
}

/**
 * Does the time sheet account for what is actually paid in wages?
 *
 * A data-quality signal, NOT an error — it never throws and a gap is often
 * legitimate. But it has to be visible, because a badly under-filled sheet
 * makes every client look more profitable than they are, and nothing else on
 * the screen would say so.
 */
export function computeCoverage(attributedCents: Cents, payrollCents: Cents): Coverage {
  if (attributedCents <= 0) {
    return { pct: null, attributedCents, payrollCents, reason: "no_hours", direction: null };
  }
  if (payrollCents <= 0) {
    // Without a payroll figure there is nothing to compare against; saying
    // "0%" or "100%" would both be inventions.
    return { pct: null, attributedCents, payrollCents, reason: "no_payroll", direction: null };
  }
  const pct = Number(new D(attributedCents).div(payrollCents).times(100).toDecimalPlaces(1, Decimal.ROUND_HALF_UP));
  return {
    pct,
    attributedCents,
    payrollCents,
    reason: "ok",
    direction: pct >= 95 && pct <= 105 ? "matched" : pct < 95 ? "under" : "over",
  };
}

export function coverageSentence(coverage: Coverage): string {
  switch (coverage.reason) {
    case "no_hours":
      return "No hours logged, so there is nothing to check against your wage bill.";
    case "no_payroll":
      return "No wages recorded in this period, so there is nothing to check the hours against.";
    case "ok":
      if (coverage.direction === "matched") {
        return "Your logged hours account for what you pay people, so these figures can be trusted.";
      }
      if (coverage.direction === "under") {
        return "Your logged hours account for less than you actually pay people — hours are missing, so every client below looks better than they really are.";
      }
      return "You have logged more time than your wages cover. Check for double-entered hours, or for people being paid outside payroll.";
  }
}
