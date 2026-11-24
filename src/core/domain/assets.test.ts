import test from "node:test";
import assert from "node:assert/strict";
import { assetLife, monthsBetween } from "./assets";

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

test("months between two dates count calendar months, not elapsed days", () => {
  assert.equal(monthsBetween(day("2026-01-15"), day("2026-01-31")), 0, "same month, none finished");
  assert.equal(monthsBetween(day("2026-01-15"), day("2026-02-01")), 1);
  assert.equal(monthsBetween(day("2026-01-15"), day("2027-01-15")), 12);
});

test("a machine bought this month has used none of its life", () => {
  const life = assetLife({
    purchaseCents: 240_000,
    spreadMonths: 12,
    purchasedAt: day("2026-09-01"),
    asOf: day("2026-09-20"),
  });
  assert.equal(life.monthsUsed, 0);
  assert.equal(life.monthsLeft, 12);
  assert.equal(life.usedCents, 0);
  assert.equal(life.remainingCents, 240_000);
});

test("halfway through, half the value is left", () => {
  const life = assetLife({
    purchaseCents: 240_000,
    spreadMonths: 12,
    purchasedAt: day("2026-01-01"),
    asOf: day("2026-07-01"),
  });
  assert.equal(life.monthsUsed, 6);
  assert.equal(life.monthsLeft, 6);
  assert.equal(life.usedCents, 120_000);
  assert.equal(life.remainingCents, 120_000);
});

test("what is used and what is left always add back to what it cost", () => {
  // The guard. These two figures are shown side by side, and a gap between
  // them would be money that simply is not anywhere.
  for (const months of [2, 7, 12, 36, 60]) {
    for (const used of [0, 1, 3, 11, 59]) {
      const life = assetLife({
        purchaseCents: 100_000,
        spreadMonths: months,
        purchasedAt: day("2026-01-01"),
        asOf: new Date(Date.UTC(2026, used, 1)),
      });
      assert.equal(life.usedCents + life.remainingCents, 100_000, `${months} months, ${used} used`);
    }
  }
});

test("a fully used asset is worth nothing, and never less than nothing", () => {
  const life = assetLife({
    purchaseCents: 240_000,
    spreadMonths: 12,
    purchasedAt: day("2026-01-01"),
    asOf: day("2030-01-01"),
  });
  assert.equal(life.monthsLeft, 0);
  assert.equal(life.remainingCents, 0);
  assert.equal(life.usedCents, 240_000);
  assert.equal(life.fullyUsed, true);
});

test("an awkward division still adds up to the last paisa", () => {
  // 100_000 over 3 months is 33_333.33 a month. Two months used must leave
  // exactly the remainder, not a figure two paisa adrift.
  const life = assetLife({
    purchaseCents: 100_000,
    spreadMonths: 3,
    purchasedAt: day("2026-01-01"),
    asOf: day("2026-03-01"),
  });
  assert.equal(life.usedCents + life.remainingCents, 100_000);
  assert.ok(Number.isSafeInteger(life.usedCents));
  assert.ok(Number.isSafeInteger(life.remainingCents));
});

test("a purchase dated in the future has used nothing", () => {
  const life = assetLife({
    purchaseCents: 50_000,
    spreadMonths: 6,
    purchasedAt: day("2027-01-01"),
    asOf: day("2026-09-01"),
  });
  assert.equal(life.monthsUsed, 0);
  assert.equal(life.remainingCents, 50_000);
});

test("how far through its life it is, as a share", () => {
  const life = assetLife({
    purchaseCents: 240_000,
    spreadMonths: 12,
    purchasedAt: day("2026-01-01"),
    asOf: day("2026-04-01"),
  });
  assert.equal(life.usedPct, 25);
});
