/**
 * Integration tests: the insight engine end to end against a REAL Postgres.
 *
 * The pure catalogue is already covered by hand-written fixtures in
 * `lib/domain/src/ruleCatalogue.test.ts`. What this file proves is the half
 * those tests cannot reach: that the facts assembled from the live read-models
 * are the facts the rules expect, that the money on a card ties to the ladder,
 * and that one business's cards never contain another's numbers.
 */
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";
import { assertLocalTestDatabases } from "@/core/db/target";

const TEST_DB_NAME = "profit_loop_test";
const ADMIN_URL = process.env.TEST_ADMIN_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/postgres";
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? `postgres://postgres:postgres@localhost:5432/${TEST_DB_NAME}`;

// Never anything but a Postgres on this machine: these suites create, migrate and wipe.
assertLocalTestDatabases(ADMIN_URL, process.env.DATABASE_URL);

const dbModule = await import("@workspace/db");
const { db, pool } = dbModule;
const { migrate } = await import("drizzle-orm/node-postgres/migrator");
const { ensureBusiness, getManualSource } = await import("./business");
const catalog = await import("./catalog");
const ledger = await import("./ledger");
const read = await import("./read");
const adSpend = await import("./adSpend");
const { computeInsights } = await import("@/app/api/reports/functions");

const MIGRATIONS = path.join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "..", "drizzle", "migrations");

const DAY = (iso: string) => new Date(`${iso}T12:00:00Z`);
const CURRENT = { start: new Date("2026-06-01T00:00:00Z"), end: new Date("2026-06-30T23:59:59Z") };
const PRIOR = { start: new Date("2026-05-01T00:00:00Z"), end: new Date("2026-05-31T23:59:59Z") };
const LABEL = "This month vs last month";

let businessId: string;
let userId: string;
let manualSourceId: string;
let mugId: string;

const run = () => computeInsights(businessId, userId, CURRENT, PRIOR, LABEL);
const idsOf = async () => (await run()).insights.map((i) => i.id);

