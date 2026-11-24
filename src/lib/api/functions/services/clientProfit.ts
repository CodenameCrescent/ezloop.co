import {
  clientEngagementsTable,
  db,
  expenseItemsTable,
  peopleTable,
  teamMemberRatesTable,
  timeEntriesTable,
  transactionLinesTable,
  type TeamMemberRate,
  type TimeEntry,
} from "@workspace/db";

type TimeEntryRow = TimeEntry;
import {
  addHours,
  computeConcentration,
  computeCoverage,
  computeScopeCreep,
  computeTargetProfit,
  computeUtilization,
  reworkShare,
  splitByWorkType,
  expenseLineSpends,
  grossLineRevenue,
  lineSubtotal,
  totalCostAttribution,
  isFullyAttributed,
  attributionReconciles,
  netLineRevenue,
  orderDiscountShares,
  summariseTargets,
  computeProfitLadder,
  monthsInWindow,
  selectEngagementForPeriod,
  type AgreedPeriod,
  type AttributionLine,
  type CostNature,
  type EngagementStatus,
  type AccountingBasis,
  type TargetProfit,
  type TargetProfitInput,
  type TimeTargetType,
  type WorkType,
} from "@workspace/domain";
import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { COUNTED_STATUSES, loadPeriodTransactions, profitLine, profitTransaction, type PeriodRange } from "./read";
import { listTimeTargets } from "./timesheet";

/**
 * Which client, product or subscription is actually worth having.
 *
 * Revenue comes from the ledger; labour comes from time entries at the rates
 * frozen on them; direct costs come from expense lines pointed at a target.
 * Nothing computed here is ever added to the profit ladder — attributed labour
 * is a DISTRIBUTION of payroll the ledger already counted.
 *
 * The rule that governs every figure: a target with NO HOURS gets no profit
 * number. See lib/domain/clientProfit.ts.
 */

const targetKey = (type: string, id: string) => `${type}:${id}`;

