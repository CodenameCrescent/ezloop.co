import {
  db,
  sourcesTable,
  transactionLinesTable,
  transactionsTable,
  type Source,
} from "@workspace/db";
import { addCents, mulCentsQty } from "@workspace/domain";
import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { invalid, notFound } from "./errors";
import * as catalog from "./catalog";
import { createTransaction, voidTransaction } from "./ledger";

/**
 * Ad spend — money paid to a platform to acquire customers.
 *
 * THERE IS NO `ad_spend` TABLE, deliberately. Ad spend is a money event, so it
 * is an ordinary expense transaction on a source of kind `ad_platform`, written
 * through `createTransaction` like everything else. A table of its own would
 * have been a parallel money path (CLAUDE.md), and — the part that actually
 * bites — `computeProfitLadder` reads only transactions and lines, so spend
 * held anywhere else would be missing from True profit. For most ecommerce
 * businesses that is the single largest cost, so the headline number would have
 * been wrong by the whole ad budget.
 *
 * Everything a separate table would have carried already exists on the ledger:
 *
 *   the platform      → `source_id`, a source of kind `ad_platform`
 *   the day           → `occurred_at` (and `paid_at`, so prepaid ad credit works)
 *   the campaign      → the line's `label`, which is what label-only lines are for
 *   connector dedupe  → `external_ref` + `unique(source_id, external_ref)`
 *   where it came from→ `origin`
 *
 * So a future Meta/Google connector calls `logAdSpend` with `origin:
 * "integration"` and the platform's own charge id, and a replayed sync is a
 * no-op at the database level. That is the integrations contract met on day
 * one rather than retrofitted.
 */

/**
 * The platforms we offer by name. `other` exists so nobody is blocked by an ad
 * network we didn't list — it takes a free-text name.
 *
 * These are display names for SOURCES, not a closed system enum: a source is
 * just a row, so an owner may rename one or add their own. Nothing keys off
 * these strings after creation.
 */
export const AD_PLATFORM_PRESETS = {
  meta: "Meta Ads",
  google: "Google Ads",
  tiktok: "TikTok Ads",
} as const;

export type AdPlatformPreset = keyof typeof AD_PLATFORM_PRESETS;

/** The one expense item every ad spend line links to. */
const ADVERTISING_ITEM_NAME = "Advertising";

/**
 * Find or create the source for an ad platform.
 *
 * Adopting a same-named source rather than failing matters because `sources`
 * is unique on (business_id, name): an owner who already made a "Meta Ads"
 * source by hand must not hit a constraint error the first time they log spend.
 * If that existing row is some other kind, we say so instead of quietly
 * treating a bank account as an ad platform.
 */
export async function ensureAdPlatformSource(businessId: string, name: string): Promise<Source> {
  const trimmed = name.trim();
  if (!trimmed) throw invalid("Pick which platform the spend went to");

  const existing = await db
    .select()
    .from(sourcesTable)
    .where(and(eq(sourcesTable.businessId, businessId), eq(sourcesTable.name, trimmed)));

  if (existing[0]) {
    if (existing[0].kind !== "ad_platform") {
      throw invalid(`"${trimmed}" is already set up as something other than an ad platform`);
    }
    return existing[0];
  }

  return catalog.createSource(businessId, { name: trimmed, kind: "ad_platform" });
}

/**
 * Find or create the "Advertising" expense item.
 *
 * `costNature: "variable"` is the load-bearing field, not decoration:
 * break-even folds variable period expenses INTO the contribution margin
 * (`computeBreakEven`), so ads booked as fixed would push the break-even point
 * out and make every margin-adjusted ROAS number wrong. Ad spend scales with
 * selling, so it is variable.
 *
 * `behavior: "usage_based"` keeps the UI from offering a recurring schedule —
 * spend is logged as it happens, it is not a subscription.
 */
export async function ensureAdvertisingItem(businessId: string) {
  const existing = await catalog.findExpenseItemByName(businessId, ADVERTISING_ITEM_NAME);
  if (existing) return existing;

  return catalog.createExpenseItem(businessId, {
    name: ADVERTISING_ITEM_NAME,
    type: "marketing",
    costNature: "variable",
    behavior: "usage_based",
  });
}

