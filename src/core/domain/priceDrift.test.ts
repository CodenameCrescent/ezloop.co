import test from "node:test";
import assert from "node:assert/strict";
import { MIN_COST_RISE_PCT, describeAge, detectPriceCostDrift, type SaleObservation } from "./priceDrift";

/** A sale of `item` on `day`, through `sourceId`, at a price and a frozen cost. */
const sale = (
  day: string,
  unitPriceCents: number,
  unitCostCents: number,
  qty = 1,
  itemId = "mug",
  itemName = "Ceramic mug",
  sourceId = "manual",
  sourceName = "Manual",
): SaleObservation => ({
  itemId,
  itemName,
  sourceId,
  sourceName,
  occurredAt: `2026-${day}T12:00:00.000Z`,
  unitPriceCents,
  unitCostCents,
  qty,
});

test("a cost rise the price never answered is found and priced", () => {
  // Clay went 400 → 500 (a 25% rise) in March. The price stayed at 1,000
  // throughout, and 30 more units sold after the rise.
  const drift = detectPriceCostDrift([
    sale("01-10", 1_000_00, 400_00, 5),
    sale("02-10", 1_000_00, 400_00, 5),
    sale("03-10", 1_000_00, 500_00, 10),
    sale("04-10", 1_000_00, 500_00, 20),
  ]);

  assert.equal(drift.length, 1);
  const d = drift[0];
  assert.equal(d.costBeforeCents, 400_00);
  assert.equal(d.costAfterCents, 500_00);
  assert.equal(d.costRisePct, 25);
  assert.equal(d.costRoseAt, "2026-03-10T12:00:00.000Z");
  assert.equal(d.unitsSinceRise, 30, "the 10 on the day it rose plus the 20 after");
  assert.equal(d.marginLostCents, 100_00 * 30, "Rs 100 more per unit, thirty times over");
});

test("a price that DID move to answer the rise is not reported", () => {
  const drift = detectPriceCostDrift([
    sale("01-10", 1_000_00, 400_00),
    sale("02-10", 1_000_00, 400_00),
    sale("03-10", 1_150_00, 500_00), // cost rose AND the price rose with it
    sale("04-10", 1_150_00, 500_00),
  ]);
  assert.deepEqual(drift, [], "the owner already answered it");
});

test("a price that moved BEFORE the rise does not count as answering it", () => {
  const drift = detectPriceCostDrift([
    sale("01-10", 900_00, 400_00),
    sale("02-10", 1_000_00, 400_00), // price rose here...
    sale("03-10", 1_000_00, 500_00), // ...but the cost rose AFTER, unanswered
    sale("04-10", 1_000_00, 500_00, 4),
  ]);

  assert.equal(drift.length, 1);
  assert.equal(drift[0].priceLastChangedAt, "2026-02-10T12:00:00.000Z");
  assert.ok(drift[0].daysSincePriceChange > 50, "and the page can say how long it has been");
});

test("a cost that FELL is good news and this rule stays quiet", () => {
  const drift = detectPriceCostDrift([
    sale("01-10", 1_000_00, 500_00),
    sale("02-10", 1_000_00, 500_00),
    sale("03-10", 1_000_00, 400_00),
  ]);
  assert.deepEqual(drift, []);
});

test("a rounding wobble is not a rise worth repricing for", () => {
  // 400 → 408 is 2%.
  const small = detectPriceCostDrift([
    sale("01-10", 1_000_00, 400_00),
    sale("02-10", 1_000_00, 408_00, 5),
  ]);
  assert.deepEqual(small, []);
  assert.equal(MIN_COST_RISE_PCT, 5);

  // 400 → 440 is 10% and does count.
  const real = detectPriceCostDrift([
    sale("01-10", 1_000_00, 400_00),
    sale("02-10", 1_000_00, 440_00, 5),
  ]);
  assert.equal(real.length, 1);
  assert.equal(real[0].marginLostCents, 40_00 * 5);
});

test("one sale is a point, not a trend", () => {
  assert.deepEqual(detectPriceCostDrift([sale("03-10", 1_000_00, 500_00)]), []);
});

test("a cost that has never moved produces nothing", () => {
  const drift = detectPriceCostDrift([
    sale("01-10", 1_000_00, 400_00),
    sale("02-10", 1_000_00, 400_00),
    sale("03-10", 1_000_00, 400_00),
  ]);
  assert.deepEqual(drift, []);
});

test("only the LATEST rise is reported, not a history lesson", () => {
  // Two rises: 400 → 450 in Feb, then 450 → 600 in April. The owner can act on
  // the current gap; a list of every change since 2024 is not actionable.
  const drift = detectPriceCostDrift([
    sale("01-10", 1_000_00, 400_00),
    sale("02-10", 1_000_00, 450_00),
    sale("03-10", 1_000_00, 450_00),
    sale("04-10", 1_000_00, 600_00, 10),
  ]);

  assert.equal(drift.length, 1);
  assert.equal(drift[0].costBeforeCents, 450_00, "measured from the step immediately before");
  assert.equal(drift[0].costAfterCents, 600_00);
  assert.equal(drift[0].marginLostCents, 150_00 * 10);
});