export async function computeClientProfitability(
  businessId: string,
  userId: string,
  range: PeriodRange,
  basis: AccountingBasis = "accrual",
) {
  const window = windowDates(range);
  const [txns, targets, timeRows, expenseItems] = await Promise.all([
    loadPeriodTransactions(businessId, range, basis),
    listTimeTargets(businessId),
    loadTimeEntries(businessId, range),
    db.select().from(expenseItemsTable).where(eq(expenseItemsTable.businessId, businessId)),
  ]);

  const expenseItemById = new Map(expenseItems.map((item) => [item.id, item]));

  // The SAME ladder the P&L page shows, built from the SAME transactions this
  // report reads — not a second query, so the two cannot answer for different
  // data. It exists only to be reconciled against, further down.
  const ladder = computeProfitLadder(
    txns.map(({ header, lines }) => profitTransaction(header, lines)),
    basis,
  );
  const ladderNetRevenueCents = ladder.netRevenue;

  // ── Revenue per target, from the ledger ──────────────────────────────────
  const revenueByTarget = new Map<string, number>();
  let unattributedRevenueCents = 0;
  const addRevenue = (key: string, cents: number) =>
    revenueByTarget.set(key, (revenueByTarget.get(key) ?? 0) + cents);

  /**
   * Which item each refunded line was selling.
   *
   * A refund line is label-only — it carries no `revenue_item_id` — so the only
   * way to take a return back off the PRODUCT that was returned is through the
   * original line it reverses. Without this the client lens would net off the
   * refund while the product lens stayed gross, and the same refund would be
   * counted differently by two tables on one page. The original sale can sit
   * outside the period, so it is fetched by id rather than looked for in
   * `txns`. One extra query, and only when refunds exist.
   */
  const refundedLineIds = txns.flatMap(({ header, lines }) =>
    header.adjustmentType ? lines.map((l) => l.refundedLineId).filter((id): id is string => Boolean(id)) : [],
  );
  const itemOfRefundedLine = new Map<string, string | null>();
  if (refundedLineIds.length > 0) {
    const originals = await db
      .select({ id: transactionLinesTable.id, revenueItemId: transactionLinesTable.revenueItemId })
      .from(transactionLinesTable)
      .where(inArray(transactionLinesTable.id, refundedLineIds));
    for (const o of originals) itemOfRefundedLine.set(o.id, o.revenueItemId);
  }

  for (const { header, lines } of txns) {
    if (!COUNTED_STATUSES.has(header.status)) continue;

    /**
     * A refund takes revenue BACK OFF the client who got it.
     *
     * These were skipped entirely, which meant a client's revenue here was
     * their gross, while the P&L's was net of refunds — so the worst kind of
     * client, the one who buys and returns, looked like one of the best. The
     * revenue guard below is what turned that into a failing request instead of
     * a plausible number. The rule mirrors the ladder's exactly: a line that
     * reverses a sale line reduces revenue; anything else (a chargeback fee) is
     * a period expense and never touches a client's revenue.
     */
    if (header.adjustmentType) {
      for (const line of lines) {
        const p = profitLine(line);
        // A line that reverses no sale line is a chargeback fee: money out that
        // is a period expense, and never a reduction of anyone's revenue.
        if (!p.refundedLineId) continue;
        const amount = grossLineRevenue(p) - p.lineDiscountCents;
        if (header.personId) addRevenue(targetKey("client", header.personId), -amount);
        else unattributedRevenueCents -= amount;

        // The product lens too, so a returned item stops looking like a seller.
        const itemId = itemOfRefundedLine.get(p.refundedLineId);
        if (itemId) addRevenue(targetKey("revenue_item", itemId), -amount);
      }
      continue;
    }

    const pLines = lines.map(profitLine);
    const revLines = pLines.filter((l, i) => (l.direction ?? header.direction) === "in");
    if (revLines.length === 0) continue;
    const shares = orderDiscountShares(header.orderDiscountCents, revLines);

    let revIndex = 0;
    lines.forEach((line, i) => {
      if ((pLines[i].direction ?? header.direction) !== "in") return;
      const net = netLineRevenue(pLines[i], shares[revIndex] ?? 0);
      revIndex += 1;
      // A sale counts for the CLIENT who paid it and, separately, for the item
      // sold. The two are different lenses on the same money and are never
      // summed together — a client row and a product row each answer a
      // different question.
      if (header.personId) addRevenue(targetKey("client", header.personId), net);
      // Money that names no customer would otherwise vanish from the
      // client-lens summary, so it is counted separately rather than silently.
      else unattributedRevenueCents += net;
      if (line.revenueItemId) addRevenue(targetKey("revenue_item", line.revenueItemId), net);
    });
    // Shipping is revenue too, and belongs to whoever paid it — or to nobody,
    // which still has to be counted. A walk-in sale with delivery charged on it
    // would otherwise leave its shipping in the P&L and nowhere on this page,
    // and the two would disagree by exactly that amount. The guard below is
    // what turned that into a failing test rather than a silent gap.
    if (header.shippingChargedCents > 0) {
      if (header.personId) addRevenue(targetKey("client", header.personId), header.shippingChargedCents);
      else unattributedRevenueCents += header.shippingChargedCents;
    }
  }

  // ── Labour per target, from the frozen rates on each entry ───────────────
  const labourByTarget = new Map<string, number>();
  const hoursByTarget = new Map<string, string>();
  const estimatedTargets = new Set<string>();
  let attributedLabourCents = 0;

  // Billable split and work types travel alongside, so utilization and rework
  // come out of the same pass rather than a second query.
  const billableHoursByTarget = new Map<string, string>();
  const workTypeByTarget = new Map<string, Array<{ workType: WorkType; hours: string }>>();
  const hoursByPerson = new Map<string, { billable: string; total: string }>();
  let billableHoursTotal = "0";
  let allHoursTotal = "0";

  for (const row of timeRows) {
    const key = targetKey(row.targetType, row.targetId);
    labourByTarget.set(key, (labourByTarget.get(key) ?? 0) + row.costAmountCents);
    hoursByTarget.set(key, addHours(hoursByTarget.get(key) ?? "0", row.hours));
    if (row.isEstimated) estimatedTargets.add(key);
    attributedLabourCents += row.costAmountCents;

    workTypeByTarget.set(key, [
      ...(workTypeByTarget.get(key) ?? []),
      { workType: row.workType as WorkType, hours: row.hours },
    ]);

    const person = hoursByPerson.get(row.personId) ?? { billable: "0", total: "0" };
    person.total = addHours(person.total, row.hours);
    allHoursTotal = addHours(allHoursTotal, row.hours);
    if (row.billable) {
      person.billable = addHours(person.billable, row.hours);
      billableHoursByTarget.set(key, addHours(billableHoursByTarget.get(key) ?? "0", row.hours));
      billableHoursTotal = addHours(billableHoursTotal, row.hours);
    }
    hoursByPerson.set(row.personId, person);
  }

  // ── Direct costs: expense lines pointed at a target ──────────────────────
  //
  // Every expense line in the period is classified, not just the targeted ones.
  // Counting only what found a home is what made a client's Rs 0 unreadable:
  // it could mean "genuinely nothing beyond labour" or "nobody filled this in",
  // and the page could not tell the owner which. The other two buckets are
  // what answer that. See lib/domain/costAttribution.ts.
  const directByTarget = new Map<string, number>();
  const attributionLines: Array<AttributionLine & { spendCents: number }> = [];
  for (const { header, lines } of txns) {
    if (!COUNTED_STATUSES.has(header.status)) continue;
    const pLines = lines.map(profitLine);
    const isAdjustment = !!header.adjustmentType;
    // Refund lines reverse a sale rather than spending anything; only a fee
    // line on an adjustment is a cost, and the ladder counts it as one.
    const spends = isAdjustment
      ? lines.map((line, i) => (line.refundedLineId ? 0 : lineSubtotal(pLines[i])))
      : expenseLineSpends(pLines, header.orderDiscountCents, basis);
    const hasSale = pLines.some((line, i) => (line.direction ?? header.direction) === "in");

    lines.forEach((line, i) => {
      const isExpenseLine = isAdjustment
        ? !line.refundedLineId
        : (pLines[i].direction ?? header.direction) === "out";
      if (!isExpenseLine) return;

      const targeted = !!(line.targetType && line.targetId);
      if (targeted && !isAdjustment) {
        const key = targetKey(line.targetType!, line.targetId!);
        directByTarget.set(key, (directByTarget.get(key) ?? 0) + spends[i]);
      }

      const item = line.expenseItemId ? expenseItemById.get(line.expenseItemId) : null;
      attributionLines.push({
        targeted,
        costNature: (item?.costNature as CostNature | undefined) ?? null,
        isAdjustmentFee: isAdjustment,
        insideSale: hasSale,
        spendCents: spends[i],
      });
    });
  }
  const costAttribution = totalCostAttribution(attributionLines);

  // ── Overhead per target, for the SECONDARY figure only ───────────────────
  // Derived from the same entries, using each person's overhead share of their
  // frozen rate. Kept apart from labour so it can never reach contribution.
  const overheadByTarget = await overheadPerTarget(businessId, timeRows);

  // ── Assemble, including every target that has revenue or hours ───────────
  // Labels come from the target picker, but that only lists clients with a live
  // engagement. Anyone who earned money is shown here whether or not they were
  // ever formally added, so their name is read from `people` as a fallback —
  // a customer showing as "(no longer listed)" would be a bug on screen.
  const labelFor = new Map(targets.map((t) => [targetKey(t.targetType, t.targetId), t.label]));
  const allPeople = await db.select().from(peopleTable).where(eq(peopleTable.businessId, businessId));
  for (const person of allPeople) {
    const key = targetKey("client", person.id);
    if (!labelFor.has(key)) labelFor.set(key, person.displayName);
  }
  const keys = new Set<string>([...revenueByTarget.keys(), ...labourByTarget.keys(), ...directByTarget.keys()]);

  const rows: TargetProfit[] = [...keys]
    .map((key) => {
      const [type, id] = key.split(":");
      const input: TargetProfitInput = {
        targetType: type as TimeTargetType,
        targetId: id,
        label: labelFor.get(key) ?? "(no longer listed)",
        revenueCents: revenueByTarget.get(key) ?? 0,
        labourCostCents: labourByTarget.get(key) ?? 0,
        overheadCostCents: overheadByTarget.get(key) ?? 0,
        directCostCents: directByTarget.get(key) ?? 0,
        hoursLogged: hoursByTarget.get(key) ?? "0",
        // THE gate: hours must actually exist for any profit figure to appear.
        hasHours: labourByTarget.has(key),
        hasEstimates: estimatedTargets.has(key),
      };
      return computeTargetProfit(input);
    })
    .sort((a, b) => b.revenueCents - a.revenueCents);

  // ── Reconciliation guard: attribution must equal the time entries total ──
  const attributedAcrossRows = rows.reduce((sum, r) => sum + (r.labourCostCents ?? 0), 0);
  if (attributedAcrossRows !== attributedLabourCents) {
    // Loud on purpose, following the Phase 2 pattern. Labour that vanishes
    // between the grid and this report is exactly the bug class this module
    // would otherwise hide behind plausible-looking numbers.
    throw new Error(
      `client profitability: attributed labour ${attributedAcrossRows} does not reconcile with time entries total ${attributedLabourCents}`,
    );
  }

  // ── Reconciliation guard: the revenue here IS the P&L's revenue ──────────
  //
  // The labour guard above proves nothing leaked out of the time entries. This
  // one proves the same about the money, against the one figure the owner has
  // already seen elsewhere. Every rupee of net revenue for this period must
  // land on exactly one client row or in `unattributedRevenueCents` — so the
  // client lens and the P&L cannot drift apart without something failing here
  // first. Without it, a change to discount allocation or shipping could quietly
  // make this page disagree with the ladder and nothing would say so.
  const clientLensRevenue =
    rows.filter((r) => r.targetType === "client").reduce((sum, r) => sum + r.revenueCents, 0) +
    unattributedRevenueCents;
  // ── The same guard, for costs ────────────────────────────────────────────
  //
  // Every rupee of the period's expenses lands in exactly one of the three
  // buckets. This is what makes the page's claim about itself trustworthy: if
  // it says "Rs X could have named a client and didn't", that X plus what did
  // name one plus the overheads IS the P&L's cost figure, not an approximation
  // of it. Writing this check is what caught a chargeback fee falling outside
  // all three buckets — a cost the page would have silently failed to account
  // for while telling the owner it had accounted for everything.
  if (!attributionReconciles(costAttribution, ladder.periodExpenses)) {
    const sum =
      costAttribution.targetedCents +
      costAttribution.untargetedSplittableCents +
      costAttribution.neverSplitCents;
    throw new Error(
      `client profitability: cost attribution ${sum} does not reconcile with the P&L's period expenses ${ladder.periodExpenses}`,
    );
  }

  if (clientLensRevenue !== ladderNetRevenueCents) {
    throw new Error(
      `client profitability: client-lens revenue ${clientLensRevenue} does not reconcile with the P&L's net revenue ${ladderNetRevenueCents}`,
    );
  }

  // ONE LENS for the summary. A sale to a client for a product is in `rows`
  // twice — under the client and under the product — because each answers a
  // different question about the same money. Totalling both would double the
  // revenue and halve the margin. The client lens is the headline, with
  // internal rows included because they carry cost and no revenue.
  // `rows` is passed alongside so the "these are estimates" warning covers the
  // whole page: an estimate on a product must not leave the banner silent while
  // the row beneath it is plainly marked.
  const summary = summariseTargets(rows.filter((r) => r.targetType !== "revenue_item"), rows);
  const payrollCents = await payrollForPeriod(businessId, range, basis, expenseItems);

  // ── The three things the hours reveal that profit alone does not ─────────
  const engagements = await db
    .select()
    .from(clientEngagementsTable)
    .where(eq(clientEngagementsTable.businessId, businessId));
  /**
   * EVERY engagement, not just the live one.
   *
   * Taking only the active engagement had a consequence nobody intended:
   * marking a client Finished erased their scope-creep record. The overrun
   * really happened and their hours still count in every other figure here, so
   * the agreement that covered the period is what gets used, live or not.
   */
  const engagementsByPerson = new Map<string, typeof engagements>();
  for (const engagement of engagements) {
    engagementsByPerson.set(engagement.personId, [
      ...(engagementsByPerson.get(engagement.personId) ?? []),
      engagement,
    ]);
  }

  // Read through the SAME window the hours were, so the two can never describe
  // different stretches of time.
  const periodMonths = monthsInWindow(window.startIso, window.endIso);

  const clientRows = rows.filter((r) => r.targetType === "client");

  const scopeCreep = clientRows
    .map((row) => {
      const forPerson: typeof engagements = engagementsByPerson.get(row.targetId) ?? [];
      const engagement = selectEngagementForPeriod(forPerson, window.startIso, window.endIso);
      const creep = computeScopeCreep({
        agreedHours: engagement?.agreedHours ?? null,
        agreedAmountCents: engagement?.agreedAmountCents ?? null,
        actualHours: row.hoursLogged,
        revenueCents: row.revenueCents,
        agreedHoursPeriod: (engagement?.agreedHoursPeriod as AgreedPeriod) ?? "total",
        agreedAmountPeriod: (engagement?.agreedAmountPeriod as AgreedPeriod) ?? "total",
        periodMonths,
        // The engagement's OWN length, needed only when the two figures are
        // quoted on different bases. Null when it has no dates, which is the
        // case that returns a reason instead of a price.
        contractMonths: monthsInWindow(engagement?.startDate, engagement?.endDate),
      });
      return {
        targetId: row.targetId,
        label: row.label,
        engagementStatus: (engagement?.engagementStatus as EngagementStatus) ?? "active",
        ...creep,
      };
    })
    // Only rows with an agreement to be over. No agreement is not "0% over".
    .filter((c) => c.overPct !== null)
    .sort((a, b) => (b.overPct ?? 0) - (a.overPct ?? 0));

  const memberNames = new Map(allPeople.map((p) => [p.id, p.displayName]));
  const utilizationByMember = [...hoursByPerson.entries()]
    .map(([personId, h]) => ({
      personId,
      name: memberNames.get(personId) ?? "Team member",
      ...computeUtilization(h.billable, h.total),
    }))
    .sort((a, b) => Number(b.totalHours) - Number(a.totalHours));

  const concentration = computeConcentration(
    clientRows.map((r) => ({ label: r.label, revenueCents: r.revenueCents })),
  );

  const workTypes = splitByWorkType(timeRows.map((r) => ({ workType: r.workType as WorkType, hours: r.hours })));

  return {
    basis,
    rows,
    summary,
    /** Revenue that names no customer — outside the client lens, never lost. */
    unattributedRevenueCents,
    /**
     * What every cost this period did with itself. `fullyAttributed` is the
     * gate: when true, a client showing no cost to serve is stating a fact and
     * the page needs no caveat. When false, the page must say what is missing,
     * because the zeros cannot be read without it.
     */
    costAttribution: {
      ...costAttribution,
      fullyAttributed: isFullyAttributed(costAttribution),
    },
    coverage: computeCoverage(attributedLabourCents, payrollCents),
    /** Clients past the hours they agreed to, worst first. */
    scopeCreep,
    /** Billable share, per person and for the business. */
    utilization: {
      overall: computeUtilization(billableHoursTotal, allHoursTotal),
      byMember: utilizationByMember,
    },
    /** How much of the book rests on one client. */
    concentration,
    /** Where the hours went — rework stands on its own, never inside delivery. */
    workTypes,
    /** Rework per client, since it is the leading indicator of a bad one. */
    reworkByClient: clientRows
      .map((row) => {
        const slices = splitByWorkType(workTypeByTarget.get(targetKey("client", row.targetId)) ?? []);
        const rework = reworkShare(slices);
        return rework ? { targetId: row.targetId, label: row.label, hours: rework.hours, sharePct: rework.sharePct } : null;
      })
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .sort((a, b) => b.sharePct - a.sharePct),
  };
}

