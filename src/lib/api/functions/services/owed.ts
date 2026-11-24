import {
  netLineRevenue,
  orderDiscountShares,
  lineSubtotal,
  owedRow as owedRowOf,
  summariseAging,
  type OwedInput,
} from "@workspace/domain";
import type { EndpointResponse, getOwed } from "@workspace/api-contract";
import { loadNameMaps, loadUnpaidTransactions, profitLine } from "./read";
import { db, paymentApplicationsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

/**
 * Who owes you, and who you owe.
 *
 * The MATH is entirely `lib/domain/owed.ts`; this file only fetches rows, works
 * out what each one is worth, and asks the domain how it stands. Nothing here
 * decides what "overdue" means.
 */

type OwedReport = EndpointResponse<typeof getOwed>;
type Side = OwedReport["incoming"];

interface Draft {
  id: string;
  displayName: string;
  occurredAt: Date;
  dueDate: string | null;
  amountCents: number;
  personId: string | null;
  personName: string | null;
  sourceName: string;
  referenceNumber: string | null;
  input: OwedInput;
}

function buildSide(drafts: Draft[], now: Date): Side {
  const rows = drafts
    .map((draft) => {
      const owed = owedRowOf(draft.input, now)!;
      return {
        id: draft.id,
        displayName: draft.displayName,
        occurredAt: draft.occurredAt.toISOString(),
        dueDate: draft.dueDate,
        amountCents: draft.amountCents,
        state: owed.state,
        daysOverdue: owed.daysOverdue,
        daysOutstanding: owed.daysOutstanding,
        personId: draft.personId,
        personName: draft.personName,
        sourceName: draft.sourceName,
        referenceNumber: draft.referenceNumber,
      };
    })
    /**
     * Most urgent first, and "urgent" means LATE before it means old. A bill
     * three days past its agreed date outranks one that has sat undated for a
     * year, because only the first one broke a promise. Undated rows then sort
     * by age among themselves, which is the only ordering they can honestly
     * have.
     */
    .sort((a, b) => b.daysOverdue - a.daysOverdue || b.daysOutstanding - a.daysOutstanding);

  const summary = summariseAging(rows.map((row) => ({ days: row.daysOutstanding, amountCents: row.amountCents })));
  const overdue = rows.filter((row) => row.state === "overdue");

  return {
    totalCents: summary.totalCents,
    count: summary.count,
    overdueCents: overdue.reduce((sum, row) => sum + row.amountCents, 0),
    overdueCount: overdue.length,
    buckets: summary.buckets,
    rows,
  };
}

export async function computeOwed(businessId: string, userId: string, now: Date): Promise<OwedReport> {
  const [txns, maps, applications] = await Promise.all([
    loadUnpaidTransactions(businessId),
    loadNameMaps(businessId, userId),
    db
      .select()
      .from(paymentApplicationsTable)
      .where(eq(paymentApplicationsTable.businessId, businessId)),
  ]);

  /**
   * What an advance has already covered, per bill.
   *
   * A bill part-settled from an advance is owed for the REMAINDER, not for its
   * face value. Without this the list would keep chasing money that has already
   * changed hands — the exact overstatement the advance was recorded to avoid.
   * A bill covered in full has its `paid_at` stamped and never reaches here.
   */
  const appliedByBill = new Map<string, number>();
  for (const application of applications) {
    appliedByBill.set(
      application.transactionId,
      (appliedByBill.get(application.transactionId) ?? 0) + application.amountCents,
    );
  }

  const incoming: Draft[] = [];
  const outgoing: Draft[] = [];

  for (const { header, lines } of txns) {
    const input: OwedInput = {
      occurredAt: header.occurredAt,
      paidAt: header.paidAt,
      dueDate: header.dueDate ? new Date(`${header.dueDate}T00:00:00Z`) : null,
      status: header.status as OwedInput["status"],
    };
    // The one gate: not paid, and a real money event. A `pending` recurring post
    // nobody has confirmed is not a debt, and must never reach a chase list.
    if (!owedRowOf(input, now)) continue;

    // An adjustment is not a bill. A refund you owe a customer reverses money
    // that was already counted; treating it as a payable would ask the owner to
    // chase themselves.
    if (header.adjustmentType) continue;

    const personName = header.personId ? (maps.people.get(header.personId) ?? null) : null;
    const first = lines[0];
    const baseName = first
      ? (first.revenueItemId ? maps.revenueItems.get(first.revenueItemId)?.name : null) ??
        (first.expenseItemId ? maps.expenseItems.get(first.expenseItemId)?.name : null) ??
        first.label ??
        (header.direction === "in" ? "Sale" : "Bill")
      : header.direction === "in"
        ? "Sale"
        : "Bill";

    const draft = {
      id: header.id,
      displayName: lines.length > 1 ? `${baseName} +${lines.length - 1}` : baseName,
      occurredAt: header.occurredAt,
      dueDate: header.dueDate ?? null,
      personId: header.personId ?? null,
      personName,
      sourceName: maps.sources.get(header.sourceId)?.name ?? "Manual",
      referenceNumber: header.referenceNumber ?? null,
      input,
    };

    if (header.direction === "in") {
      // What the customer actually owes: revenue lines net of every discount,
      // plus anything charged for delivery. Tax collected is excluded from
      // revenue everywhere else in this app, but it IS owed — the customer
      // hands it over and the business passes it on — so it stays in.
      const pLines = lines.map(profitLine);
      const revLines = pLines.filter((line) => (line.direction ?? "in") === "in");
      const shares = orderDiscountShares(header.orderDiscountCents, revLines);
      const amount =
        revLines.reduce((sum, line, i) => sum + netLineRevenue(line, shares[i]), 0) +
        header.shippingChargedCents +
        header.taxCollectedCents;
      incoming.push({ ...draft, amountCents: Math.max(0, amount - (appliedByBill.get(header.id) ?? 0)) });
    } else {
      // A spread purchase posts monthly slices as CHILD rows, and the debt is
      // the parent's whole amount. Counting a slice would owe the same money
      // twice — once as the invoice, again as this month's share of it.
      if (header.parentTransactionId) continue;
      // The bill as written: subtotals less the order discount, tax included.
      // An invoice is owed inclusive of tax whether or not it is reclaimable —
      // reclaiming is a later, separate event.
      const amount =
        lines.reduce((sum, line) => sum + lineSubtotal(profitLine(line)), 0) - header.orderDiscountCents;
      outgoing.push({ ...draft, amountCents: Math.max(0, amount - (appliedByBill.get(header.id) ?? 0)) });
    }
  }

  return { incoming: buildSide(incoming, now), outgoing: buildSide(outgoing, now) };
}
