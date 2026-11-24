/**
 * Query-time analytics for People + Subscriptions. Everything here is DERIVED
 * (never stored, CLAUDE.md/R4): lifetime revenue/contribution, order counts,
 * MRR, churn, cohort grids. All money is server-computed integer cents via
 * lib/domain.
 */
import {
  db,
  expenseItemsTable,
  peopleTable,
  recurringSchedulesTable,
  revenueItemsTable,
  subscriptionEventsTable,
  subscriptionsTable,
  transactionLinesTable,
  transactionsTable,
  type Person,
  type Subscription,
} from "@workspace/db";
import {
  buildCohortGrid,
  buildRetentionGrid,
  churnSentence,
  computeRepeatStats,
  computeChurnRate,
  computeClientSignals,
  computeMrr,
  computeMrrMovement,
  computeNetRevenueRetention,
  computeProfitLadder,
  expenseLineSpends,
  mineItemPairs,
  grossLineRevenue,
  lineCostTotal,
  lineSubtotal,
  movementSentence,
  mrrSentence,
  netLineRevenue,
  normalizedMrrCents,
  orderDiscountShares,
  type CohortCustomer,
  type MrrMovementSub,
  type ProfitLine,
  type ProfitTransaction,
  type RecurInterval,
} from "@workspace/domain";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { CostSnapshot } from "@workspace/domain";
import { computePnl, loadNameMaps, loadPeriodTransactions, profitTransaction, type PeriodRange } from "./read";
import { computeOwed } from "./owed";
import { MAX_BUCKETS, bucketLabel, bucketStartOf, nextBucketStart, type SeriesBucket } from "./buckets";
import { invalid } from "./errors";
import { logger } from "../lib/logger";
import { loadBusinessCapabilities } from "../lib/settingsShape";
import { getBusinessById } from "./business";
import { computeClientProfitability } from "./clientProfit";

const COUNTED = new Set(["completed", "refunded", "partially_refunded", "disputed"]);

function profitLine(line: typeof transactionLinesTable.$inferSelect): ProfitLine {
  return {
    direction: line.direction as "in" | "out",
    qty: line.qty,
    unitPriceCents: line.unitPriceCents,
    lineDiscountCents: line.lineDiscountCents,
    costSnapshot: (line.costSnapshot as CostSnapshot | null) ?? null,
    refundedLineId: line.refundedLineId,
    spreadMonths: line.spreadMonths,
  };
}

/**
 * Split a sale's lines for per-person/cohort math: revenue lines earn, expense
 * lines inside the sale are direct job costs (mixed-transaction rule). Returns
 * net revenue and contribution across the whole transaction.
 */
function saleMoney(lines: ProfitLine[], orderDiscountCents: number): { net: number; contribution: number } {
  const revLines = lines.filter((l) => (l.direction ?? "in") === "in");
  const expLines = lines.filter((l) => (l.direction ?? "in") === "out");
  const shares = orderDiscountShares(orderDiscountCents, revLines);
  const net = revLines.reduce((s, l, i) => s + netLineRevenue(l, shares[i]), 0);
  const revCost = revLines.reduce((s, l) => s + lineCostTotal(l), 0);
  const jobCost = expLines.reduce((s, l) => s + lineSubtotal(l), 0);
  return { net, contribution: net - revCost - jobCost };
}

export interface PersonMetrics {
  lifetimeNetRevenueCents: number;
  lifetimeContributionCents: number;
  orderCount: number;
  firstActivityAt: string | null;
  lastActivityAt: string | null;
  activeSubscriptions: number;
  vendorSpendCents: number;
}

interface PersonAgg {
  net: number;
  contribution: number;
  orders: number;
  first: Date | null;
  last: Date | null;
  vendorSpend: number;
}

