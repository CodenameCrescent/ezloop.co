/**
 * Deterministic demo seed for the new money core — THE fixture. Every number
 * below is hand-computed; seed.integration.test.ts asserts the seeded ledger
 * reproduces EXPECTED_PNL to the cent, and `pnpm db:seed` prints the same
 * comparison. Everything posts through the domain services (never raw SQL).
 *
 * ── Worked P&L (all amounts integer cents; window = last 90 days) ──────────
 *
 * Sources: Manual · "Fiverr — designwork" (marketplace; 20% source-scoped fee
 * on Logo design) · "Etsy shop" (6.5% source-scoped fee on Ceramic mug,
 * price override 2800).
 *
 * Cost boundary: "Clay + glaze" 800 → 900 per unit, effective day-45
 * (mid-history effective-dated edit through updateCostComponent).
 *
 * REVENUE (completed sales)
 *   8 × Logo design on Fiverr @ 50000            = 400000
 *       snapshot/unit: assets 5000 (cost) + 20% fee 10000 = 15000
 *   6 × Ceramic mug, Manual, qty 2 @ 2500        =  30000
 *       3 before day-45 → cost 1600/sale; 3 after → 1800/sale
 *   4 × Ceramic mug, Etsy, qty 1 @ 2800 override =  11200
 *       cost/unit: clay (800|900) + 6.5%×2800=182 → 982 | 1082
 *   3 × Consulting retainer @ 100000             = 300000   (no components)
 *   1 × Custom web build (variable) @ 300000     = 300000
 *       contractor 30% = 90000 (is_fee=false → kind cost)
 *   Cart order: mug×3 @2500 (7500, cost 2700) + logo (50000, disc 5000,
 *       cost 5000) + "Rush delivery" 2000 → lines 59500, shipping 1500,
 *       order discount 3000, tax 2000 (EXCLUDED)
 *   Pending ×2 and void ×1: EXCLUDED everywhere.
 *
 *   grossRevenue = 400000+30000+11200+300000+300000+59500+1500 = 1102200
 *   discounts    = 5000 (line) + 3000 (order)                  =    8000
 *
 * REFUNDS (occur in period)
 *   R1 mug (after-boundary sale), qty 1, 2500, RESTOCKED → recovers 900
 *   R2 logo on Fiverr, 50000, nothing recovered
 *   CB chargeback on logo, 50000 + 1500 chargeback fee (fee → expenses)
 *   refunds = 2500 + 50000 + 50000                             =  102500
 *
 *   netRevenue = 1102200 − 8000 − 102500                       =  991700
 *
 * DIRECT COSTS (from frozen snapshots; recovered costs subtract)
 *   logos 8×15000 = 120000 · mugs manual 3×1600+3×1800 = 10200
 *   mugs etsy 2×982+2×1082 = 4128 · web build 90000 · cart 2700+5000 = 7700
 *   recovered (R1) −900
 *   directCosts = 120000+10200+4128+90000+7700−900             =  231128
 *
 *   contributionProfit = 991700 − 231128                       =  760572
 *
 * PERIOD EXPENSES
 *   software 3×15000=45000 · rent 3×50000=150000 · ads 12000+18000+25000+
 *   15000=70000 · kiln 20000 · packaging 3×5000=15000 · bank charges 800 ·
 *   chargeback fee 1500
 *   periodExpenses                                             =  302300
 *
 *   trueProfit = 760572 − 302300                               =  458272
 */
import {
  db,
  recurringPostingsTable,
  recurringSchedulesTable,
  revenueItemSourcesTable,
  revenueItemsTable,
  subscriptionEventsTable,
  subscriptionsTable,
  transactionLinesTable,
  transactionsTable,
} from "@workspace/db";
import { computeProfitLadder, type CostSnapshot, type ProfitLadder, type ProfitTransaction } from "@workspace/domain";
import { eq, inArray } from "drizzle-orm";
import { ensureBusiness, getManualSource, wipeBusinessById, wipeBusinessData } from "../services/business";
import * as catalog from "../services/catalog";
import * as ledger from "../services/ledger";
import { createSchedule } from "../services/recurring";
import { createSubscription } from "../services/subscription";
import { findOrCreatePerson } from "../services/person";
import { uid } from "../lib/uid";

