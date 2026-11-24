import { test } from "node:test";
import assert from "node:assert/strict";
import { convertEntryToBase, entryAmountCents, EnteredCurrencyError } from "./enteredCurrency";

test("every typed amount converts at the given rate, rounding half-up per amount", () => {
  const converted = convertEntryToBase(
    {
      orderDiscountCents: 200,
      shippingChargedCents: 500,
      lines: [
        { direction: "in" as const, qty: "2", unitPriceCents: 1999, lineDiscountCents: 100 },
        { direction: "out" as const, qty: "1", unitPriceCents: 1000 },
      ],
    },
    "280.5",
  );
  // 1999 × 280.5 = 560,719.5 → 560,720
  assert.equal(converted.lines[0].unitPriceCents, 560720);
  assert.equal(converted.lines[0].lineDiscountCents, 28050);
  assert.equal(converted.lines[1].unitPriceCents, 280500);
  assert.equal(converted.orderDiscountCents, 56100);
  assert.equal(converted.shippingChargedCents, 140250);
});

test("fields that were not typed stay absent rather than becoming zero", () => {
  const converted = convertEntryToBase({ lines: [{ direction: "in" as const, qty: "1", unitPriceCents: 100 }] }, "280");
  assert.equal("orderDiscountCents" in converted, false);
  assert.equal("taxPaidCents" in converted, false);
  assert.equal("lineDiscountCents" in converted.lines[0], false);
});

test("everything else on the entry passes through untouched", () => {
  const converted = convertEntryToBase(
    { notes: "Etsy order", lines: [{ direction: "in" as const, qty: "3", label: "Mug", unitPriceCents: 100 }] },
    "280",
  );
  assert.equal(converted.notes, "Etsy order");
  assert.equal(converted.lines[0].label, "Mug");
  assert.equal(converted.lines[0].qty, "3");
});

test("a line with no typed price is refused: the catalogue price is in the business's own currency", () => {
  const fromCatalogue: { lines: Array<{ qty: string; revenueItemId: string; unitPriceCents?: number }> } = {
    lines: [{ qty: "1", revenueItemId: "ri_1" }],
  };
  assert.throws(() => convertEntryToBase(fromCatalogue, "280"), EnteredCurrencyError);
});

test("a rate of one, zero, or nonsense is refused", () => {
  const entry = { lines: [{ direction: "in" as const, qty: "1", unitPriceCents: 100 }] };
  for (const rate of ["1", "1.000", "0", "-3", "abc", ""]) {
    assert.throws(() => convertEntryToBase(entry, rate), EnteredCurrencyError, `rate "${rate}"`);
  }
});

test("a sale's amount is its net revenue plus shipping, and cost lines are not part of it", () => {
  const amount = entryAmountCents({
    direction: "in",
    orderDiscountCents: 200,
    shippingChargedCents: 500,
    lines: [
      { direction: "in", qty: "2", unitPriceCents: 1000, lineDiscountCents: 100, costSnapshot: null },
      { direction: "out", qty: "1", unitPriceCents: 9999, lineDiscountCents: 0, costSnapshot: null },
    ],
  });
  // 2 × 1000 − 100 line discount − 200 order discount + 500 shipping
  assert.equal(amount, 2200);
});

test("an expense's amount is its lines less the order discount", () => {
  const amount = entryAmountCents({
    direction: "out",
    orderDiscountCents: 50,
    shippingChargedCents: 0,
    lines: [{ direction: "out", qty: "3", unitPriceCents: 1000, lineDiscountCents: 0, costSnapshot: null }],
  });
  assert.equal(amount, 2950);
});
