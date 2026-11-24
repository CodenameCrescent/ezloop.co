import {
  budgetLinesTable,
  budgetsTable,
  businessSettingsTable,
  businessesTable,
  categoriesTable,
  clientEngagementsTable,
  costComponentsTable,
  db,
  expenseItemsTable,
  importBatchesTable,
  integrationsTable,
  teamMemberRatesTable,
  timeEntriesTable,
  paymentApplicationsTable,
  peopleTable,
  projectsTable,
  recurringPostingsTable,
  recurringSchedulesTable,
  revenueItemSourcesTable,
  revenueItemsTable,
  sourcesTable,
  subscriptionEventsTable,
  subscriptionsTable,
  transactionAttachmentsTable,
  transactionLinesTable,
  transactionTemplatesTable,
  transactionsTable,
} from "@workspace/db";
import { INTERNAL_TIME_CATEGORIES, type BusinessType } from "@workspace/domain";
import { and, eq, inArray } from "drizzle-orm";
import { uid } from "../lib/uid";
import { starterExpenseTypes } from "../lib/starterExpenseTypes";

export const MANUAL_SOURCE_NAME = "Manual";

/**
 * Gives a business the starter expense types for its type. Idempotent: the
 * unique (business_id, name) index makes a repeat call a no-op, so this is safe
 * to run again when the owner changes their business type.
 *
 * Seeded rows are ordinary expense items — fully editable, archivable, and in
 * no way privileged over ones the owner writes.
 */
export async function seedStarterExpenseTypes(businessId: string, businessType: BusinessType) {
  const rows = starterExpenseTypes(businessType).map((starter) => ({
    id: uid("ei"),
    businessId,
    name: starter.name,
    type: starter.type,
    costNature: starter.costNature,
    behavior: starter.behavior,
    unitLabel: starter.unitLabel ?? null,
  }));
  if (rows.length === 0) return;
  await db.insert(expenseItemsTable).values(rows).onConflictDoNothing();
}

/**
 * Gives a business the internal buckets that absorb labour — Admin, Sales &
 * pitching, and so on. They are ordinary rows in the shared category tree,
 * tagged `time` so they stay out of the revenue and expense pickers rather
 * than getting a category table of their own.
 *
 * Idempotent by name: `categories` has no unique constraint on (business, name),
 * so this checks first rather than relying on a conflict. Safe to re-run when
 * the owner switches business type, and it never resurrects a bucket they
 * renamed — a rename simply means the old name is missing and comes back,
 * which is why this only runs on creation and on an explicit type change.
 */
export async function seedInternalTimeCategories(businessId: string) {
  const existing = await db
    .select({ name: categoriesTable.name })
    .from(categoriesTable)
    .where(and(eq(categoriesTable.businessId, businessId), eq(categoriesTable.appliesTo, "time")));
  const have = new Set(existing.map((c) => c.name));

  const missing = INTERNAL_TIME_CATEGORIES.filter((name) => !have.has(name)).map((name) => ({
    id: uid("cat"),
    businessId,
    name,
    appliesTo: "time" as const,
  }));
  if (missing.length === 0) return;
  await db.insert(categoriesTable).values(missing);
}

/**
 * Everything a brand-new business needs before it can hold money: its starter
 * expense types, the internal buckets that absorb labour, and the guaranteed
 * "Manual" source — the channel for hand-entered money (a product requirement:
 * fast entry with zero setup).
 *
 * Runs ONCE, at creation. It deliberately does not run on read: an owner who
 * archived a starter type must not find it back on the next page load.
 */
async function seedNewBusiness(businessId: string, businessType: BusinessType) {
  await seedStarterExpenseTypes(businessId, businessType);
  // Seeded for every business, not just service ones: the buckets cost nothing
  // when hidden, and an ecommerce owner who switches the client toggle on
  // should find them already there rather than an empty screen.
  await seedInternalTimeCategories(businessId);
  await ensureManualSource(businessId);
}

/** Every business has a "Manual" source. Idempotent; safe to call on an old row. */
export async function ensureManualSource(businessId: string) {
  const existing = await db
    .select()
    .from(sourcesTable)
    .where(and(eq(sourcesTable.businessId, businessId), eq(sourcesTable.name, MANUAL_SOURCE_NAME)));
  if (existing.length > 0) return existing[0];
  const [created] = await db
    .insert(sourcesTable)
    .values({ id: uid("src"), businessId, name: MANUAL_SOURCE_NAME, kind: "manual" })
    .onConflictDoNothing()
    .returning();
  return created ?? (await getManualSource(businessId))!;
}

/**
 * The businesses this user owns. MAY BE EMPTY — a brand-new account owns
 * nothing until it says so, and that emptiness is what sends them to the
 * welcome screen rather than into a workspace nobody asked for.
 */
export async function listBusinesses(userId: string, options?: { includeArchived?: boolean }) {
  const rows = await db
    .select()
    .from(businessesTable)
    .where(eq(businessesTable.userId, userId))
    .orderBy(businessesTable.createdAt);
  return options?.includeArchived ? rows : rows.filter((b) => b.archivedAt === null);
}

