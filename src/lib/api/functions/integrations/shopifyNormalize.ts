/**
 * Shopify's words, turned into this app's money facts.
 *
 * Pure: no database, no network, no ids. Everything here is a decision about
 * what a Shopify payload MEANS, which is the part worth testing without a
 * server running. Resolving those meanings to real rows — a source, a catalogue
 * item, an existing transaction — happens in `shopify.ts`.
 *
 * ── The money-truth hierarchy, applied ────────────────────────────────────
 *
 * CLAUDE.md fixes the precedence when two systems describe the same money:
 *
 *   The PLATFORM owns order facts.   What sold, how many, at what price, what
 *                                    discount came off, what tax was collected.
 *                                    Shopify is the authority; we copy it.
 *   The PROCESSOR owns fee facts.    What the sale actually cost to take. Read
 *                                    from the order's transactions, never
 *                                    estimated from a percentage — an estimate
 *                                    that looks like a fact is worse than no
 *                                    figure at all.
 *   PAYOUTS are never revenue.       A bank deposit is money already recorded
 *                                    as sales. Nothing here reads the payouts
 *                                    endpoint, and nothing should: it would
 *                                    book every sale a second time.
 */

/** Shopify sends money as decimal strings: "1234.50". */
export function moneyToCents(value: string | null | undefined): number {
  const raw = (value ?? "").trim();
  if (raw === "") return 0;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return 0;
  // Rounded, not truncated: a half-paisa lost per line adds up across a
  // backfill, and the total we compare against would stop reconciling.
  return Math.round(parsed * 100);
}

export interface ShopifyDiscountAllocation {
  amount: string;
}

export interface ShopifyLineItem {
  id: number;
  variant_id: number | null;
  product_id: number | null;
  title: string;
  variant_title?: string | null;
  quantity: number;
  price: string;
  /** Per-line share of every discount Shopify applied. */
  discount_allocations?: ShopifyDiscountAllocation[];
}

export interface ShopifyShippingLine {
  price: string;
}

export interface ShopifyRefundLineItem {
  quantity: number;
  subtotal: string;
}

export interface ShopifyRefundTransaction {
  amount: string;
  kind: string;
  status: string;
}

export interface ShopifyRefund {
  id: number;
  created_at: string;
  note?: string | null;
  refund_line_items?: ShopifyRefundLineItem[];
  transactions?: ShopifyRefundTransaction[];
}

export interface ShopifyTransaction {
  id: number;
  kind: string;
  status: string;
  amount: string;
  /** Present on Shopify Payments orders; this is the REAL fee. */
  receipt?: { charges?: { data?: Array<{ balance_transaction?: { fee?: string } }> } } | null;
  fee?: string | null;
}

export interface ShopifyOrder {
  id: number;
  name: string;
  email?: string | null;
  phone?: string | null;
  created_at: string;
  processed_at?: string | null;
  cancelled_at?: string | null;
  financial_status?: string | null;
  currency?: string | null;
  total_discounts?: string | null;
  total_tax?: string | null;
  billing_address?: { name?: string | null } | null;
  customer?: { first_name?: string | null; last_name?: string | null } | null;
  shipping_lines?: ShopifyShippingLine[];
  line_items: ShopifyLineItem[];
  refunds?: ShopifyRefund[];
  test?: boolean;
}

/** A sale line before its catalogue item has been looked up. */
export interface NormalizedLine {
  /** Shopify's variant id, or its product id — how the item mapping is found. */
  externalId: string | null;
  /** What to call it when nothing in the catalogue matches. */
  label: string;
  qty: string;
  unitPriceCents: number;
  lineDiscountCents: number;
}

export interface NormalizedOrder {
  externalRef: string;
  reference: string;
  occurredAt: Date;
  /** Null when Shopify says the money has not arrived. */
  paidAt: Date | null;
  customerName: string | null;
  currency: string;
  lines: NormalizedLine[];
  shippingChargedCents: number;
  taxCollectedCents: number;
  /**
   * Discounts Shopify did NOT already attribute to a line. Order-level, shared
   * across the revenue lines by the ladder — never subtracted twice.
   */
  orderDiscountCents: number;
  cancelled: boolean;
  /** A test order is not money. Skipped rather than imported. */
  isTest: boolean;
}

function customerNameOf(order: ShopifyOrder): string | null {
  const billing = order.billing_address?.name?.trim();
  if (billing) return billing;
  const first = order.customer?.first_name?.trim() ?? "";
  const last = order.customer?.last_name?.trim() ?? "";
  const joined = `${first} ${last}`.trim();
  if (joined) return joined;
  // The email is a name of last resort: an owner recognises "aisha@..." where
  // they recognise nothing at all in a blank.
  return order.email?.trim() || null;
}

/** "Blue mug — Large", or just the title when there is no variant. */
export function lineLabel(item: ShopifyLineItem): string {
  const title = item.title?.trim() || "Item";
  const variant = item.variant_title?.trim();
  return variant && variant.toLowerCase() !== "default title" ? `${title} — ${variant}` : title;
}

