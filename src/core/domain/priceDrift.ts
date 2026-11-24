import { addCents, type Cents } from "./money";

/**
 * Your costs went up and your price did not follow.
 *
 * ★ This is the insight only this schema can produce, and the reason is worth
 * stating plainly: `revenue_items.unit_price_cents` is a single column with no
 * history at all — edit it and the old price is gone. But every
 * `transaction_line` FREEZES the price it sold at and the resolved
 * `cost_snapshot` beside it, forever. So the ledger is the price-and-cost
 * history, and it is a better one than a catalogue audit trail would be: it
 * records what customers actually paid rather than what the price list said.
 *
 * Nothing here reads the catalogue. Everything is the frozen record of what
 * happened, which is also why editing a cost today cannot retroactively change
 * what this reports about last March.
 */

export interface SaleObservation {
  itemId: string;
  itemName: string;
  /**
   * The channel it sold through — and this matters more than it looks.
   *
   * The SAME item on two sources legitimately has a different price and a
   * different cost: `revenue_item_sources.price_override_cents` sets the price
   * and source-scoped cost components add the platform's fee. Interleaving the
   * two into one time series makes the price look like it changes every few
   * days, which is exactly how the first version of this rule talked itself out
   * of a real finding on live data — a mug whose direct cost rose while its
   * direct price never moved, hidden behind alternating Etsy sales.
   *
   * Each (item, channel) pair is its own price history.
   */
  sourceId: string;
  sourceName: string;
  /** ISO timestamp of the sale. */
  occurredAt: string;
  /** What one unit sold for, frozen on the line. */
  unitPriceCents: Cents;
  /** What one unit cost, from the frozen snapshot. */
  unitCostCents: Cents;
  /** Units on that line. */
  qty: number;
}

export interface PriceCostDrift {
  itemId: string;
  itemName: string;
  sourceId: string;
  /**
   * The channel this drift is on. Null when the item only ever sold through
   * one, because naming a channel the owner has no alternative to is noise.
   */
  sourceName: string | null;

  /** Cost per unit immediately before the most recent rise. */
  costBeforeCents: Cents;
  costAfterCents: Cents;
  costRisePct: number;
  /** ISO date the cost last went up. */
  costRoseAt: string;

  currentPriceCents: Cents;
  /** ISO date the price last moved. Null when it has never moved on record. */
  priceLastChangedAt: string | null;
  /** Days since the price last moved, measured from the newest sale. */
  daysSincePriceChange: number;

  /** Units sold at the higher cost with the old price still attached. */
  unitsSinceRise: number;
  /** What the unchanged price has cost so far: the rise times those units. */
  marginLostCents: Cents;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Below this a cost wobble is rounding, not a rise worth repricing for. */
export const MIN_COST_RISE_PCT = 5;

/**
 * Find, per item, the most recent cost rise that the price did not answer.
 *
 * Deliberately reports only the LATEST rise rather than every historical one:
 * the owner can act on "your cost went up in March and the price never moved",
 * and cannot act on a list of six changes since 2024.
 */
export function detectPriceCostDrift(
  observations: SaleObservation[],
  options: { minRisePct?: number } = {},
): PriceCostDrift[] {
  const minRisePct = options.minRisePct ?? MIN_COST_RISE_PCT;

  // Keyed by item AND channel: the same item on two sources has two genuinely
  // different price histories, and merging them hides real drift.
  const byItemAndSource = new Map<string, SaleObservation[]>();
  const sourcesPerItem = new Map<string, Set<string>>();

  for (const o of observations) {
    const key = `${o.itemId}::${o.sourceId}`;
    const list = byItemAndSource.get(key) ?? [];
    list.push(o);
    byItemAndSource.set(key, list);

    const sources = sourcesPerItem.get(o.itemId) ?? new Set<string>();
    sources.add(o.sourceId);
    sourcesPerItem.set(o.itemId, sources);
  }

  const out: PriceCostDrift[] = [];

  for (const [, sales] of byItemAndSource) {
    const sorted = [...sales].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
    if (sorted.length < 2) continue; // one sale is a point, not a trend

    const newest = sorted[sorted.length - 1];

    // Walk backwards for the most recent point where the cost CHANGED.
    let riseIndex = -1;
    for (let i = sorted.length - 1; i > 0; i--) {
      if (sorted[i].unitCostCents !== sorted[i - 1].unitCostCents) {
        riseIndex = i;
        break;
      }
    }
    if (riseIndex === -1) continue; // the cost has never moved

    const costBefore = sorted[riseIndex - 1].unitCostCents;
    const costAfter = sorted[riseIndex].unitCostCents;
    if (costAfter <= costBefore) continue; // it fell — good news, not this rule's job
    if (costBefore <= 0) continue; // no baseline to take a percentage of

    const costRisePct = ((costAfter - costBefore) / costBefore) * 100;
    if (costRisePct < minRisePct) continue;

    // And the most recent point where the PRICE changed.
    let priceChangeIndex = -1;
    for (let i = sorted.length - 1; i > 0; i--) {
      if (sorted[i].unitPriceCents !== sorted[i - 1].unitPriceCents) {
        priceChangeIndex = i;
        break;
      }
    }

    // If the price moved at or after the cost rise, the owner already answered
    // it. Whether they answered it ADEQUATELY is a different question and a
    // different card; this one is only about the price that never moved.
    if (priceChangeIndex >= riseIndex) continue;

    const priceLastChangedAt = priceChangeIndex === -1 ? null : sorted[priceChangeIndex].occurredAt;
    const priceAnchor = priceLastChangedAt ?? sorted[0].occurredAt;
    const daysSincePriceChange = Math.max(
      0,
      Math.round(
        (new Date(newest.occurredAt).getTime() - new Date(priceAnchor).getTime()) / DAY_MS,
      ),
    );

    // Units sold from the rise onward — those are the ones the stale price cost
    // money on.
    const unitsSinceRise = sorted
      .slice(riseIndex)
      .reduce((sum, o) => sum + o.qty, 0);

    const risePerUnit = addCents(costAfter, -costBefore);
    const marginLost = Math.round(risePerUnit * unitsSinceRise);
    if (marginLost <= 0) continue;

    out.push({
      itemId: newest.itemId,
      itemName: newest.itemName,
      sourceId: newest.sourceId,
      // Only worth naming when the item genuinely sells in more than one place.
      sourceName:
        (sourcesPerItem.get(newest.itemId)?.size ?? 1) > 1 ? newest.sourceName : null,
      costBeforeCents: costBefore,
      costAfterCents: costAfter,
      costRisePct,
      costRoseAt: sorted[riseIndex].occurredAt,
      currentPriceCents: newest.unitPriceCents,
      priceLastChangedAt,
      daysSincePriceChange,
      unitsSinceRise,
      marginLostCents: marginLost,
    });
  }

  // Worst first: the owner should see the one costing the most money.
  return out.sort((a, b) => b.marginLostCents - a.marginLostCents);
}

/** Months, for copy that reads better than a day count once it gets large. */
export function describeAge(days: number): string {
  if (days < 45) return `${days} days`;
  const months = Math.round(days / 30);
  if (months < 18) return `${months} months`;
  return `${Math.round(months / 12)} years`;
}