/**
 * THE ownership check. Every request that touches money goes through this, via
 * `resolveBusiness` in `http/guards.ts` — nothing else may resolve a business.
 *
 * Returns null for "not yours" and for "does not exist" alike, and the caller
 * turns both into 404. Telling the two apart would hand out a free directory of
 * other people's businesses.
 */
export async function getBusinessForUser(userId: string, businessId: string) {
  const [row] = await db
    .select()
    .from(businessesTable)
    .where(and(eq(businessesTable.id, businessId), eq(businessesTable.userId, userId)));
  return row ?? null;
}

/**
 * A business by id, WITHOUT an ownership check.
 *
 * For service-layer code that was handed a business id by a caller which has
 * already been through the business guard — the check has happened, one rung up.
 * Never reachable from a request that has not passed the gate.
 */
export async function getBusinessById(businessId: string) {
  const [row] = await db.select().from(businessesTable).where(eq(businessesTable.id, businessId));
  return row ?? null;
}

/**
 * The symbol this business's money is written with — a LABEL, never a
 * conversion (CLAUDE.md). Used by the server only where money is embedded in a
 * SENTENCE and the UI's own formatter cannot reach it.
 */
export async function currencySymbolOf(businessId: string): Promise<string> {
  const [row] = await db
    .select({ symbol: businessesTable.currencySymbol })
    .from(businessesTable)
    .where(eq(businessesTable.id, businessId));
  return row?.symbol ?? "Rs";
}

export interface CreateBusinessInput {
  name: string;
  businessType: BusinessType;
  currency?: string;
  currencySymbol?: string;
}

/** Makes a business and everything it needs to be usable immediately. */
export async function createBusiness(userId: string, input: CreateBusinessInput) {
  const [created] = await db
    .insert(businessesTable)
    .values({
      id: uid("biz"),
      userId,
      name: input.name,
      businessType: input.businessType,
      ...(input.currency ? { baseCurrency: input.currency } : {}),
      ...(input.currencySymbol ? { currencySymbol: input.currencySymbol } : {}),
    })
    .returning();
  await seedNewBusiness(created.id, input.businessType);
  return created;
}

/**
 * The business for a user, made if they have none.
 *
 * FOR SCRIPTS AND TESTS ONLY — seeders and fixtures own their user and mean
 * exactly this. The request path must never use it: it would silently hand a
 * new visitor an empty workspace instead of asking them what they are building,
 * and with many businesses per user "the user's business" no longer names one.
 */
export async function ensureBusiness(userId: string) {
  const [existing] = await db
    .select()
    .from(businessesTable)
    .where(eq(businessesTable.userId, userId))
    .orderBy(businessesTable.createdAt);
  if (existing) {
    // Old rows predate the guarantee; cheap to confirm, disastrous to assume.
    await ensureManualSource(existing.id);
    return existing;
  }
  const type = "ecommerce" as const;
  return createBusiness(userId, { name: "My Business", businessType: type });
}

export async function getManualSource(businessId: string) {
  const [source] = await db
    .select()
    .from(sourcesTable)
    .where(and(eq(sourcesTable.businessId, businessId), eq(sourcesTable.name, MANUAL_SOURCE_NAME)));
  return source ?? null;
}

/**
 * Deletes every money-core row of EVERY business a user owns, the businesses
 * included. ONLY for explicit dev resets and re-seeding — normal flows never
 * hard-delete money rows (append-only ledger).
 *
 * Now that a user may own several, "the user's business" names nothing, so a
 * reset takes the lot. A reset of ONE set of books goes through
 * `wipeBusinessById` behind the ownership check.
 */
