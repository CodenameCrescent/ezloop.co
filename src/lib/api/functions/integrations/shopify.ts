import {
  db,
  integrationsTable,
  revenueItemSourcesTable,
  sourcesTable,
  transactionsTable,
  type Integration,
} from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import { decryptToken } from "../lib/tokenCrypto";
import { logger } from "../lib/logger";
import { createSource } from "../services/catalog";
import { createRefundForAmount, createTransaction, voidTransaction } from "../services/ledger";
import { findOrCreatePerson } from "../services/person";
import {
  normalizeOrder,
  normalizeRefunds,
  processingFeeCents,
  type NormalizedOrder,
  type ShopifyOrder,
  type ShopifyTransaction,
} from "./shopifyNormalize";

export type { ShopifyOrder } from "./shopifyNormalize";

/**
 * The Shopify connector, rebuilt on the money core.
 *
 * It has exactly one job: turn a Shopify payload into the inputs the domain
 * services already take, and call them. It writes no SQL of its own for money,
 * has no endpoint of its own, and knows nothing the UI does not — which is the
 * "engines write only through the same domain services" invariant applied to
 * sync (CLAUDE.md).
 *
 * The four hooks it rides, all of which existed before it:
 *
 *   1. `createTransaction` / `createRefundForAmount` / `voidTransaction` — the
 *      identical path Quick Add uses.
 *   2. `unique(source_id, external_ref)` — a re-sync is a no-op at the DATABASE
 *      level, so a webhook replay and a backfill over the same week cannot
 *      double anybody's revenue even if this code is wrong.
 *   3. `revenue_item_sources.external_id` — how a Shopify variant becomes a
 *      catalogue item with real costs. Unmapped lines fall back to a label,
 *      because zero-catalogue entry is a product requirement, not an edge case.
 *   4. `origin: "integration"` — every imported row says where it came from, and
 *      the UI shows it.
 *
 * What it deliberately does NOT do: read the payouts endpoint. A payout is money
 * already recorded as sales; posting it would book every order twice. See the
 * money-truth hierarchy in `shopifyNormalize.ts`.
 */

const API_VERSION = "2024-10";

function normalizeStore(store: string): string {
  return store
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "")
    .replace(/\.myshopify\.com$/, "");
}

function parseNextPageCursor(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  const match = linkHeader.match(/<[^>]*[?&]page_info=([^&>]+)[^>]*>;\s*rel="next"/);
  return match ? match[1] : null;
}

/**
 * Fetch from the Shopify API with automatic 429 retry/backoff.
 * Retries up to 3 times with exponential delays: 1s, 2s, 4s.
 */
export async function shopifyFetch(url: string, options: RequestInit, retries = 3): Promise<Response> {
  const delays = [1000, 2000, 4000];

  for (let attempt = 0; attempt <= retries; attempt++) {
    const resp = await fetch(url, options);
    if (resp.status !== 429) return resp;

    if (attempt === retries) {
      throw new Error(`Shopify rate limit exceeded after ${retries} retries`);
    }

    const retryAfterHeader = resp.headers.get("Retry-After");
    const retryAfterMs = retryAfterHeader ? parseFloat(retryAfterHeader) * 1000 : NaN;
    const delay =
      Number.isFinite(retryAfterMs) && retryAfterMs > 0 ? Math.min(retryAfterMs, 10000) : (delays[attempt] ?? 4000);

    logger.warn({ url, attempt, delay }, "shopify: 429 rate limit, retrying with backoff");
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  throw new Error("Shopify rate limit exceeded");
}

async function fetchAllShopifyOrders(store: string, token: string, sinceDate: string): Promise<ShopifyOrder[]> {
  const headers = { "X-Shopify-Access-Token": token, "Content-Type": "application/json" };
  const baseUrl = `https://${store}.myshopify.com/admin/api/${API_VERSION}/orders.json`;

  const firstUrl = new URL(baseUrl);
  firstUrl.searchParams.set("status", "any");
  firstUrl.searchParams.set("limit", "250");
  firstUrl.searchParams.set("updated_at_min", sinceDate);

  const allOrders: ShopifyOrder[] = [];
  let nextUrl: string | null = firstUrl.toString();

  while (nextUrl) {
    const resp = await shopifyFetch(nextUrl, { headers });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(`Shopify API error ${resp.status}: ${body}`);
    }
    const json = (await resp.json()) as { orders?: ShopifyOrder[] };
    const page = json.orders ?? [];
    allOrders.push(...page);

    const cursor = parseNextPageCursor(resp.headers.get("link"));
    if (cursor && page.length === 250) {
      const pageUrl = new URL(baseUrl);
      pageUrl.searchParams.set("limit", "250");
      pageUrl.searchParams.set("page_info", cursor);
      nextUrl = pageUrl.toString();
    } else {
      nextUrl = null;
    }
  }

  return allOrders;
}