before(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE ${TEST_DB_NAME}`);
  } catch (err) {
    if ((err as { code?: string }).code !== "42P04") throw err;
  }
  await admin.end();

  await migrate(db, { migrationsFolder: MIGRATIONS });
  await db.execute(
    `TRUNCATE transaction_lines, transactions, cost_components, revenue_item_sources, revenue_items, expense_items, categories, sources, businesses CASCADE`,
  );

  userId = "insights-user";
  const business = await ensureBusiness(userId);
  businessId = business.id;
  manualSourceId = (await getManualSource(businessId))!.id;

  const mug = await catalog.createRevenueItem(businessId, {
    name: "Ceramic mug",
    type: "product",
    pricingModel: "fixed",
    unitPriceCents: 1_000_00,
  });
  mugId = mug.id;
  await catalog.addCostComponent(businessId, mugId, {
    name: "Clay",
    calcType: "fixed_per_unit",
    valueCents: 400_00,
    effectiveFrom: new Date("2026-01-01T00:00:00Z"),
  });
});

after(async () => {
  await pool.end();
});

test("a business with no data at all produces no cards and claims no normals", async () => {
  const report = await run();
  assert.deepEqual(report.insights, [], "nothing recorded means nothing to say — a quiet screen is valid output");
  assert.equal(report.totalLeakCents, 0);
  assert.equal(report.baselinePeriods, 0, "no trading history means no normals, not six empty ones");
  assert.ok(report.generatedAt, "and the feed stamps when it ran");
});

test("cards carry real money that ties to the ladder", async () => {
  // May: one sale. June: two sales and a big standalone expense, so June is a loss.
  await ledger.createTransaction(businessId, {
    direction: "in",
    occurredAt: DAY("2026-05-10"),
    sourceId: manualSourceId,
    lines: [{ revenueItemId: mugId, qty: "2" }],
  });
  await ledger.createTransaction(businessId, {
    direction: "in",
    occurredAt: DAY("2026-06-10"),
    sourceId: manualSourceId,
    lines: [{ revenueItemId: mugId, qty: "3" }],
  });
  await ledger.createTransaction(businessId, {
    direction: "out",
    occurredAt: DAY("2026-06-15"),
    sourceId: manualSourceId,
    lines: [{ label: "Studio rent", qty: "1", unitPriceCents: 4_000_00 }],
  });

  const [report, pnl] = await Promise.all([run(), read.computePnl(businessId, userId, CURRENT)]);

  const loss = report.insights.find((i) => i.id === "running-at-a-loss");
  assert.ok(loss, `expected the loss card — got ${report.insights.map((i) => i.id).join(", ")}`);
  assert.equal(
    loss.impactCents,
    pnl.ladder.trueProfit,
    "the figure on the card IS the ladder's true profit, not a second opinion",
  );
  assert.equal(loss.urgent, true);
  assert.equal(loss.severity, "critical");

  // And the money inside the sentence is the owner's currency, not a hardcoded one.
  assert.match(loss.cause, /Rs /, "money in the copy uses the business's own symbol");
});

test("every card that fires shows its real working", async () => {
  const report = await run();
  assert.ok(report.insights.length > 0);
  for (const card of report.insights) {
    assert.ok(Number.isFinite(card.impactCents), `${card.id} has no money figure`);
    assert.ok(card.explain.inputs.length > 0, `${card.id} shows no inputs`);
    assert.equal(card.explain.comparisonPeriod.length > 0, true);
    // Explain inputs are strings the server formatted — never a raw cents integer
    // leaking into the interface.
    for (const input of card.explain.inputs) {
      assert.equal(typeof input.value, "string", `${card.id} leaked a raw value for ${input.label}`);
    }
  }
});

test("the leak total is the sum of the losing cards, and wins never net it off", async () => {
  const report = await run();
  const expected = report.leaks.reduce((sum, l) => sum + Math.abs(l.impactCents), 0);
  assert.equal(report.totalLeakCents, expected);
  assert.ok(report.leaks.every((l) => l.impactCents < 0), "the leaks view holds losses only");
  assert.ok(
    report.totalLeakCents > 0,
    "this fixture is losing money, so the toggle has a figure to advertise",
  );
});

test("the feed never shows more than five cards", async () => {
  const report = await run();
  assert.ok(report.insights.length <= 5, `got ${report.insights.length}`);
});

test("ad spend logged through its own screen reaches the ad rule's facts", async () => {
  // Six quiet months of small spend establish a normal, then June spikes.
  for (const month of ["2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05"]) {
    await adSpend.logAdSpend(businessId, {
      platform: "Meta Ads",
      spentOn: DAY(`${month}-15`),
      amountCents: 50_00,
    });
  }
  await adSpend.logAdSpend(businessId, {
    platform: "Meta Ads",
    spentOn: DAY("2026-06-05"),
    amountCents: 900_00,
  });

  const report = await run();
  const ads = report.insights.find((i) => i.id === "ads-not-paying-off")
    ?? report.leaks.find((i) => i.id === "ads-not-paying-off");

  assert.ok(ads, "a spend spike with no profit to show for it is exactly what this rule is for");
  assert.match(ads.cause, /Meta Ads/, "and it names the platform the money went to");
  assert.ok(ads.impactCents < 0);
});

test("a rule with no normal to lean on stays silent rather than guessing", async () => {
  // A brand-new business has no history, so nothing baseline-driven may fire.
  const fresh = await ensureBusiness("insights-newcomer");
  const freshSource = (await getManualSource(fresh.id))!.id;
  await ledger.createTransaction(fresh.id, {
    direction: "in",
    occurredAt: DAY("2026-06-10"),
    sourceId: freshSource,
    lines: [{ label: "First sale", qty: "1", unitPriceCents: 500_00 }],
  });
  // A refund big enough that a fixed threshold would certainly have fired.
  await ledger.createTransaction(fresh.id, {
    direction: "out",
    occurredAt: DAY("2026-06-12"),
    sourceId: freshSource,
    lines: [{ label: "Goodwill refund", qty: "1", unitPriceCents: 450_00 }],
  });

  const report = await computeInsights(fresh.id, "insights-newcomer", CURRENT, PRIOR, LABEL);
  const baselineDriven = ["refunds-above-normal", "ads-not-paying-off"];
  for (const id of baselineDriven) {
    assert.ok(
      !report.insights.some((i) => i.id === id),
      `${id} must not fire without a normal to compare against`,
    );
  }
});

test("periods from before the business was trading do not become its normal", async () => {
  // The bug this pins: six empty windows before any data existed were read as
  // "a normal of zero", which made the first refund of a business's life read
  // as "above your normal, normally Rs 0.00", and fired a "discounts are taking
  // a big bite" card over a Rs 80 discount. A window with no activity is a
  // period we know nothing about, not a period where nothing happened.
  const fresh = await ensureBusiness("insights-firstmonth");
  const source = (await getManualSource(fresh.id))!.id;

  await ledger.createTransaction(fresh.id, {
    direction: "in",
    occurredAt: DAY("2026-06-10"),
    sourceId: source,
    lines: [{ label: "First ever sale", qty: "1", unitPriceCents: 1_000_00 }],
  });
  await ledger.createTransaction(fresh.id, {
    direction: "out",
    occurredAt: DAY("2026-06-11"),
    sourceId: source,
    lines: [{ label: "A small discount given", qty: "1", unitPriceCents: 80_00 }],
  });

  const report = await computeInsights(fresh.id, "insights-firstmonth", CURRENT, PRIOR, LABEL);

  assert.equal(report.baselinePeriods, 0, "no trading periods behind it means no normals at all");
  const text = JSON.stringify(report);
  assert.ok(!text.includes("normally Rs 0.00"), "and nothing claims a normal of zero");
});

test("one business's cards never contain another's money", async () => {
  const other = await ensureBusiness("insights-intruder");
  const otherSource = (await getManualSource(other.id))!.id;
  await ledger.createTransaction(other.id, {
    direction: "in",
    occurredAt: DAY("2026-06-10"),
    sourceId: otherSource,
    lines: [{ label: "Their sale", qty: "1", unitPriceCents: 99_999_00 }],
  });

  const mine = await run();
  const theirs = await computeInsights(other.id, "insights-intruder", CURRENT, PRIOR, LABEL);

  // Their very large sale must not appear anywhere in our figures.
  const myText = JSON.stringify(mine);
  assert.ok(!myText.includes("Their sale"), "another business's labels never reach our cards");
  assert.ok(!myText.includes("99,999"), "nor their money");

  // Control: their own feed does see their own business, so the read works.
  const theirPnl = await read.computePnl(other.id, "insights-intruder", CURRENT);
  assert.equal(theirPnl.ladder.grossRevenue, 99_999_00);
  assert.ok(theirs.insights.length >= 0);
});

test("the same facts produce the same feed twice — nothing random reaches a card", async () => {
  const [a, b] = await Promise.all([run(), run()]);
  assert.deepEqual(
    a.insights.map((i) => [i.id, i.impactCents, i.headline, i.cause]),
    b.insights.map((i) => [i.id, i.impactCents, i.headline, i.cause]),
  );
});

// ── PQS ──────────────────────────────────────────────────────────────────────
//
// The scales and the weighting are proven in `lib/domain/src/pqs.test.ts` with
// hand-written fixtures. What these prove is the wiring: that the pillars are
// fed the same numbers the rest of the app shows, and that an absent measure
// stays absent all the way out to the response.

const { computePqsReport } = await import("@/app/api/reports/functions");

test("the score is built from the same ladder every other screen reads", async () => {
  const [pqs, pnl] = await Promise.all([
    computePqsReport(businessId, userId, CURRENT, PRIOR),
    read.computePnl(businessId, userId, CURRENT),
  ]);

  const margin = pqs.pillars.find((p) => p.id === "margin")!;
  assert.equal(
    margin.inputs.find((i) => i.label === "True profit")!.value.replace(/[^\d.-]/g, ""),
    (pnl.ladder.trueProfit / 100).toFixed(2),
    "the figure the score is judged on IS the ladder's, not a second opinion",
  );
  assert.equal(pqs.crisis, pnl.ladder.trueProfit < 0);
  assert.ok(pqs.calculatedAt, "and the drawer can say when it last ran");
});

test("ad efficiency comes back absent, with the other weights renormalised to 100", async () => {
  const pqs = await computePqsReport(businessId, userId, CURRENT, PRIOR);
  const ads = pqs.pillars.find((p) => p.id === "ads")!;

  assert.equal(ads.score, null, "absent, never zero");
  assert.equal(ads.weightPct, 0);
  assert.equal(ads.reason, "not_available_yet");
  assert.equal(pqs.measuresTotal, 4);
  assert.ok(pqs.measuresUsed < 4, "so the page says 'based on N of 4 measures'");

  const scored = pqs.pillars.filter((p) => p.score !== null);
  if (scored.length > 0) {
    assert.equal(
      scored.reduce((sum, p) => sum + p.weightPct, 0),
      100,
      "the measures that DID run carry the whole score between them",
    );
  }
});

test("every pillar can be re-derived by hand from what it reports", async () => {
  const pqs = await computePqsReport(businessId, userId, CURRENT, PRIOR);
  for (const p of pqs.pillars) {
    assert.ok(p.range.length > 0, `${p.id} does not state its scale`);
    assert.ok(p.href.length > 0, `${p.id} has nowhere to route — the bar would be decoration`);
    if (p.score !== null) {
      assert.ok(p.score >= 0 && p.score <= 100);
      assert.ok(p.inputs.length > 0, `${p.id} shows no working`);
      for (const i of p.inputs) assert.equal(typeof i.value, "string");
    }
  }
  assert.ok(pqs.verdict.length > 0);
  assert.ok(!pqs.verdict.includes("?"), "a verdict is never a question");
});

test("a business too new to judge gets no score and a date to come back on", async () => {
  const fresh = await ensureBusiness("pqs-newcomer");
  const source = (await getManualSource(fresh.id))!.id;
  // A sale two days before the period ends — days of activity is well under 14.
  await ledger.createTransaction(fresh.id, {
    direction: "in",
    occurredAt: DAY("2026-06-28"),
    sourceId: source,
    lines: [{ label: "First sale", qty: "1", unitPriceCents: 500_00 }],
  });

  const pqs = await computePqsReport(fresh.id, "pqs-newcomer", CURRENT, PRIOR);
  assert.equal(pqs.state, "too_new");
  assert.equal(pqs.score, null, "never a 0 and never a spinner");
  assert.ok(pqs.daysOfActivity < 14);
  assert.match(pqs.verdict, /more day/, "and it says when the score starts meaning something");
});

test("a business with nothing recorded is told to start, not scored", async () => {
  const empty = await ensureBusiness("pqs-empty");
  const pqs = await computePqsReport(empty.id, "pqs-empty", CURRENT, PRIOR);
  assert.equal(pqs.state, "no_activity");
  assert.equal(pqs.score, null);
  assert.match(pqs.verdict, /first sale/i);
});

test("one business's score never sees another's money", async () => {
  const [mine, theirs] = await Promise.all([
    computePqsReport(businessId, userId, CURRENT, PRIOR),
    computePqsReport("pqs-empty-nonexistent-id", "pqs-empty", CURRENT, PRIOR).catch(() => null),
  ]);
  assert.ok(mine.pillars.length === 4);
  // The intruder business created above has no data of its own.
  const other = await ensureBusiness("insights-intruder");
  const otherPqs = await computePqsReport(other.id, "insights-intruder", CURRENT, PRIOR);
  const mineText = JSON.stringify(mine);
  assert.ok(!mineText.includes("Their sale"), "another business's labels never reach our pillars");
  assert.notEqual(otherPqs.score, mine.score, "and their score is their own");
  void theirs;
});

// ── The money waterfall ──────────────────────────────────────────────────────

const { computeWaterfallReport } = await import("@/app/api/reports/functions");

test("the waterfall's bars land exactly on the ladder's true profit", async () => {
  const [w, pnl] = await Promise.all([
    computeWaterfallReport(businessId, userId, CURRENT, PRIOR),
    read.computePnl(businessId, userId, CURRENT),
  ]);

  assert.equal(w.reconciles, true);
  assert.equal(w.startCents, pnl.ladder.grossRevenue, "it starts where the ladder starts");
  assert.equal(w.endCents, pnl.ladder.trueProfit, "and ends where the ladder ends");

  // Stated independently of the flag, so a broken flag cannot hide a broken chart.
  const deductions = w.steps
    .filter((s) => s.kind === "deduction")
    .reduce((sum, s) => sum + s.amountCents, 0);
  assert.equal(
    w.startCents - deductions,
    w.endCents,
    "every bar drawn adds up to the number printed beside them",
  );
});

test("the named splits are reconciled against their totals, so nothing is quietly dropped", async () => {
  const [w, pnl] = await Promise.all([
    computeWaterfallReport(businessId, userId, CURRENT, PRIOR),
    read.computePnl(businessId, userId, CURRENT),
  ]);

  const sumOf = (prefix: string) =>
    w.steps.filter((s) => s.id.startsWith(prefix)).reduce((sum, s) => sum + s.amountCents, 0);

  const directCosts = pnl.ladder.netRevenue - pnl.ladder.contributionProfit;
  assert.equal(sumOf("cost:"), directCosts, "the cost bars account for ALL direct costs");
  assert.equal(sumOf("expense:"), pnl.ladder.periodExpenses, "and the expense bars for all running costs");
});

test("the tiles agree with the ladder, on both bases", async () => {
  const [w, accrual, cash] = await Promise.all([
    computeWaterfallReport(businessId, userId, CURRENT, PRIOR),
    read.computePnl(businessId, userId, CURRENT),
    read.computePnl(businessId, userId, CURRENT, "cash"),
  ]);

  assert.equal(w.tiles.revenueCents, accrual.ladder.netRevenue);
  assert.equal(w.tiles.trueProfitCents, accrual.ladder.trueProfit);
  assert.equal(
    w.tiles.cashMovedCents,
    cash.ladder.trueProfit,
    "cash that MOVED is the cash-basis ladder — never a bank balance we do not hold",
  );
});

test("revenue with nothing costed against it is flagged rather than drawn as a triumph", async () => {
  const uncosted = await ensureBusiness("waterfall-uncosted");
  const source = (await getManualSource(uncosted.id))!.id;
  await ledger.createTransaction(uncosted.id, {
    direction: "in",
    occurredAt: DAY("2026-06-12"),
    sourceId: source,
    lines: [{ label: "A sale with no costs behind it", qty: "1", unitPriceCents: 5_000_00 }],
  });

  const w = await computeWaterfallReport(uncosted.id, "waterfall-uncosted", CURRENT, PRIOR);
  assert.equal(w.missingCosts, true);
  assert.equal(w.startCents, w.endCents, "every rupee in shows as kept, which is why it must be said out loud");
  assert.equal(w.reconciles, true);
});

test("an empty period offers an instruction rather than an empty chart", async () => {
  const empty = await ensureBusiness("waterfall-empty");
  const w = await computeWaterfallReport(empty.id, "waterfall-empty", CURRENT, PRIOR);
  assert.equal(w.startCents, 0);
  assert.equal(w.missingCosts, false, "nothing sold means nothing uncosted");
  assert.match(w.verdict, /No money came in/);
});

// ── Offers ───────────────────────────────────────────────────────────────────

const { computeOffersReport } = await import("@/app/api/reports/functions");

test("offers are ranked by what you KEEP, not by what they sell for", async () => {
  const cheap = await catalog.createRevenueItem(businessId, {
    name: "Cheap tote",
    type: "product",
    pricingModel: "fixed",
    unitPriceCents: 500_00,
  });
  await catalog.addCostComponent(businessId, cheap.id, {
    name: "Cotton",
    calcType: "fixed_per_unit",
    valueCents: 470_00,
    effectiveFrom: new Date("2026-01-01T00:00:00Z"),
  });
  // Sells far more money than the mug, keeps almost none of it.
  await ledger.createTransaction(businessId, {
    direction: "in",
    occurredAt: DAY("2026-06-20"),
    sourceId: manualSourceId,
    lines: [{ revenueItemId: cheap.id, qty: "20" }],
  });

  const report = await computeOffersReport(businessId, userId, CURRENT);

  const cheapRow = report.offers.find((o) => o.name === "Cheap tote")!;
  const mugRow = report.offers.find((o) => o.name === "Ceramic mug")!;
  assert.ok(
    cheapRow.netRevenueCents > mugRow.netRevenueCents,
    "the tote genuinely brings in more money",
  );
  assert.ok(
    report.offers.indexOf(mugRow) < report.offers.indexOf(cheapRow),
    "and still ranks BELOW the mug, because the ranking is by profit",
  );
});

test("the flip is surfaced when the best seller is not the best earner", async () => {
  const report = await computeOffersReport(businessId, userId, CURRENT);
  assert.ok(report.flip, "this fixture was built to produce one");
  assert.equal(report.flip.revenueLeader.name, "Cheap tote");
  assert.equal(report.flip.profitLeader.name, "Ceramic mug");
  assert.match(report.verdict, /Cheap tote brings in the most money/);
  assert.match(report.verdict, /Ceramic mug earns you the most/);
});

test("the quadrant splits on this business's own median and files the trap correctly", async () => {
  const report = await computeOffersReport(businessId, userId, CURRENT);
  assert.equal(report.quadrant.missingCosts, false, "both items have costs");

  const tote = report.quadrant.dots.find((d) => d.name === "Cheap tote");
  assert.ok(tote, "a thing that sold is on the map");
  assert.ok(
    tote.marginPct < report.quadrant.marginMidpoint || tote.quadrant === "traps" || tote.quadrant === "dead-weight",
    "high volume and a 6% margin is not a winner",
  );

  for (const dot of report.quadrant.dots) {
    assert.ok(dot.unitsSold > 0, "nothing unsold is plotted");
    assert.ok(dot.revenueCents > 0, "money is the X axis");
    assert.ok(Number.isFinite(dot.marginPct));
  }
});

test("the biggest earner is never filed as dead weight", async () => {
  // The contradiction this page must never show: a podium naming an offer the
  // best thing you sell, directly above a map calling it a candidate to drop.
  const report = await computeOffersReport(businessId, userId, CURRENT);
  const top = report.podium.entries[0];
  if (!top) return;

  const dot = report.quadrant.dots.find((d) => d.id === top.id);
  if (dot) {
    assert.notEqual(
      dot.quadrant,
      "dead-weight",
      `${top.name} earns the most and cannot also be dead weight`,
    );
  }
});

test("uncosted offers are counted and named rather than plotted at a fake 100%", async () => {
  const report = await computeOffersReport(businessId, userId, CURRENT);
  assert.equal(report.quadrant.uncostedCount, report.quadrant.uncostedNames.length);
  for (const name of report.quadrant.uncostedNames) {
    assert.ok(
      !report.quadrant.dots.some((d) => d.name === name),
      `${name} has no costs, so it must not sit on the map at a flawless margin`,
    );
  }
});

test("an offer nobody bought is listed but never plotted", async () => {
  await catalog.createRevenueItem(businessId, {
    name: "Never sold thing",
    type: "product",
    pricingModel: "fixed",
    unitPriceCents: 100_00,
  });

  const report = await computeOffersReport(businessId, userId, CURRENT);
  assert.ok(report.offers.some((o) => o.name === "Never sold thing"), "it is in the table");
  assert.ok(
    !report.quadrant.dots.some((d) => d.name === "Never sold thing"),
    "but plotting it at the origin would file it under Dead weight on no evidence",
  );
});

test("a business with nothing costed is told to add costs rather than shown a map of winners", async () => {
  const uncosted = await ensureBusiness("offers-uncosted");
  const source = (await getManualSource(uncosted.id))!.id;
  for (const name of ["A", "B", "C"]) {
    const item = await catalog.createRevenueItem(uncosted.id, {
      name,
      type: "product",
      pricingModel: "fixed",
      unitPriceCents: 100_00,
    });
    await ledger.createTransaction(uncosted.id, {
      direction: "in",
      occurredAt: DAY("2026-06-10"),
      sourceId: source,
      lines: [{ revenueItemId: item.id, qty: "2" }],
    });
  }

  const report = await computeOffersReport(uncosted.id, "offers-uncosted", CURRENT);
  assert.equal(report.quadrant.missingCosts, true, "every margin is 100%, so the axis says nothing");
  assert.equal(report.quadrant.show, false);
});

test("a business with nothing to sell gets an instruction, not an empty ranking", async () => {
  const empty = await ensureBusiness("offers-empty");
  const report = await computeOffersReport(empty.id, "offers-empty", CURRENT);
  assert.deepEqual(report.offers, []);
  assert.equal(report.podium.show, false);
  assert.match(report.verdict, /Nothing sold in this period/);
});

// ── People ───────────────────────────────────────────────────────────────────

const { computePeopleReport } = await import("@/app/api/reports/functions");
const { findOrCreatePerson } = await import("./person");

test("the concentration bar's shares add to 100 and are built from the SAME ladder", async () => {
  const acme = await findOrCreatePerson(businessId, { name: "Acme Corp", kind: "customer" });
  const belmont = await findOrCreatePerson(businessId, { name: "Belmont Ltd", kind: "customer" });

  await ledger.createTransaction(businessId, {
    direction: "in",
    occurredAt: DAY("2026-06-14"),
    sourceId: manualSourceId,
    personId: acme.id,
    lines: [{ revenueItemId: mugId, qty: "10" }],
  });
  await ledger.createTransaction(businessId, {
    direction: "in",
    occurredAt: DAY("2026-06-16"),
    sourceId: manualSourceId,
    personId: belmont.id,
    lines: [{ revenueItemId: mugId, qty: "3" }],
  });

  const report = await computePeopleReport(businessId, userId, CURRENT);

  const total = report.concentration.segments.reduce((sum, s) => sum + s.sharePct, 0);
  assert.ok(Math.abs(total - 100) < 0.01, `shares summed to ${total}`);
  assert.equal(report.concentration.topName, "Acme Corp", "largest first");

  // The customer's revenue is the ladder's netRevenue for their transactions —
  // not a second definition living inside this page.
  const acmeRow = report.customers.find((c) => c.name === "Acme Corp")!;
  assert.equal(acmeRow.netRevenueCents, 10 * 1_000_00);
});

test("sales with nobody attached are named, never folded into 'everyone else'", async () => {
  const report = await computePeopleReport(businessId, userId, CURRENT);
  // The fixture has plenty of customer-less sales from earlier tests.
  assert.ok(report.concentration.unattributedCents > 0);
  const pool = report.concentration.segments.find((s) => s.name === "no customer recorded");
  assert.ok(pool, "walk-in revenue is real money that cannot concentrate on anybody");
  assert.equal(pool.netRevenueCents, report.concentration.unattributedCents);
});

test("losing the top customer is priced off CONTRIBUTION, against the real ladder", async () => {
  const [report, pnl] = await Promise.all([
    computePeopleReport(businessId, userId, CURRENT),
    read.computePnl(businessId, userId, CURRENT),
  ]);

  const top = report.customers[0];
  if (!top) return;
  assert.equal(
    report.concentration.profitWithoutTopCents,
    pnl.ladder.trueProfit - top.contributionProfitCents,
    "the rent and payroll stay exactly where they are when a customer leaves",
  );
  assert.equal(
    report.concentration.losingThemMeansLoss,
    pnl.ladder.trueProfit >= 0 && report.concentration.profitWithoutTopCents! < 0,
  );
});

test("a repeat rate is withheld until there are enough customers for it to mean anything", async () => {
  const report = await computePeopleReport(businessId, userId, CURRENT);
  if (report.tiles.customerCount < 20) {
    assert.equal(
      report.tiles.repeatRatePct,
      null,
      "a rate on a handful of customers moves violently on one person's behaviour",
    );
  } else {
    assert.ok(report.tiles.repeatRatePct !== null);
  }
});

test("gone-quiet is a list of NAMES with a value, and never includes a one-time buyer", async () => {
  const report = await computePeopleReport(businessId, userId, CURRENT);

  assert.equal(report.tiles.goneQuietCount, report.goneQuiet.length);
  assert.equal(
    report.tiles.goneQuietValueCents,
    report.goneQuiet.reduce((sum, q) => sum + Math.max(0, q.worthPerYearCents), 0),
  );

  for (const q of report.goneQuiet) {
    assert.ok(q.name.length > 0, "a percentage is not actionable; a name is");
    assert.ok(q.usualGapDays >= 1);
    assert.ok(
      q.daysSince > q.usualGapDays * 2,
      `${q.name} is only ${q.daysSince} days quiet against a ${q.usualGapDays}-day rhythm`,
    );
  }
});

test("a business with no customers at all gets an instruction, not an empty bar", async () => {
  const empty = await ensureBusiness("people-empty");
  const report = await computePeopleReport(empty.id, "people-empty", CURRENT);

  assert.deepEqual(report.concentration.segments, []);
  assert.equal(report.concentration.topSharePct, null);
  assert.equal(report.tiles.revenuePerCustomerCents, null, "no average, rather than a proud zero");
  assert.match(report.verdict, /No sales are recorded against a customer/);
});

test("a freelancer with one client is given the advice, not a useless 100%", async () => {
  const solo = await ensureBusiness("people-solo");
  const source = (await getManualSource(solo.id))!.id;
  const onlyClient = await findOrCreatePerson(solo.id, { name: "Only Client", kind: "customer" });
  await ledger.createTransaction(solo.id, {
    direction: "in",
    occurredAt: DAY("2026-06-10"),
    sourceId: source,
    personId: onlyClient.id,
    lines: [{ label: "Retainer", qty: "1", unitPriceCents: 5_000_00 }],
  });

  const report = await computePeopleReport(solo.id, "people-solo", CURRENT);
  assert.equal(report.concentration.risk, "sole");
  assert.match(report.verdict, /All your revenue comes from Only Client/);
  assert.match(report.verdict, /Adding a second customer/);
});

test("one business's customers never appear in another's bar", async () => {
  const mine = await computePeopleReport(businessId, userId, CURRENT);
  const solo = await computePeopleReport(
    (await ensureBusiness("people-solo")).id,
    "people-solo",
    CURRENT,
  );

  assert.ok(!JSON.stringify(solo).includes("Acme Corp"));
  assert.ok(!JSON.stringify(mine).includes("Only Client"));
});

// ── Marketing ────────────────────────────────────────────────────────────────

const { computeMarketingReport } = await import("@/app/api/reports/functions");

test("break-even ROAS is derived from the SAME ladder margin every screen shows", async () => {
  const [m, pnl] = await Promise.all([
    computeMarketingReport(businessId, userId, CURRENT, PRIOR),
    read.computePnl(businessId, userId, CURRENT),
  ]);

  const marginPct = (pnl.ladder.contributionProfit / pnl.ladder.netRevenue) * 100;
  assert.ok(Math.abs(m.contributionMarginPct! - marginPct) < 0.0001, "one margin, not two");
  assert.ok(
    Math.abs(m.breakEvenRoas! - 100 / marginPct) < 0.0001,
    "the multiple is 1 ÷ the margin rate and nothing else",
  );
  assert.equal(m.contributionProfitCents, pnl.ladder.contributionProfit);
});

test("profit before ads is true profit with the spend added back, never recomputed", async () => {
  const [m, pnl] = await Promise.all([
    computeMarketingReport(businessId, userId, CURRENT, PRIOR),
    read.computePnl(businessId, userId, CURRENT),
  ]);

  assert.equal(m.profitAfterAdsCents, pnl.ladder.trueProfit, "true profit already has ads out of it");
  assert.equal(m.profitBeforeAdsCents, pnl.ladder.trueProfit + m.adSpendCents);
});

test("ad spend on the page is the same spend the ad screen logged", async () => {
  const [m, entries] = await Promise.all([
    computeMarketingReport(businessId, userId, CURRENT, PRIOR),
    adSpend.listAdSpend(businessId, { startDate: CURRENT.start, endDate: CURRENT.end }),
  ]);

  assert.equal(m.adSpendCents, entries.reduce((sum, e) => sum + e.amountCents, 0));
  assert.equal(
    m.byPlatform.reduce((sum, p) => sum + p.amountCents, 0),
    m.adSpendCents,
    "the platform split accounts for every rupee",
  );
  assert.ok(m.byPlatform.some((p) => p.platform === "Meta Ads"));
});

test("the caveat travels with the data so the page cannot forget it", async () => {
  const m = await computeMarketingReport(businessId, userId, CURRENT, PRIOR);
  assert.match(m.blendedCaveat, /which sales came from which advert/);
  assert.ok(!m.verdict.includes("?"), "a verdict is never a question");
});

test("no attributed-ROAS field exists to be mistaken for a real one", async () => {
  const m = await computeMarketingReport(businessId, userId, CURRENT, PRIOR);
  const keys = Object.keys(m);
  // Everything ratio-shaped is explicitly named blended or break-even. A field
  // called `roas` or `trueRoas` would read as attributed and there is no
  // attribution, so none exists.
  assert.ok(!keys.includes("roas"));
  assert.ok(!keys.includes("trueRoas"));
  assert.ok(keys.includes("blendedRoas") && keys.includes("breakEvenRoas"));
});

test("a business that never advertised is told there is nothing to judge", async () => {
  const quiet = await ensureBusiness("marketing-noads");
  const source = (await getManualSource(quiet.id))!.id;
  await ledger.createTransaction(quiet.id, {
    direction: "in",
    occurredAt: DAY("2026-06-10"),
    sourceId: source,
    lines: [{ label: "A sale", qty: "1", unitPriceCents: 1_000_00 }],
  });

  const m = await computeMarketingReport(quiet.id, "marketing-noads", CURRENT, PRIOR);
  assert.equal(m.state, "no_spend");
  assert.equal(m.adSpendCents, 0);
  assert.equal(m.blendedRoas, null, "no spend means no ratio, not a zero");
  assert.equal(m.definitelyLostMoney, false);
  assert.match(m.verdict, /have not logged any ad spend/);

  // The break-even multiple still stands: it is a fact about the margin, worth
  // knowing BEFORE spending anything.
  assert.ok(m.breakEvenRoas !== null);
});

test("new customers are counted from first-ever purchase, needing no attribution", async () => {
  const m = await computeMarketingReport(businessId, userId, CURRENT, PRIOR);
  assert.ok(m.newCustomerCount >= 0);
  if (m.newCustomerCount > 0 && m.adSpendCents > 0) {
    assert.equal(m.costPerNewCustomerCents, Math.round(m.adSpendCents / m.newCustomerCount));
  } else {
    assert.ok(m.costPerNewCustomerCents === null || m.costPerNewCustomerCents >= 0);
  }
});

test("one business's ad spend never reaches another's page", async () => {
  const mine = await computeMarketingReport(businessId, userId, CURRENT, PRIOR);
  const other = await computeMarketingReport(
    (await ensureBusiness("marketing-noads")).id,
    "marketing-noads",
    CURRENT,
    PRIOR,
  );
  assert.ok(mine.adSpendCents > 0);
  assert.equal(other.adSpendCents, 0);
  assert.deepEqual(other.byPlatform, []);
});

// ── Payment habit gap ────────────────────────────────────────────────────────

test("the payment gap is measured from real dates, and stays out of the leak total", async () => {
  const habits = await ensureBusiness("habits-user");
  const source = (await getManualSource(habits.id))!.id;
  const item = await catalog.createRevenueItem(habits.id, {
    name: "Consulting day",
    type: "service",
    pricingModel: "fixed",
    unitPriceCents: 1_000_00,
  });
  await catalog.addCostComponent(habits.id, item.id, {
    name: "Contractor",
    calcType: "fixed_per_unit",
    valueCents: 400_00,
    effectiveFrom: new Date("2026-01-01T00:00:00Z"),
  });

  // Six sales, each paid 40 days after the work. Six bills, each paid in 10.
  for (let i = 0; i < 6; i++) {
    const day = 2 + i;
    await ledger.createTransaction(habits.id, {
      direction: "in",
      occurredAt: DAY(`2026-06-0${day}`),
      paidAt: new Date(DAY(`2026-06-0${day}`).getTime() + 40 * 24 * 60 * 60 * 1000),
      sourceId: source,
      lines: [{ revenueItemId: item.id, qty: "1" }],
    });
    await ledger.createTransaction(habits.id, {
      direction: "out",
      occurredAt: DAY(`2026-06-0${day}`),
      paidAt: new Date(DAY(`2026-06-0${day}`).getTime() + 10 * 24 * 60 * 60 * 1000),
      sourceId: source,
      lines: [{ label: "Supplier bill", qty: "1", unitPriceCents: 100_00 }],
    });
  }

  const report = await computeInsights(habits.id, "habits-user", CURRENT, PRIOR, LABEL);
  const gap =
    report.insights.find((i) => i.id === "payment-habit-gap") ??
    report.leaks.find((i) => i.id === "payment-habit-gap");

  assert.ok(gap, `expected the gap card — got ${report.insights.map((i) => i.id).join(", ")}`);
  assert.match(gap.cause, /40 days/, "customers take 40 days");
  assert.match(gap.cause, /10/, "and the business pays in 10");
  assert.equal(gap.exposure, true);

  // The whole point of the exposure flag.
  assert.ok(
    !report.leaks.some((i) => i.id === "payment-habit-gap"),
    "cash that is merely late is not leaking",
  );

  const measuredOn = gap.explain.inputs.find((i) => i.label === "Measured on")!;
  assert.match(measuredOn.value, /6 paid sales and 6 paid bills/);
});

test("unpaid transactions cannot be timed, so they never sway the habit", async () => {
  const quiet = await ensureBusiness("habits-unpaid");
  const source = (await getManualSource(quiet.id))!.id;

  // Everything invoiced, nothing settled — there is no habit to measure.
  for (let i = 0; i < 6; i++) {
    await ledger.createTransaction(quiet.id, {
      direction: "in",
      occurredAt: DAY(`2026-06-0${2 + i}`),
      paidAt: null,
      sourceId: source,
      lines: [{ label: "Invoice", qty: "1", unitPriceCents: 500_00 }],
    });
  }

  const report = await computeInsights(quiet.id, "habits-unpaid", CURRENT, PRIOR, LABEL);
  assert.ok(
    !report.insights.some((i) => i.id === "payment-habit-gap"),
    "no paid bills at all means no supplier habit, so no gap can be claimed",
  );
});

// ── Price staleness vs cost creep ────────────────────────────────────────────

test("a cost rise the price never answered is read off the FROZEN ledger", async () => {
  const drifting = await ensureBusiness("drift-user");
  const source = (await getManualSource(drifting.id))!.id;

  const bowl = await catalog.createRevenueItem(drifting.id, {
    name: "Ceramic bowl",
    type: "product",
    pricingModel: "fixed",
    unitPriceCents: 1_000_00,
  });
  await catalog.addCostComponent(drifting.id, bowl.id, {
    name: "Clay",
    calcType: "fixed_per_unit",
    valueCents: 400_00,
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  });

  // Two sales at the old cost.
  for (const day of ["2026-01-10", "2026-02-10"]) {
    await ledger.createTransaction(drifting.id, {
      direction: "in",
      occurredAt: DAY(day),
      sourceId: source,
      lines: [{ revenueItemId: bowl.id, qty: "2" }],
    });
  }

  // The clay gets dearer from March. Effective-dated, so old snapshots stay frozen.
  const components = await catalog.listCostComponents(bowl.id);
  const clay = components.find((c) => c.name === "Clay" && c.effectiveTo === null)!;
  await catalog.updateCostComponent(drifting.id, clay.id, {
    valueCents: 520_00,
    effectiveFrom: new Date("2026-03-01T00:00:00Z"),
  });

  // More sales at the higher cost — and the price never moves.
  for (const day of ["2026-03-10", "2026-06-10"]) {
    await ledger.createTransaction(drifting.id, {
      direction: "in",
      occurredAt: DAY(day),
      sourceId: source,
      lines: [{ revenueItemId: bowl.id, qty: "5" }],
    });
  }

  const report = await computeInsights(drifting.id, "drift-user", CURRENT, PRIOR, LABEL);
  const card =
    report.insights.find((i) => i.id === "price-staleness") ??
    report.leaks.find((i) => i.id === "price-staleness");

  assert.ok(card, `expected the staleness card — got ${report.insights.map((i) => i.id).join(", ")}`);
  assert.match(card.headline, /Ceramic bowl/);
  assert.match(card.cause, /30%/, "400 → 520 is a 30% rise");

  const input = (label: string) => card.explain.inputs.find((i) => i.label === label)!.value;
  assert.match(input("Used to cost you"), /400/, "the OLD snapshot, still frozen on the old lines");
  assert.match(input("Now costs you"), /520/);
  assert.match(input("Still sells for"), /1,?000/);
  assert.equal(input("Sold since the rise"), "10", "five in March plus five in June");

  // Rs 120 more per unit across 10 units.
  assert.equal(card.impactCents, -120_00 * 10);
});

test("editing a cost today cannot rewrite what the card says about last year", async () => {
  // The whole point of frozen snapshots. The card's "used to cost you" figure
  // comes off lines written before the change and must be immune to it.
  const drifting = await ensureBusiness("drift-user");
  const before = await computeInsights(drifting.id, "drift-user", CURRENT, PRIOR, LABEL);
  const cardBefore = [...before.insights, ...before.leaks].find((i) => i.id === "price-staleness")!;

  const stats = await read.listRevenueItemsWithStats(drifting.id, "drift-user", CURRENT, "active");
  const bowl = stats.items.find((i) => i.name === "Ceramic bowl")!;
  const components = await catalog.listCostComponents(bowl.id);
  const clay = components.find((c) => c.name === "Clay" && c.effectiveTo === null)!;
  await catalog.updateCostComponent(drifting.id, clay.id, {
    valueCents: 900_00,
    effectiveFrom: new Date("2026-08-01T00:00:00Z"),
  });

  const after = await computeInsights(drifting.id, "drift-user", CURRENT, PRIOR, LABEL);
  const cardAfter = [...after.insights, ...after.leaks].find((i) => i.id === "price-staleness")!;

  const input = (c: typeof cardBefore, label: string) =>
    c.explain.inputs.find((i) => i.label === label)!.value;
  assert.equal(
    input(cardAfter, "Used to cost you"),
    input(cardBefore, "Used to cost you"),
    "history is frozen — today's edit cannot restate what March cost",
  );
  assert.equal(cardAfter.impactCents, cardBefore.impactCents);
});

test("a price that moved WITH the cost produces no card", async () => {
  const answered = await ensureBusiness("drift-answered");
  const source = (await getManualSource(answered.id))!.id;

  const mug = await catalog.createRevenueItem(answered.id, {
    name: "Answered mug",
    type: "product",
    pricingModel: "fixed",
    unitPriceCents: 1_000_00,
  });
  await catalog.addCostComponent(answered.id, mug.id, {
    name: "Clay",
    calcType: "fixed_per_unit",
    valueCents: 400_00,
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  });

  await ledger.createTransaction(answered.id, {
    direction: "in",
    occurredAt: DAY("2026-01-10"),
    sourceId: source,
    lines: [{ revenueItemId: mug.id, qty: "2" }],
  });

  const comps = await catalog.listCostComponents(mug.id);
  await catalog.updateCostComponent(answered.id, comps.find((c) => c.name === "Clay" && c.effectiveTo === null)!.id, {
    valueCents: 520_00,
    effectiveFrom: new Date("2026-03-01T00:00:00Z"),
  });

  // The owner repriced at the same time — an explicit price on the line.
  await ledger.createTransaction(answered.id, {
    direction: "in",
    occurredAt: DAY("2026-03-10"),
    sourceId: source,
    lines: [{ revenueItemId: mug.id, qty: "5", unitPriceCents: 1_200_00 }],
  });

  const report = await computeInsights(answered.id, "drift-answered", CURRENT, PRIOR, LABEL);
  assert.ok(
    ![...report.insights, ...report.leaks].some((i) => i.id === "price-staleness"),
    "the owner already answered the rise",
  );
});