/**
 * R4 additions to the base fixture (all in the 90-day window):
 *   + subscription revenue 105_000 (2 Pro 30_000 + Team 45_000 + past_due 10_000
 *     + 2 canceled 20_000; annual + trialing contribute 0 in-window) — subscription
 *     plans have no cost components, so this adds equally to gross/net/contribution/true.
 *   + recurring expenses 256_000 (office rent 90_000 + payroll 150_000 + software 16_000;
 *     the software pending post is excluded).
 * base → grossRevenue 1_102_200 + 105_000; periodExpenses 302_300 + 256_000; etc.
 */
export const EXPECTED_PNL: ProfitLadder = {
  grossRevenue: 1_207_200,
  discounts: 8_000,
  refunds: 102_500,
  netRevenue: 1_096_700,
  directCosts: 231_128,
  contributionProfit: 865_572,
  periodExpenses: 558_300,
  trueProfit: 307_272,
};

/** mulberry32 — the deterministic RNG jittering times-of-day (never dates). */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Seeds the hand-computed fixture.
 *
 * `targetBusinessId` seeds INTO an existing business, emptying it first and
 * keeping its id — which is what the app's own "seed sample data" button means,
 * because the browser is holding that id and a fresh one would strand it. The
 * CLI passes nothing and gets the old behaviour: wipe everything this user owns
 * and start from one business.
 */
