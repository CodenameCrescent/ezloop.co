import test from "node:test";
import assert from "node:assert/strict";
import { computeBaseline } from "./baseline";
import { RULE_CATALOGUE, ruleById } from "./ruleCatalogue";
import {
  evaluateRules,
  headlineIsWithinCap,
  leaksOnly,
  totalLeakCents,
  type InsightFacts,
  type LadderFacts,
} from "./rules";

/**
 * A healthy, unremarkable business. Every test starts here and breaks exactly
 * one thing, so what fired can only be what the test broke.
 */
const ladder = (over: Partial<LadderFacts> = {}): LadderFacts => ({
  grossRevenue: 1_000_00,
  discounts: 0,
  refunds: 0,
  netRevenue: 1_000_00,
  contributionProfit: 600_00,
  periodExpenses: 400_00,
  trueProfit: 200_00,
  ...over,
});

function facts(over: Partial<InsightFacts> = {}): InsightFacts {
  return {
    businessType: "ecommerce",
    comparisonPeriod: "This month vs last month",
    periodDays: 30,
    current: ladder(),
    prior: ladder(),
    leaks: {
      refundsCents: 0,
      refundRatePct: 0,
      topRefundItem: null,
      discountsCents: 0,
      discountPctOfGross: 0,
      feesCents: 0,
      topFee: null,
      marginErosion: [],
      unpaidTotalCents: 0,
      unpaidOver30Cents: 0,
      unpaidOver30Count: 0,
    },
    breakEven: {
      reason: "ok",
      breakEvenRevenueCents: 500_00,
      surplusCents: 500_00,
      coveredPct: 200,
      fixedExpensesCents: 300_00,
      unclassifiedExpensesCents: 0,
    },
    ads: { spendCents: 0, byPlatform: [], shareOfRevenueBps: 0 },
    items: [],
    retention: { customersWithPurchase: 0, repeatCustomers: 0, repeatRatePct: 0 },
    paymentHabit: { customerDaysToPay: null, supplierDaysToPay: null, paidSalesCount: 0, paidBillsCount: 0 },
    priceDrift: [],
    history: {
      trueProfitCents: [],
      grossRevenueCents: [],
      refundsCents: [],
      discountsCents: [],
      periodExpensesCents: [],
      adSpendCents: [],
    },
    cashOnHandCents: null,
    baselines: {},
    money: (c) => `Rs ${(Math.abs(c) / 100).toFixed(2)}`,
    ...over,
  };
}

const fire = (f: InsightFacts) => evaluateRules(RULE_CATALOGUE, f);
const ids = (f: InsightFacts) => fire(f).map((i) => i.id);
const only = (f: InsightFacts, id: string) => {
  const hit = fire(f).find((i) => i.id === id);
  assert.ok(hit, `expected ${id} to fire — got ${ids(f).join(", ") || "nothing"}`);
  return hit;
};

// ── The catalogue's own house rules ──────────────────────────────────────────

test("every rule in the catalogue has a unique id", () => {
  const seen = new Set<string>();
  for (const rule of RULE_CATALOGUE) {
    assert.ok(!seen.has(rule.id), `duplicate rule id "${rule.id}"`);
    seen.add(rule.id);
  }
  assert.equal(seen.size, RULE_CATALOGUE.length);
  assert.ok(ruleById("running-at-a-loss"));
  assert.equal(ruleById("does-not-exist"), undefined);
});

test("a healthy, boring period says almost nothing", () => {
  // The quiet screen is a valid output. What survives here must be genuinely
  // true of a business that simply had an ordinary month.
  assert.deepEqual(ids(facts()), ["covered-fixed-costs"]);
});

