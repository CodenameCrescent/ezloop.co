import test from "node:test";
import assert from "node:assert/strict";
import {
  DATA_STATE_MESSAGE,
  computeCoverage,
  computeTargetProfit,
  coverageSentence,
  summariseTargets,
  type TargetProfitInput,
} from "./clientProfit";

/** A client billed Rs 200,000 with 100 hours of work behind it. */
const costed: TargetProfitInput = {
  targetType: "client",
  targetId: "c1",
  label: "Acme Corp",
  revenueCents: 200_000_00,
  labourCostCents: 50_000_00,
  overheadCostCents: 11_538_00,
  directCostCents: 10_000_00,
  hoursLogged: "100",
  hasHours: true,
  hasEstimates: false,
};

/** The dangerous one: real revenue, nobody logged a minute against it. */
const uncosted: TargetProfitInput = {
  ...costed,
  targetId: "c2",
  label: "Ghost Client",
  revenueCents: 45_000_00,
  labourCostCents: 0,
  overheadCostCents: 0,
  directCostCents: 0,
  hoursLogged: "0",
  hasHours: false,
};

test("a client with revenue and NO hours has no profit figure at all", () => {
  // THE failure the whole design exists to prevent: Rs 45,000 of revenue with
  // no labour computes to Rs 45,000 profit at 100% margin — the most
  // flattering possible lie about the client most likely to be losing money.
  const result = computeTargetProfit(uncosted);

  assert.equal(result.isCosted, false);
  assert.equal(result.contributionCents, null, "contribution must be absent, not zero");
  assert.equal(result.marginPct, null, "margin must be absent, not 100");
  assert.equal(result.labourCostCents, null, "labour must be absent, not zero");
  assert.equal(result.afterOverheadCents, null);
  assert.equal(result.effectiveHourlyRateCents, null);

  // Revenue itself is still shown — the owner should see the money came in.
  assert.equal(result.revenueCents, 45_000_00);

  // Nothing in the payload can be coerced into a margin by a careless caller.
  const serialised = JSON.stringify(result);
  assert.ok(!serialised.includes("100"), "no stray 100 that could read as a margin");
});

test("a costed client produces the primary contribution figure", () => {
  const result = computeTargetProfit(costed);
  // 200,000 − 50,000 labour − 10,000 direct = 140,000
  assert.equal(result.contributionCents, 140_000_00);
  assert.equal(result.marginPct, 70);
  assert.equal(result.isCosted, true);
  // Rs 200,000 over 100 hours = Rs 2,000/hr actually earned.
  assert.equal(result.effectiveHourlyRateCents, 2_000_00);
});

test("the overhead figure is separate and always lower — never the headline", () => {
  const result = computeTargetProfit(costed);
  assert.equal(result.afterOverheadCents, 140_000_00 - 11_538_00);
  assert.ok(result.afterOverheadCents! < result.contributionCents!);
  // Contribution never has overhead folded into it; that would allocate a
  // fixed cost per item, which CLAUDE.md forbids.
  assert.equal(result.contributionCents, 140_000_00);
});

test("a loss-making client shows a negative figure, not a hidden one", () => {
  const result = computeTargetProfit({ ...costed, revenueCents: 20_000_00 });
  assert.equal(result.contributionCents, -40_000_00);
  assert.equal(result.marginPct, -200);
});

test("no hours anywhere means NO summary at all, not a zeroed one", () => {
  const summary = summariseTargets([computeTargetProfit(uncosted), computeTargetProfit({ ...uncosted, targetId: "c3" })]);

  assert.equal(summary.state, "no_hours");
  assert.equal(summary.costedContributionCents, null);
  assert.equal(summary.costedRevenueCents, null);
  assert.equal(summary.costedMarginPct, null);
  assert.equal(summary.costedLabourCents, null);
  // The revenue is still reported, just never as the basis of a margin.
  assert.equal(summary.uncostedRevenueCents, 90_000_00);
  assert.equal(summary.uncostedWithRevenueCount, 2);
});