export async function runSeed(
  userId: string,
  targetBusinessId?: string,
  /**
   * `alreadyEmptied`: the caller has just emptied the target inside its own
   * locked check (`/api/data/seed` → `prepareBusinessForSeed`). Wiping again
   * here would be a second, UNGUARDED wipe — anything written in between
   * would be deleted — so it is skipped.
   */
  options?: { alreadyEmptied?: boolean },
) {
  const rng = mulberry32(0x100f); // fixed seed — same jitter every run
  const now = new Date();
  /** N days ago at a jittered work-hour (09:00–17:00 UTC) — date math stays on the day. */
  const day = (daysAgo: number) => {
    const date = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
    date.setUTCHours(9 + Math.floor(rng() * 8), Math.floor(rng() * 60), 0, 0);
    return date;
  };

  // ── Wipe the money core (seed is a reset, data is disposable) ────────────
  let businessId: string;
  if (targetBusinessId) {
    if (!options?.alreadyEmptied) await wipeBusinessById(targetBusinessId, { keepBusiness: true });
    businessId = targetBusinessId;
  } else {
    await wipeBusinessData(userId);
    businessId = (await ensureBusiness(userId)).id;
  }

  // ── Sources ───────────────────────────────────────────────────────────────
  const manual = (await getManualSource(businessId))!;
  const fiverr = await catalog.createSource(businessId, {
    name: "Fiverr — designwork",
    kind: "marketplace",
    platformFeePercent: "20",
  });
  const etsy = await catalog.createSource(businessId, { name: "Etsy shop", kind: "ecommerce_store" });

  // ── Categories (grouping only) ────────────────────────────────────────────
  const clientWork = await catalog.createCategory(businessId, { name: "Client work", appliesTo: "revenue" });
  await catalog.createCategory(businessId, { name: "Operations", appliesTo: "expense" });

  // ── Revenue catalog ───────────────────────────────────────────────────────
  const logo = await catalog.createRevenueItem(businessId, {
    name: "Logo design",
    type: "service",
    pricingModel: "fixed",
    unitPriceCents: 50_000,
    categoryId: clientWork.id,
  });
  await catalog.addCostComponent(businessId, logo.id, {
    name: "Stock assets",
    calcType: "fixed_per_unit",
    valueCents: 5_000,
    effectiveFrom: day(400),
  });
  await catalog.addCostComponent(businessId, logo.id, {
    name: "Fiverr platform fee",
    calcType: "percent_of_price",
    valueRate: "20",
    sourceId: fiverr.id, // the marketplace's 20% cut — source-scoped
    effectiveFrom: day(400),
  });

  const mug = await catalog.createRevenueItem(businessId, {
    name: "Ceramic mug",
    type: "product",
    pricingModel: "per_unit",
    unitPriceCents: 2_500,
  });
  const clay = await catalog.addCostComponent(businessId, mug.id, {
    name: "Clay + glaze",
    calcType: "fixed_per_unit",
    valueCents: 800,
    effectiveFrom: day(400),
  });
  // THE mid-history effective-dated change: 800 → 900 at day-45.
  await catalog.updateCostComponent(businessId, clay.id, { valueCents: 900, effectiveFrom: day(45) });
  await catalog.addCostComponent(businessId, mug.id, {
    name: "Etsy fees",
    calcType: "percent_of_price",
    valueRate: "6.5",
    sourceId: etsy.id,
    effectiveFrom: day(400),
  });
  // Sold on two sources; Etsy lists it higher.
  await db.insert(revenueItemSourcesTable).values({
    id: uid("ris"),
    revenueItemId: mug.id,
    sourceId: etsy.id,
    externalId: "etsy-listing-88231",
    priceOverrideCents: 2_800,
  });

  const retainer = await catalog.createRevenueItem(businessId, {
    name: "Consulting retainer",
    type: "subscription",
    pricingModel: "fixed",
    unitPriceCents: 100_000,
    categoryId: clientWork.id,
  });

  const webBuild = await catalog.createRevenueItem(businessId, {
    name: "Custom web build",
    type: "service",
    pricingModel: "variable", // priced per engagement
  });
  await catalog.addCostComponent(businessId, webBuild.id, {
    name: "Contractor help",
    calcType: "percent_of_price",
    valueRate: "30",
    isFee: false, // a percent that is genuinely a COST, not a platform fee
    effectiveFrom: day(400),
  });

  // ── Expense catalog ───────────────────────────────────────────────────────
  const software = await catalog.findOrCreateExpenseItem(businessId, { name: "Software subscriptions", type: "operational", costNature: "fixed", behavior: "recurring", defaultAmountCents: 15_000 });
  const rent = await catalog.findOrCreateExpenseItem(businessId, { name: "Studio rent", type: "operational", costNature: "fixed", behavior: "recurring", defaultAmountCents: 50_000 });
  const ads = await catalog.findOrCreateExpenseItem(businessId, { name: "Ad spend", type: "marketing", behavior: "usage_based" });
  const kiln = await catalog.findOrCreateExpenseItem(businessId, { name: "Kiln maintenance", type: "maintenance", behavior: "one_time", defaultAmountCents: 20_000 });
  const packaging = await catalog.findOrCreateExpenseItem(businessId, { name: "Packaging supplies", type: "cogs", behavior: "usage_based", defaultAmountCents: 5_000 });

  // ── Sales ─────────────────────────────────────────────────────────────────
  const sale = (sourceId: string, daysAgo: number, lines: ledger.CreateTransactionLineInput[], extra?: Partial<ledger.CreateTransactionInput>) =>
    ledger.createTransaction(businessId, {
      direction: "in",
      occurredAt: day(daysAgo),
      sourceId,
      lines,
      ...extra,
    });

  // 8 logo designs on Fiverr (day 85..12). S3 (day 72) gets refunded, S5 (day 50) charged back.
  const logoDays = [85, 80, 72, 58, 50, 38, 22, 12];
  const logoSales = [];
  for (const daysAgo of logoDays) logoSales.push(await sale(fiverr.id, daysAgo, [{ revenueItemId: logo.id }]));

  // 6 manual mug sales, qty 2 — three before the day-45 cost change, three after.
  const mugSales = [];
  for (const daysAgo of [75, 65, 55, 40, 30, 20]) mugSales.push(await sale(manual.id, daysAgo, [{ revenueItemId: mug.id, qty: "2" }]));

  // 4 Etsy mug sales, qty 1 at the 2800 override — two each side of the boundary.
  for (const daysAgo of [70, 60, 35, 25]) await sale(etsy.id, daysAgo, [{ revenueItemId: mug.id }], { externalRef: `etsy-order-${daysAgo}`, origin: "integration" });

  // 3 consulting retainers.
  for (const daysAgo of [60, 30, 2]) await sale(manual.id, daysAgo, [{ revenueItemId: retainer.id }]);

  // 1 variable-priced web build at an explicit 300000.
  await sale(manual.id, 15, [{ revenueItemId: webBuild.id, unitPriceCents: 300_000 }]);

  // THE 3-line cart order: line discount + order discount + shipping + tax (excluded).
  await sale(
    manual.id,
    10,
    [
      { revenueItemId: mug.id, qty: "3" },
      { revenueItemId: logo.id, lineDiscountCents: 5_000 },
      { label: "Rush delivery", unitPriceCents: 2_000 },
    ],
    { orderDiscountCents: 3_000, shippingChargedCents: 1_500, taxCollectedCents: 2_000 },
  );

  // Pending (not money yet — excluded from the ladder).
  await sale(manual.id, 5, [{ revenueItemId: logo.id }], { status: "pending" });
  await sale(manual.id, 3, [{ revenueItemId: mug.id }], { status: "pending" });

  // A mistake, voided (excluded everywhere).
  const oops = await sale(manual.id, 48, [{ label: "Workshop session (entered twice)", unitPriceCents: 40_000 }]);
  await ledger.voidTransaction(businessId, oops.transaction.id);

  // ── Refunds & chargeback ──────────────────────────────────────────────────
  // R1: one mug from the day-30 sale comes back on day 18 and is RESTOCKED (recovers 900).
  await ledger.createRefund(businessId, {
    transactionId: mugSales[4].transaction.id,
    requests: [{ lineId: mugSales[4].lines[0].id, qtyRefunded: "1", amountRefundedCents: 2_500, restocked: true }],
    occurredAt: day(18),
  });
  // R2: the day-72 logo refunds in full on day 66 — nothing recovered.
  await ledger.createRefund(businessId, {
    transactionId: logoSales[2].transaction.id,
    requests: [{ lineId: logoSales[2].lines[0].id, qtyRefunded: "1", amountRefundedCents: 50_000 }],
    occurredAt: day(66),
  });
  // CB: the day-50 logo is charged back on day 44, with the processor's 1500 fee.
  await ledger.createRefund(businessId, {
    transactionId: logoSales[4].transaction.id,
    requests: [{ lineId: logoSales[4].lines[0].id, qtyRefunded: "1", amountRefundedCents: 50_000 }],
    adjustmentType: "chargeback",
    chargebackFeeCents: 1_500,
    occurredAt: day(44),
  });

  // ── Expenses ──────────────────────────────────────────────────────────────
  const expense = (daysAgo: number, lines: ledger.CreateTransactionLineInput[]) =>
    ledger.createTransaction(businessId, { direction: "out", occurredAt: day(daysAgo), sourceId: manual.id, lines });

  for (const daysAgo of [75, 45, 15]) await expense(daysAgo, [{ expenseItemId: software.id }]);
  for (const daysAgo of [80, 50, 20]) await expense(daysAgo, [{ expenseItemId: rent.id }]);
  const adAmounts: Array<[number, number]> = [[62, 12_000], [42, 18_000], [28, 25_000], [9, 15_000]];
  for (const [daysAgo, cents] of adAmounts) await expense(daysAgo, [{ expenseItemId: ads.id, unitPriceCents: cents }]);
  await expense(33, [{ expenseItemId: kiln.id }]);
  for (const daysAgo of [68, 37, 7]) await expense(daysAgo, [{ expenseItemId: packaging.id }]);
  await expense(4, [{ label: "Bank charges", unitPriceCents: 800 }]);

  // ── R4: People, subscriptions, recurring expenses ─────────────────────────
  await seedRecurringAndPeople(businessId, manual.id, day);

  return businessId;
}