test("no card is rendered without a money figure", () => {
  // Sweep every rule against a range of shapes; nothing may produce a card
  // whose impact is not a real number.
  const shapes = [
    facts(),
    facts({ current: ladder({ trueProfit: -50_00 }) }),
    facts({ current: ladder({ netRevenue: 0, grossRevenue: 0, contributionProfit: 0, trueProfit: -400_00 }) }),
    facts({ prior: ladder({ trueProfit: 0, netRevenue: 0, grossRevenue: 0 }) }),
  ];
  for (const shape of shapes) {
    for (const insight of fire(shape)) {
      assert.ok(Number.isFinite(insight.impactCents), `${insight.id} produced a non-figure`);
    }
  }
});

test("every headline stays inside eight words and every card explains itself", () => {
  const shapes = [
    facts({ current: ladder({ trueProfit: -100_00 }) }),
    facts({
      current: ladder({ grossRevenue: 2_000_00, netRevenue: 2_000_00, trueProfit: 100_00 }),
      prior: ladder({ trueProfit: 300_00 }),
    }),
    facts({
      leaks: { ...facts().leaks, unpaidOver30Cents: 300_00, unpaidOver30Count: 2, unpaidTotalCents: 500_00 },
    }),
    facts({
      items: [
        { id: "i1", name: "Mug", netRevenueCents: 100_00, contributionProfitCents: -20_00, marginPct: -20, unitsSold: 4 },
      ],
    }),
  ];

  for (const shape of shapes) {
    for (const insight of fire(shape)) {
      assert.ok(
        headlineIsWithinCap(insight.headline),
        `"${insight.headline}" (${insight.id}) is longer than eight words`,
      );
      assert.ok(insight.cause.length > 0, `${insight.id} has no cause line`);
      assert.ok(insight.explain.inputs.length > 0, `${insight.id} shows no working`);
      assert.ok(insight.explain.threshold.length > 0, `${insight.id} does not say what fired`);
      assert.ok(insight.subject.length > 0, `${insight.id} has no subject to dedupe on`);
    }
  }
});

// ── Money ────────────────────────────────────────────────────────────────────

test("running at a loss is critical, urgent, and priced at the loss", () => {
  const f = facts({ current: ladder({ trueProfit: -150_00, contributionProfit: 250_00, periodExpenses: 400_00 }) });
  const card = only(f, "running-at-a-loss");
  assert.equal(card.impactCents, -150_00);
  assert.equal(card.severity, "critical");
  assert.equal(card.urgent, true, "losing money outranks a bigger leak");
});

test("selling more and keeping less is caught and priced at the profit lost", () => {
  const f = facts({
    prior: ladder({ grossRevenue: 1_000_00, netRevenue: 1_000_00, trueProfit: 300_00 }),
    current: ladder({ grossRevenue: 1_400_00, netRevenue: 1_400_00, trueProfit: 180_00 }),
  });
  const card = only(f, "revenue-up-profit-down");
  assert.equal(card.impactCents, -120_00, "the loss is the profit drop, not the revenue gain");
  assert.match(card.cause, /Rs 400\.00/, "and the cause names the sales rise");
  assert.equal(card.severity, "critical");
});

test("selling more and keeping more is not a warning", () => {
  const f = facts({
    prior: ladder({ grossRevenue: 1_000_00, netRevenue: 1_000_00, trueProfit: 200_00 }),
    current: ladder({ grossRevenue: 1_400_00, netRevenue: 1_400_00, trueProfit: 400_00 }),
  });
  assert.ok(!ids(f).includes("revenue-up-profit-down"));
});

test("a slipping margin is priced at what the old rate would have earned", () => {
  // Before: 300 of 1,000 = 30%. Now: 200 of 1,000 = 20%. At 30% today's sales
  // would have kept 300, so the slip cost 100.
  const f = facts({
    prior: ladder({ netRevenue: 1_000_00, trueProfit: 300_00 }),
    current: ladder({ netRevenue: 1_000_00, trueProfit: 200_00 }),
  });
  const card = only(f, "margin-slipping");
  assert.equal(card.impactCents, -100_00);
  assert.match(card.cause, /30\.0%/);
  assert.match(card.cause, /20\.0%/);
});