/**
 * Which id to match a catalogue item on.
 *
 * The VARIANT first: a shop selling one mug in three sizes has three variants
 * with three prices and three costs, and collapsing them onto the product would
 * make every size report the same margin. The product id is the fallback for
 * single-variant listings.
 */
export function lineExternalId(item: ShopifyLineItem): string | null {
  if (item.variant_id != null) return `variant:${item.variant_id}`;
  if (item.product_id != null) return `product:${item.product_id}`;
  return null;
}

/** Has Shopify actually taken the money? */
export function paidAtOf(order: ShopifyOrder): Date | null {
  const status = (order.financial_status ?? "").toLowerCase();
  // `refunded` and `partially_refunded` both mean it WAS paid — the refund is a
  // separate money event, posted separately, not a reason to call the sale unpaid.
  const settled = ["paid", "refunded", "partially_refunded"];
  if (!settled.includes(status)) return null;
  const when = order.processed_at ?? order.created_at;
  const parsed = new Date(when);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function normalizeOrder(order: ShopifyOrder): NormalizedOrder {
  const occurredAt = new Date(order.created_at);

  const lines: NormalizedLine[] = order.line_items.map((item) => ({
    externalId: lineExternalId(item),
    label: lineLabel(item),
    qty: String(item.quantity),
    unitPriceCents: moneyToCents(item.price),
    // Shopify allocates discounts per line when it can. Taking them here rather
    // than at order level keeps a discount attached to the thing it discounted,
    // which is what makes per-item margin honest.
    lineDiscountCents: (item.discount_allocations ?? []).reduce(
      (sum, allocation) => sum + moneyToCents(allocation.amount),
      0,
    ),
  }));

  const allocatedDiscount = lines.reduce((sum, line) => sum + line.lineDiscountCents, 0);
  const totalDiscount = moneyToCents(order.total_discounts);
  // Whatever Shopify did not pin to a line. Clamped at zero: allocations can
  // exceed the header figure on edge cases, and a negative discount would read
  // as revenue appearing from nowhere.
  const orderDiscountCents = Math.max(0, totalDiscount - allocatedDiscount);

  return {
    externalRef: `shopify-order-${order.id}`,
    reference: order.name,
    occurredAt: Number.isNaN(occurredAt.getTime()) ? new Date() : occurredAt,
    paidAt: paidAtOf(order),
    customerName: customerNameOf(order),
    currency: order.currency ?? "PKR",
    lines,
    shippingChargedCents: (order.shipping_lines ?? []).reduce(
      (sum, shipping) => sum + moneyToCents(shipping.price),
      0,
    ),
    // Tax collected is NOT revenue — a header field the ladder excludes from
    // every revenue and profit figure. It is somebody else's money in transit.
    taxCollectedCents: moneyToCents(order.total_tax),
    orderDiscountCents,
    cancelled: !!order.cancelled_at,
    isTest: order.test === true,
  };
}

export interface NormalizedRefund {
  externalRef: string;
  occurredAt: Date;
  amountCents: number;
  /** Shopify says the goods came back, so their cost is recovered. */
  restocked: boolean;
  note: string | null;
}

/**
 * Refunds on an order, as their own money events.
 *
 * The amount is what the PROCESSOR actually returned, not what the line items
 * add up to: a partial refund with a restocking fee gives back less than the
 * goods were worth, and the ledger has to hold the money that really moved.
 * Refunds with no returned money at all — a Shopify "refund" that only restocks
 * inventory — are dropped, because nothing happened financially.
 */
export function normalizeRefunds(order: ShopifyOrder): NormalizedRefund[] {
  const out: NormalizedRefund[] = [];
  for (const refund of order.refunds ?? []) {
    const amountCents = (refund.transactions ?? [])
      .filter((t) => t.kind === "refund" && t.status === "success")
      .reduce((sum, t) => sum + moneyToCents(t.amount), 0);
    if (amountCents <= 0) continue;

    const occurredAt = new Date(refund.created_at);
    out.push({
      externalRef: `shopify-refund-${refund.id}`,
      occurredAt: Number.isNaN(occurredAt.getTime()) ? new Date() : occurredAt,
      amountCents,
      restocked: (refund.refund_line_items ?? []).some((item) => item.quantity > 0),
      note: refund.note?.trim() || null,
    });
  }
  return out;
}

/**
 * What the sale cost to take, as the processor reported it.
 *
 * Returns 0 when the store is not on Shopify Payments, and 0 is the right
 * answer there: we do not know the fee, and a percentage guess dressed as a
 * measurement is exactly what the money-truth rule forbids. The owner can add a
 * real fee as a cost component on the source instead.
 */
export function processingFeeCents(transactions: ShopifyTransaction[]): number {
  let total = 0;
  for (const txn of transactions) {
    if (txn.status !== "success") continue;
    if (txn.kind !== "sale" && txn.kind !== "capture") continue;
    const direct = moneyToCents(txn.fee);
    if (direct > 0) {
      total += direct;
      continue;
    }
    for (const charge of txn.receipt?.charges?.data ?? []) {
      total += moneyToCents(charge.balance_transaction?.fee);
    }
  }
  return total;
}
