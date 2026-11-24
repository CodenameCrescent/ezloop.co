import test from "node:test";
import assert from "node:assert/strict";
import {
  computeConcentration,
  computeScopeCreep,
  computeUtilization,
  concentrationSentence,
  reworkShare,
  scopeCreepSentence,
  splitByWorkType,
} from "./workInsights";

test("the spec's worked example: 60 agreed hours, 88 actual, priced at Rs 150,000", () => {
  // "a client at 47% over hours is earning them Rs 1,705/hr on a Rs 2,500/hr
  // assumption" — the whole point of this measure, reproduced exactly.
  const creep = computeScopeCreep({
    agreedHours: "60",
    agreedAmountCents: 150_000_00,
    actualHours: "88",
    revenueCents: 150_000_00,
  });

  assert.equal(creep.isOver, true);
  assert.equal(creep.overHours, "28");
  assert.equal(creep.overPct, 46.7); // 28/60 — "47% over" when rounded for display
  assert.equal(Math.round(creep.overPct!), 47);

  // The pair of rates is the part that changes behaviour.
  assert.equal(creep.agreedHourlyRateCents, 2_500_00); // 150,000 ÷ 60
  // 150,000 ÷ 88 = Rs 1,704.55, which the spec quotes rounded as "Rs 1,705".
  // Stored to the paisa; the screen is what rounds.
  assert.equal(creep.effectiveHourlyRateCents, 1_704_55);
  assert.equal(Math.round(creep.effectiveHourlyRateCents! / 100), 1705);
  assert.equal(creep.rateGapCents, 2_500_00 - 1_704_55);
  assert.match(scopeCreepSentence("Acme", creep)!, /47% over/);
});

test("a client under their agreed hours is not 'over' anything", () => {
  const creep = computeScopeCreep({
    agreedHours: "60", agreedAmountCents: 150_000_00, actualHours: "40", revenueCents: 150_000_00,
  });
  assert.equal(creep.isOver, false);
  assert.equal(creep.overHours, "-20");
  assert.ok(creep.overPct! < 0);
  assert.equal(scopeCreepSentence("Acme", creep), null, "nothing to warn about");
  // And they are earning MORE per hour than the job was priced at.
  assert.equal(creep.effectiveHourlyRateCents, 3_750_00);
});

test("no agreed hours means no scope creep figure at all", () => {
  // Not "0% over" — there is no agreement to be over.
  for (const agreed of [null, "0"]) {
    const creep = computeScopeCreep({
      agreedHours: agreed, agreedAmountCents: 100_000_00, actualHours: "88", revenueCents: 100_000_00,
    });
    assert.equal(creep.overPct, null);
    assert.equal(creep.overHours, null);
    assert.equal(creep.agreedHourlyRateCents, null);
    assert.equal(creep.isOver, false);
    // The effective rate still works — it needs no agreement.
    assert.ok(creep.effectiveHourlyRateCents! > 0);
  }
});

test("agreed hours with no agreed price still reports the overrun", () => {
  const creep = computeScopeCreep({
    agreedHours: "60", agreedAmountCents: null, actualHours: "88", revenueCents: 150_000_00,
  });
  assert.equal(Math.round(creep.overPct!), 47);
  assert.equal(creep.agreedHourlyRateCents, null, "nothing was priced, so no assumed rate");
  assert.equal(creep.rateGapCents, null);
  assert.match(scopeCreepSentence("Acme", creep)!, /over the hours agreed\.$/);
});

test("the spec's worked example: 207 billable of 280 total is 74% utilization", () => {
  const u = computeUtilization("207", "280");
  assert.equal(u.pct, 73.9);
  assert.equal(Math.round(u.pct!), 74);
  // The gap is the number that matters: paid time earning nothing.
  assert.equal(u.nonBillableHours, "73");
});

test("nothing logged means utilization is unknown, not zero", () => {
  // 0% would read as "nobody billed anything", which is a far worse claim than
  // "we don't know yet".
  const u = computeUtilization("0", "0");
  assert.equal(u.pct, null);
  assert.equal(u.nonBillableHours, "0");
});

test("fully billable and fully non-billable both compute", () => {
  assert.equal(computeUtilization("40", "40").pct, 100);
  assert.equal(computeUtilization("0", "40").pct, 0);
  assert.equal(computeUtilization("0", "40").nonBillableHours, "40");
});

