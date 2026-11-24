import test from "node:test";
import assert from "node:assert/strict";
import {
  CONCENTRATION_WARN_PCT,
  MIN_CUSTOMERS_FOR_REPEAT,
  QUIET_MULTIPLE,
  biggestVsBest,
  buildConcentration,
  customerConcentrationSentence,
  findGoneQuiet,
  repeatRateIsMeaningful,
  revenuePerCustomer,
  type CustomerStat,
} from "./people";

const money = (c: number) =>
  `Rs ${new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(c) / 100)}`;

const NOW = new Date("2026-06-30T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

function customer(over: Partial<CustomerStat> & { id: string; name: string }): CustomerStat {
  const netRevenueCents = over.netRevenueCents ?? 1_000_00;
  return {
    netRevenueCents,
    contributionProfitCents: over.contributionProfitCents ?? Math.round(netRevenueCents * 0.5),
    lifetimeOrderCount: 4,
    firstPurchaseAt: daysAgo(120),
    lastPurchaseAt: daysAgo(10),
    trailingYearContributionCents: over.trailingYearContributionCents ?? 500_00,
    ...over,
  };
}

// ── The bar ──────────────────────────────────────────────────────────────────

test("segments are sorted largest first and their shares add to 100", () => {
  // The brief's own example: Acme 38% · Belmont 19% · Vero 11% · everyone else 32%.
  const c = buildConcentration(
    [
      customer({ id: "b", name: "Belmont", netRevenueCents: 1_900_00 }),
      customer({ id: "a", name: "Acme", netRevenueCents: 3_800_00 }),
      customer({ id: "v", name: "Vero", netRevenueCents: 1_100_00 }),
      ...Array.from({ length: 4 }, (_, i) =>
        customer({ id: `s${i}`, name: `Small ${i}`, netRevenueCents: 800_00 }),
      ),
    ],
    2_000_00,
  );

  assert.deepEqual(
    c.segments.map((s) => s.name),
    ["Acme", "Belmont", "Vero", "everyone else"],
    "three named, the tail pooled — thirty slivers is not a chart",
  );
  const total = c.segments.reduce((sum, s) => sum + s.sharePct, 0);
  assert.ok(Math.abs(total - 100) < 0.001, `shares summed to ${total}`);
  assert.equal(c.topName, "Acme");
  assert.equal(Math.round(c.topSharePct!), 38);
});

test("only the top segment can be flagged, and only past the threshold", () => {
  const risky = buildConcentration(
    [
      customer({ id: "a", name: "Acme", netRevenueCents: 3_800_00 }),
      customer({ id: "b", name: "Belmont", netRevenueCents: 3_400_00 }),
      customer({ id: "c", name: "Vero", netRevenueCents: 2_800_00 }),
    ],
    1_000_00,
  );
  assert.equal(risky.segments[0].atRisk, true);
  assert.ok(!risky.segments.slice(1).some((s) => s.atRisk), "a second big name is not a second warning");
  assert.equal(CONCENTRATION_WARN_PCT, 30);

  const spread = buildConcentration(
    Array.from({ length: 10 }, (_, i) => customer({ id: `c${i}`, name: `C${i}`, netRevenueCents: 100_00 })),
    500_00,
  );
  assert.equal(spread.segments[0].atRisk, false, "10% of revenue is not a risk");
  assert.equal(spread.risk, "none");
});

test("losing them is priced against CONTRIBUTION, because the rent does not leave with them", () => {
  // True profit 500. Acme contributes 800 — lose them and you are 300 down,
  // because the fixed costs stay exactly where they are.
  const c = buildConcentration(
    [
      customer({ id: "a", name: "Acme", netRevenueCents: 4_000_00, contributionProfitCents: 800_00 }),
      customer({ id: "b", name: "Belmont", netRevenueCents: 2_000_00, contributionProfitCents: 400_00 }),
    ],
    500_00,
  );

  assert.equal(c.profitWithoutTopCents, -300_00);
  assert.equal(c.losingThemMeansLoss, true);
  assert.match(customerConcentrationSentence(c, money), /Losing them would take you to a loss/);
});

test("a big customer you could afford to lose is reported without the alarm", () => {
  const c = buildConcentration(
    [
      customer({ id: "a", name: "Acme", netRevenueCents: 4_000_00, contributionProfitCents: 800_00 }),
      customer({ id: "b", name: "Belmont", netRevenueCents: 3_000_00, contributionProfitCents: 600_00 }),
    ],
    5_000_00,
  );

  assert.equal(c.losingThemMeansLoss, false);
  const s = customerConcentrationSentence(c, money);
  assert.match(s, /Acme is 57% of your revenue/);
  assert.match(s, /you would have kept Rs 4,200\.00/, "the honest figure instead of a scare");
});

test("a freelancer with one client gets advice, not a useless 100%", () => {
  const c = buildConcentration([customer({ id: "a", name: "Acme", netRevenueCents: 5_000_00 })], 1_000_00);

  assert.equal(c.risk, "sole");
  assert.equal(Math.round(c.topSharePct!), 100);
  const s = customerConcentrationSentence(c, money);
  assert.match(s, /All your revenue comes from Acme/);
  assert.match(s, /Adding a second customer/);
});

test("a shop with hundreds of small customers reads as mostly 'everyone else', which is correct", () => {
  const many = Array.from({ length: 200 }, (_, i) =>
    customer({ id: `c${i}`, name: `Customer ${i}`, netRevenueCents: 50_00 }),
  );
  const c = buildConcentration(many, 3_000_00);

  const everyoneElse = c.segments.find((s) => s.name === "everyone else")!;
  assert.ok(everyoneElse.sharePct > 90, "no special casing needed — the honest picture is the reassuring one");
  assert.equal(c.risk, "none");
  assert.match(customerConcentrationSentence(c, money), /well spread/);
});

test("revenue with nobody attached is named, never folded into 'everyone else'", () => {
  const c = buildConcentration(
    [customer({ id: "a", name: "Acme", netRevenueCents: 5_000_00 })],
    1_000_00,
    5_000_00,
  );

  const unattributed = c.segments.find((s) => s.name === "no customer recorded");
  assert.ok(unattributed, "walk-in sales are real money that cannot concentrate on anybody");
  assert.equal(unattributed.sharePct, 50);
  assert.equal(
    c.risk,
    "high",
    "and pooling it into 'everyone else' would have overstated how spread the base is",
  );
});

test("no sales against any customer says so plainly", () => {
  const c = buildConcentration([], 0);
  assert.deepEqual(c.segments, []);
  assert.equal(c.topSharePct, null);
  assert.match(customerConcentrationSentence(c, money), /No sales are recorded against a customer/);
});

// ── Gone quiet ───────────────────────────────────────────────────────────────

test("quiet is judged against each customer's OWN rhythm, not a fixed 90 days", () => {
  const quiet = findGoneQuiet(
    [
      // Buys monthly, unseen for 100 days. That is a crisis.
      customer({
        id: "monthly",
        name: "Monthly Mary",
        lifetimeOrderCount: 5,
        firstPurchaseAt: daysAgo(220),
        lastPurchaseAt: daysAgo(100),
        trailingYearContributionCents: 900_00,
      }),
      // Buys roughly twice a year, unseen for 100 days. That is normal.
      customer({
        id: "seasonal",
        name: "Seasonal Sam",
        lifetimeOrderCount: 3,
        firstPurchaseAt: daysAgo(820),
        lastPurchaseAt: daysAgo(100),
        trailingYearContributionCents: 400_00,
      }),
    ],
    NOW,
  );

  assert.deepEqual(quiet.customers.map((c) => c.name), ["Monthly Mary"]);
  assert.equal(quiet.customers[0].usualGapDays, 30);
  assert.equal(quiet.customers[0].daysSince, 100);
  assert.equal(QUIET_MULTIPLE, 2);
});

test("somebody who bought once has no rhythm to break and is counted separately", () => {
  const quiet = findGoneQuiet(
    [
      customer({
        id: "once",
        name: "One-time Olly",
        lifetimeOrderCount: 1,
        firstPurchaseAt: daysAgo(300),
        lastPurchaseAt: daysAgo(300),
      }),
    ],
    NOW,
  );

  assert.deepEqual(quiet.customers, [], "a single purchase is an event, not a habit that stopped");
  assert.equal(quiet.unjudgeableCount, 1);
});

test("the list is a list of names, ranked by what they were worth", () => {
  const quiet = findGoneQuiet(
    [
      customer({
        id: "small",
        name: "Small Sue",
        lifetimeOrderCount: 6,
        firstPurchaseAt: daysAgo(200),
        lastPurchaseAt: daysAgo(150),
        trailingYearContributionCents: 100_00,
      }),
      customer({
        id: "big",
        name: "Big Ben",
        lifetimeOrderCount: 6,
        firstPurchaseAt: daysAgo(200),
        lastPurchaseAt: daysAgo(150),
        trailingYearContributionCents: 2_000_00,
      }),
    ],
    NOW,
  );

  assert.deepEqual(quiet.customers.map((c) => c.name), ["Big Ben", "Small Sue"]);
  assert.equal(quiet.totalAtRiskCents, 2_100_00, "the tile shows what is at stake, not a percentage");
});

test("a customer still buying on schedule is not on the list", () => {
  const quiet = findGoneQuiet(
    [customer({ id: "a", name: "Regular Reg", lifetimeOrderCount: 12, firstPurchaseAt: daysAgo(360), lastPurchaseAt: daysAgo(20) })],
    NOW,
  );
  assert.deepEqual(quiet.customers, []);
});

// ── Thin data and the rest ───────────────────────────────────────────────────

test("a repeat rate on twelve customers is noise and is not shown", () => {
  assert.equal(repeatRateIsMeaningful(12), false);
  assert.equal(repeatRateIsMeaningful(20), true);
  assert.equal(MIN_CUSTOMERS_FOR_REPEAT, 20);
});

test("revenue per customer counts only customers who actually paid", () => {
  const value = revenuePerCustomer([
    customer({ id: "a", name: "A", netRevenueCents: 300_00 }),
    customer({ id: "b", name: "B", netRevenueCents: 100_00 }),
    customer({ id: "c", name: "C", netRevenueCents: 0 }),
  ]);
  assert.equal(value, 200_00, "the non-paying one does not drag the average down");
  assert.equal(revenuePerCustomer([]), null, "and with nobody paying there is no average, not zero");
});

test("the biggest customer is flagged when they are not the most profitable", () => {
  const flip = biggestVsBest([
    customer({ id: "a", name: "Big Cheap", netRevenueCents: 5_000_00, contributionProfitCents: 100_00 }),
    customer({ id: "b", name: "Small Rich", netRevenueCents: 1_000_00, contributionProfitCents: 800_00 }),
  ]);

  assert.ok(flip);
  assert.equal(flip.biggest.name, "Big Cheap");
  assert.equal(flip.best.name, "Small Rich");
});

test("no flip is claimed when the same customer leads both, or when nobody was profitable", () => {
  assert.equal(
    biggestVsBest([
      customer({ id: "a", name: "Star", netRevenueCents: 5_000_00, contributionProfitCents: 3_000_00 }),
      customer({ id: "b", name: "Other", netRevenueCents: 1_000_00, contributionProfitCents: 200_00 }),
    ]),
    null,
  );

  assert.equal(
    biggestVsBest([
      customer({ id: "a", name: "Bad", netRevenueCents: 5_000_00, contributionProfitCents: -500_00 }),
      customer({ id: "b", name: "Worse", netRevenueCents: 1_000_00, contributionProfitCents: -100_00 }),
    ]),
    null,
    "losing least is not being the most profitable",
  );
});