/**
 * Deterministic R4 layer. History is posted at fixed relative days (not via the
 * calendar engine) so the 90-day P&L delta stays exactly hand-computable while
 * the schedules, postings, subscription events, and 6-month cohort spread are
 * all realistic. In-window subscription revenue = 105_000; recurring expenses
 * added = 256_000 (see EXPECTED_PNL breakdown).
 */
async function seedRecurringAndPeople(businessId: string, sourceId: string, day: (n: number) => Date) {
  // Subscription plans (no cost components → contribution == revenue).
  const proPlan = await catalog.createRevenueItem(businessId, { name: "Pro plan", type: "subscription", pricingModel: "fixed", unitPriceCents: 5_000 });
  const teamPlan = await catalog.createRevenueItem(businessId, { name: "Team plan", type: "subscription", pricingModel: "fixed", unitPriceCents: 15_000 });
  const annualPlan = await catalog.createRevenueItem(businessId, { name: "Annual plan", type: "subscription", pricingModel: "fixed", unitPriceCents: 60_000 });

  // Post a recurring occurrence directly (ledger txn + posting row + optional sub event).
  const post = async (scheduleId: string, personId: string, revenueItemId: string, amountCents: number, daysAgo: number, opts: { status?: "completed" | "pending"; subscriptionId?: string } = {}) => {
    const status = opts.status ?? "completed";
    const created = await ledger.createTransaction(businessId, {
      direction: "in",
      occurredAt: day(daysAgo),
      sourceId,
      personId,
      status,
      origin: "recurring_engine",
      lines: [{ revenueItemId, unitPriceCents: amountCents }],
    });
    await db.insert(recurringPostingsTable).values({ id: uid("post"), scheduleId, scheduledFor: day(daysAgo), transactionId: created.transaction.id, postedAt: new Date() });
    if (opts.subscriptionId && status === "completed") {
      await db.insert(subscriptionEventsTable).values({ id: uid("subev"), subscriptionId: opts.subscriptionId, event: "payment_posted", occurredAt: day(daysAgo), metadata: { transactionId: created.transaction.id } });
    }
    return created;
  };

  const makeSub = async (
    name: string,
    plan: { id: string; unitPriceCents: number | null },
    amountCents: number,
    interval: "monthly" | "yearly",
    startDaysAgo: number,
    opts: { status: "active" | "trialing" | "past_due" | "canceled"; confirmFirst?: boolean; trialEndsDaysAgo?: number; canceledDaysAgo?: number; paymentDaysAgo?: number[]; pendingDaysAgo?: number },
  ) => {
    const person = await findOrCreatePerson(businessId, { name, email: `${name.toLowerCase().replace(/[^a-z]/g, "")}@example.com` });
    const schedule = await createSchedule(businessId, {
      direction: "in",
      revenueItemId: plan.id,
      personId: person.id,
      sourceId,
      amountCents,
      interval,
      anchorDay: day(startDaysAgo).getUTCDate(),
      startDate: day(startDaysAgo),
      postingMode: opts.confirmFirst ? "confirm_first" : "auto_post",
    });
    const sub = await createSubscription(businessId, {
      revenueItemId: plan.id,
      personId: person.id,
      scheduleId: schedule.id,
      startedAt: day(startDaysAgo),
      trialEndsAt: opts.trialEndsDaysAgo !== undefined ? day(opts.trialEndsDaysAgo) : null,
      status: opts.status === "trialing" ? "trialing" : "active",
    });
    for (const d of opts.paymentDaysAgo ?? []) await post(schedule.id, person.id, plan.id, amountCents, d, { subscriptionId: sub.id });
    if (opts.pendingDaysAgo !== undefined) await post(schedule.id, person.id, plan.id, amountCents, opts.pendingDaysAgo, { status: "pending", subscriptionId: sub.id });
    // Set final status directly (past_due / canceled) after posting history.
    if (opts.status === "past_due") await db.update(subscriptionsTable).set({ status: "past_due" }).where(eq(subscriptionsTable.id, sub.id));
    if (opts.status === "canceled") {
      await db.update(subscriptionsTable).set({ status: "canceled", canceledAt: day(opts.canceledDaysAgo ?? 40), cancelReason: "churned" }).where(eq(subscriptionsTable.id, sub.id));
      await db.update(recurringSchedulesTable).set({ status: "canceled" }).where(eq(recurringSchedulesTable.id, schedule.id));
      await db.insert(subscriptionEventsTable).values({ id: uid("subev"), subscriptionId: sub.id, event: "canceled", occurredAt: day(opts.canceledDaysAgo ?? 40) });
    }
    // Keep the live job from posting more history on top of the seed.
    await db.update(recurringSchedulesTable).set({ nextRunAt: day(-30) }).where(eq(recurringSchedulesTable.id, schedule.id));
    return sub;
  };

  // 4 active (mixed intervals), 1 trialing, 1 past_due, 2 canceled = 8 subscriptions.
  await makeSub("Nadia Khan", proPlan, 5_000, "monthly", 80, { status: "active", paymentDaysAgo: [75, 45, 15] });
  await makeSub("Omar Farooq", proPlan, 5_000, "monthly", 80, { status: "active", paymentDaysAgo: [75, 45, 15] });
  await makeSub("Acme Corp", teamPlan, 15_000, "monthly", 80, { status: "active", paymentDaysAgo: [75, 45, 15] });
  await makeSub("Zara Ltd", annualPlan, 60_000, "yearly", 100, { status: "active", paymentDaysAgo: [100] }); // last pay >90d
  await makeSub("Hina Malik", proPlan, 5_000, "monthly", 5, { status: "trialing", trialEndsDaysAgo: -2 }); // trial, no payment yet
  await makeSub("Bilal Ahmed", proPlan, 5_000, "monthly", 85, { status: "past_due", confirmFirst: true, paymentDaysAgo: [80, 50], pendingDaysAgo: 20 });
  await makeSub("Sana Tariq", proPlan, 5_000, "monthly", 90, { status: "canceled", paymentDaysAgo: [85, 55], canceledDaysAgo: 40 });
  await makeSub("Kamran Shah", proPlan, 5_000, "monthly", 90, { status: "canceled", paymentDaysAgo: [85, 55], canceledDaysAgo: 40 });

  // Recurring expenses (mixed auto/confirm), history at fixed days.
  const officeRent = await catalog.findOrCreateExpenseItem(businessId, { name: "Office rent", type: "operational", costNature: "fixed", behavior: "recurring", defaultAmountCents: 30_000 });
  const payroll = await catalog.findOrCreateExpenseItem(businessId, { name: "Payroll", type: "payroll", behavior: "recurring", defaultAmountCents: 50_000 });
  const softwareLicenses = await catalog.findOrCreateExpenseItem(businessId, { name: "Software licenses", type: "operational", behavior: "recurring", defaultAmountCents: 8_000 });

  const recurringExpense = async (itemId: string, amountCents: number, daysAgo: number, confirmFirst: boolean) => {
    const schedule = await createSchedule(businessId, { direction: "out", expenseItemId: itemId, sourceId, amountCents, interval: "monthly", anchorDay: day(daysAgo).getUTCDate(), startDate: day(daysAgo), postingMode: confirmFirst ? "confirm_first" : "auto_post" });
    return schedule;
  };
  const postExpense = async (scheduleId: string, itemId: string, amountCents: number, daysAgo: number, status: "completed" | "pending") => {
    const created = await ledger.createTransaction(businessId, { direction: "out", occurredAt: day(daysAgo), sourceId, status, origin: "recurring_engine", lines: [{ expenseItemId: itemId, unitPriceCents: amountCents }] });
    await db.insert(recurringPostingsTable).values({ id: uid("post"), scheduleId, scheduledFor: day(daysAgo), transactionId: created.transaction.id, postedAt: new Date() });
  };

  const rentSched = await recurringExpense(officeRent.id, 30_000, 70, false);
  for (const d of [70, 40, 10]) await postExpense(rentSched.id, officeRent.id, 30_000, d, "completed"); // 90_000
  const payrollSched = await recurringExpense(payroll.id, 50_000, 65, false);
  for (const d of [65, 35, 5]) await postExpense(payrollSched.id, payroll.id, 50_000, d, "completed"); // 150_000
  const swSched = await recurringExpense(softwareLicenses.id, 8_000, 75, true);
  for (const d of [75, 45]) await postExpense(swSched.id, softwareLicenses.id, 8_000, d, "completed"); // 16_000
  await postExpense(swSched.id, softwareLicenses.id, 8_000, 15, "pending"); // excluded
  for (const s of [rentSched.id, payrollSched.id, swSched.id]) await db.update(recurringSchedulesTable).set({ nextRunAt: day(-30) }).where(eq(recurringSchedulesTable.id, s));

  // 17 one-off customers dated > 90 days (populate cohorts without touching the window).
  const oneOffItem = await catalog.getRevenueItem(businessId, (await db.select().from(revenueItemsTable).where(eq(revenueItemsTable.businessId, businessId))).find((i) => i.name === "Ceramic mug")!.id);
  for (let i = 0; i < 17; i += 1) {
    const person = await findOrCreatePerson(businessId, { name: `Cohort Customer ${i + 1}` });
    // First purchase 130–230 days ago; any repeat 30 days later still > 90 days,
    // so cohorts are non-trivial while the 90-day P&L window stays untouched.
    const firstDays = 130 + (i % 6) * 20;
    await ledger.createTransaction(businessId, { direction: "in", occurredAt: day(firstDays), sourceId, personId: person.id, lines: [{ revenueItemId: oneOffItem.id, qty: "2" }] });
    if (i % 3 === 0) await ledger.createTransaction(businessId, { direction: "in", occurredAt: day(firstDays - 30), sourceId, personId: person.id, lines: [{ revenueItemId: oneOffItem.id }] });
  }
}

