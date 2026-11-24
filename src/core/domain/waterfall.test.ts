import test from "node:test";
import assert from "node:assert/strict";
import type { ProfitLadder } from "./profit";
import { buildWaterfall, waterfallReconciles, waterfallSentence } from "./waterfall";

/** Groups thousands, like the real formatter, so the assertions test real output. */
const money = (c: number) =>
  `Rs ${new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(c) / 100)}`;

/**
 * A worked fixture, computed by hand:
 *
 *   Money in            12,400.00
 *   − discounts            200.00
 *   − refunds              310.00
 *   = net revenue       11,890.00
 *   − direct costs       4,990.00   (Clay 4,100 + Card fees 890)
 *   = contribution       6,900.00
 *   − period expenses    2,000.00   (Marketing 1,200 + Rent 800)
 *   = true profit        4,900.00
 */
const LADDER: ProfitLadder = {
  grossRevenue: 12_400_00,
  discounts: 200_00,
  refunds: 310_00,
  netRevenue: 11_890_00,
  directCosts: 4_990_00,
  contributionProfit: 6_900_00,
  periodExpenses: 2_000_00,
  trueProfit: 4_900_00,
};

const BREAKDOWN = {
  costComponents: [
    { name: "Clay", kind: "cost" as const, totalCents: 4_100_00 },
    { name: "Card fees", kind: "fee" as const, totalCents: 890_00 },
  ],
  expenseGroups: [
    { key: "marketing", label: "Marketing", amountCents: 1_200_00 },
    { key: "operational", label: "Rent", amountCents: 800_00 },
  ],
};

const stepIds = (w: ReturnType<typeof buildWaterfall>) => w.steps.map((s) => s.id);
const step = (w: ReturnType<typeof buildWaterfall>, id: string) => w.steps.find((s) => s.id === id)!;

test("the waterfall starts at money in and lands exactly on what you kept", () => {
  const w = buildWaterfall(LADDER, BREAKDOWN);

  assert.equal(w.startCents, 12_400_00);
  assert.equal(w.endCents, 4_900_00);
  assert.equal(w.reconciles, true);
  assert.equal(waterfallReconciles(LADDER, w.steps), true);

  // Stated the other way round, in case the helper is ever wrong: the bars
  // themselves have to add up.
  const deductions = w.steps.filter((s) => s.kind === "deduction").reduce((sum, s) => sum + s.amountCents, 0);
  assert.equal(w.startCents - deductions, w.endCents);
  assert.equal(deductions, 7_500_00, "12,400 in, 4,900 kept — 7,500 was eaten");
});

test("the steps run in ladder order and carry the ladder's own rung names", () => {
  const w = buildWaterfall(LADDER, BREAKDOWN);

  assert.deepEqual(stepIds(w), [
    "gross",
    "discounts",
    "refunds",
    "cost:Clay",
    "cost:Card fees",
    "expense:marketing",
    "expense:operational",
    "true-profit",
  ]);

  assert.equal(step(w, "refunds").rungLabel, "Net revenue", "the last deduction before costs completes net revenue");
  assert.equal(step(w, "cost:Card fees").rungLabel, "Contribution profit");
  assert.equal(step(w, "true-profit").rungLabel, "True profit");
});

test("the running total after each bar is where the next one starts", () => {
  const w = buildWaterfall(LADDER, BREAKDOWN);

  assert.equal(step(w, "gross").runningTotalCents, 12_400_00);
  assert.equal(step(w, "discounts").runningTotalCents, 12_200_00);
  assert.equal(step(w, "refunds").runningTotalCents, 11_890_00, "which is net revenue");
  assert.equal(step(w, "cost:Card fees").runningTotalCents, 6_900_00, "which is contribution profit");
  assert.equal(step(w, "true-profit").runningTotalCents, 4_900_00);
});

test("a fee is labelled as one, so a platform's cut never reads as a cost of making the thing", () => {
  const w = buildWaterfall(LADDER, BREAKDOWN);
  assert.equal(step(w, "cost:Card fees").label, "Card fees (fee)");
  assert.equal(step(w, "cost:Clay").label, "Clay");
});

