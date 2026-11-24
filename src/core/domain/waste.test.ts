import test from "node:test";
import assert from "node:assert/strict";
import {
  summariseWaste,
  wasteRatePct,
  wasteReconciles,
  wasteValueCents,
  type WasteLine,
} from "./waste";

const line = (over: Partial<WasteLine> = {}): WasteLine => ({
  name: "Cement",
  qty: "200",
  wastedQty: "12",
  unitPriceCents: 25_000,
  ...over,
});

// ── What the waste was worth ────────────────────────────────────────────────

test("wasted units are valued at what they cost", () => {
  // 12 bags at Rs 250 each.
  assert.equal(wasteValueCents("12", 25_000), 300_000);
});

test("nothing wasted is worth nothing, and a missing figure is not an error", () => {
  assert.equal(wasteValueCents("0", 25_000), 0);
  assert.equal(wasteValueCents(null, 25_000), 0);
  assert.equal(wasteValueCents("", 25_000), 0);
});

test("a fractional quantity is valued exactly, not rounded up to a whole unit", () => {
  // Half a tonne of a Rs 100.00 tonne.
  assert.equal(wasteValueCents("0.5", 10_000), 5_000);
  assert.equal(wasteValueCents("1.5", 33_333), 50_000, "rounds to the nearest whole paisa");
});

test("waste is a share of what was bought, in whole percentage points to one place", () => {
  assert.equal(wasteRatePct("12", "200"), 6);
  assert.equal(wasteRatePct("1", "3"), 33.3);
});

test("a rate against nothing bought is null, never a division by zero", () => {
  assert.equal(wasteRatePct("5", "0"), null);
  assert.equal(wasteRatePct("5", null), null);
});

// ── The rule that cannot bend ───────────────────────────────────────────────

test("WASTE IS NEVER MONEY OF ITS OWN — it can only ever be part of what was spent", () => {
  // You already paid for 200 bags. The 12 that were ruined are a slice of that
  // cost, not an extra one. Adding a money row would double-count, which is
  // the single mistake this whole feature could make.
  assert.equal(wasteReconciles(line()), true);
  assert.equal(wasteValueCents("12", 25_000) <= 200 * 25_000, true);
});

test("wasting more than was bought is refused — it is a typo, not a fact", () => {
  assert.equal(wasteReconciles(line({ wastedQty: "250" })), false);
  assert.equal(wasteReconciles(line({ wastedQty: "200" })), true, "all of it is possible");
});

test("a negative waste figure is refused", () => {
  assert.equal(wasteReconciles(line({ wastedQty: "-1" })), false);
});

// ── The report ──────────────────────────────────────────────────────────────

test("the report groups by what was wasted and totals it", () => {
  const summary = summariseWaste([
    line({ name: "Cement", qty: "200", wastedQty: "12", unitPriceCents: 25_000 }),
    line({ name: "Cement", qty: "100", wastedQty: "4", unitPriceCents: 25_000 }),
    line({ name: "Sand", qty: "50", wastedQty: "5", unitPriceCents: 10_000 }),
    line({ name: "Steel", qty: "10", wastedQty: null, unitPriceCents: 500_000 }),
  ]);

  assert.equal(summary.totalWastedCents, 300_000 + 100_000 + 50_000);
  // Steel wasted nothing, so it is not on a list of things going to waste.
  assert.equal(summary.rows.length, 2);

  const cement = summary.rows.find((row) => row.name === "Cement")!;
  assert.equal(cement.wastedCents, 400_000);
  assert.equal(cement.boughtCents, 300 * 25_000);
  assert.equal(cement.ratePct, 5.3, "16 of 300 bags");
});

test("the biggest waste sorts first, because that is the one worth doing something about", () => {
  const summary = summariseWaste([
    line({ name: "Small", qty: "10", wastedQty: "1", unitPriceCents: 100 }),
    line({ name: "Big", qty: "10", wastedQty: "1", unitPriceCents: 100_000 }),
  ]);
  assert.equal(summary.rows[0].name, "Big");
});

test("a period with no waste recorded totals zero and lists nothing", () => {
  const summary = summariseWaste([line({ wastedQty: null })]);
  assert.equal(summary.totalWastedCents, 0);
  assert.equal(summary.rows.length, 0);
  assert.equal(summary.shareOfSpendPct, null, "no waste against no measurement is not 0%");
});

test("the headline share compares waste to what was spent on the same things", () => {
  const summary = summariseWaste([
    line({ name: "Cement", qty: "100", wastedQty: "10", unitPriceCents: 1_000 }),
  ]);
  assert.equal(summary.totalWastedCents, 10_000);
  assert.equal(summary.totalBoughtCents, 100_000);
  assert.equal(summary.shareOfSpendPct, 10);
});

test("every figure out is a whole number of minor units", () => {
  const summary = summariseWaste([line({ qty: "3", wastedQty: "1", unitPriceCents: 33_333 })]);
  assert.ok(Number.isSafeInteger(summary.totalWastedCents));
  assert.ok(Number.isSafeInteger(summary.rows[0].wastedCents));
});