/**
 * The window as plain dates — the ONE derivation everything here reads.
 *
 * A time entry is a date, not an instant, so the range's timestamps get
 * truncated to pick them. The months multiplier has to be measured over
 * exactly the same dates, or the agreed hours would describe a different
 * stretch of time from the hours they are compared against. Hoisted so the two
 * cannot drift apart.
 *
 * A browser five hours ahead of UTC asking for "July" sends a window that
 * truncates to 30 June – 31 July, and 1.03 months is the honest answer for it.
 * Do not "fix" that to 1.0 — it would make the multiplier disagree with the
 * hours it divides.
 */
function windowDates(range: PeriodRange) {
  return {
    startIso: range.start ? range.start.toISOString().slice(0, 10) : null,
    endIso: range.end ? range.end.toISOString().slice(0, 10) : null,
  };
}

async function loadTimeEntries(businessId: string, range: PeriodRange) {
  const { startIso, endIso } = windowDates(range);
  const conditions = [eq(timeEntriesTable.businessId, businessId)];
  if (startIso) conditions.push(gte(timeEntriesTable.entryDate, startIso));
  if (endIso) conditions.push(lte(timeEntriesTable.entryDate, endIso));
  return db.select().from(timeEntriesTable).where(and(...conditions));
}

/**
 * Each target's share of overhead, from the people whose hours landed on it.
 *
 * The frozen rate on an entry is fully loaded (pay + overhead), so the overhead
 * portion is recovered from the person's rate rather than re-derived. Feeds the
 * secondary figure only.
 */