/**
 * What the processor charged for one order.
 *
 * A separate call per order, which is why it is optional and failure is
 * survivable: a missing fee leaves the sale correct and only the cost of taking
 * it unknown, where a failed import would leave the sale missing entirely.
 */
async function fetchOrderFeeCents(store: string, token: string, orderId: number): Promise<number> {
  try {
    const url = `https://${store}.myshopify.com/admin/api/${API_VERSION}/orders/${orderId}/transactions.json`;
    const resp = await shopifyFetch(url, {
      headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
    });
    if (!resp.ok) return 0;
    const json = (await resp.json()) as { transactions?: ShopifyTransaction[] };
    return processingFeeCents(json.transactions ?? []);
  } catch (err) {
    logger.warn({ err, orderId }, "shopify: could not read processing fee");
    return 0;
  }
}

/**
 * The channel this store's money flows through.
 *
 * Made once and remembered on the integration row. Matching by NAME instead
 * would split a store's history the first time somebody renamed the channel.
 */
export async function ensureIntegrationSource(integration: Integration): Promise<string> {
  // Re-read rather than trusting the row in hand. Callers hold an integration
  // they loaded moments ago, and two webhook deliveries landing together would
  // both see a null source and both try to make one.
  const [fresh] = await db.select().from(integrationsTable).where(eq(integrationsTable.id, integration.id));
  if (fresh?.sourceId) return fresh.sourceId;

  const label = integration.externalAccount
    ? `${integration.displayName} — ${normalizeStore(integration.externalAccount)}`
    : integration.displayName;

  const remember = async (id: string) => {
    await db.update(integrationsTable).set({ sourceId: id }).where(eq(integrationsTable.id, integration.id));
    return id;
  };

  // A channel with this name may already exist — the owner made one by hand
  // before connecting, or a previous attempt created it and failed before
  // recording the id. Adopting it keeps one store's history in one place.
  const [existing] = await db
    .select()
    .from(sourcesTable)
    .where(and(eq(sourcesTable.businessId, integration.businessId), eq(sourcesTable.name, label)));
  if (existing) return remember(existing.id);

  try {
    const source = await createSource(integration.businessId, { name: label, kind: "ecommerce_store" });
    return remember(source.id);
  } catch (err) {
    if (!isDuplicateName(err)) throw err;
    // Lost the race. The winner's row is the answer.
    const [won] = await db
      .select()
      .from(sourcesTable)
      .where(and(eq(sourcesTable.businessId, integration.businessId), eq(sourcesTable.name, label)));
    if (!won) throw err;
    return remember(won.id);
  }
}

function isDuplicateName(err: unknown): boolean {
  const cause = (err as { cause?: { code?: string; constraint?: string } })?.cause;
  return cause?.code === "23505" || (err as { code?: string })?.code === "23505";
}

/** Shopify variant/product id → catalogue item, for this source only. */
async function loadItemMap(sourceId: string, externalIds: string[]): Promise<Map<string, string>> {
  if (externalIds.length === 0) return new Map();
  const rows = await db
    .select()
    .from(revenueItemSourcesTable)
    .where(
      and(
        eq(revenueItemSourcesTable.sourceId, sourceId),
        inArray(revenueItemSourcesTable.externalId, [...new Set(externalIds)]),
      ),
    );
  return new Map(rows.map((row) => [row.externalId!, row.revenueItemId]));
}

