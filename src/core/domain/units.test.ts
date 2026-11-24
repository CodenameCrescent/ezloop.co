import test from "node:test";
import assert from "node:assert/strict";
import { detectUnitMismatch, formatQuantity, pluralizeUnit, quantityFieldLabel } from "./units";

test("a quantity is said in the unit it was sold in", () => {
  // THE BUG: six hours of design work read as "×6", which is six logos.
  assert.equal(formatQuantity("6", "hour"), "6 hours");
  assert.equal(formatQuantity("1", "hour"), "1 hour");
  assert.equal(formatQuantity("148", "unit"), "148 units");
  assert.equal(formatQuantity("1", "unit"), "1 unit");
  assert.equal(formatQuantity("26", "month"), "26 months");
  // Fractions are real — half an hour is a normal thing to bill.
  assert.equal(formatQuantity("1.5", "hour"), "1.5 hours");
  assert.equal(formatQuantity("0.5", "hour"), "0.5 hours");
  // No unit (a label-only line) prints the bare number, never "6 undefined".
  assert.equal(formatQuantity("6", null), "6");
  assert.equal(formatQuantity("6", ""), "6");
  assert.equal(formatQuantity("6", "   "), "6");
  // Precision is never invented: what was stored is what is shown.
  assert.equal(formatQuantity("3.00", "hour"), "3.00 hours");
  assert.equal(formatQuantity("", "hour"), "0 hours");
});

test("a unit the owner invented is left exactly as they typed it", () => {
  // Guessing a plural for someone's own word is how "boxs" happens.
  assert.equal(pluralizeUnit("sqft", 5), "sqft");
  assert.equal(pluralizeUnit("km", 5), "km");
  assert.equal(pluralizeUnit("Hour", 5), "Hours");
  // Already plural stays put.
  assert.equal(pluralizeUnit("hours", 5), "hours");
  assert.equal(pluralizeUnit("hour", 1), "hour");
});

test("the quantity box is labelled by the unit, not by the pricing model", () => {
  assert.equal(quantityFieldLabel("hour"), "Hours");
  assert.equal(quantityFieldLabel("unit"), "Units");
  assert.equal(quantityFieldLabel("month"), "Months");
  assert.equal(quantityFieldLabel("sqft"), "Sqft");
  // Nothing picked yet — the generic word is still the honest one.
  assert.equal(quantityFieldLabel(null), "Qty");
  assert.equal(quantityFieldLabel(""), "Qty");
});

test("an item whose pricing and usage disagree is flagged, never corrected", () => {
  // Logo design: filed "fixed", sold in varying hours. This is the live case.
  assert.equal(
    detectUnitMismatch({ pricingModel: "fixed", unitLabel: "hour", lineCount: 23, linesWithNonUnitQty: 12 }),
    "priced_fixed_sold_by_unit",
  );
  // Leather bag: filed "hourly", every sale records exactly one.
  assert.equal(
    detectUnitMismatch({ pricingModel: "hourly", unitLabel: "hour", lineCount: 2, linesWithNonUnitQty: 0 }),
    "priced_hourly_never_multiple",
  );
  // A product sold in varying counts is ordinary, not a mismatch.
  assert.equal(
    detectUnitMismatch({ pricingModel: "per_unit", unitLabel: "unit", lineCount: 76, linesWithNonUnitQty: 40 }),
    null,
  );
  // Hourly and genuinely sold by the hour is right.
  assert.equal(
    detectUnitMismatch({ pricingModel: "hourly", unitLabel: "hour", lineCount: 5, linesWithNonUnitQty: 3 }),
    null,
  );
  // Nothing sold yet says nothing at all — there is no usage to disagree with.
  assert.equal(
    detectUnitMismatch({ pricingModel: "hourly", unitLabel: "hour", lineCount: 0, linesWithNonUnitQty: 0 }),
    null,
  );
});
