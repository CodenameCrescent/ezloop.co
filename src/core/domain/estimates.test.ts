import test from "node:test";
import assert from "node:assert/strict";
import { estimateSentence, isSpreadable, spreadHours, workingDaysBetween } from "./estimates";
import { addHours } from "./timesheet";

test("the spec's example: roughly 80 hours across a month", () => {
  // July 2026: 23 working days. 80 ÷ 23 = 3.478..., which no clean split gives.
  const days = workingDaysBetween("2026-07-01", "2026-07-31");
  assert.equal(days.length, 23);

  const spread = spreadHours("80", days.length);
  assert.equal(spread.dayCount, 23);
  assert.equal(spread.total, "80", "the parts add up to the figure that was typed");
  assert.equal(addHours(...spread.perDay), "80");

  // Rounded down, with the leftover hundredths on the earliest days.
  assert.equal(spread.perDay[0], "3.48");
  assert.equal(spread.perDay[22], "3.47");
});

test("hours are never lost or gained, whatever the total or the day count", () => {
  // The failure this guards: "about 80 hours" storing 79.98, so every figure
  // downstream disagrees with what the owner typed for no visible reason.
  for (const total of ["1", "7.5", "80", "160", "37.33", "0.07", "123.45"]) {
    for (const days of [1, 5, 20, 23, 31]) {
      const spread = spreadHours(total, days);
      assert.equal(spread.total, addHours(total), `${total} over ${days} days`);
      assert.equal(addHours(...spread.perDay), addHours(total));
    }
  }
});

test("a day never gets zero hours — it is spread over fewer days instead", () => {
  // A zero-hour entry is not a thing: the database refuses it, and it would
  // claim someone was on a job for no time at all.
  const spread = spreadHours("0.05", 23);
  assert.equal(spread.dayCount, 5, "5 days of a hundredth, not 23 days of nothing");
  assert.deepEqual(spread.perDay, ["0.01", "0.01", "0.01", "0.01", "0.01"]);
  assert.equal(spread.total, "0.05");

  for (const hours of spreadHours("1", 500).perDay) {
    assert.ok(Number(hours) > 0, "no zero days anywhere");
  }
});

test("weekends are left out, so an estimate never claims the team worked Sunday", () => {
  // 2026-07-04 is a Saturday, 2026-07-05 a Sunday.
  const days = workingDaysBetween("2026-07-03", "2026-07-06");
  assert.deepEqual(days, ["2026-07-03", "2026-07-06"]);
});

test("a single day, and a period that is one weekend, both behave", () => {
  assert.deepEqual(workingDaysBetween("2026-07-06", "2026-07-06"), ["2026-07-06"]);
  assert.deepEqual(workingDaysBetween("2026-07-04", "2026-07-05"), [], "a weekend has no working days");
  // Backwards or nonsense ranges give nothing rather than throwing.
  assert.deepEqual(workingDaysBetween("2026-07-31", "2026-07-01"), []);
  assert.deepEqual(workingDaysBetween("not-a-date", "2026-07-01"), []);
});

test("nothing to spread produces nothing, not a row of zeroes", () => {
  for (const total of ["0", "", "-5"]) {
    const spread = spreadHours(total, 20);
    assert.deepEqual(spread.perDay, []);
    assert.equal(spread.dayCount, 0);
    assert.equal(spread.total, "0");
  }
  assert.deepEqual(spreadHours("80", 0).perDay, []);
});

test("an impossible workload is refused rather than spread", () => {
  // 800 hours over 5 working days is 160 a day. That is a typo.
  assert.equal(isSpreadable("800", 5), false);
  assert.equal(isSpreadable("120", 5), true, "24 a day is the limit, not past it");
  assert.equal(isSpreadable("80", 23), true);
  assert.equal(isSpreadable("0", 23), false);
  assert.equal(isSpreadable("80", 0), false);
});

test("the sentence says what will happen, in hours and days", () => {
  const days = workingDaysBetween("2026-07-01", "2026-07-31");
  const sentence = estimateSentence("Sara", "Acme Corp", spreadHours("80", days.length), days.length);
  assert.match(sentence, /80 hours for Sara on Acme Corp/);
  assert.match(sentence, /23 working days/);

  // An even split says so plainly rather than hedging with "about".
  const even = estimateSentence("Sara", "Acme", spreadHours("20", 5), 5);
  assert.match(even, /4 hours a day across 5 working days/);
  assert.ok(!/about/.test(even));

  // And when it will not reach every day, it says that too.
  const thin = estimateSentence("Sara", "Acme", spreadHours("0.05", 23), 23);
  assert.match(thin, /too little to give all 23 working days a share/);
});
