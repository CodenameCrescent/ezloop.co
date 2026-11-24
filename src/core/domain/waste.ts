import Decimal from "decimal.js";
import type { Cents } from "./money";

/**
 * Waste — what you bought and did not use.
 *
 * Twelve bags of cement ruined by rain. Four metres of steel cut wrong. Scrap
 * off a production run. Every trade has it, most of them guess at it, and the
 * guess is always low.
 *
 * ── THE RULE THIS MODULE EXISTS TO PROTECT ──────────────────────────────────
 *
 * **Waste is never money of its own.** You already paid for the 200 bags. The
 * 12 that were ruined are a SLICE of a cost that is already in the ledger, not
 * an extra cost beside it. Recording waste as its own money row would double
 * every wasted rupee — once as the purchase, again as the loss — and the
 * business would appear to be spending far more than it does.
 *
 * So `wasted_qty` sits on the line as INFORMATION. Nothing here is added to any
 * total, and no figure this module returns ever reaches the profit ladder. What
 * it produces is a report: how much of what you bought never made it into the
 * work, valued at what it cost you.
 *
 * The value is genuinely useful precisely because it is not new money — it tells
 * an owner how much of their existing spend is going nowhere, which is a
 * question the ladder cannot answer at all.
 */

const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

/** One purchased line, with however much of it was wasted. */
export interface WasteLine {
  /** What it was — the item name, or the line's own label. */
  name: string;
  /** How much was bought, as a decimal string. */
  qty: string;
  /** How much of that was wasted. Null when nobody recorded any. */
  wastedQty: string | null;
  /** What one unit cost. */
  unitPriceCents: Cents;
}

function toDecimal(value: string | null | undefined): Decimal | null {
  const trimmed = (value ?? "").trim();
  if (trimmed === "") return null;
  try {
    const parsed = new D(trimmed);
    return parsed.isFinite() ? parsed : null;
  } catch {
    return null;
  }
}

/** What the wasted units cost — valued at the line's OWN price, never today's. */
export function wasteValueCents(wastedQty: string | null | undefined, unitPriceCents: Cents): Cents {
  const wasted = toDecimal(wastedQty);
  if (!wasted || wasted.lessThanOrEqualTo(0)) return 0;
  return Number(wasted.times(unitPriceCents).toDecimalPlaces(0, Decimal.ROUND_HALF_UP));
}

/** Wasted as a share of what was bought, 0–100. Null when nothing was bought. */
export function wasteRatePct(
  wastedQty: string | null | undefined,
  boughtQty: string | null | undefined,
): number | null {
  const wasted = toDecimal(wastedQty);
  const bought = toDecimal(boughtQty);
  if (!bought || bought.lessThanOrEqualTo(0)) return null;
  if (!wasted) return 0;
  return Number(wasted.div(bought).times(100).toDecimalPlaces(1, Decimal.ROUND_HALF_UP));
}

/**
 * The property a test can assert directly: you cannot waste more than you
 * bought, and you cannot waste a negative amount.
 *
 * A breach is a typo rather than a fact, and letting one through would put a
 * waste figure larger than the purchase on the report — which reads as the
 * business losing money it never spent.
 */
export function wasteReconciles(line: WasteLine): boolean {
  const wasted = toDecimal(line.wastedQty);
  if (!wasted) return true;
  if (wasted.lessThan(0)) return false;
  const bought = toDecimal(line.qty);
  if (!bought) return false;
  return wasted.lessThanOrEqualTo(bought);
}

export interface WasteRow {
  name: string;
  wastedCents: Cents;
  boughtCents: Cents;
  /** Wasted units as a share of units bought. Null when nothing was bought. */
  ratePct: number | null;
}

export interface WasteSummary {
  totalWastedCents: Cents;
  totalBoughtCents: Cents;
  /** Waste as a share of what was spent on the same things. Null when nothing was wasted. */
  shareOfSpendPct: number | null;
  rows: WasteRow[];
}

/**
 * Waste grouped by what was wasted, biggest first.
 *
 * Only things with waste appear. A material that was used in full is not a
 * finding, and listing it would bury the two rows that matter in twenty that
 * do not.
 *
 * ── The rate is over TRACKED purchases only ────────────────────────────────
 *
 * A row's `ratePct` and `boughtCents` count only the lines that carried a waste
 * figure. A purchase with no figure recorded is not a recorded zero — nobody
 * checked that delivery — and averaging it in would assume no waste on it,
 * flattering every rate on the report. "Of the cement you tracked, 12% went to
 * waste" is a claim the data supports; "4% of all your cement" is not.
 *
 * `totalBoughtCents` is different on purpose: it is ALL spending in the period,
 * because the headline share answers "how much of what I spend goes nowhere",
 * which is a question about the whole business.
 */
export function summariseWaste(lines: WasteLine[]): WasteSummary {
  const byName = new Map<string, { wastedCents: Cents; boughtCents: Cents; wastedQty: Decimal; boughtQty: Decimal }>();

  let totalBoughtCents = 0;
  for (const line of lines) {
    const bought = toDecimal(line.qty) ?? new D(0);
    const boughtCents = Number(bought.times(line.unitPriceCents).toDecimalPlaces(0, Decimal.ROUND_HALF_UP));
    totalBoughtCents += boughtCents;

    const wasted = toDecimal(line.wastedQty);
    if (!wasted || wasted.lessThanOrEqualTo(0)) continue;

    const entry = byName.get(line.name) ?? {
      wastedCents: 0,
      boughtCents: 0,
      wastedQty: new D(0),
      boughtQty: new D(0),
    };
    entry.wastedCents += wasteValueCents(line.wastedQty, line.unitPriceCents);
    entry.boughtCents += boughtCents;
    entry.wastedQty = entry.wastedQty.plus(wasted);
    entry.boughtQty = entry.boughtQty.plus(bought);
    byName.set(line.name, entry);
  }

  const rows: WasteRow[] = [...byName.entries()]
    .map(([name, entry]) => ({
      name,
      wastedCents: entry.wastedCents,
      boughtCents: entry.boughtCents,
      ratePct: entry.boughtQty.greaterThan(0)
        ? Number(entry.wastedQty.div(entry.boughtQty).times(100).toDecimalPlaces(1, Decimal.ROUND_HALF_UP))
        : null,
    }))
    // Biggest first: that is the one worth doing something about.
    .sort((a, b) => b.wastedCents - a.wastedCents);

  const totalWastedCents = rows.reduce((sum, row) => sum + row.wastedCents, 0);

  return {
    totalWastedCents,
    totalBoughtCents,
    // Null rather than 0% when nothing was wasted: no waste against no
    // measurement is an absence, and "0% wasted" is a claim about a process
    // nobody has actually recorded.
    shareOfSpendPct:
      totalWastedCents > 0 && totalBoughtCents > 0
        ? Number(new D(totalWastedCents).div(totalBoughtCents).times(100).toDecimalPlaces(1, Decimal.ROUND_HALF_UP))
        : null,
    rows,
  };
}