test("concentration ranks clients and flags a single point of failure", () => {
  const c = computeConcentration([
    { label: "Big Co", revenueCents: 570_000_00 },
    { label: "Mid Co", revenueCents: 300_000_00 },
    { label: "Small Co", revenueCents: 130_000_00 },
  ]);

  assert.equal(c.totalRevenueCents, 1_000_000_00);
  assert.equal(c.topLabel, "Big Co");
  assert.equal(c.topSharePct, 57); // the spec's example
  assert.equal(c.risk, "high");
  assert.deepEqual(c.slices.map((s) => s.label), ["Big Co", "Mid Co", "Small Co"]);
  assert.match(concentrationSentence(c)!, /57%/);
});

test("concentration thresholds: healthy, watch, high", () => {
  /** Biggest client at `top`, with the remainder spread evenly over `others`. */
  const riskWith = (top: number, others: number[]) =>
    computeConcentration([
      { label: "Top", revenueCents: top },
      ...others.map((cents, i) => ({ label: `Other ${i}`, revenueCents: cents })),
    ]).risk;

  // 25 of 100 — a healthy spread across four clients.
  assert.equal(riskWith(25_000_00, [25_000_00, 25_000_00, 25_000_00]), "none");
  // 40 of 100 — a third of the book on one name, worth watching.
  assert.equal(riskWith(40_000_00, [30_000_00, 30_000_00]), "watch");
  // 60 of 100 — losing them takes most of the income with them.
  assert.equal(riskWith(60_000_00, [40_000_00]), "high");
});

test("no revenue means no concentration figure", () => {
  const c = computeConcentration([{ label: "Nobody", revenueCents: 0 }]);
  assert.equal(c.topSharePct, null);
  assert.equal(c.risk, null);
  assert.deepEqual(c.slices, []);
  assert.equal(concentrationSentence(c), null);
});

test("one client is 100% of the book, and the consequence is stated correctly", () => {
  const c = computeConcentration([{ label: "Only Co", revenueCents: 50_000_00 }]);
  assert.equal(c.topSharePct, 100);
  assert.equal(c.risk, "high");
  // A stock "half your income" line would be flatly wrong here.
  const sentence = concentrationSentence(c)!;
  assert.match(sentence, /leave you with nothing/i);
  assert.ok(!/half/i.test(sentence));
});

test("a high-but-not-total share quotes its own number, not a stock phrase", () => {
  const c = computeConcentration([
    { label: "Big", revenueCents: 60_000_00 },
    { label: "Rest", revenueCents: 40_000_00 },
  ]);
  assert.match(concentrationSentence(c)!, /take 60% of your income/i);
});

test("the spec's worked example: 14 rework hours of 62 stands on its own", () => {
  // rework is the leading indicator of a client who cannot settle on a brief,
  // and it is invisible once folded into delivery.
  const slices = splitByWorkType([
    { workType: "delivery", hours: "40" },
    { workType: "rework", hours: "14" },
    { workType: "admin", hours: "8" },
  ]);

  const rework = reworkShare(slices)!;
  assert.equal(rework.hours, "14");
  assert.equal(rework.sharePct, 22.6); // 14 of 62
  // And it is genuinely separate — delivery does not include it.
  const delivery = slices.find((s) => s.workType === "delivery")!;
  assert.equal(delivery.hours, "40");
  assert.equal(slices.reduce((sum, s) => sum + Number(s.hours), 0), 62);
});

test("no rework means no rework figure, not a zero row", () => {
  const slices = splitByWorkType([{ workType: "delivery", hours: "40" }]);
  assert.equal(reworkShare(slices), null);
  assert.equal(slices.length, 1);
});

test("hours split by work type sums to 100% and orders by size", () => {
  const slices = splitByWorkType([
    { workType: "admin", hours: "5" },
    { workType: "delivery", hours: "30" },
    { workType: "pitching", hours: "15" },
  ]);
  assert.deepEqual(slices.map((s) => s.workType), ["delivery", "pitching", "admin"]);
  assert.equal(Math.round(slices.reduce((sum, s) => sum + s.sharePct, 0)), 100);
});

test("empty input produces no slices rather than a divide by zero", () => {
  assert.deepEqual(splitByWorkType([]), []);
  assert.deepEqual(splitByWorkType([{ workType: "delivery", hours: "0" }]), []);
});