test("a margin wobble under three points is left alone", () => {
  const f = facts({
    prior: ladder({ netRevenue: 1_000_00, trueProfit: 300_00 }),
    current: ladder({ netRevenue: 1_000_00, trueProfit: 280_00 }), // 30% → 28%
  });
  assert.ok(!ids(f).includes("margin-slipping"), "2 points is noise, not news");
});

test("falling short of break-even is priced at the shortfall", () => {
  const f = facts({
    current: ladder({ netRevenue: 400_00, trueProfit: -50_00, contributionProfit: 250_00, periodExpenses: 300_00 }),
    breakEven: { ...facts().breakEven, breakEvenRevenueCents: 500_00, surplusCents: -100_00, coveredPct: 80 },
  });
  const card = only(f, "below-break-even");
  assert.equal(card.impactCents, -100_00);
  assert.ok(!ids(f).includes("covered-fixed-costs"), "you cannot both clear and miss break-even");
});

test("break-even says nothing at all when it has no answer to give", () => {
  for (const reason of ["no_fixed_costs", "no_sales", "no_margin"] as const) {
    const f = facts({ breakEven: { ...facts().breakEven, reason, surplusCents: null, breakEvenRevenueCents: null } });
    const fired = ids(f);
    assert.ok(!fired.includes("below-break-even"), `${reason} must not produce a shortfall`);
    assert.ok(!fired.includes("covered-fixed-costs"), `${reason} must not produce a win`);
  }
});

// ── Baseline-driven rules ────────────────────────────────────────────────────

test("refunds are judged against this business's own normal, and only the excess is the leak", () => {
  const history = [100_00, 100_00, 100_00, 100_00, 100_00];
  const f = facts({
    leaks: { ...facts().leaks, refundsCents: 500_00, refundRatePct: 50, topRefundItem: { name: "Mug", cents: 300_00 } },
    history: { ...facts().history, refundsCents: history },
    baselines: { refundsCents: computeBaseline(history, { floor: 10_00 }) },
  });

  const card = only(f, "refunds-above-normal");
  assert.equal(card.impactCents, -400_00, "500 refunded against a normal of 100 — the leak is the 400 excess");
  assert.match(card.cause, /normally Rs 100\.00/);
  assert.match(card.cause, /Mug leads them/);
});

test("refunds at a business's normal are not reported as a leak, however big", () => {
  // A clothing shop with a 40% return rate is not leaking. It is a clothing shop.
  const history = [4_000_00, 4_200_00, 3_900_00, 4_100_00, 4_000_00];
  const f = facts({
    leaks: { ...facts().leaks, refundsCents: 4_050_00, refundRatePct: 40 },
    history: { ...facts().history, refundsCents: history },
    baselines: { refundsCents: computeBaseline(history, { floor: 10_00 }) },
  });
  assert.ok(!ids(f).includes("refunds-above-normal"));
});

test("with no history there is no normal, so the refund rule stays quiet", () => {
  const f = facts({
    leaks: { ...facts().leaks, refundsCents: 900_00, refundRatePct: 90 },
    baselines: {},
  });
  assert.ok(
    !ids(f).includes("refunds-above-normal"),
    "silence beats a confident warning built on a normal we do not have",
  );
});

test("discounting falls back to a fixed line for a business with no history yet", () => {
  const f = facts({
    leaks: { ...facts().leaks, discountsCents: 200_00, discountPctOfGross: 20 },
  });
  const card = only(f, "discount-drain");
  assert.equal(card.impactCents, -200_00, "with no normal, the honest figure is the whole discount");
  assert.match(card.explain.threshold, /15% of sales/);
});