/** Per-person derived metrics across the whole ledger + subscriptions. */
export async function computePeopleMetrics(businessId: string): Promise<Map<string, PersonMetrics>> {
  const headers = await db.select().from(transactionsTable).where(eq(transactionsTable.businessId, businessId));
  const linesByTxn = await loadLines(headers.map((h) => h.id));

  const byPerson = new Map<string, PersonAgg>();
  const agg = (id: string) => {
    const e = byPerson.get(id);
    if (e) return e;
    const created: PersonAgg = { net: 0, contribution: 0, orders: 0, first: null, last: null, vendorSpend: 0 };
    byPerson.set(id, created);
    return created;
  };

  for (const header of headers) {
    if (header.status === "void" || !header.personId) continue;
    if (!COUNTED.has(header.status)) continue;
    const a = agg(header.personId);
    const when = header.occurredAt;
    if (!a.first || when < a.first) a.first = when;
    if (!a.last || when > a.last) a.last = when;

    const lines = (linesByTxn.get(header.id) ?? []).map(profitLine);
    if (header.adjustmentType) {
      const refundLines = (linesByTxn.get(header.id) ?? []).filter((l) => l.refundedLineId);
      const amount = refundLines.reduce((s, l) => s + grossLineRevenue(profitLine(l)), 0);
      const recovered = refundLines.reduce((s, l) => s + lineCostTotal(profitLine(l)), 0);
      a.net -= amount;
      a.contribution += -amount + recovered;
    } else if (header.direction === "in") {
      const { net, contribution } = saleMoney(lines, header.orderDiscountCents);
      a.net += net;
      a.contribution += contribution;
      a.orders += 1;
    }
  }

  // Vendor spend: money-out transactions on expense items whose vendor is this person.
  const expenseItems = await db.select().from(expenseItemsTable).where(eq(expenseItemsTable.businessId, businessId));
  const vendorByItem = new Map(expenseItems.map((e) => [e.id, e.vendorPersonId]));
  for (const header of headers) {
    if (header.status === "void" || header.direction !== "in" && header.adjustmentType) continue;
    if (header.direction !== "out" || header.adjustmentType) continue;
    if (!COUNTED.has(header.status)) continue;
    for (const line of linesByTxn.get(header.id) ?? []) {
      const vendorId = line.expenseItemId ? vendorByItem.get(line.expenseItemId) : null;
      if (!vendorId) continue;
      agg(vendorId).vendorSpend += grossLineRevenue(profitLine(line)) - line.lineDiscountCents;
    }
  }

  // Active subscriptions per person.
  const subs = await db.select().from(subscriptionsTable).where(eq(subscriptionsTable.businessId, businessId));
  const activeByPerson = new Map<string, number>();
  for (const sub of subs) {
    if (sub.status === "active" || sub.status === "trialing" || sub.status === "past_due") {
      activeByPerson.set(sub.personId, (activeByPerson.get(sub.personId) ?? 0) + 1);
    }
  }

  const out = new Map<string, PersonMetrics>();
  const ids = new Set<string>([...byPerson.keys(), ...activeByPerson.keys()]);
  for (const id of ids) {
    const a = byPerson.get(id) ?? { net: 0, contribution: 0, orders: 0, first: null, last: null, vendorSpend: 0 };
    out.set(id, {
      lifetimeNetRevenueCents: a.net,
      lifetimeContributionCents: a.contribution,
      orderCount: a.orders,
      firstActivityAt: a.first ? a.first.toISOString() : null,
      lastActivityAt: a.last ? a.last.toISOString() : null,
      activeSubscriptions: activeByPerson.get(id) ?? 0,
      vendorSpendCents: a.vendorSpend,
    });
  }
  return out;
}

async function loadLines(ids: string[]) {
  const byTxn = new Map<string, (typeof transactionLinesTable.$inferSelect)[]>();
  if (ids.length === 0) return byTxn;
  const rows = await db.select().from(transactionLinesTable).where(inArray(transactionLinesTable.transactionId, ids));
  for (const r of rows) {
    const list = byTxn.get(r.transactionId) ?? [];
    list.push(r);
    byTxn.set(r.transactionId, list);
  }
  return byTxn;
}

