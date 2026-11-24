/**
 * TODO(R4): delete. Client-side adapter turning the new cents-native ledger +
 * catalog into the legacy rupee-float AppData shape (orders/products/expenses)
 * that the not-yet-rebuilt pages (Dashboard, Insights, Cash Flow, Budget) read
 * from the store. The rebuilt money pages bypass this and use the typed hooks
 * directly. Money crosses cents→rupees exactly once, here.
 */
import type { EndpointResponse } from "@workspace/api-contract";
import type { listExpenseItems, listRevenueItems, listTransactions } from "@workspace/api-contract";
import type { AdSpendEntry, Order, OrderItem, Product } from "./types";
import type { Expense } from "./legacyTypes";

type TransactionSummary = EndpointResponse<typeof listTransactions>["items"][number];
type RevenueItem = EndpointResponse<typeof listRevenueItems>["items"][number];
type ExpenseItem = EndpointResponse<typeof listExpenseItems>["items"][number];

const toRupees = (cents: number) => cents / 100;

const TYPE_TO_OFFER: Record<string, string> = {
  product: "physical_product",
  service: "service",
  subscription: "subscription",
  rental: "custom",
  commission: "custom",
  royalty: "custom",
  other: "custom",
};

export function revenueItemToProduct(item: RevenueItem): Product {
  const unitCostCents = item.openComponents
    .filter((c) => c.calcType === "fixed_per_unit" && c.sourceId === null)
    .reduce((sum, c) => sum + (c.valueCents ?? 0), 0);
  return {
    id: item.id,
    name: item.name,
    category: item.type === "product" ? null : `offer_type:${TYPE_TO_OFFER[item.type] ?? "custom"}`,
    defaultCostPrice: toRupees(unitCostCents),
    defaultSellingPrice: toRupees(item.unitPriceCents ?? 0),
    packagingCost: 0,
    defaultShippingCost: 0,
    imageColor: "217 91% 62%",
    supplier: null,
    status: item.status === "active" ? "active" : "inactive",
    notes: item.notes,
  };
}