test("discounting against a normal reports only the excess, and says so", () => {
  const history = [50_00, 50_00, 50_00, 50_00];
  const f = facts({
    leaks: { ...facts().leaks, discountsCents: 300_00, discountPctOfGross: 30 },
    baselines: { discountsCents: computeBaseline(history, { floor: 5_00 }) },
  });
  const card = only(f, "discount-drain");
  assert.equal(card.impactCents, -250_00);
  assert.match(card.explain.threshold, /your own normal/);
});

test("modest, ordinary discounting is not a card", () => {
  const f = facts({ leaks: { ...facts().leaks, discountsCents: 50_00, discountPctOfGross: 4 } });
  assert.ok(!ids(f).includes("discount-drain"));
});

test("a card never contradicts its own cause line", () => {
  // Unusual-for-you is not enough. A business that has never discounted and
  // then gives away a rounding error is "above normal" by any statistical test,
  // but a card headlined "taking a big bite" whose cause reads "0.1% of your
  // sales" catches the app lying to itself, and that costs every number beside
  // it.
  const f = facts({
    leaks: { ...facts().leaks, discountsCents: 1_00, discountPctOfGross: 0.1 },
    baselines: { discountsCents: computeBaseline([0, 0, 0, 0], { floor: 5 }) },
  });
  assert.ok(!ids(f).includes("discount-drain"));
});

// ── Unpaid, fees, offers ─────────────────────────────────────────────────────

test("old unpaid sales are named, counted and priced", () => {
  const f = facts({
    leaks: { ...facts().leaks, unpaidOver30Cents: 340_00, unpaidOver30Count: 3, unpaidTotalCents: 900_00 },
  });
  const card = only(f, "unpaid-over-30");
  assert.equal(card.impactCents, -340_00);
  assert.match(card.cause, /3 sales/);
});

test("a fee that grew only because sales grew is not creep", () => {
  const f = facts({
    prior: ladder({ grossRevenue: 1_000_00 }),
    current: ladder({ grossRevenue: 2_000_00 }),
    leaks: { ...facts().leaks, topFee: { name: "Card fees", currentCents: 40_00, priorCents: 20_00 } },
  });
  assert.ok(!ids(f).includes("fee-creep"), "doubling sales doubles card fees — that is arithmetic, not a leak");
});

test("a fee that outran sales is creep, priced at the growth", () => {
  const f = facts({
    prior: ladder({ grossRevenue: 1_000_00 }),
    current: ladder({ grossRevenue: 1_050_00 }),
    leaks: { ...facts().leaks, topFee: { name: "Card fees", currentCents: 60_00, priorCents: 20_00 } },
  });
  const card = only(f, "fee-creep");
  assert.equal(card.impactCents, -40_00);
  assert.equal(card.subject, "fee:Card fees", "subject is per-fee so two fees do not collapse together");
});

test("something that loses money on every sale is critical and named", () => {
  const f = facts({
    items: [
      { id: "a", name: "Tote bag", netRevenueCents: 200_00, contributionProfitCents: -80_00, marginPct: -40, unitsSold: 10 },
      { id: "b", name: "Mug", netRevenueCents: 500_00, contributionProfitCents: 300_00, marginPct: 60, unitsSold: 20 },
    ],
  });
  const card = only(f, "offer-losing-money");
  assert.equal(card.impactCents, -80_00);
  assert.match(card.headline, /Tote bag/);
  assert.equal(card.severity, "critical");
});

test("an item nobody sold this period cannot be losing money on every sale", () => {
  const f = facts({
    items: [{ id: "a", name: "Ghost", netRevenueCents: 0, contributionProfitCents: -5_00, marginPct: null, unitsSold: 0 }],
  });
  assert.ok(!ids(f).includes("offer-losing-money"));
});

// ── Ads ──────────────────────────────────────────────────────────────────────

