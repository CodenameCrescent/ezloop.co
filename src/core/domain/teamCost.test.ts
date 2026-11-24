import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_TARGET,
  computeTeamCost,
  isValidBillableTarget,
  overheadPerHead,
  type TeamCostInput,
} from "./teamCost";

/** Rs 60,000 a month, Rs 10,000 of overhead, the default 130-hour target. */
const salaried: TeamCostInput = {
  costType: "salaried",
  monthlyCostCents: 60_000_00,
  hourlyRateCents: null,
  overheadShareCents: 10_000_00,
  billableTargetHours: "130",
};

test("a salary becomes an hourly cost by dividing across the billable target", () => {
  const cost = computeTeamCost(salaried);
  // 60,000 ÷ 130 = 461.538... → Rs 461.54
  assert.equal(cost.payHourlyCents, 461_54);
  // 10,000 ÷ 130 = 76.923... → Rs 76.92
  assert.equal(cost.overheadHourlyCents, 76_92);
  assert.equal(cost.effectiveHourlyCostCents, 538_46);
});

test("the two halves are returned separately, because only one may reach contribution", () => {
  // Pay is a direct cost of delivery and belongs in contribution profit.
  // Overhead is a fixed-cost allocation and must never be blended in silently
  // — CLAUDE.md forbids allocating fixed costs per item.
  const cost = computeTeamCost(salaried);
  assert.equal(cost.payHourlyCents + cost.overheadHourlyCents, cost.effectiveHourlyCostCents);
  assert.ok(cost.payHourlyCents > 0 && cost.overheadHourlyCents > 0);
});

test("a lower billable target means a HIGHER hourly cost — the trade-off the owner must see", () => {
  // The whole reason the default is 130 rather than 160: pretending every hour
  // is billable makes each hour look cheaper and every client look better.
  const at130 = computeTeamCost(salaried).effectiveHourlyCostCents;
  const at160 = computeTeamCost({ ...salaried, billableTargetHours: "160" }).effectiveHourlyCostCents;
  assert.ok(at160 < at130, "a full-month target flatters the cost");
  assert.equal(at160, 437_50); // 70,000 ÷ 160
});

test("hourly and contractor rates are used directly, skipping the division", () => {
  const hourly = computeTeamCost({
    costType: "hourly",
    monthlyCostCents: 0,
    hourlyRateCents: 800_00,
    overheadShareCents: 0,
    billableTargetHours: "130",
  });
  assert.equal(hourly.payHourlyCents, 800_00);
  assert.equal(hourly.overheadHourlyCents, 0);
  assert.equal(hourly.effectiveHourlyCostCents, 800_00);

  // A monthly salary on an hourly person is ignored, not added.
  const withStraySalary = computeTeamCost({
    costType: "contractor",
    monthlyCostCents: 99_999_00,
    hourlyRateCents: 800_00,
    overheadShareCents: 0,
    billableTargetHours: "130",
  });
  assert.equal(withStraySalary.effectiveHourlyCostCents, 800_00);
});

test("a contractor who does carry overhead gets it per hour, on top of their rate", () => {
  const cost = computeTeamCost({
    costType: "contractor",
    monthlyCostCents: 0,
    hourlyRateCents: 800_00,
    overheadShareCents: 13_000_00,
    billableTargetHours: "130",
  });
  assert.equal(cost.payHourlyCents, 800_00);
  assert.equal(cost.overheadHourlyCents, 100_00); // 13,000 ÷ 130
  assert.equal(cost.effectiveHourlyCostCents, 900_00);
});

test("zero overhead is honest arithmetic, not a crash", () => {
  const cost = computeTeamCost({ ...salaried, overheadShareCents: 0 });
  assert.equal(cost.overheadHourlyCents, 0);
  assert.equal(cost.effectiveHourlyCostCents, cost.payHourlyCents);
});

test("an impossible billable target is refused rather than dividing by zero", () => {
  for (const bad of ["0", "-5", "", "abc", "1,5"]) {
    assert.equal(isValidBillableTarget(bad), false, `${bad} is not a target`);
    assert.throws(() => computeTeamCost({ ...salaried, billableTargetHours: bad }), /positive decimal string/);
  }
  assert.equal(isValidBillableTarget("130"), true);
  assert.equal(isValidBillableTarget("0.5"), true);
  assert.equal(DEFAULT_TARGET, "130");
});

test("money in must be integer minor units", () => {
  assert.throws(() => computeTeamCost({ ...salaried, monthlyCostCents: 100.5 }), /integer minor units/);
});

test("overhead splits evenly across the team, rounded half-up", () => {
  const split = overheadPerHead(30_000_00, 3);
  assert.equal(split.reason, "ok");
  assert.equal(split.perPersonCents, 10_000_00);
  // The working is returned so the screen can show it rather than assert it.
  assert.equal(split.fixedCostPoolCents, 30_000_00);
  assert.equal(split.headcount, 3);

  // 10,000 ÷ 3 = 3,333.33
  assert.equal(overheadPerHead(10_000_00, 3).perPersonCents, 3_333_33);
});

test("no team and no fixed costs each give a REASON, never a zero", () => {
  // A silent zero understates every cost rate in the system, and the owner has
  // no way to notice. Saying why is the whole point.
  const noTeam = overheadPerHead(30_000_00, 0);
  assert.equal(noTeam.reason, "no_team");
  assert.equal(noTeam.perPersonCents, null);

  const noCosts = overheadPerHead(0, 3);
  assert.equal(noCosts.reason, "no_fixed_costs");
  assert.equal(noCosts.perPersonCents, null);
});

test("a realistic end-to-end: three people sharing Rs 45,000 of overhead", () => {
  const split = overheadPerHead(45_000_00, 3);
  assert.equal(split.perPersonCents, 15_000_00);

  const cost = computeTeamCost({ ...salaried, overheadShareCents: split.perPersonCents! });
  // Pay 461.54 + overhead 115.38 = 576.92/hr fully loaded.
  assert.equal(cost.payHourlyCents, 461_54);
  assert.equal(cost.overheadHourlyCents, 115_38);
  assert.equal(cost.effectiveHourlyCostCents, 576_92);
});