/** Loads the last-90-days ledger and runs it through the ONE ladder implementation. */
export async function loadSeededLadder(businessId: string): Promise<ProfitLadder> {
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const headers = await db
    .select()
    .from(transactionsTable)
    .where(eq(transactionsTable.businessId, businessId));
  const inWindow = headers.filter((h) => h.occurredAt >= since);
  const lines = inWindow.length
    ? await db
        .select()
        .from(transactionLinesTable)
        .where(inArray(transactionLinesTable.transactionId, inWindow.map((h) => h.id)))
    : [];
  const linesByTxn = new Map<string, typeof lines>();
  for (const line of lines) {
    const list = linesByTxn.get(line.transactionId) ?? [];
    list.push(line);
    linesByTxn.set(line.transactionId, list);
  }
  const profitTransactions: ProfitTransaction[] = inWindow.map((header) => ({
    direction: header.direction as ProfitTransaction["direction"],
    status: header.status as ProfitTransaction["status"],
    adjustmentType: header.adjustmentType as ProfitTransaction["adjustmentType"],
    orderDiscountCents: header.orderDiscountCents,
    shippingChargedCents: header.shippingChargedCents,
    taxCollectedCents: header.taxCollectedCents,
    lines: (linesByTxn.get(header.id) ?? []).map((line) => ({
      qty: line.qty,
      unitPriceCents: line.unitPriceCents,
      lineDiscountCents: line.lineDiscountCents,
      costSnapshot: (line.costSnapshot as CostSnapshot | null) ?? null,
      refundedLineId: line.refundedLineId,
    })),
  }));
  return computeProfitLadder(profitTransactions);
}
