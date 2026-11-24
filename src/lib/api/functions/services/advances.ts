import {
  db,
  paymentApplicationsTable,
  transactionLinesTable,
  transactionsTable,
  type Transaction,
} from "@workspace/db";
import {
  advanceBalance,
  applicableAmount,
  isFullySettled,
  lineSubtotal,
  netLineRevenue,
  orderDiscountShares,
} from "@workspace/domain";
import { and, eq, inArray, sql } from "drizzle-orm";
import { uid } from "../lib/uid";
import { invalid, notFound } from "./errors";
import { loadNameMaps, profitLine } from "./read";

/**
 * Advances: money that moved before the work did, and how it later ends.
 *
 * The RULES are `lib/domain/advances.ts` — what is left, how much may be
 * applied, when a bill counts as settled. This file finds the rows and writes
 * the applications, and decides nothing.
 */

/** What one transaction is worth, by the same rules the owed lists use. */
function amountOf(header: Transaction, lines: (typeof transactionLinesTable.$inferSelect)[]): number {
  if (header.direction === "in") {
    const rev = lines.filter((line) => line.direction === "in").map(profitLine);
    const shares = orderDiscountShares(header.orderDiscountCents, rev);
    return (
      rev.reduce((sum, line, i) => sum + netLineRevenue(line, shares[i]), 0) +
      header.shippingChargedCents +
      header.taxCollectedCents
    );
  }
  return lines.reduce((sum, line) => sum + lineSubtotal(profitLine(line)), 0) - header.orderDiscountCents;
}

async function linesFor(transactionIds: string[]) {
  const byTxn = new Map<string, (typeof transactionLinesTable.$inferSelect)[]>();
  if (transactionIds.length === 0) return byTxn;
  const rows = await db
    .select()
    .from(transactionLinesTable)
    .where(inArray(transactionLinesTable.transactionId, transactionIds));
  for (const row of rows) {
    const list = byTxn.get(row.transactionId) ?? [];
    list.push(row);
    byTxn.set(row.transactionId, list);
  }
  return byTxn;
}

/** Every application in this business, keyed by what it settled and what it came from. */
async function loadApplications(businessId: string) {
  const rows = await db
    .select()
    .from(paymentApplicationsTable)
    .where(eq(paymentApplicationsTable.businessId, businessId));
  const againstBill = new Map<string, number>();
  const drawnFromAdvance = new Map<string, number>();
  for (const row of rows) {
    againstBill.set(row.transactionId, (againstBill.get(row.transactionId) ?? 0) + row.amountCents);
    if (row.appliedFromTransactionId) {
      drawnFromAdvance.set(
        row.appliedFromTransactionId,
        (drawnFromAdvance.get(row.appliedFromTransactionId) ?? 0) + row.amountCents,
      );
    }
  }
  return { againstBill, drawnFromAdvance };
}

export interface AdvanceRow {
  id: string;
  direction: "in" | "out";
  displayName: string;
  occurredAt: string;
  personId: string | null;
  personName: string | null;
  amountCents: number;
  usedCents: number;
  remainingCents: number;
}

/**
 * Advances with something still on them — money paid ahead, or held on someone
 * else's behalf.
 *
 * Fully-used advances drop off: they have become an ordinary cost of the month
 * the work happened in, and leaving them on a "paid ahead" list would keep
 * showing the owner money that is no longer theirs to spend.
 */
export async function listOpenAdvances(businessId: string, userId: string): Promise<AdvanceRow[]> {
  const rows = await db
    .select({ header: transactionsTable, line: transactionLinesTable })
    .from(transactionLinesTable)
    .innerJoin(transactionsTable, eq(transactionLinesTable.transactionId, transactionsTable.id))
    .where(
      and(
        eq(transactionsTable.businessId, businessId),
        eq(transactionLinesTable.isAdvance, true),
        // A void advance is not money, and an unconfirmed one has not happened.
        inArray(transactionsTable.status, ["completed", "disputed"]),
      ),
    );

  const [{ drawnFromAdvance }, maps] = await Promise.all([
    loadApplications(businessId),
    loadNameMaps(businessId, userId),
  ]);

  const byTransaction = new Map<string, { header: Transaction; lines: typeof rows[number]["line"][] }>();
  for (const row of rows) {
    const entry = byTransaction.get(row.header.id) ?? { header: row.header, lines: [] };
    entry.lines.push(row.line);
    byTransaction.set(row.header.id, entry);
  }

  const out: AdvanceRow[] = [];
  for (const { header, lines } of byTransaction.values()) {
    // Only the advance LINES count toward the advance; an ordinary line on the
    // same transaction is an ordinary cost and was spent, not paid ahead.
    const amountCents = lines.reduce((sum, line) => sum + lineSubtotal(profitLine(line)), 0);
    const usedCents = drawnFromAdvance.get(header.id) ?? 0;
    const remainingCents = advanceBalance(amountCents, [{ amountCents: usedCents }]);
    if (remainingCents <= 0) continue;

    const first = lines[0];
    const name =
      (first.expenseItemId ? maps.expenseItems.get(first.expenseItemId)?.name : null) ??
      (first.revenueItemId ? maps.revenueItems.get(first.revenueItemId)?.name : null) ??
      first.label ??
      (header.direction === "out" ? "Advance paid" : "Deposit received");

    out.push({
      id: header.id,
      direction: header.direction as "in" | "out",
      displayName: name,
      occurredAt: header.occurredAt.toISOString(),
      personId: header.personId ?? null,
      personName: header.personId ? (maps.people.get(header.personId) ?? null) : null,
      amountCents,
      usedCents,
      remainingCents,
    });
  }

  return out.sort((a, b) => b.remainingCents - a.remainingCents);
}