test("ads only get a warning when spend rose above normal AND profit did not follow", () => {
  const history = [100_00, 100_00, 100_00, 100_00];
  const baselines = { adSpendCents: computeBaseline(history, { floor: 10_00 }) };

  const profitFlat = facts({
    ads: { spendCents: 500_00, byPlatform: [{ platform: "Meta Ads", amountCents: 500_00 }], shareOfRevenueBps: 5000 },
    prior: ladder({ trueProfit: 200_00 }),
    current: ladder({ trueProfit: 190_00 }),
    baselines,
  });
  const card = only(profitFlat, "ads-not-paying-off");
  assert.equal(card.impactCents, -400_00, "the excess spend, not the whole budget");
  assert.match(card.cause, /Meta Ads/);

  // Same spend, but profit rose with it — that is advertising working.
  const profitRose = facts({
    ads: { spendCents: 500_00, byPlatform: [{ platform: "Meta Ads", amountCents: 500_00 }], shareOfRevenueBps: 5000 },
    prior: ladder({ trueProfit: 200_00 }),
    current: ladder({ trueProfit: 900_00 }),
    baselines,
  });
  assert.ok(!ids(profitRose).includes("ads-not-paying-off"));
});

test("a business that has never logged ad spend never hears about ads", () => {
  assert.ok(!ids(facts()).includes("ads-not-paying-off"));
});

// ── People ───────────────────────────────────────────────────────────────────

test("the repeat-rate rule needs enough customers to mean anything", () => {
  const thin = facts({ retention: { customersWithPurchase: 8, repeatCustomers: 0, repeatRatePct: 0 } });
  assert.ok(!ids(thin).includes("few-customers-return"), "a repeat rate on eight customers is noise");

  const real = facts({ retention: { customersWithPurchase: 100, repeatCustomers: 5, repeatRatePct: 5 } });
  const card = only(real, "few-customers-return");
  // Rs 1,000 of sales over 100 customers is Rs 10 each. Going from 5 repeat
  // customers to 1-in-5 means 15 more, so the rate is worth Rs 150.
  assert.equal(card.impactCents, 150_00);
  assert.equal(card.page, "people");
});

test("the repeat-rate rule is for shops, not for agencies", () => {
  const retention = { customersWithPurchase: 100, repeatCustomers: 5, repeatRatePct: 5 };
  assert.ok(ids(facts({ retention })).includes("few-customers-return"));
  assert.ok(
    !ids(facts({ retention, businessType: "service" })).includes("few-customers-return"),
    "a consultancy with five clients is not failing at repeat purchase",
  );
});

// ── Wins ─────────────────────────────────────────────────────────────────────

test("growing profit is reported, and a rounding-error rise is not", () => {
  const real = facts({ prior: ladder({ trueProfit: 200_00 }), current: ladder({ trueProfit: 300_00 }) });
  assert.equal(only(real, "profit-growing").impactCents, 100_00);

  const trivial = facts({ prior: ladder({ trueProfit: 200_00 }), current: ladder({ trueProfit: 205_00 }) });
  assert.ok(!ids(trivial).includes("profit-growing"), "a 2.5% rise is not news");
});

test("a best seller is only news when it genuinely carries the period", () => {
  const carried = facts({
    items: [
      { id: "a", name: "Deep tissue", netRevenueCents: 800_00, contributionProfitCents: 500_00, marginPct: 62, unitsSold: 10 },
      { id: "b", name: "Sports", netRevenueCents: 200_00, contributionProfitCents: 100_00, marginPct: 50, unitsSold: 4 },
    ],
  });
  const card = only(carried, "best-offer");
  assert.equal(card.impactCents, 500_00);
  assert.match(card.cause, /83\.3%/);

  const evenSpread = facts({
    items: Array.from({ length: 10 }, (_, i) => ({
      id: `i${i}`,
      name: `Item ${i}`,
      netRevenueCents: 100_00,
      contributionProfitCents: 50_00,
      marginPct: 50,
      unitsSold: 2,
    })),
  });
  assert.ok(!ids(evenSpread).includes("best-offer"), "ten equal sellers have no standout to report");
});