test("a mixed period totals ONLY the costed targets, and says how many it left out", () => {
  const summary = summariseTargets([computeTargetProfit(costed), computeTargetProfit(uncosted)]);

  assert.equal(summary.state, "partial");
  assert.equal(summary.costedCount, 1);
  assert.equal(summary.uncostedCount, 1);
  // The total is the costed client alone — NOT 245,000 of blended revenue,
  // which would smuggle the uncosted client's margin back in at business level.
  assert.equal(summary.costedRevenueCents, 200_000_00);
  assert.equal(summary.costedContributionCents, 140_000_00);
  assert.equal(summary.costedMarginPct, 70);
  // And the excluded revenue is reported separately so nothing goes missing.
  assert.equal(summary.uncostedRevenueCents, 45_000_00);
});

test("an internal bucket with no hours does not make the picture incomplete", () => {
  // Only targets that EARNED money need costing for the picture to be complete.
  const internal = computeTargetProfit({
    ...uncosted,
    targetType: "internal",
    targetId: "i1",
    label: "Admin",
    revenueCents: 0,
  });
  const summary = summariseTargets([computeTargetProfit(costed), internal]);
  assert.equal(summary.state, "complete");
  assert.equal(summary.uncostedWithRevenueCount, 0);
});

test("estimates are carried up to the summary so they can be marked everywhere", () => {
  const summary = summariseTargets([computeTargetProfit({ ...costed, hasEstimates: true })]);
  assert.equal(summary.hasEstimates, true);
  assert.equal(summariseTargets([computeTargetProfit(costed)]).hasEstimates, false);

  // The warning covers the WHOLE page, not just the lens the totals came from.
  // An estimate on a product would otherwise leave the banner silent while the
  // row beneath it was plainly marked, and the page would contradict itself.
  const clientLens = [computeTargetProfit(costed)];
  const bothLenses = [...clientLens, computeTargetProfit({ ...costed, hasEstimates: true })];
  assert.equal(summariseTargets(clientLens, bothLenses).hasEstimates, true);
  // And it is still only a flag — no money crossed between the lenses.
  assert.equal(
    summariseTargets(clientLens, bothLenses).costedRevenueCents,
    summariseTargets(clientLens).costedRevenueCents,
  );
});

test("every state has a sentence that never promises a number it doesn't have", () => {
  assert.match(DATA_STATE_MESSAGE.no_hours, /no profit figure/i);
  assert.match(DATA_STATE_MESSAGE.partial, /only the ones that do/i);
  assert.match(DATA_STATE_MESSAGE.complete, /complete/i);
  for (const msg of Object.values(DATA_STATE_MESSAGE)) {
    assert.ok(!msg.includes("_"), `"${msg}" leaks an enum key`);
  }
});

test("coverage reports under-logging as the dangerous direction", () => {
  // Rs 80,000 attributed against Rs 100,000 of wages.
  const under = computeCoverage(80_000_00, 100_000_00);
  assert.equal(under.pct, 80);
  assert.equal(under.direction, "under");
  assert.match(coverageSentence(under), /looks? better than they really are/i);

  const matched = computeCoverage(98_000_00, 100_000_00);
  assert.equal(matched.direction, "matched");

  const over = computeCoverage(130_000_00, 100_000_00);
  assert.equal(over.direction, "over");
  assert.match(coverageSentence(over), /double-entered|outside payroll/i);
});

test("coverage gives a reason rather than a misleading percentage", () => {
  const noHours = computeCoverage(0, 100_000_00);
  assert.equal(noHours.reason, "no_hours");
  assert.equal(noHours.pct, null);

  const noPayroll = computeCoverage(50_000_00, 0);
  assert.equal(noPayroll.reason, "no_payroll");
  assert.equal(noPayroll.pct, null);
  assert.match(coverageSentence(noPayroll), /no wages recorded/i);
});

test("a target with hours but no revenue is costed, and has no margin to show", () => {
  // Internal work: real cost, no income. Margin would be a division by zero.
  const result = computeTargetProfit({
    ...costed,
    targetType: "internal",
    label: "Sales & pitching",
    revenueCents: 0,
    directCostCents: 0,
  });
  assert.equal(result.isCosted, true);
  assert.equal(result.contributionCents, -50_000_00);
  assert.equal(result.marginPct, null, "no revenue means no margin, not -Infinity");
  assert.equal(result.effectiveHourlyRateCents, 0);
});
