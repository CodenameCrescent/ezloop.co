import test from "node:test";
import assert from "node:assert/strict";
import {
  AGREED_PERIODS,
  AGREED_PERIOD_LABELS,
  agreedHourlyRate,
  isAgreedPeriod,
  monthsInWindow,
  scaleAgreedHours,
} from "./agreedPeriod";

test("any single whole calendar month is exactly one month, whatever its length", () => {
  // The reason for prorating by each month's own length rather than by an
  // average: dividing 31 days by 30.44 gives 1.0184, and every monthly figure
  // would read 2% over for a reason the owner could never see.
  assert.equal(monthsInWindow("2060-07-01", "2060-07-31"), "1"); // 31 days
  assert.equal(monthsInWindow("2060-06-01", "2060-06-30"), "1"); // 30 days
  assert.equal(monthsInWindow("2061-02-01", "2061-02-28"), "1"); // 28 days
  assert.equal(monthsInWindow("2060-02-01", "2060-02-29"), "1"); // leap February
});

test("a window spanning two half-months adds the two fractions", () => {
  // 17 days of July plus 15 of August, each against its own 31.
  assert.equal(monthsInWindow("2060-07-15", "2060-08-15"), "1.032258");
  // A single day is one day's worth of its own month.
  assert.equal(monthsInWindow("2060-07-15", "2060-07-15"), "0.032258"); // 1/31
  assert.equal(monthsInWindow("2060-06-15", "2060-06-15"), "0.033333"); // 1/30
});

test("a whole year is twelve, and a quarter is three", () => {
  assert.equal(monthsInWindow("2060-01-01", "2060-12-31"), "12");
  assert.equal(monthsInWindow("2060-01-01", "2060-03-31"), "3");
  assert.equal(monthsInWindow("2060-07-01", "2060-08-31"), "2");
});

test("an unanswerable window is null, never a multiplier of one", () => {
  // "How many months is all time" has no answer. Defaulting to 1 would compare
  // a monthly figure against five years of hours and report 6000% over.
  for (const [from, to] of [
    [null, "2060-07-31"],
    ["2060-07-01", null],
    [undefined, undefined],
    ["2060-07-31", "2060-07-01"], // backwards
    ["not-a-date", "2060-07-31"],
    ["2060-07-01", "31-07-2060"],
  ] as Array<[string | null | undefined, string | null | undefined]>) {
    assert.equal(monthsInWindow(from, to), null, `${from} .. ${to}`);
  }
  // And a hostile range stops rather than spinning.
  assert.equal(monthsInWindow("1000-01-01", "2500-01-01"), null);
});

test("hours given in total are already the answer; monthly hours scale to the window", () => {
  assert.equal(scaleAgreedHours("60", "total", "3"), "60", "a total is a total, window or not");
  assert.equal(scaleAgreedHours("60", "total", null), "60");

  assert.equal(scaleAgreedHours("40", "monthly", "1"), "40");
  assert.equal(scaleAgreedHours("40", "monthly", "3"), "120");
  assert.equal(scaleAgreedHours("40", "monthly", "1.032258"), "41.29");
});

test("a monthly figure with no window is absent, not unscaled", () => {
  // Falling back to the raw 40 would silently claim the whole year's agreement
  // was forty hours.
  assert.equal(scaleAgreedHours("40", "monthly", null), null);
  // And nothing agreed is nothing agreed.
  for (const hours of [null, "0", ""]) {
    assert.equal(scaleAgreedHours(hours, "monthly", "3"), null);
    assert.equal(scaleAgreedHours(hours, "total", "3"), null);
  }
});

test("when both figures share a basis the price is the plain ratio, unscaled", () => {
  // THE load-bearing case. The price is money ÷ hours, so scaling both by the
  // same multiplier cancels — and doing it anyway rounds the money and makes
  // the price drift every time the date filter moves.
  const both = (period: "total" | "monthly") =>
    agreedHourlyRate({
      agreedAmountCents: 200_000_00,
      agreedHours: "40",
      amountPeriod: period,
      hoursPeriod: period,
      contractMonths: null,
    });

  assert.deepEqual(both("total"), { cents: 5_000_00, reason: "ok" });
  assert.deepEqual(both("monthly"), { cents: 5_000_00, reason: "ok" }, "monthly/monthly is the same ratio");
  // Explicitly: no contract dates needed when the bases match.
  assert.equal(both("monthly").reason, "ok");
});