/** Transactions already imported for these external refs. */
async function loadExistingByRef(sourceId: string, refs: string[]): Promise<Map<string, string>> {
  if (refs.length === 0) return new Map();
  const rows = await db
    .select({ id: transactionsTable.id, externalRef: transactionsTable.externalRef, status: transactionsTable.status })
    .from(transactionsTable)
    .where(
      and(eq(transactionsTable.sourceId, sourceId), inArray(transactionsTable.externalRef, [...new Set(refs)])),
    );
  return new Map(rows.map((row) => [row.externalRef!, row.id]));
}

export interface ImportOutcome {
  imported: number;
  skipped: number;
  refunded: number;
  cancelled: number;
  unmappedLines: number;
}

const EMPTY: ImportOutcome = { imported: 0, skipped: 0, refunded: 0, cancelled: 0, unmappedLines: 0 };

/**
 * Import one order, and any refunds against it.
 *
 * Shared by the manual sync and the webhook, because they are the same event
 * arriving by two roads — and a second copy of this logic is how the two would
 * eventually disagree about what an order means.
 */
export async function importShopifyOrder(
  integration: Integration,
  sourceId: string,
  order: ShopifyOrder,
  options: { feeCents?: number } = {},
): Promise<ImportOutcome> {
  const businessId = integration.businessId;
  const normalized = normalizeOrder(order);

  // A test order is not money. Importing one puts a sale in the books that
  // never happened, which is worse than showing nothing.
  if (normalized.isTest) return { ...EMPTY, skipped: 1 };

  const refunds = normalizeRefunds(order);
  const existing = await loadExistingByRef(sourceId, [
    normalized.externalRef,
    ...refunds.map((refund) => refund.externalRef),
  ]);

  let transactionId = existing.get(normalized.externalRef) ?? null;
  let imported = 0;
  let unmappedLines = 0;

  if (!transactionId) {
    const itemMap = await loadItemMap(
      sourceId,
      normalized.lines.map((line) => line.externalId).filter((id): id is string => id !== null),
    );

    const personId = normalized.customerName
      ? (await findOrCreatePerson(businessId, { name: normalized.customerName, kind: "customer" })).id
      : null;

    const lines = normalized.lines.map((line) => {
      const revenueItemId = line.externalId ? (itemMap.get(line.externalId) ?? null) : null;
      if (!revenueItemId) unmappedLines += 1;
      return {
        // A mapped line gets the catalogue item's costs frozen onto it; an
        // unmapped one is an honest label with a price and no cost yet. Both
        // are real sales — the second just cannot report a margin until
        // somebody links the listing.
        ...(revenueItemId ? { revenueItemId } : { label: line.label }),
        qty: line.qty,
        unitPriceCents: line.unitPriceCents,
        lineDiscountCents: line.lineDiscountCents,
      };
    });

    const feeCents = options.feeCents ?? 0;
    if (feeCents > 0) {
      // The processor's own figure, as a cost INSIDE the sale — so it lands at
      // contribution level, where the cost of taking money belongs.
      lines.push({
        direction: "out",
        label: "Shopify payment fee",
        qty: "1",
        unitPriceCents: feeCents,
        lineDiscountCents: 0,
      } as (typeof lines)[number]);
    }

    try {
      const created = await createTransaction(businessId, {
        direction: "in",
        occurredAt: normalized.occurredAt,
        paidAt: normalized.paidAt,
        sourceId,
        personId,
        origin: "integration",
        externalRef: normalized.externalRef,
        referenceNumber: normalized.reference,
        currency: normalized.currency,
        orderDiscountCents: normalized.orderDiscountCents,
        shippingChargedCents: normalized.shippingChargedCents,
        taxCollectedCents: normalized.taxCollectedCents,
        lines,
      });
      transactionId = created.transaction.id;
      imported = 1;
    } catch (err) {
      // The unique index is the real dedupe, and it wins a race this code
      // cannot see — two webhook deliveries landing at once. Losing that race
      // is a SUCCESS: the order is in the books exactly once.
      if (!isDuplicateRef(err)) throw err;
      const again = await loadExistingByRef(sourceId, [normalized.externalRef]);
      transactionId = again.get(normalized.externalRef) ?? null;
      if (!transactionId) throw err;
    }
  }

  let cancelled = 0;
  let refunded = 0;

  for (const refund of refunds) {
    if (existing.has(refund.externalRef)) continue;
    try {
      await createRefundForAmount(businessId, {
        transactionId,
        amountCents: refund.amountCents,
        restocked: refund.restocked,
        occurredAt: refund.occurredAt,
        notes: refund.note,
        externalRef: refund.externalRef,
      });
      refunded += 1;
    } catch (err) {
      if (isDuplicateRef(err)) continue;
      // A refund larger than what is left to refund means Shopify and the
      // ledger disagree about the sale — worth a loud line in the log, not
      // worth abandoning the rest of the sync.
      logger.warn({ err, refund: refund.externalRef }, "shopify: refund could not be posted");
    }
  }

  // Cancelled last: voiding refuses while live adjustments exist, so the
  // refunds above have to be settled first. An order cancelled AND refunded is
  // ordinary — Shopify refunds the money, then marks the order cancelled.
  if (normalized.cancelled && refunds.length === 0 && imported === 0) {
    // Only an order that was already in the books can be voided, and only once.
    try {
      await voidTransaction(businessId, transactionId);
      cancelled = 1;
    } catch (err) {
      logger.warn({ err, order: normalized.externalRef }, "shopify: order could not be voided");
    }
  }

  return {
    imported,
    skipped: imported === 0 && refunded === 0 && cancelled === 0 ? 1 : 0,
    refunded,
    cancelled,
    unmappedLines,
  };
}