/** Splits ledger transactions into the legacy order/expense/adSpend collections. */
export function ledgerToLegacy(
  transactions: TransactionSummary[],
  expenseItems: ExpenseItem[],
): { orders: Order[]; expenses: Expense[]; adSpend: AdSpendEntry[] } {
  const orders: Order[] = [];
  const expenses: Expense[] = [];
  const adSpend: AdSpendEntry[] = [];
  const expenseTypeById = new Map(expenseItems.map((e) => [e.id, e]));

  for (const t of transactions) {
    if (t.status === "void") continue;

    if (t.adjustmentType) {
      // Refund / chargeback → a refunded order carrying the returned amount.
      orders.push({
        id: t.id,
        customer: t.personId,
        phone: null,
        source: t.origin === "integration" ? "integration" : "manual",
        platform: t.sourceName,
        externalId: t.externalRef,
        paymentStatus: "paid",
        sellingPrice: 0,
        costPrice: 0,
        discount: 0,
        refundAmount: toRupees(t.amountCents),
        taxAmount: 0,
        shippingCharged: 0,
        deliveryCost: 0,
        adCost: 0,
        date: t.occurredAt,
        status: "refunded",
        notes: t.notes,
        items: [],
        productName: t.displayName,
        productId: "",
      });

      // A line on an adjustment that reverses NO sale line is a fee — a
      // chargeback fee, say. The profit ladder counts it as a period expense;
      // emitting it here stops it vanishing from every legacy page.
      for (const l of t.lines) {
        if (l.refundedLineId) continue;
        const cents = Math.max(0, l.unitPriceCents * Number(l.qty) - l.lineDiscountCents);
        if (cents === 0) continue;
        expenses.push({
          id: `${t.id}:${l.id}`,
          name: l.label ?? l.itemName ?? "Adjustment fee",
          amount: toRupees(cents),
          // Deliberately CUSTOM — see the note on expense type mapping below.
          type: "CUSTOM",
          frequency: null,
          date: t.occurredAt,
          status: "active",
          paymentStatus: "paid",
          category: l.categoryName ?? null,
          vendor: null,
          attachmentName: null,
          orderId: t.id,
          note: t.notes,
        });
      }
      continue;
    }

    if (t.direction === "in") {
      // Mixed support: only revenue lines are order items; expense ("out")
      // lines are direct costs of the job and fold into costPrice.
      const revLines = t.lines.filter((l) => l.direction !== "out");
      const costLines = t.lines.filter((l) => l.direction === "out");
      const items: OrderItem[] = revLines.map((l, i) => ({
        id: `${t.id}:${i}`,
        productId: l.revenueItemId ?? "",
        productName: l.itemName ?? l.label ?? "Item",
        quantity: Number(l.qty),
        unitSellingPrice: toRupees(l.unitPriceCents),
        unitCostPrice: toRupees(l.costSnapshot?.total_per_unit_cents ?? 0),
      }));
      const costPrice =
        revLines.reduce((sum, l) => sum + (l.costSnapshot?.total_per_unit_cents ?? 0) * Number(l.qty), 0) +
        costLines.reduce((sum, l) => sum + Math.max(0, l.unitPriceCents * Number(l.qty) - l.lineDiscountCents), 0);
      const first = items[0];
      orders.push({
        id: t.id,
        customer: t.personId,
        phone: null,
        source: t.origin === "integration" ? "integration" : "manual",
        platform: t.sourceName,
        externalId: t.externalRef,
        // Unpaid is a missing paid date now, not a pending status — reading
        // status here would report every outstanding invoice as settled.
        paymentStatus: t.paidAt === null ? "unpaid" : "paid",
        sellingPrice: toRupees(t.amountCents),
        // amountCents is ALREADY net of line + order discounts (server-computed).
        // Legacy finance subtracts `discount` from sellingPrice again, so passing
        // the discount here double-counted it on every legacy page. Always 0.
        costPrice: toRupees(costPrice),
        discount: 0,
        refundAmount: 0,
        taxAmount: toRupees(t.taxCollectedCents),
        shippingCharged: toRupees(t.shippingChargedCents),
        deliveryCost: 0,
        adCost: 0,
        date: t.occurredAt,
        status: t.status === "pending" ? "pending" : "completed",
        notes: t.notes,
        items,
        productName: first?.productName ?? t.displayName,
        productId: first?.productId ?? "",
      });
      continue;
    }

    // Money out → expense (ad spend expense items surface as marketing expenses).
    const firstLine = t.lines[0];
    const expenseItem = firstLine?.expenseItemId ? expenseTypeById.get(firstLine.expenseItemId) : undefined;
    expenses.push({
      id: t.id,
      name: expenseItem?.name ?? firstLine?.itemName ?? firstLine?.label ?? t.displayName,
      amount: toRupees(t.amountCents),
      /**
       * DO NOT map a fixed cost through to legacy "FIXED", even though expense
       * items now carry a real `costNature`.
       *
       * Legacy treats FIXED/RECURRING as a repeating TEMPLATE and expands it
       * day by day across the period (recurringExpenseAmountInRange). What we
       * pass here are actual OCCURRENCES — one row per real payment — so
       * labelling them FIXED would expand each one again and inflate expenses
       * enormously. Everything therefore stays VARIABLE/CUSTOM, which keeps
       * these legacy totals honest.
       *
       * Nothing is lost by that any more: break-even no longer reads this
       * bridge at all. It reads GET /reports/break-even, which splits period
       * expenses by cost nature server-side (Phase 2, done). This mapping only
       * feeds the remaining legacy budget/cash-flow pages until R5.1 deletes
       * the adapter.
       */
      type: expenseItem?.type === "marketing" ? "VARIABLE" : "CUSTOM",
      frequency: null,
      date: t.occurredAt,
      status: "active",
      // Unpaid is a missing paid date now, not a pending status — reading
        // status here would report every outstanding invoice as settled.
        paymentStatus: t.paidAt === null ? "unpaid" : "paid",
      category: expenseItem?.categoryName ?? expenseItem?.name ?? null,
      vendor: expenseItem?.vendorName ?? null,
      attachmentName: null,
      orderId: null,
      note: t.notes,
    });
  }

  return { orders, expenses, adSpend };
}