test("costs the named components do not explain are SHOWN, not dropped", () => {
  // Materials booked straight onto a job have no component name to sit under.
  // Direct costs are 4,990 but only 4,100 is named.
  const w = buildWaterfall(LADDER, {
    ...BREAKDOWN,
    costComponents: [{ name: "Clay", kind: "cost", totalCents: 4_100_00 }],
  });

  const other = step(w, "cost:other");
  assert.ok(other, "the unexplained 890 gets its own bar");
  assert.equal(other.amountCents, 890_00);
  assert.equal(w.reconciles, true, "so the chart still adds up");
});

test("running costs the named groups do not explain are shown too", () => {
  const w = buildWaterfall(LADDER, {
    ...BREAKDOWN,
    expenseGroups: [{ key: "marketing", label: "Marketing", amountCents: 1_200_00 }],
  });

  assert.equal(step(w, "expense:other").amountCents, 800_00);
  assert.equal(w.reconciles, true);
});

test("costs handed BACK by refunds appear as a credit, and the chart still adds up", () => {
  // This is not hypothetical: when a sale is refunded the ladder takes the
  // goods' cost back off the period's direct costs, so the named components
  // legitimately sum to MORE than the net figure. An earlier version dropped
  // that negative remainder for being negative and silently broke the one
  // property this chart has to keep — caught by the server's guard on real
  // seed data, not by these fixtures.
  //
  // Direct costs are 4,990 but the named components claim 5,500, so 510 came
  // back.
  const w = buildWaterfall(LADDER, {
    ...BREAKDOWN,
    costComponents: [{ name: "Clay", kind: "cost", totalCents: 5_500_00 }],
  });

  const credit = step(w, "cost:other");
  assert.ok(credit, "the returned money gets its own bar rather than vanishing");
  assert.equal(credit.kind, "credit");
  assert.equal(credit.amountCents, 510_00, "carried as a positive magnitude; the kind says which way");
  assert.equal(credit.label, "Costs recovered on refunds", "and it is named for what it actually is");

  assert.equal(w.reconciles, true);
  assert.equal(w.endCents, LADDER.trueProfit, "still lands on the ladder's own profit");
});

test("a credit raises the running total instead of lowering it", () => {
  const w = buildWaterfall(LADDER, {
    ...BREAKDOWN,
    costComponents: [{ name: "Clay", kind: "cost", totalCents: 5_500_00 }],
  });

  const before = step(w, "cost:Clay").runningTotalCents;
  const after = step(w, "cost:other").runningTotalCents;
  assert.equal(after, before + 510_00, "money coming back moves the total UP");
});

test("zero-value slices never become bars", () => {
  const w = buildWaterfall(LADDER, {
    costComponents: [
      { name: "Clay", kind: "cost", totalCents: 4_990_00 },
      { name: "Nothing", kind: "cost", totalCents: 0 },
    ],
    expenseGroups: [
      { key: "marketing", label: "Marketing", amountCents: 2_000_00 },
      { key: "empty", label: "Empty", amountCents: 0 },
    ],
  });

  assert.ok(!stepIds(w).some((id) => id.includes("Nothing")));
  assert.ok(!stepIds(w).includes("expense:empty"));
  assert.equal(w.reconciles, true);
});

test("a period with no discounts or refunds simply has no bars for them", () => {
  const clean: ProfitLadder = {
    grossRevenue: 1_000_00,
    discounts: 0,
    refunds: 0,
    netRevenue: 1_000_00,
    directCosts: 400_00,
    contributionProfit: 600_00,
    periodExpenses: 100_00,
    trueProfit: 500_00,
  };
  const w = buildWaterfall(clean, {
    costComponents: [{ name: "Materials", kind: "cost", totalCents: 400_00 }],
    expenseGroups: [{ key: "operational", label: "Rent", amountCents: 100_00 }],
  });

  assert.deepEqual(stepIds(w), ["gross", "cost:Materials", "expense:operational", "true-profit"]);
  assert.equal(w.reconciles, true);
});