export interface SettleInput {
  /** The bill or invoice being settled. */
  transactionId: string;
  /** The advance to draw from. */
  advanceTransactionId: string;
  /** Omit to apply as much as both sides allow. */
  amountCents?: number;
  appliedOn?: string;
}

/**
 * Draw an advance down against a real bill.
 *
 * Append-only: this writes an application row and, when the bill is fully
 * covered, stamps its `paid_at`. It never edits an existing row and never
 * touches an amount — the bill is still for what it was always for.
 */
export async function settleFromAdvance(businessId: string, input: SettleInput) {
  if (input.transactionId === input.advanceTransactionId) {
    throw invalid("An advance cannot settle itself");
  }

  const headers = await db
    .select()
    .from(transactionsTable)
    .where(
      and(
        eq(transactionsTable.businessId, businessId),
        inArray(transactionsTable.id, [input.transactionId, input.advanceTransactionId]),
      ),
    );
  const bill = headers.find((row) => row.id === input.transactionId);
  const advance = headers.find((row) => row.id === input.advanceTransactionId);
  if (!bill) throw notFound("Transaction");
  if (!advance) throw notFound("Advance");
  if (bill.paidAt) throw invalid("That bill is already settled");
  if (bill.status === "void" || advance.status === "void") throw invalid("A void transaction cannot be settled");
  // An advance paid out settles a bill you owe; a deposit taken in settles an
  // invoice you raised. Crossing them would net a customer's deposit against a
  // supplier's bill, which is two unrelated obligations pretending to cancel.
  if (bill.direction !== advance.direction) {
    throw invalid("An advance can only settle money moving the same way");
  }

  const lines = await linesFor([bill.id, advance.id]);
  const advanceLines = (lines.get(advance.id) ?? []).filter((line) => line.isAdvance);
  if (advanceLines.length === 0) throw invalid("That transaction is not an advance");

  const { againstBill, drawnFromAdvance } = await loadApplications(businessId);
  const billCents = amountOf(bill, lines.get(bill.id) ?? []);
  const advanceCents = advanceLines.reduce((sum, line) => sum + lineSubtotal(profitLine(line)), 0);
  const remaining = advanceBalance(advanceCents, [{ amountCents: drawnFromAdvance.get(advance.id) ?? 0 }]);

  const most = applicableAmount({
    billCents,
    alreadyAppliedCents: againstBill.get(bill.id) ?? 0,
    advanceBalanceCents: remaining,
  });
  if (most <= 0) throw invalid("There is nothing left to apply");

  const amountCents = input.amountCents ?? most;
  if (amountCents <= 0) throw invalid("An application has to be for more than nothing");
  if (amountCents > most) {
    throw invalid(`Only ${most} can be applied — the advance or the bill will not take more`);
  }

  const appliedOn = input.appliedOn ?? new Date().toISOString().slice(0, 10);

  return db.transaction(async (tx) => {
    await tx.insert(paymentApplicationsTable).values({
      id: uid("pa"),
      businessId,
      transactionId: bill.id,
      appliedFromTransactionId: advance.id,
      amountCents,
      appliedOn,
    });

    const totalApplied = (againstBill.get(bill.id) ?? 0) + amountCents;
    const settled = isFullySettled(billCents, [{ amountCents: totalApplied }]);
    if (settled) {
      // `paid_at` stays the ONE answer to "is this settled". Applications
      // explain how; they never become a second answer to whether.
      await tx
        .update(transactionsTable)
        .set({ paidAt: new Date(`${appliedOn}T00:00:00Z`), updatedAt: new Date() })
        .where(eq(transactionsTable.id, bill.id));
    }

    return {
      appliedCents: amountCents,
      billStillOwesCents: Math.max(0, billCents - totalApplied),
      advanceRemainingCents: remaining - amountCents,
      billSettled: settled,
    };
  });
}

/** What has been applied to a bill, for the drawer to show how it was settled. */
export async function applicationsFor(businessId: string, transactionId: string) {
  return db
    .select()
    .from(paymentApplicationsTable)
    .where(
      and(
        eq(paymentApplicationsTable.businessId, businessId),
        eq(paymentApplicationsTable.transactionId, transactionId),
      ),
    )
    .orderBy(sql`${paymentApplicationsTable.appliedOn} asc`);
}