export async function wipeBusinessData(userId: string) {
  const businesses = await db.select().from(businessesTable).where(eq(businessesTable.userId, userId));
  for (const business of businesses) await wipeBusinessById(business.id);
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Wipes one business. Callers MUST have verified ownership first.
 *
 * `keepBusiness` empties the books but leaves the row — which is what "reset
 * this business" means from the app, where the client is holding this id and
 * would be switched to a business that no longer exists.
 *
 * `exec` lets a caller run the whole wipe inside its own transaction, so
 * deleting an account either removes everything or nothing.
 */
export async function wipeBusinessById(
  bid: string,
  /**
   * `restoreManualSource: false` leaves re-creating the "Manual" channel to the
   * caller. Needed when `exec` is a transaction holding a lock on the business
   * row: `ensureManualSource` writes on its own connection, and its foreign key
   * check would wait on that lock forever.
   */
  options?: { keepBusiness?: boolean; restoreManualSource?: boolean },
  exec: typeof db | Tx = db,
) {
  // Children first, honouring every FK (subscription events → subscriptions →
  // schedules/postings → transaction lines → transactions → catalog → people).
  const subs = await exec.select({ id: subscriptionsTable.id }).from(subscriptionsTable).where(eq(subscriptionsTable.businessId, bid));
  if (subs.length) {
    await exec.delete(subscriptionEventsTable).where(inArray(subscriptionEventsTable.subscriptionId, subs.map((s) => s.id)));
    await exec.delete(subscriptionsTable).where(eq(subscriptionsTable.businessId, bid));
  }
  const schedules = await exec.select({ id: recurringSchedulesTable.id }).from(recurringSchedulesTable).where(eq(recurringSchedulesTable.businessId, bid));
  if (schedules.length) {
    await exec.delete(recurringPostingsTable).where(inArray(recurringPostingsTable.scheduleId, schedules.map((s) => s.id)));
    await exec.delete(recurringSchedulesTable).where(eq(recurringSchedulesTable.businessId, bid));
  }

  const txns = await exec.select({ id: transactionsTable.id }).from(transactionsTable).where(eq(transactionsTable.businessId, bid));
  if (txns.length) {
    // Applications reference transactions TWICE — the bill they settled and the
    // advance they came from — so they go before either can be removed.
    await exec.delete(transactionAttachmentsTable).where(eq(transactionAttachmentsTable.businessId, bid));
    await exec.delete(paymentApplicationsTable).where(eq(paymentApplicationsTable.businessId, bid));
    await exec.delete(transactionLinesTable).where(inArray(transactionLinesTable.transactionId, txns.map((t) => t.id)));
    await exec.delete(transactionsTable).where(eq(transactionsTable.businessId, bid));
  }
  // A budget line points at an expense item, a revenue item or a category, and
  // a budget points at a project — so the whole plan goes before any of the
  // things it has an opinion about.
  const budgetIds = await exec.select({ id: budgetsTable.id }).from(budgetsTable).where(eq(budgetsTable.businessId, bid));
  if (budgetIds.length) {
    await exec.delete(budgetLinesTable).where(inArray(budgetLinesTable.budgetId, budgetIds.map((b) => b.id)));
    await exec.delete(budgetsTable).where(eq(budgetsTable.businessId, bid));
  }

  const items = await exec.select({ id: revenueItemsTable.id }).from(revenueItemsTable).where(eq(revenueItemsTable.businessId, bid));
  if (items.length) {
    await exec.delete(costComponentsTable).where(inArray(costComponentsTable.revenueItemId, items.map((i) => i.id)));
    await exec.delete(revenueItemSourcesTable).where(inArray(revenueItemSourcesTable.revenueItemId, items.map((i) => i.id)));
  }
  await exec.delete(revenueItemsTable).where(eq(revenueItemsTable.businessId, bid));
  await exec.delete(expenseItemsTable).where(eq(expenseItemsTable.businessId, bid));
  // Client-profitability rows reference people, so they go before people do.
  await exec.delete(timeEntriesTable).where(eq(timeEntriesTable.businessId, bid));
  await exec.delete(teamMemberRatesTable).where(eq(teamMemberRatesTable.businessId, bid));
  await exec.delete(clientEngagementsTable).where(eq(clientEngagementsTable.businessId, bid));
  await exec.delete(categoriesTable).where(eq(categoriesTable.businessId, bid));
  // Projects reference people, so they go before people do. Transaction lines
  // point at a project by id without a foreign key — a target is a reference,
  // not a dependency — so nothing above needs to know about this.
  await exec.delete(projectsTable).where(eq(projectsTable.businessId, bid));
  await exec.delete(peopleTable).where(eq(peopleTable.businessId, bid));
  // Import batches go after everything that points AT them — transactions,
  // both catalog tables and people all carry import_batch_id — and before
  // sources, which a batch itself references. Both FKs are ON DELETE no
  // action, so the order is the only thing keeping this from raising. Outside
  // the keepBusiness branch on purpose: sources go on BOTH paths, so a batch
  // left behind breaks a reset exactly as it breaks a full wipe.
  await exec.delete(importBatchesTable).where(eq(importBatchesTable.businessId, bid));
  // Connected accounts point at the channel they post through, so they resolve
  // BEFORE sources go. A reset keeps the account — emptying the books is not
  // the same as unplugging the shop, and re-authorising Shopify to clear demo
  // data would be a surprise — but it cannot keep a link to a channel that no
  // longer exists. The next sync makes a fresh one.
  if (options?.keepBusiness) {
    await exec.update(integrationsTable).set({ sourceId: null }).where(eq(integrationsTable.businessId, bid));
  } else {
    await exec.delete(integrationsTable).where(eq(integrationsTable.businessId, bid));
    await exec.delete(businessSettingsTable).where(eq(businessSettingsTable.businessId, bid));
    // Saved entry shortcuts. A reset keeps them — they are not money — but a
    // business that is going away takes them with it.
    await exec.delete(transactionTemplatesTable).where(eq(transactionTemplatesTable.businessId, bid));
  }
  await exec.delete(sourcesTable).where(eq(sourcesTable.businessId, bid));
  if (options?.keepBusiness) {
    // The books are empty but the business is still open for entry, and fast
    // entry with zero setup is a product requirement — so its channel comes back.
    if (options.restoreManualSource !== false) await ensureManualSource(bid);
    return;
  }
  await exec.delete(businessesTable).where(eq(businessesTable.id, bid));
}