test("a losing period reconciles onto a negative end bar", () => {
  const losing: ProfitLadder = {
    grossRevenue: 1_000_00,
    discounts: 0,
    refunds: 0,
    netRevenue: 1_000_00,
    directCosts: 600_00,
    contributionProfit: 400_00,
    periodExpenses: 900_00,
    trueProfit: -500_00,
  };
  const w = buildWaterfall(losing, {
    costComponents: [{ name: "Materials", kind: "cost", totalCents: 600_00 }],
    expenseGroups: [{ key: "operational", label: "Rent", amountCents: 900_00 }],
  });

  assert.equal(w.endCents, -500_00);
  assert.equal(w.reconciles, true, "the bars still add up when the answer is negative");
});

test("revenue with NO costs behind it is flagged, because it looks like a triumph", () => {
  // The trust-critical case. A waterfall with no COGS does not look broken — it
  // looks like a wildly profitable business, and the page has to say so inline
  // rather than draw it silently.
  const uncosted: ProfitLadder = {
    grossRevenue: 5_000_00,
    discounts: 0,
    refunds: 0,
    netRevenue: 5_000_00,
    directCosts: 0,
    contributionProfit: 5_000_00,
    periodExpenses: 0,
    trueProfit: 5_000_00,
  };
  const w = buildWaterfall(uncosted, { costComponents: [], expenseGroups: [] });

  assert.equal(w.missingCosts, true);
  assert.equal(w.startCents, w.endCents, "every rupee that came in is shown as kept");
  assert.equal(w.reconciles, true);

  assert.equal(buildWaterfall(LADDER, BREAKDOWN).missingCosts, false);
});

test("an empty period is not flagged as missing costs — there is nothing to cost", () => {
  const empty: ProfitLadder = {
    grossRevenue: 0,
    discounts: 0,
    refunds: 0,
    netRevenue: 0,
    directCosts: 0,
    contributionProfit: 0,
    periodExpenses: 0,
    trueProfit: 0,
  };
  const w = buildWaterfall(empty, { costComponents: [], expenseGroups: [] });
  assert.equal(w.missingCosts, false);
  assert.equal(w.reconciles, true);
});

test("every bar knows where it drills to, except the one with nothing behind it", () => {
  const w = buildWaterfall(LADDER, BREAKDOWN);
  for (const s of w.steps) {
    if (s.id === "true-profit") {
      assert.equal(s.href, null, "the answer is not a link to somewhere else");
    } else {
      assert.ok(s.href, `${s.id} is a dead end`);
    }
  }
});

// ── The sentence above the chart ─────────────────────────────────────────────

test("the sentence says what came in, what was kept, and how it moved", () => {
  const s = waterfallSentence(LADDER, 4_000_00, money);
  assert.match(s, /Rs 12,400\.00 came in/);
  assert.match(s, /kept Rs 4,900\.00/);
  assert.match(s, /Rs 900\.00 more than last period/);
  assert.ok(!s.includes("?"), "a verdict is never a question");
});

test("with nothing to compare against it does not invent a comparison", () => {
  const s = waterfallSentence(LADDER, null, money);
  assert.match(s, /came in and you kept/);
  assert.ok(!/last period/.test(s));
});

test("a loss is named as one rather than dressed as a small profit", () => {
  const losing = { ...LADDER, trueProfit: -500_00 };
  assert.match(waterfallSentence(losing, 100_00, money), /you are down Rs 500\.00/);
});

test("an empty period says so instead of reporting a proud zero", () => {
  const empty = { ...LADDER, grossRevenue: 0, trueProfit: 0 };
  assert.match(waterfallSentence(empty, null, money), /No money came in/);
});

test("a flat period is allowed to be flat", () => {
  assert.match(waterfallSentence(LADDER, 4_900_00, money), /the same as last period/);
});