// ── Payment habit gap ────────────────────────────────────────────────────────

const habit = (over: Partial<InsightFacts["paymentHabit"]> = {}) => ({
  customerDaysToPay: 42,
  supplierDaysToPay: 12,
  paidSalesCount: 20,
  paidBillsCount: 8,
  ...over,
});

test("paying out before getting paid is measured, priced, and marked as exposure", () => {
  // Rs 3,000 of sales over 30 days = Rs 100 a day. A 30-day gap ties up
  // roughly Rs 3,000 of working capital at any moment.
  const f = facts({
    current: ladder({ netRevenue: 3_000_00 }),
    periodDays: 30,
    paymentHabit: habit({ customerDaysToPay: 42, supplierDaysToPay: 12 }),
  });
  const card = only(f, "payment-habit-gap");

  assert.equal(card.impactCents, -3_000_00);
  assert.equal(
    card.exposure,
    true,
    "the cash is late, not lost — it must not inflate the leak total",
  );
  assert.equal(
    card.impactSuffix,
    " tied up",
    "and the card itself says which it is, since a red figure otherwise reads as money gone",
  );
  assert.match(card.cause, /42 days/);
  assert.match(card.cause, /12/);
});

test("the gap card is absent from the leaks view and its total", () => {
  // The ladder is scaled up WHOLE — margin held at 20% — so the only leak in
  // play is the unpaid one. Raising net revenue alone would have slipped the
  // margin and added a second card to the total.
  const f = facts({
    current: ladder({
      grossRevenue: 3_000_00,
      netRevenue: 3_000_00,
      contributionProfit: 1_800_00,
      periodExpenses: 1_200_00,
      trueProfit: 600_00,
    }),
    periodDays: 30,
    paymentHabit: habit(),
    leaks: { ...facts().leaks, unpaidOver30Cents: 500_00, unpaidOver30Count: 2, unpaidTotalCents: 500_00 },
  });
  const fired = fire(f);

  assert.ok(fired.some((i) => i.id === "payment-habit-gap"), "it still fires");
  assert.ok(
    !leaksOnly(fired).some((i) => i.id === "payment-habit-gap"),
    "but delayed cash is not a leak",
  );
  assert.equal(totalLeakCents(fired), 500_00, "only the genuinely lost money is counted");
});

test("being paid before you pay out is good news, and this rule stays quiet about it", () => {
  const f = facts({
    current: ladder({ netRevenue: 3_000_00 }),
    periodDays: 30,
    paymentHabit: habit({ customerDaysToPay: 5, supplierDaysToPay: 30 }),
  });
  assert.ok(!ids(f).includes("payment-habit-gap"));
});

test("a gap under a week is noise, not a finding", () => {
  const f = facts({
    current: ladder({ netRevenue: 3_000_00 }),
    periodDays: 30,
    paymentHabit: habit({ customerDaysToPay: 16, supplierDaysToPay: 12 }),
  });
  assert.ok(!ids(f).includes("payment-habit-gap"));
});

test("one habit alone is a fact about the business, not a gap between two", () => {
  const noBills = facts({
    current: ladder({ netRevenue: 3_000_00 }),
    periodDays: 30,
    paymentHabit: habit({ supplierDaysToPay: null, paidBillsCount: 0 }),
  });
  assert.ok(!ids(noBills).includes("payment-habit-gap"));

  const noSales = facts({
    current: ladder({ netRevenue: 3_000_00 }),
    periodDays: 30,
    paymentHabit: habit({ customerDaysToPay: null, paidSalesCount: 0 }),
  });
  assert.ok(!ids(noSales).includes("payment-habit-gap"));
});