test("items are ranked by what the stale price is actually costing", () => {
  const drift = detectPriceCostDrift([
    // Small item: Rs 10 more per unit, 2 units.
    sale("01-10", 100_00, 40_00, 1, "small", "Sticker"),
    sale("02-10", 100_00, 50_00, 2, "small", "Sticker"),
    // Big item: Rs 100 more per unit, 20 units.
    sale("01-10", 1_000_00, 400_00, 1, "big", "Mug"),
    sale("02-10", 1_000_00, 500_00, 20, "big", "Mug"),
  ]);

  assert.deepEqual(drift.map((d) => d.itemName), ["Mug", "Sticker"]);
  assert.equal(drift[0].marginLostCents, 100_00 * 20);
  assert.equal(drift[1].marginLostCents, 10_00 * 2);
});

test("a cost with no baseline to compare against is skipped", () => {
  const drift = detectPriceCostDrift([
    sale("01-10", 1_000_00, 0),
    sale("02-10", 1_000_00, 500_00, 5),
  ]);
  assert.deepEqual(drift, [], "a rise from zero has no percentage to report");
});

test("age reads in the unit a person would use", () => {
  assert.equal(describeAge(12), "12 days");
  assert.equal(describeAge(44), "44 days");
  assert.equal(describeAge(60), "2 months");
  assert.equal(describeAge(420), "14 months");
  assert.equal(describeAge(800), "2 years");
});

// ── Channels ─────────────────────────────────────────────────────────────────

test("the same item on two channels is two price histories, not one", () => {
  // The bug live data exposed. A mug sells direct at 2,500 (cost 800 → 900, a
  // real unanswered rise) and on Etsy at 2,800 with the platform's fee baked
  // into the cost. Interleaved, the price looks like it changes every few days,
  // and the first version of this rule talked itself out of a genuine finding.
  const drift = detectPriceCostDrift([
    sale("04-04", 2_500, 800, 2),
    sale("05-04", 2_800, 982, 1, "mug", "Ceramic mug", "etsy", "Etsy"),
    sale("05-09", 2_500, 800, 2),
    sale("05-14", 2_800, 982, 1, "mug", "Ceramic mug", "etsy", "Etsy"),
    sale("06-03", 2_500, 900, 2), // ← the real rise, direct channel, price unmoved
    sale("06-08", 2_800, 1_082, 1, "mug", "Ceramic mug", "etsy", "Etsy"),
    sale("06-13", 2_500, 900, 2),
    sale("07-03", 2_500, 900, 3),
    sale("08-02", 2_500, 900, 5),
  ]);

  const direct = drift.find((d) => d.sourceId === "manual");
  assert.ok(direct, "the direct channel's unanswered rise must be found");
  assert.equal(direct.costBeforeCents, 800);
  assert.equal(direct.costAfterCents, 900);
  assert.equal(direct.currentPriceCents, 2_500, "the price genuinely never moved on this channel");
  assert.equal(direct.unitsSinceRise, 12, "2 + 2 + 3 + 5 sold at the higher cost");
  assert.equal(direct.marginLostCents, 100 * 12);
});

test("a channel is named only when the item sells in more than one place", () => {
  const twoChannels = detectPriceCostDrift([
    sale("01-10", 2_500, 800, 2),
    sale("02-10", 2_500, 900, 5),
    sale("02-11", 2_800, 982, 1, "mug", "Ceramic mug", "etsy", "Etsy"),
    sale("03-11", 2_800, 982, 1, "mug", "Ceramic mug", "etsy", "Etsy"),
  ]);
  assert.equal(twoChannels.find((d) => d.sourceId === "manual")!.sourceName, "Manual");

  const oneChannel = detectPriceCostDrift([
    sale("01-10", 2_500, 800, 2),
    sale("02-10", 2_500, 900, 5),
  ]);
  assert.equal(
    oneChannel[0].sourceName,
    null,
    "naming a channel the owner has no alternative to is noise",
  );
});

test("a rise on one channel does not implicate the other", () => {
  const drift = detectPriceCostDrift([
    // Direct: steady cost, steady price. Nothing wrong.
    sale("01-10", 2_500, 800, 5),
    sale("06-10", 2_500, 800, 5),
    // Etsy: the fee went up and the listing price never followed.
    sale("01-10", 2_800, 900, 5, "mug", "Ceramic mug", "etsy", "Etsy"),
    sale("06-10", 2_800, 1_100, 5, "mug", "Ceramic mug", "etsy", "Etsy"),
  ]);

  assert.equal(drift.length, 1);
  assert.equal(drift[0].sourceName, "Etsy");
  assert.equal(drift[0].marginLostCents, 200 * 5);
});