export function personView(p: Person, metrics: PersonMetrics | undefined) {
  const m = metrics ?? {
    lifetimeNetRevenueCents: 0,
    lifetimeContributionCents: 0,
    orderCount: 0,
    firstActivityAt: null,
    lastActivityAt: null,
    activeSubscriptions: 0,
    vendorSpendCents: 0,
  };
  const cohortSource = p.firstTransactionAt ?? (m.firstActivityAt ? new Date(m.firstActivityAt) : null);
  return {
    id: p.id,
    kind: p.kind as "customer" | "vendor" | "employee" | "other",
    displayName: p.displayName,
    email: p.email ?? null,
    phone: p.phone ?? null,
    company: p.company ?? null,
    firstTransactionAt: p.firstTransactionAt ? p.firstTransactionAt.toISOString() : m.firstActivityAt,
    needsReview: p.needsReview,
    status: p.status as "active" | "archived",
    notes: p.notes ?? null,
    cohortMonth: cohortSource ? monthKey(new Date(cohortSource)) : null,
    metrics: m,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Simple duplicate detection: same email, or same normalized display name. */
export function findDuplicates(people: Person[]) {
  const groups: Array<{ reason: string; people: Array<{ id: string; displayName: string; email: string | null }> }> = [];
  const byEmail = new Map<string, Person[]>();
  const byName = new Map<string, Person[]>();
  for (const p of people) {
    if (p.status === "archived") continue;
    if (p.email) {
      const k = p.email.trim().toLowerCase();
      byEmail.set(k, [...(byEmail.get(k) ?? []), p]);
    }
    const nk = p.displayName.trim().toLowerCase();
    byName.set(nk, [...(byName.get(nk) ?? []), p]);
  }
  const seen = new Set<string>();
  for (const [, group] of byEmail) {
    if (group.length > 1) {
      groups.push({ reason: "Same email", people: group.map((p) => ({ id: p.id, displayName: p.displayName, email: p.email })) });
      group.forEach((p) => seen.add(p.id));
    }
  }
  for (const [, group] of byName) {
    if (group.length > 1 && !group.every((p) => seen.has(p.id))) {
      groups.push({ reason: "Same name", people: group.map((p) => ({ id: p.id, displayName: p.displayName, email: p.email })) });
    }
  }
  return groups;
}

// ── Subscriptions summary ───────────────────────────────────────────────────

/**
 * The billing amount + interval of a subscription, from its schedule (+ item
 * default). Both lookups stay inside the subscription's own business, so a
 * stored id from elsewhere can never bring another business's price in.
 */
async function subscriptionMrr(sub: Subscription): Promise<{ amountCents: number; interval: RecurInterval; intervalCount: number }> {
  const [schedule] = await db
    .select()
    .from(recurringSchedulesTable)
    .where(and(eq(recurringSchedulesTable.id, sub.scheduleId), eq(recurringSchedulesTable.businessId, sub.businessId)));
  let amountCents = schedule?.amountCents ?? null;
  if (amountCents === null) {
    const [item] = await db
      .select()
      .from(revenueItemsTable)
      .where(and(eq(revenueItemsTable.id, sub.revenueItemId), eq(revenueItemsTable.businessId, sub.businessId)));
    amountCents = item?.unitPriceCents ?? 0;
  }
  return { amountCents, interval: (schedule?.interval ?? "monthly") as RecurInterval, intervalCount: schedule?.intervalCount ?? 1 };
}

export async function subscriptionSummary(businessId: string, range: PeriodRange) {
  const subs = await db.select().from(subscriptionsTable).where(eq(subscriptionsTable.businessId, businessId));
  const mrrByStub = new Map<string, { amountCents: number; interval: RecurInterval; intervalCount: number }>();
  for (const sub of subs) mrrByStub.set(sub.id, await subscriptionMrr(sub));

  const isActive = (s: Subscription) => s.status === "active" || s.status === "trialing" || s.status === "past_due";
  const activeSubs = subs.filter(isActive);
  const mrrCents = computeMrr(activeSubs.map((s) => mrrByStub.get(s.id)!));

  const start = range.start ?? new Date(0);
  const end = range.end ?? new Date();
  const inPeriod = (d: Date | null) => !!d && d >= start && d <= end;

  // Plan-change deltas within the period (expansion/contraction).
  const events = await db
    .select()
    .from(subscriptionEventsTable)
    .where(inArray(subscriptionEventsTable.subscriptionId, subs.length ? subs.map((s) => s.id) : ["_none_"]));
  const planDeltaBySub = new Map<string, number>();
  for (const ev of events) {
    if (ev.event !== "plan_changed" || !inPeriod(ev.occurredAt)) continue;
    const meta = (ev.metadata as { amountCents?: number; previousAmountCents?: number } | null) ?? {};
    if (meta.amountCents !== undefined && meta.previousAmountCents !== undefined) {
      planDeltaBySub.set(ev.subscriptionId, (planDeltaBySub.get(ev.subscriptionId) ?? 0) + (meta.amountCents - meta.previousAmountCents));
    }
  }

  const movementSubs: MrrMovementSub[] = subs.map((s) => {
    const mrr = normalizedMrrCents(mrrByStub.get(s.id)!.amountCents, mrrByStub.get(s.id)!.interval, mrrByStub.get(s.id)!.intervalCount);
    const startedInPeriod = inPeriod(s.startedAt);
    const canceledInPeriod = inPeriod(s.canceledAt);
    const delta = planDeltaBySub.get(s.id) ?? 0;
    const mrrAfter = canceledInPeriod ? 0 : isActive(s) ? mrr : 0;
    const mrrBefore = startedInPeriod ? 0 : canceledInPeriod ? mrr : mrr - delta;
    return { mrrBeforeCents: mrrBefore, mrrAfterCents: mrrAfter, startedInPeriod, canceledInPeriod };
  });
  const movement = computeMrrMovement(movementSubs);

  const activeAtStart = subs.filter((s) => s.startedAt < start && (!s.canceledAt || s.canceledAt >= start)).length;
  const churnedCount = subs.filter((s) => inPeriod(s.canceledAt)).length;
  const churn = computeChurnRate(activeAtStart, churnedCount);
  const startMrr = subs
    .filter((s) => s.startedAt < start && (!s.canceledAt || s.canceledAt >= start))
    .reduce((sum, s) => sum + normalizedMrrCents(mrrByStub.get(s.id)!.amountCents, mrrByStub.get(s.id)!.interval, mrrByStub.get(s.id)!.intervalCount), 0);
  const nrr = computeNetRevenueRetention(startMrr, movement);

  return {
    mrrCents,
    activeCount: activeSubs.length,
    movement,
    churnRatePct: churn.ratePct,
    churnedCount: churn.churnedCount,
    netRevenueRetentionPct: nrr,
    sentences: {
      mrr: mrrSentence(mrrCents),
      churn: churnSentence(churn, movement.churnedCents),
      movement: movementSentence(movement),
    },
  };
}

export async function listSubscriptionViews(businessId: string) {
  const [subs, people] = await Promise.all([
    db.select().from(subscriptionsTable).where(eq(subscriptionsTable.businessId, businessId)).orderBy(asc(subscriptionsTable.startedAt)),
    db.select().from(peopleTable).where(eq(peopleTable.businessId, businessId)),
  ]);
  const nameById = new Map(people.map((p) => [p.id, p.displayName]));
  const items = await db.select().from(revenueItemsTable).where(eq(revenueItemsTable.businessId, businessId));
  const itemName = new Map(items.map((i) => [i.id, i.name]));

  const out = [];
  for (const sub of subs) {
    const mrr = await subscriptionMrr(sub);
    out.push({
      id: sub.id,
      personId: sub.personId,
      personName: nameById.get(sub.personId) ?? "?",
      itemName: itemName.get(sub.revenueItemId) ?? "?",
      status: sub.status as "trialing" | "active" | "past_due" | "paused" | "canceled",
      mrrCents: normalizedMrrCents(mrr.amountCents, mrr.interval, mrr.intervalCount),
      interval: mrr.interval,
      startedAt: sub.startedAt.toISOString(),
      trialEndsAt: sub.trialEndsAt ? sub.trialEndsAt.toISOString() : null,
      canceledAt: sub.canceledAt ? sub.canceledAt.toISOString() : null,
    });
  }
  return out;
}

// ── Cohort grid (contribution profit) ───────────────────────────────────────

/** Customers + their sale events, shared by the cohort and retention grids. */
async function collectCohortCustomers(businessId: string): Promise<CohortCustomer[]> {
  const metrics = await computePeopleMetrics(businessId); // reuses per-txn compute
  const people = await db.select().from(peopleTable).where(and(eq(peopleTable.businessId, businessId), eq(peopleTable.kind, "customer")));
  const headers = await db.select().from(transactionsTable).where(eq(transactionsTable.businessId, businessId));
  const linesByTxn = await loadLines(headers.map((h) => h.id));

  // Per-person contribution events (sales only) for the cohort curve.
  const eventsByPerson = new Map<string, { occurredAt: Date; contributionProfitCents: number }[]>();
  for (const header of headers) {
    if (header.status === "void" || !header.personId || header.adjustmentType || header.direction !== "in") continue;
    if (!COUNTED.has(header.status)) continue;
    const lines = (linesByTxn.get(header.id) ?? []).map(profitLine);
    const { contribution } = saleMoney(lines, header.orderDiscountCents);
    const list = eventsByPerson.get(header.personId) ?? [];
    list.push({ occurredAt: header.occurredAt, contributionProfitCents: contribution });
    eventsByPerson.set(header.personId, list);
  }

  return people.map((p) => ({
    id: p.id,
    firstTransactionAt: p.firstTransactionAt ?? metrics.get(p.id)?.firstActivityAt ?? null,
    events: eventsByPerson.get(p.id) ?? [],
  }));
}

export async function buildContributionCohorts(businessId: string) {
  return buildCohortGrid(await collectCohortCustomers(businessId));
}

/** Retention + repeat-purchase behaviour (Wave 1.4 data layer; UI comes with the Insights redesign). */
export async function buildCustomerRetention(businessId: string) {
  const customers = await collectCohortCustomers(businessId);
  return { retention: buildRetentionGrid(customers), repeat: computeRepeatStats(customers) };
}

// ── Drivers: WHY did true profit move? (Insights 2.0, Block 2) ──────────────
//
// The whole period's true profit is decomposed into named buckets — each
// revenue item's contribution, job costs, shipping, refunds, fees, and each
// expense type — such that the buckets SUM EXACTLY to the ladder's true
// profit. Comparing two windows bucket-by-bucket therefore explains the whole
// change with nothing left over (the reconciliation invariant, tested).

interface Bucket {
  label: string;
  cents: number;
}

interface AxisMaps {
  profit: Map<string, Bucket>;
  items: Map<string, Bucket>;
  sources: Map<string, Bucket>;
  categories: Map<string, Bucket>;
  expenseTypes: Map<string, Bucket>;
}

function bump(map: Map<string, Bucket>, key: string, label: string, cents: number) {
  const bucket = map.get(key) ?? { label, cents: 0 };
  bucket.cents += cents;
  map.set(key, bucket);
}

async function axisAggregates(businessId: string, userId: string, range: PeriodRange): Promise<AxisMaps> {
  const [txns, maps] = await Promise.all([loadPeriodTransactions(businessId, range), loadNameMaps(businessId, userId)]);
  const axes: AxisMaps = { profit: new Map(), items: new Map(), sources: new Map(), categories: new Map(), expenseTypes: new Map() };

  for (const { header, lines } of txns) {
    if (!COUNTED.has(header.status)) continue;
    const sourceName = maps.sources.get(header.sourceId)?.name ?? "Manual";

    if (header.adjustmentType) {
      for (const line of lines) {
        const p = profitLine(line);
        const amount = grossLineRevenue(p) - p.lineDiscountCents;
        if (line.refundedLineId) {
          // Mirrors the ladder: refunds subtract; recovered costs come back.
          const impact = -amount + lineCostTotal(p);
          bump(axes.profit, "refunds", "Refunds & chargebacks", impact);
          bump(axes.sources, header.sourceId, sourceName, impact);
        } else {
          bump(axes.profit, "fees", "Chargeback fees", -amount);
          bump(axes.expenseTypes, "fees", "Chargeback fees", -amount);
        }
      }
      continue;
    }

    if (header.direction === "in") {
      const pLines = lines.map(profitLine);
      const revIdx = pLines.map((l, i) => ((l.direction ?? "in") === "in" ? i : -1)).filter((i) => i >= 0);
      const revLines = revIdx.map((i) => pLines[i]);
      const shares = orderDiscountShares(header.orderDiscountCents, revLines);

      revIdx.forEach((lineIdx, k) => {
        const line = lines[lineIdx];
        const contribution = netLineRevenue(pLines[lineIdx], shares[k]) - lineCostTotal(pLines[lineIdx]);
        const itemKey = line.revenueItemId ? `item:${line.revenueItemId}` : "item:oneoff";
        const itemLabel = line.revenueItemId
          ? maps.revenueItems.get(line.revenueItemId)?.name ?? "Unknown item"
          : "One-off sales";
        bump(axes.profit, itemKey, itemLabel, contribution);
        bump(axes.items, itemKey, itemLabel, contribution);
        bump(axes.sources, header.sourceId, sourceName, contribution);
        const catId = line.categoryId ?? (line.revenueItemId ? maps.revenueItems.get(line.revenueItemId)?.categoryId : null) ?? null;
        bump(axes.categories, catId ?? "uncat", catId ? maps.categories.get(catId)?.name ?? "Uncategorized" : "Uncategorized", contribution);
      });

      // Expense lines inside a sale: direct costs of that job (mixed entries).
      for (let i = 0; i < lines.length; i += 1) {
        if ((pLines[i].direction ?? "in") !== "out") continue;
        const sub = lineSubtotal(pLines[i]);
        bump(axes.profit, "jobcost", "Costs inside jobs", -sub);
        bump(axes.sources, header.sourceId, sourceName, -sub);
      }

      if (header.shippingChargedCents !== 0) {
        bump(axes.profit, "shipping", "Shipping charged", header.shippingChargedCents);
        bump(axes.sources, header.sourceId, sourceName, header.shippingChargedCents);
      }
      continue;
    }

    // Standalone expense transaction → period expense, attributed PER LINE so a
    // multi-item expense doesn't land entirely on its first line's type. The
    // discount split keeps the profit axis reconciling to the ladder.
    const spends = expenseLineSpends(lines.map(profitLine), header.orderDiscountCents);
    lines.forEach((line, i) => {
      const type = line.expenseItemId
        ? (maps.expenseItems.get(line.expenseItemId)?.type as string | undefined) ?? "custom"
        : "custom";
      const label = type === "custom" ? "Other expenses" : `${type.charAt(0).toUpperCase()}${type.slice(1)} expenses`;
      bump(axes.profit, `exp:${type}`, label, -spends[i]);
      bump(axes.expenseTypes, `exp:${type}`, label, -spends[i]);
    });
  }

  return axes;
}

export interface DriverRow {
  key: string;
  label: string;
  currentCents: number;
  priorCents: number;
  deltaCents: number;
}

function mergeAxis(current: Map<string, Bucket>, prior: Map<string, Bucket>, cap = 30): DriverRow[] {
  const keys = new Set([...current.keys(), ...prior.keys()]);
  const rows: DriverRow[] = [];
  for (const key of keys) {
    const a = current.get(key);
    const b = prior.get(key);
    rows.push({
      key,
      label: a?.label ?? b?.label ?? key,
      currentCents: a?.cents ?? 0,
      priorCents: b?.cents ?? 0,
      deltaCents: (a?.cents ?? 0) - (b?.cents ?? 0),
    });
  }
  rows.sort((x, y) => Math.abs(y.deltaCents) - Math.abs(x.deltaCents));
  return rows.slice(0, cap);
}

export async function computeDrivers(
  businessId: string,
  userId: string,
  current: PeriodRange,
  prior: PeriodRange,
) {
  const [a, b] = await Promise.all([
    axisAggregates(businessId, userId, current),
    axisAggregates(businessId, userId, prior),
  ]);
  const sum = (m: Map<string, Bucket>) => [...m.values()].reduce((s, x) => s + x.cents, 0);
  return {
    profit: mergeAxis(a.profit, b.profit),
    items: mergeAxis(a.items, b.items),
    sources: mergeAxis(a.sources, b.sources),
    categories: mergeAxis(a.categories, b.categories),
    expenseTypes: mergeAxis(a.expenseTypes, b.expenseTypes),
    currentTrueProfitCents: sum(a.profit),
    priorTrueProfitCents: sum(b.profit),
  };
}

// ── Signals: computed nudges (Insights 2.0, ambient alerts) ─────────────────
//
// Plain-English rules over the period-vs-prior money. Currency-agnostic
// (percentages + counts, no symbols) so they read correctly for any business.
// Consumed by the sidebar health chip, a Dashboard banner, and the command
// center's Needs-attention list.

export type SignalSeverity = "positive" | "info" | "warning" | "critical";
export interface Signal {
  id: string;
  severity: SignalSeverity;
  title: string;
  plainEnglish: string;
  href: string;
}

export async function computeSignals(
  businessId: string,
  userId: string,
  current: PeriodRange,
  prior: PeriodRange,
): Promise<{ signals: Signal[] }> {
  const [cur, prev, leaks, retention] = await Promise.all([
    computePnl(businessId, userId, current),
    computePnl(businessId, userId, prior),
    computeLeaks(businessId, userId, current, prior),
    buildCustomerRetention(businessId),
  ]);

  const curMargin = cur.ladder.netRevenue > 0 ? (cur.ladder.trueProfit / cur.ladder.netRevenue) * 100 : 0;
  const priorMargin = prev.ladder.netRevenue > 0 ? (prev.ladder.trueProfit / prev.ladder.netRevenue) * 100 : 0;
  const signals: Signal[] = [];

  if (cur.ladder.netRevenue > 0 && cur.ladder.trueProfit < 0) {
    signals.push({ id: "loss", severity: "critical", title: "Running at a loss", plainEnglish: "This period's costs are higher than what came in — start with your biggest leaks.", href: "/insights/leaks" });
  }
  if (priorMargin > 0 && curMargin < priorMargin - 5) {
    signals.push({ id: "margin", severity: "warning", title: "Margin is slipping", plainEnglish: `Your profit margin fell from ${priorMargin.toFixed(0)}% to ${curMargin.toFixed(0)}%.`, href: "/insights/profit" });
  }
  if (leaks.refunds.ratePct > 8) {
    signals.push({ id: "refunds", severity: "warning", title: "Refunds are high", plainEnglish: `Refunds are ${leaks.refunds.ratePct.toFixed(0)}% of revenue${leaks.refunds.byItem[0] ? ` — ${leaks.refunds.byItem[0].name} leads them` : ""}.`, href: "/insights/leaks" });
  }
  const aged = leaks.unpaidAging.buckets[2];
  if (aged && aged.count > 0) {
    signals.push({ id: "unpaid", severity: "warning", title: "Old unpaid sales", plainEnglish: `${aged.count} sale${aged.count === 1 ? " has" : "s have"} been unpaid for over 30 days.`, href: "/insights/leaks" });
  }
  if (leaks.marginErosion[0] && leaks.marginErosion[0].deltaPts <= -3) {
    const m = leaks.marginErosion[0];
    signals.push({ id: "erosion", severity: "info", title: `${m.name} is earning less`, plainEnglish: `${m.name}'s margin dropped ${Math.abs(m.deltaPts).toFixed(0)} points to ${m.marginNowPct.toFixed(0)}%.`, href: "/insights/leaks" });
  }
  if (retention.repeat.customersWithPurchase >= 5 && retention.repeat.repeatRatePct < 20) {
    signals.push({ id: "retention", severity: "info", title: "Few customers return", plainEnglish: `Only ${retention.repeat.repeatRatePct.toFixed(0)}% of customers buy a second time.`, href: "/insights/customers" });
  }
  if (prev.ladder.trueProfit > 0 && cur.ladder.trueProfit > prev.ladder.trueProfit * 1.1) {
    signals.push({ id: "growth", severity: "positive", title: "Profit is growing", plainEnglish: "True profit is up meaningfully on the previous period — keep it going.", href: "/insights/profit" });
  }

  // ── What the hours say, for businesses that track them ───────────────────
  //
  // Gated INSIDE the function, not by middleware. `/reports/signals` is an
  // app-wide endpoint that every business hits; putting requireFeature on it
  // would 403 the sidebar health chip for everyone who does not use this
  // module. The gate belongs where the client-specific work begins.
  signals.push(...(await clientProfitabilitySignals(businessId, userId, current)));

  const rank: Record<SignalSeverity, number> = { critical: 0, warning: 1, info: 2, positive: 3 };
  signals.sort((a, b) => rank[a.severity] - rank[b.severity]);
  return { signals };
}

/**
 * The client-profitability nudges, or nothing at all.
 *
 * Deliberately swallows its own failures. The profitability report carries
 * reconciliation guards that THROW rather than serve a figure that disagrees
 * with the P&L — correct there, because that page's whole job is that number.
 * Here it would take down the sidebar health chip and the Dashboard banner for
 * an unrelated business-wide read. So a broken module costs its own nudges and
 * nothing else, and the failure is logged rather than swallowed silently.
 */
async function clientProfitabilitySignals(
  businessId: string,
  userId: string,
  current: PeriodRange,
): Promise<Signal[]> {
  try {
    const business = await getBusinessById(businessId);
    if (!business) return [];
    const { features } = loadBusinessCapabilities(business);
    if (!features.client_profitability) return [];

    const report = await computeClientProfitability(businessId, userId, current);
    return computeClientSignals({
      rows: report.rows,
      summary: report.summary,
      scopeCreep: report.scopeCreep,
      utilization: { overall: report.utilization.overall },
      concentration: report.concentration,
      coverage: report.coverage,
    });
  } catch (err) {
    logger.error({ err, businessId }, "client-profitability signals failed; the rest of the feed still stands");
    return [];
  }
}

// ── Momentum + frequently-bought-together (Insights 2.0, Block 4) ───────────

export async function computeMomentum(
  businessId: string,
  userId: string,
  current: PeriodRange,
  prior: PeriodRange,
) {
  const [a, b, curTxns, maps] = await Promise.all([
    axisAggregates(businessId, userId, current),
    axisAggregates(businessId, userId, prior),
    loadPeriodTransactions(businessId, current),
    loadNameMaps(businessId, userId),
  ]);

  // mergeAxis returns rows ordered by |delta|, so the biggest gains/drops are
  // already first within each sign.
  const items = mergeAxis(a.items, b.items);
  const sources = mergeAxis(a.sources, b.sources);

  const nameOfLine = (line: (typeof curTxns)[number]["lines"][number]) =>
    line.revenueItemId ? maps.revenueItems.get(line.revenueItemId)?.name ?? "Item" : line.label ?? "Item";

  const baskets = curTxns
    .filter(({ header }) => COUNTED.has(header.status) && header.direction === "in" && !header.adjustmentType)
    .map(({ lines }) => ({
      itemKeys: lines.filter((l) => (l.direction ?? "in") === "in").map(nameOfLine),
    }));
  const pairs = mineItemPairs(baskets).map((p) => ({ aName: p.a, bName: p.b, count: p.count }));

  return {
    itemWinners: items.filter((r) => r.deltaCents > 0).slice(0, 6),
    itemLosers: items.filter((r) => r.deltaCents < 0).slice(0, 6),
    sourceWinners: sources.filter((r) => r.deltaCents > 0).slice(0, 6),
    sourceLosers: sources.filter((r) => r.deltaCents < 0).slice(0, 6),
    pairs,
  };
}

// ── Profit leaks: where is money quietly draining? (Insights 2.0, Block 3) ──

interface LeakPass {
  grossTotal: number;
  discountTotal: number;
  refundedTotal: number;
  grossByItem: Map<string, { name: string; cents: number }>;
  refundedByItem: Map<string, { name: string; cents: number }>;
  refundedBySource: Map<string, { name: string; cents: number }>;
  netByItem: Map<string, number>;
  contribByItem: Map<string, number>;
  feesByName: Map<string, number>;
}

function leakPass(txns: Awaited<ReturnType<typeof loadPeriodTransactions>>, maps: Awaited<ReturnType<typeof loadNameMaps>>, lineToItem: Map<string, string>): LeakPass {
  const p: LeakPass = {
    grossTotal: 0,
    discountTotal: 0,
    refundedTotal: 0,
    grossByItem: new Map(),
    refundedByItem: new Map(),
    refundedBySource: new Map(),
    netByItem: new Map(),
    contribByItem: new Map(),
    feesByName: new Map(),
  };
  const itemName = (id: string) => maps.revenueItems.get(id)?.name ?? "Unknown item";

  for (const { header, lines } of txns) {
    if (!COUNTED.has(header.status)) continue;
    const sourceName = maps.sources.get(header.sourceId)?.name ?? "Manual";

    if (header.adjustmentType) {
      for (const line of lines) {
        if (!line.refundedLineId) continue;
        const amount = grossLineRevenue(profitLine(line)) - line.lineDiscountCents;
        p.refundedTotal += amount;
        const itemId = lineToItem.get(line.refundedLineId);
        if (itemId) {
          const e = p.refundedByItem.get(itemId) ?? { name: itemName(itemId), cents: 0 };
          e.cents += amount;
          p.refundedByItem.set(itemId, e);
        }
        const se = p.refundedBySource.get(header.sourceId) ?? { name: sourceName, cents: 0 };
        se.cents += amount;
        p.refundedBySource.set(header.sourceId, se);
      }
      continue;
    }
    if (header.direction !== "in") continue;

    const pLines = lines.map(profitLine);
    const revIdx = pLines.map((l, i) => ((l.direction ?? "in") === "in" ? i : -1)).filter((i) => i >= 0);
    const revLines = revIdx.map((i) => pLines[i]);
    const shares = orderDiscountShares(header.orderDiscountCents, revLines);
    p.discountTotal += header.orderDiscountCents;

    revIdx.forEach((lineIdx, k) => {
      const line = lines[lineIdx];
      const pl = pLines[lineIdx];
      const gross = grossLineRevenue(pl);
      p.grossTotal += gross;
      p.discountTotal += pl.lineDiscountCents;
      const net = netLineRevenue(pl, shares[k]);
      const contribution = net - lineCostTotal(pl);
      if (line.revenueItemId) {
        const g = p.grossByItem.get(line.revenueItemId) ?? { name: itemName(line.revenueItemId), cents: 0 };
        g.cents += gross;
        p.grossByItem.set(line.revenueItemId, g);
        p.netByItem.set(line.revenueItemId, (p.netByItem.get(line.revenueItemId) ?? 0) + net);
        p.contribByItem.set(line.revenueItemId, (p.contribByItem.get(line.revenueItemId) ?? 0) + contribution);
      }
      // Fee components from the frozen snapshot.
      const snap = line.costSnapshot as CostSnapshot | null;
      if (snap) {
        for (const comp of snap.components) {
          if (comp.kind !== "fee") continue;
          p.feesByName.set(comp.name, (p.feesByName.get(comp.name) ?? 0) + Math.round(comp.per_unit_cents * Number(line.qty)));
        }
      }
    });
  }
  return p;
}

export async function computeLeaks(
  businessId: string,
  userId: string,
  current: PeriodRange,
  prior: PeriodRange,
) {
  const [curTxns, priorTxns, maps] = await Promise.all([
    loadPeriodTransactions(businessId, current),
    loadPeriodTransactions(businessId, prior),
    loadNameMaps(businessId, userId),
  ]);

  /**
   * lineId → revenueItemId for the originals these windows' refunds point at.
   *
   * A refund may unwind a sale from outside the window, so these cannot come
   * from the loaded transactions alone. This used to read EVERY line in the
   * business for it, which grew with the ledger no matter how short the window
   * was; only the referenced originals are fetched now.
   */
  const refundedLineIds = [
    ...new Set(
      [...curTxns, ...priorTxns].flatMap(({ header, lines }) =>
        header.adjustmentType && COUNTED.has(header.status)
          ? lines.map((l) => l.refundedLineId).filter((id): id is string => !!id)
          : [],
      ),
    ),
  ];

  const lineToItem = new Map<string, string>();
  if (refundedLineIds.length > 0) {
    const originals = await db
      .select({ id: transactionLinesTable.id, revenueItemId: transactionLinesTable.revenueItemId })
      .from(transactionLinesTable)
      .innerJoin(transactionsTable, eq(transactionLinesTable.transactionId, transactionsTable.id))
      .where(
        and(eq(transactionsTable.businessId, businessId), inArray(transactionLinesTable.id, refundedLineIds)),
      );
    for (const l of originals) if (l.revenueItemId) lineToItem.set(l.id, l.revenueItemId);
  }

  const cur = leakPass(curTxns, maps, lineToItem);
  const prev = leakPass(priorTxns, maps, lineToItem);

  const refundByItem = [...cur.refundedByItem.entries()]
    .map(([id, e]) => ({ name: e.name, cents: e.cents, ratePct: (cur.grossByItem.get(id)?.cents ?? 0) > 0 ? (e.cents / (cur.grossByItem.get(id)!.cents)) * 100 : 0 }))
    .sort((a, b) => b.cents - a.cents)
    .slice(0, 8);
  const refundBySource = [...cur.refundedBySource.values()].sort((a, b) => b.cents - a.cents).slice(0, 8);

  const fees = [...new Set([...cur.feesByName.keys(), ...prev.feesByName.keys()])]
    .map((name) => ({ name, currentCents: cur.feesByName.get(name) ?? 0, priorCents: prev.feesByName.get(name) ?? 0, deltaCents: (cur.feesByName.get(name) ?? 0) - (prev.feesByName.get(name) ?? 0) }))
    .sort((a, b) => b.currentCents - a.currentCents);

  const marginErosion = [...cur.contribByItem.keys()]
    .map((id) => {
      const netNow = cur.netByItem.get(id) ?? 0;
      const netBefore = prev.netByItem.get(id) ?? 0;
      const marginNowPct = netNow > 0 ? ((cur.contribByItem.get(id) ?? 0) / netNow) * 100 : 0;
      const marginPriorPct = netBefore > 0 ? ((prev.contribByItem.get(id) ?? 0) / netBefore) * 100 : 0;
      return { name: cur.grossByItem.get(id)?.name ?? maps.revenueItems.get(id)?.name ?? "Item", marginNowPct, marginPriorPct, deltaPts: marginNowPct - marginPriorPct };
    })
    .filter((r) => r.marginPriorPct > 0 && r.deltaPts < -0.5)
    .sort((a, b) => a.deltaPts - b.deltaPts)
    .slice(0, 8);

  /*
   * What is owed, both ways — asked of `computeOwed`, never worked out here.
   *
   * This report used to derive both sides itself, and the two copies drifted
   * exactly where a second copy always does: `owed.ts` subtracts what an
   * advance has already covered (`appliedByBill`), and this file had never
   * heard of advances. On the construction demo the Dashboard therefore said
   * "You owe Rs 1,154,000" while the Money owed screen said Rs 1,004,000 —
   * the Rs 150,000 a deposit had already settled, chased twice.
   *
   * It also read the PERIOD's transactions, while a debt does not stop
   * existing because the header shows August. `computeOwed` loads the unpaid
   * rows whenever they happened, which is what the card's own "as of today"
   * label has always claimed.
   *
   * Same move as the ageing bands before it: §19 stopped this file writing its
   * own "31+ days" and had it call `summariseAging`. This finishes that.
   * `cachedRead` dedupes the underlying loads per request, so asking costs
   * little beyond the one extra query for the applications table.
   */
  const owed = await computeOwed(businessId, userId, new Date());

  return {
    refunds: { totalCents: cur.refundedTotal, ratePct: cur.grossTotal > 0 ? (cur.refundedTotal / cur.grossTotal) * 100 : 0, byItem: refundByItem, bySource: refundBySource },
    discounts: { totalCents: cur.discountTotal, pctOfGross: cur.grossTotal > 0 ? (cur.discountTotal / cur.grossTotal) * 100 : 0 },
    fees,
    marginErosion,
    unpaidAging: {
      totalCents: owed.incoming.totalCents,
      buckets: owed.incoming.buckets,
      // `computeOwed` already sorts most-urgent-first (late before merely old),
      // which is a better order for a chase list than the plain age sort this
      // used to do. `days` is that row's `daysOutstanding` under the name the
      // contract gives it.
      rows: owed.incoming.rows.slice(0, 20).map((row) => ({
        id: row.id,
        displayName: row.displayName,
        occurredAt: row.occurredAt,
        amountCents: row.amountCents,
        days: row.daysOutstanding,
      })),
    },
    unpaidPayables: { totalCents: owed.outgoing.totalCents, count: owed.outgoing.count },
  };
}

// ── Profit time-series (Wave 1) ─────────────────────────────────────────────
//
// The ladder over TIME: the period partitioned into buckets, each rung computed
// per bucket by the SAME computeProfitLadder. Every transaction lands in
// exactly one bucket and every rung is a sum over transactions, so bucket rungs
// are additive — they tie exactly to the whole-period ladder.

export type { SeriesBucket } from "./buckets";

export async function computePnlSeries(
  businessId: string,
  range: { start: Date; end: Date },
  bucket: SeriesBucket,
) {
  if (Number.isNaN(range.start.getTime())) throw invalid("startDate is invalid");
  if (Number.isNaN(range.end.getTime())) throw invalid("endDate is invalid");
  if (range.end < range.start) throw invalid("endDate must be after startDate");

  const boundaries: Date[] = [];
  let cursor = bucketStartOf(range.start, bucket);
  while (cursor <= range.end) {
    boundaries.push(cursor);
    cursor = nextBucketStart(cursor, bucket);
    if (boundaries.length > MAX_BUCKETS) {
      throw invalid(`Too many ${bucket} buckets for this range — pick a coarser bucket or a shorter period`);
    }
  }
  if (boundaries.length === 0) boundaries.push(bucketStartOf(range.start, bucket));

  // One load for the whole window; each transaction lands in exactly one bucket.
  const txns = await loadPeriodTransactions(businessId, { start: range.start, end: range.end });

  const buckets = boundaries.map((start, i) => {
    const endExclusive = i + 1 < boundaries.length ? boundaries[i + 1] : nextBucketStart(start, bucket);
    const slice = txns.filter(({ header }) => header.occurredAt >= start && header.occurredAt < endExclusive);
    const ladder = computeProfitLadder(slice.map(({ header, lines }) => profitTransaction(header, lines)));
    return {
      start: start.toISOString(),
      end: new Date(endExclusive.getTime() - 1).toISOString(),
      label: bucketLabel(start, bucket),
      ...ladder,
      transactionCount: slice.filter(({ header }) => COUNTED.has(header.status)).length,
    };
  });

  return { bucket, buckets };
}