test("the spec's worked example still prices at Rs 2,500 an hour", () => {
  const rate = agreedHourlyRate({
    agreedAmountCents: 150_000_00,
    agreedHours: "60",
    amountPeriod: "total",
    hoursPeriod: "total",
    contractMonths: null,
  });
  assert.deepEqual(rate, { cents: 2_500_00, reason: "ok" });
});

test("mixed bases need the contract length, and say so when it is missing", () => {
  // Forty hours a month against a fixed total fee is a real way to quote a
  // retainer, and the ratio means nothing until both sit on one basis.
  const mixed = (contractMonths: string | null) =>
    agreedHourlyRate({
      agreedAmountCents: 1_200_000_00,
      agreedHours: "40",
      amountPeriod: "total",
      hoursPeriod: "monthly",
      contractMonths,
    });

  // Six months: 40 × 6 = 240 hours for Rs 1,200,000 → Rs 5,000/hr.
  assert.deepEqual(mixed("6"), { cents: 5_000_00, reason: "ok" });
  // Without dates the length is unknowable, so there is no price.
  assert.deepEqual(mixed(null), { cents: null, reason: "needs_dates" });
});

test("the other mixed direction works too: a monthly fee against total hours", () => {
  // Rs 200,000 a month for 6 months = Rs 1,200,000 across 240 total hours.
  assert.deepEqual(
    agreedHourlyRate({
      agreedAmountCents: 200_000_00,
      agreedHours: "240",
      amountPeriod: "monthly",
      hoursPeriod: "total",
      contractMonths: "6",
    }),
    { cents: 5_000_00, reason: "ok" },
  );
});

test("a missing figure gives a reason, never a zero price", () => {
  const base = { amountPeriod: "total" as const, hoursPeriod: "total" as const, contractMonths: null };
  assert.deepEqual(agreedHourlyRate({ ...base, agreedAmountCents: null, agreedHours: "40" }), {
    cents: null,
    reason: "no_amount",
  });
  assert.deepEqual(agreedHourlyRate({ ...base, agreedAmountCents: 0, agreedHours: "40" }), {
    cents: null,
    reason: "no_amount",
  });
  assert.deepEqual(agreedHourlyRate({ ...base, agreedAmountCents: 100_00, agreedHours: null }), {
    cents: null,
    reason: "no_hours",
  });
  assert.deepEqual(agreedHourlyRate({ ...base, agreedAmountCents: 100_00, agreedHours: "0" }), {
    cents: null,
    reason: "no_hours",
  });
});

test("the price does not move when the date filter does", () => {
  // The whole point of computing from the raw pair. Same client, three windows,
  // one price — a figure that changed with the filter would be nonsense.
  const price = (contractMonths: string | null) =>
    agreedHourlyRate({
      agreedAmountCents: 200_000_00,
      agreedHours: "40",
      amountPeriod: "monthly",
      hoursPeriod: "monthly",
      contractMonths,
    }).cents;

  assert.equal(price(null), price("1"));
  assert.equal(price("1"), price("1.032258"));
  assert.equal(price("1.032258"), price("12"));
});

test("the vocabulary is two values with plain English behind each", () => {
  assert.deepEqual([...AGREED_PERIODS], ["total", "monthly"]);
  assert.equal(AGREED_PERIOD_LABELS.total, "In total");
  assert.equal(AGREED_PERIOD_LABELS.monthly, "Per month");
  for (const period of AGREED_PERIODS) {
    assert.ok(AGREED_PERIOD_LABELS[period]);
    assert.ok(!AGREED_PERIOD_LABELS[period].includes("_"), "no enum value leaks to screen");
  }
  assert.equal(isAgreedPeriod("monthly"), true);
  for (const junk of ["quarterly", "", null, undefined, 3, {}]) {
    assert.equal(isAgreedPeriod(junk), false);
  }
});