async function overheadPerTarget(businessId: string, timeRows: TimeEntryRow[]) {
  const out = new Map<string, number>();
  if (timeRows.length === 0) return out;

  const rates = await db
    .select()
    .from(teamMemberRatesTable)
    .where(eq(teamMemberRatesTable.businessId, businessId));

  for (const row of timeRows) {
    // The rate whose window contains this entry's date.
    const on = new Date(`${row.entryDate}T12:00:00Z`);
    const rate = rates
      .filter((r) => r.personId === row.personId && r.effectiveFrom <= on && (!r.effectiveTo || r.effectiveTo >= on))
      .sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime())[0];
    if (!rate || rate.effectiveHourlyCostCents <= 0) continue;

    // What fraction of the loaded rate was overhead, applied to this entry's cost.
    const overheadHourly = Math.max(0, rate.effectiveHourlyCostCents - payHourlyOf(rate));
    const share = Math.round((overheadHourly / rate.effectiveHourlyCostCents) * row.costAmountCents);
    const key = targetKey(row.targetType, row.targetId);
    out.set(key, (out.get(key) ?? 0) + share);
  }
  return out;
}

function payHourlyOf(rate: TeamMemberRate): number {
  if (rate.costType !== "salaried") return rate.hourlyRateCents ?? 0;
  const target = Number(rate.billableTargetHours || "0");
  return target > 0 ? Math.round(rate.monthlyCostCents / target) : 0;
}

/** What was actually paid in wages this period — the yardstick coverage uses. */
async function payrollForPeriod(
  businessId: string,
  range: PeriodRange,
  basis: AccountingBasis,
  expenseItems: Array<typeof expenseItemsTable.$inferSelect>,
) {
  const payrollItemIds = new Set(expenseItems.filter((i) => i.type === "payroll").map((i) => i.id));
  if (payrollItemIds.size === 0) return 0;

  const txns = await loadPeriodTransactions(businessId, range, basis);
  let total = 0;
  for (const { header, lines } of txns) {
    if (!COUNTED_STATUSES.has(header.status) || header.adjustmentType) continue;
    const pLines = lines.map(profitLine);
    if (pLines.some((l, i) => (l.direction ?? header.direction) === "in")) continue;
    const spends = expenseLineSpends(pLines, header.orderDiscountCents, basis);
    lines.forEach((line, i) => {
      if (line.expenseItemId && payrollItemIds.has(line.expenseItemId)) total += spends[i];
    });
  }
  return total;
}