test("too few paid transactions to measure a habit means no claim about one", () => {
  const f = facts({
    current: ladder({ netRevenue: 3_000_00 }),
    periodDays: 30,
    paymentHabit: habit({ paidSalesCount: 3, paidBillsCount: 2 }),
  });
  assert.ok(
    !ids(f).includes("payment-habit-gap"),
    "two bills and three sales do not establish how a business pays",
  );
});

test("the card admits that only PAID transactions could be timed", () => {
  const f = facts({
    current: ladder({ netRevenue: 3_000_00 }),
    periodDays: 30,
    paymentHabit: habit({ paidSalesCount: 20, paidBillsCount: 8 }),
  });
  const card = only(f, "payment-habit-gap");

  const measuredOn = card.explain.inputs.find((i) => i.label === "Measured on")!;
  assert.match(
    measuredOn.value,
    /20 paid sales and 8 paid bills/,
    "the slowest payers have no paid date yet, so the customer figure is optimistic and the card says what it rests on",
  );
});

// ── Price staleness vs cost creep ────────────────────────────────────────────

const drift = (over: Partial<InsightFacts["priceDrift"][number]> = {}) => ({
  itemId: "mug",
  itemName: "Ceramic mug",
  sourceId: "manual",
  sourceName: null as string | null,
  costBeforeCents: 400_00,
  costAfterCents: 500_00,
  costRisePct: 25,
  costRoseAt: "2026-03-10T12:00:00.000Z",
  currentPriceCents: 1_000_00,
  priceLastChangedAt: "2025-01-15T12:00:00.000Z",
  daysSincePriceChange: 420,
  unitsSinceRise: 30,
  marginLostCents: 3_000_00,
  ...over,
});

test("a cost rise the price never answered is named, dated and priced", () => {
  const f = facts({ priceDrift: [drift()] });
  const card = only(f, "price-staleness");

  assert.equal(card.impactCents, -3_000_00);
  assert.match(card.headline, /Ceramic mug/);
  assert.match(card.cause, /25%/);
  assert.match(card.cause, /14 months/, "the age reads in the unit a person would use");
  assert.equal(card.page, "offers");
});

test("the card shows the exact arithmetic, including when the price last moved", () => {
  const card = only(facts({ priceDrift: [drift()] }), "price-staleness");
  const input = (label: string) => card.explain.inputs.find((i) => i.label === label)!.value;

  assert.match(input("Used to cost you"), /400/);
  assert.match(input("Now costs you"), /500/);
  assert.match(input("Still sells for"), /1,?000/);
  assert.equal(input("Sold since the rise"), "30");
  assert.match(input("Price last changed"), /2025/);
});

test("a price that has never moved on record says exactly that", () => {
  const card = only(
    facts({ priceDrift: [drift({ priceLastChangedAt: null })] }),
    "price-staleness",
  );
  const value = card.explain.inputs.find((i) => i.label === "Price last changed")!.value;
  assert.equal(value, "not since your records begin", "rather than an invented date or a blank");
});

test("only the worst drift becomes a card — the rest are not a history lesson", () => {
  const f = facts({
    priceDrift: [
      drift({ itemId: "big", itemName: "Web build", marginLostCents: 9_000_00 }),
      drift({ itemId: "small", itemName: "Sticker", marginLostCents: 20_00 }),
    ],
  });
  const fired = fire(f).filter((i) => i.id === "price-staleness");

  assert.equal(fired.length, 1);
  assert.match(fired[0].headline, /Web build/, "the one costing the most money");
});

test("no drift means no card", () => {
  assert.ok(!ids(facts({ priceDrift: [] })).includes("price-staleness"));
});

test("the card names the channel when the item sells in more than one place", () => {
  const named = only(facts({ priceDrift: [drift({ sourceName: "Etsy" })] }), "price-staleness");
  assert.match(named.cause, /on Etsy/);

  const single = only(facts({ priceDrift: [drift({ sourceName: null })] }), "price-staleness");
  assert.ok(!/ on /.test(single.cause), "no channel to name means no clause about one");
});