/** Postgres' unique-violation code, however the driver wrapped it. */
function isDuplicateRef(err: unknown): boolean {
  const code = (err as { code?: string; cause?: { code?: string } })?.code;
  const causeCode = (err as { cause?: { code?: string } })?.cause?.code;
  return code === "23505" || causeCode === "23505";
}

export interface ShopifySyncOutcome extends ImportOutcome {
  ordersSeen: number;
}

export async function runShopifySync(integrationId: string): Promise<ShopifySyncOutcome> {
  const [integration] = await db.select().from(integrationsTable).where(eq(integrationsTable.id, integrationId));
  if (!integration) throw new Error("Integration not found");

  const rawStore = integration.externalAccount ?? "";
  const token = integration.accessToken ? decryptToken(integration.accessToken) : "";
  if (!rawStore || !token) {
    throw new Error("Shopify store not fully connected. Please reconnect via OAuth.");
  }

  const store = normalizeStore(rawStore);
  const sourceId = await ensureIntegrationSource(integration);

  // Two minutes of overlap so an order updated on the boundary is not missed.
  // Re-reading a handful of orders is free — the unique index makes every one
  // of them a no-op.
  const OVERLAP_MS = 2 * 60 * 1000;
  const sinceDate = integration.lastSyncedAt
    ? new Date(integration.lastSyncedAt.getTime() - OVERLAP_MS).toISOString()
    : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

  let orders: ShopifyOrder[];
  try {
    orders = await fetchAllShopifyOrders(store, token, sinceDate);
  } catch (err) {
    throw new Error(`Failed to reach Shopify API. Try reconnecting. (${(err as Error).message})`);
  }

  const totals: ShopifySyncOutcome = { ...EMPTY, ordersSeen: orders.length };

  for (const order of orders) {
    // Only for orders about to be imported: the fee call is per order, and
    // re-reading it for one already in the books would triple the sync's cost
    // to learn a number that is already frozen on the line.
    const alreadyThere = await loadExistingByRef(sourceId, [`shopify-order-${order.id}`]);
    const feeCents = alreadyThere.size > 0 ? 0 : await fetchOrderFeeCents(store, token, order.id);

    try {
      const result = await importShopifyOrder(integration, sourceId, order, { feeCents });
      totals.imported += result.imported;
      totals.skipped += result.skipped;
      totals.refunded += result.refunded;
      totals.cancelled += result.cancelled;
      totals.unmappedLines += result.unmappedLines;
    } catch (err) {
      // One malformed order must not cost the owner the other 249.
      logger.error({ err, orderId: order.id }, "shopify sync: order failed to import");
      totals.skipped += 1;
    }
  }

  await db
    .update(integrationsTable)
    .set({ lastSyncedAt: new Date() })
    .where(eq(integrationsTable.id, integration.id));

  return totals;
}