export interface LogAdSpendInput {
  /** Display name of the platform — a preset value or the owner's own. */
  platform: string;
  /** The day the spend happened. Accrual date, exactly like any other expense. */
  spentOn: Date;
  amountCents: number;
  /**
   * Omit for "paid on the day", which is what a card-billed ad account does.
   * Pass null for spend that is invoiced and not yet settled.
   */
  paidAt?: Date | null;
  /** Free text, e.g. "Retargeting – broad". No campaign table in v1. */
  campaign?: string | null;
  currency?: string;
  fxRateToBase?: string;
  notes?: string | null;
  /** Set by a connector; "manual" for the logging screen. */
  origin?: "manual" | "integration" | "import";
  /** The platform's own charge id. Makes a replayed sync a database-level no-op. */
  externalRef?: string | null;
}

/**
 * Log ad spend. One expense transaction, one line — no revenue lines, so
 * `computeProfitLadder` classifies it as a period expense and it lands at True
 * profit, which is where advertising belongs.
 */
export async function logAdSpend(businessId: string, input: LogAdSpendInput) {
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) {
    throw invalid("Enter how much you spent");
  }

  const source = await ensureAdPlatformSource(businessId, input.platform);
  const item = await ensureAdvertisingItem(businessId);
  const campaign = input.campaign?.trim() || null;

  return createTransaction(businessId, {
    direction: "out",
    occurredAt: input.spentOn,
    paidAt: input.paidAt,
    sourceId: source.id,
    currency: input.currency,
    fxRateToBase: input.fxRateToBase,
    origin: input.origin ?? "manual",
    externalRef: input.externalRef ?? null,
    notes: input.notes ?? null,
    lines: [
      {
        expenseItemId: item.id,
        // The campaign name rides on the line label, which is where a line's
        // own words go. Null leaves the item name ("Advertising") to speak.
        label: campaign,
        qty: "1",
        unitPriceCents: input.amountCents,
      },
    ],
  });
}

/** Voiding is a status change — money rows are never hard-deleted (CLAUDE.md). */
export async function voidAdSpend(businessId: string, transactionId: string) {
  const row = await getAdSpendRow(businessId, transactionId);
  if (!row) throw notFound("Ad spend");
  return voidTransaction(businessId, transactionId);
}

async function getAdSpendRow(businessId: string, transactionId: string) {
  const [row] = await db
    .select({ id: transactionsTable.id })
    .from(transactionsTable)
    .innerJoin(sourcesTable, eq(sourcesTable.id, transactionsTable.sourceId))
    .where(
      and(
        eq(transactionsTable.businessId, businessId),
        eq(transactionsTable.id, transactionId),
        eq(sourcesTable.kind, "ad_platform"),
      ),
    );
  return row ?? null;
}

export interface AdSpendEntry {
  id: string;
  spentOn: string;
  platform: string;
  sourceId: string;
  campaign: string | null;
  amountCents: number;
  currency: string;
  paidAt: string | null;
  origin: string;
  status: string;
  notes: string | null;
}

export interface AdSpendPlatformTotal {
  sourceId: string;
  platform: string;
  amountCents: number;
  entryCount: number;
}

export interface AdSpendReport {
  entries: AdSpendEntry[];
  byPlatform: AdSpendPlatformTotal[];
  totalCents: number;
  /**
   * Ad spend as a share of the period's gross revenue, in basis points so it
   * stays an integer. Null when there is no revenue to divide by — a rate on
   * zero is not 0%, it is unanswerable, and the UI must say so rather than
   * print a confident nothing.
   */
  shareOfRevenueBps: number | null;
}

/**
 * Every ad-spend entry in a period, read back OUT of the ledger.
 *
 * Reading rather than storing is the whole point: there is one set of rows, so
 * this can never disagree with the P&L. Voids are excluded here the same way
 * the ladder excludes them.
 */
