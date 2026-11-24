import Decimal from "decimal.js";
import { assertCents, type Cents } from "./money";

/**
 * Did this project make money?
 *
 * ── Where it stops, and why ─────────────────────────────────────────────────
 *
 * At CONTRIBUTION PROFIT, and no further. CLAUDE.md forbids allocating fixed
 * costs per unit or per item, and a project is an item-level thing: head office
 * rent does not belong to the Gulberg site in some ratio the software worked
 * out on its own, and an accountant asked to justify that ratio would rightly
 * refuse.
 *
 * What DOES land on a project is everything genuinely direct to it — materials,
 * subcontractors, plant hire, the site office, the hours booked to it. A site's
 * own overheads are direct costs of that site. Only company-wide costs stay out.
 *
 * The consequence must be stated on the screen, not left for the owner to
 * discover: this is profit BEFORE fixed running costs. A project showing
 * Rs 300,000 has not put Rs 300,000 in the bank, and a screen that implies it
 * has is the most expensive kind of wrong this app can be.
 *
 * ── Nulls are answers ───────────────────────────────────────────────────────
 *
 * Margin with nothing billed is null, not zero: zero percent is a measurement,
 * and there is nothing here to measure. Same for everything derived from a
 * contract value nobody entered. The screens render an em dash for these — a
 * real absence — rather than a number that looks like a finding.
 */

export interface ProjectProfitInput {
  /** What the project is worth, if it was agreed. Null when it was not. */
  contractValueCents: Cents | null;
  /** Revenue raised against this project, whether or not it has been paid. */
  billedCents: Cents;
  /** The part of that which has actually been paid. */
  receivedCents: Cents;
  /** Costs booked to the project from the ledger, read from frozen snapshots. */
  directCostCents: Cents;
  /** Hours booked to the project, at their frozen cost rates. */
  labourCostCents: Cents;
  /** Units produced, as a decimal string. Null when the project does not count output. */
  outputQty: string | null;
}

export interface ProjectProfit {
  /** Everything the project consumed: direct costs plus labour. */
  costToDateCents: Cents;
  /** Billed less consumed. BEFORE fixed running costs — say so wherever it appears. */
  contributionProfitCents: Cents;
  /** That as a share of what was billed, 0–100. Null when nothing has been billed. */
  marginPct: number | null;
  /** Billed but not yet received. Never negative. */
  stillOwedCents: Cents;
  /** Contract less billed. Null without a contract value; never negative. */
  leftToBillCents: Cents | null;
  /** How much of the contract has been billed, uncapped so an overrun shows. */
  billedPct: number | null;
  /** Cost to date ÷ units made. Null without a positive output quantity. */
  costPerUnitCents: Cents | null;
}

const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

function pct(part: number, whole: number): number {
  return Number(new D(part).div(whole).times(100).toDecimalPlaces(1, Decimal.ROUND_HALF_UP));
}

export function computeProjectProfit(input: ProjectProfitInput): ProjectProfit {
  assertCents(input.billedCents, "computeProjectProfit.billedCents");
  assertCents(input.receivedCents, "computeProjectProfit.receivedCents");
  assertCents(input.directCostCents, "computeProjectProfit.directCostCents");
  assertCents(input.labourCostCents, "computeProjectProfit.labourCostCents");
  if (input.contractValueCents !== null) {
    assertCents(input.contractValueCents, "computeProjectProfit.contractValueCents");
  }

  const costToDateCents = input.directCostCents + input.labourCostCents;
  const contributionProfitCents = input.billedCents - costToDateCents;

  let costPerUnitCents: Cents | null = null;
  if (input.outputQty !== null) {
    const qty = new D(input.outputQty);
    if (qty.greaterThan(0)) {
      costPerUnitCents = Number(new D(costToDateCents).div(qty).toDecimalPlaces(0, Decimal.ROUND_HALF_UP));
    }
  }

  return {
    costToDateCents,
    contributionProfitCents,
    marginPct: input.billedCents > 0 ? pct(contributionProfitCents, input.billedCents) : null,
    // An overpayment is a deposit against future work, not negative debt.
    stillOwedCents: Math.max(0, input.billedCents - input.receivedCents),
    leftToBillCents:
      input.contractValueCents === null ? null : Math.max(0, input.contractValueCents - input.billedCents),
    // Uncapped on purpose: 120% is the most useful thing this figure ever says.
    billedPct:
      input.contractValueCents === null || input.contractValueCents === 0
        ? null
        : pct(input.billedCents, input.contractValueCents),
    costPerUnitCents,
  };
}

/**
 * The property a test can assert directly: what the project earned, minus what
 * it consumed, is its contribution profit. Stated as a function because it is
 * the whole safety claim — every other figure here is a comparison, and this is
 * the only one that adds up.
 */
export function projectProfitReconciles(input: ProjectProfitInput, result: ProjectProfit): boolean {
  return (
    result.costToDateCents === input.directCostCents + input.labourCostCents &&
    result.contributionProfitCents === input.billedCents - result.costToDateCents
  );
}