export async function listAdSpend(
  businessId: string,
  range: { startDate?: Date; endDate?: Date } = {},
): Promise<AdSpendEntry[]> {
  const conditions = [
    eq(transactionsTable.businessId, businessId),
    eq(sourcesTable.kind, "ad_platform"),
    sql`${transactionsTable.status} <> 'void'`,
  ];
  if (range.startDate) conditions.push(gte(transactionsTable.occurredAt, range.startDate));
  if (range.endDate) conditions.push(lte(transactionsTable.occurredAt, range.endDate));

  const headers = await db
    .select({
      id: transactionsTable.id,
      occurredAt: transactionsTable.occurredAt,
      paidAt: transactionsTable.paidAt,
      currency: transactionsTable.currency,
      origin: transactionsTable.origin,
      status: transactionsTable.status,
      notes: transactionsTable.notes,
      sourceId: sourcesTable.id,
      platform: sourcesTable.name,
    })
    .from(transactionsTable)
    .innerJoin(sourcesTable, eq(sourcesTable.id, transactionsTable.sourceId))
    .where(and(...conditions))
    .orderBy(desc(transactionsTable.occurredAt), asc(transactionsTable.id));

  if (headers.length === 0) return [];

  // Sum the lines per transaction rather than assuming one: nothing stops an
  // owner (or a connector) putting two campaigns on one day's charge, and a
  // total that quietly ignored the second line would not tie to the P&L.
  const lines = await db
    .select({
      transactionId: transactionLinesTable.transactionId,
      label: transactionLinesTable.label,
      qty: transactionLinesTable.qty,
      unitPriceCents: transactionLinesTable.unitPriceCents,
      lineDiscountCents: transactionLinesTable.lineDiscountCents,
    })
    .from(transactionLinesTable)
    .where(
      inArray(
        transactionLinesTable.transactionId,
        headers.map((h) => h.id),
      ),
    );

  const byTransaction = new Map<string, { amountCents: number; labels: string[] }>();
  for (const line of lines) {
    const entry = byTransaction.get(line.transactionId) ?? { amountCents: 0, labels: [] };
    // `mulCentsQty` (decimal.js, half-up) rather than qty * price: quantity is a
    // decimal STRING and multiplying it as a float is exactly the drift the
    // integer-cents rule exists to prevent.
    const gross = mulCentsQty(line.unitPriceCents, line.qty);
    entry.amountCents = addCents(entry.amountCents, gross, -line.lineDiscountCents);
    if (line.label) entry.labels.push(line.label);
    byTransaction.set(line.transactionId, entry);
  }

  return headers.map((h) => {
    const agg = byTransaction.get(h.id);
    return {
      id: h.id,
      spentOn: h.occurredAt.toISOString(),
      platform: h.platform,
      sourceId: h.sourceId,
      campaign: agg && agg.labels.length > 0 ? agg.labels.join(" · ") : null,
      amountCents: agg?.amountCents ?? 0,
      currency: h.currency,
      paidAt: h.paidAt ? h.paidAt.toISOString() : null,
      origin: h.origin,
      status: h.status,
      notes: h.notes,
    };
  });
}

/**
 * The period's ad spend with its per-platform split and its share of revenue.
 *
 * `grossRevenueCents` is passed in by the caller (which already has the ladder)
 * rather than recomputed here, so the share can never be taken against a
 * different revenue number than the one on screen.
 */
export function summariseAdSpend(entries: AdSpendEntry[], grossRevenueCents: number): AdSpendReport {
  const platforms = new Map<string, AdSpendPlatformTotal>();
  let totalCents = 0;

  for (const entry of entries) {
    totalCents += entry.amountCents;
    const current = platforms.get(entry.sourceId) ?? {
      sourceId: entry.sourceId,
      platform: entry.platform,
      amountCents: 0,
      entryCount: 0,
    };
    current.amountCents += entry.amountCents;
    current.entryCount += 1;
    platforms.set(entry.sourceId, current);
  }

  return {
    entries,
    byPlatform: [...platforms.values()].sort((a, b) => b.amountCents - a.amountCents),
    totalCents,
    shareOfRevenueBps:
      grossRevenueCents > 0 ? Math.round((totalCents / grossRevenueCents) * 10_000) : null,
  };
}

/** The ad platforms this business has, for the logging screen's picker. */
export async function listAdPlatforms(businessId: string): Promise<Source[]> {
  return db
    .select()
    .from(sourcesTable)
    .where(and(eq(sourcesTable.businessId, businessId), eq(sourcesTable.kind, "ad_platform")))
    .orderBy(asc(sourcesTable.name));
}
