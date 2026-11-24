import {
  db,
  expenseItemsTable,
  peopleTable,
  personKindValues,
  recurringSchedulesTable,
  revenueItemsTable,
  subscriptionsTable,
  transactionsTable,
  type Person,
  type PersonKind,
} from "@workspace/db";
import type { RecurInterval } from "@workspace/domain";
import { and, eq, inArray, sql } from "drizzle-orm";
import { uid } from "../lib/uid";
import { invalid, notFound } from "./errors";

/**
 * People service. Everyone the business exchanges money with lives here;
 * derived metrics (LTV, spend, MRR) are computed at query time in the read
 * model, never stored. Merges repoint, never hard-delete (append-only spirit).
 */

export interface FindOrCreateInput {
  email?: string | null;
  name: string;
  kind?: PersonKind;
  /** Sets first_transaction_at on create when this person is born from a sale. */
  firstTransactionAt?: Date;
}

/**
 * Resolve a person: existing email match (case-insensitive) → exact
 * normalized-name match → else create. Name-only creations are flagged
 * needs_review so the owner can confirm or merge later.
 */
export async function findOrCreatePerson(businessId: string, input: FindOrCreateInput): Promise<Person> {
  const name = input.name.trim();
  const email = input.email?.trim() || null;
  if (!name && !email) throw invalid("A person needs a name or an email");
  const kind = input.kind ?? "customer";
  if (!personKindValues.includes(kind)) throw invalid(`Unknown person kind "${kind}"`);

  if (email) {
    const [byEmail] = await db
      .select()
      .from(peopleTable)
      .where(and(eq(peopleTable.businessId, businessId), sql`lower(${peopleTable.email}) = lower(${email})`));
    if (byEmail) return byEmail;
  }
  if (name) {
    const [byName] = await db
      .select()
      .from(peopleTable)
      .where(and(eq(peopleTable.businessId, businessId), sql`lower(${peopleTable.displayName}) = lower(${name})`));
    if (byName) return byName;
  }

  const [created] = await db
    .insert(peopleTable)
    .values({
      id: uid("person"),
      businessId,
      kind,
      displayName: name || email!,
      email,
      // Name-only (no email) auto-creations are the ones worth reviewing.
      needsReview: !email,
      firstTransactionAt: input.firstTransactionAt ?? null,
    })
    .returning();
  return created;
}

/** Back-compat helper for the ledger route: resolve a free-typed customer name. */
export async function resolvePersonByName(
  businessId: string,
  name: string,
  firstTransactionAt?: Date,
): Promise<string | null> {
  if (!name.trim()) return null;
  const person = await findOrCreatePerson(businessId, { name, firstTransactionAt });
  return person.id;
}

export async function getPerson(businessId: string, personId: string): Promise<Person> {
  const [person] = await db
    .select()
    .from(peopleTable)
    .where(and(eq(peopleTable.businessId, businessId), eq(peopleTable.id, personId)));
  if (!person) throw notFound("Person");
  return person;
}

/**
 * Merge `mergeId` into `keepId`: repoint every transaction / schedule /
 * subscription, carry the earliest first_transaction_at, and archive the
 * merged person (never delete). Idempotent-ish: a second call is a no-op.
 */
export async function mergePersons(businessId: string, keepId: string, mergeId: string): Promise<Person> {
  if (keepId === mergeId) throw invalid("Cannot merge a person into themselves");
  const keep = await getPerson(businessId, keepId);
  const merged = await getPerson(businessId, mergeId);

  return db.transaction(async (tx) => {
    // Only THIS business's rows move: a merge never reaches into another set of books.
    await tx
      .update(transactionsTable)
      .set({ personId: keepId })
      .where(and(eq(transactionsTable.businessId, businessId), eq(transactionsTable.personId, mergeId)));
    await tx
      .update(recurringSchedulesTable)
      .set({ personId: keepId })
      .where(and(eq(recurringSchedulesTable.businessId, businessId), eq(recurringSchedulesTable.personId, mergeId)));
    await tx
      .update(subscriptionsTable)
      .set({ personId: keepId })
      .where(and(eq(subscriptionsTable.businessId, businessId), eq(subscriptionsTable.personId, mergeId)));

    const earliest =
      keep.firstTransactionAt && merged.firstTransactionAt
        ? new Date(Math.min(keep.firstTransactionAt.getTime(), merged.firstTransactionAt.getTime()))
        : keep.firstTransactionAt ?? merged.firstTransactionAt ?? null;

    const [updatedKeep] = await tx
      .update(peopleTable)
      .set({
        firstTransactionAt: earliest,
        // Inherit contact fields the survivor is missing.
        email: keep.email ?? merged.email,
        phone: keep.phone ?? merged.phone,
        company: keep.company ?? merged.company,
        needsReview: false,
        updatedAt: new Date(),
      })
      .where(and(eq(peopleTable.id, keepId), eq(peopleTable.businessId, businessId)))
      .returning();

    await tx
      .update(peopleTable)
      .set({ status: "archived", needsReview: false, notes: sql`coalesce(${peopleTable.notes} || ' · ', '') || 'merged into ' || ${keepId}`, updatedAt: new Date() })
      .where(and(eq(peopleTable.id, mergeId), eq(peopleTable.businessId, businessId)));

    return updatedKeep;
  });
}

/**
 * What will go on posting money for this person once they are archived.
 *
 * Archiving hides someone from the pickers. It does not touch the recurring
 * engine, which selects on `recurring_schedules.status = 'active'` and never
 * looks at the person — so a monthly subscription belonging to an archived
 * customer keeps creating revenue for someone the owner can no longer see.
 * This is what the screen warns with before letting them go ahead.
 *
 * ACTIVE SCHEDULES are the source of truth, because they are what the job
 * reads. A subscription is a label on one — it carries `schedule_id` — so
 * listing both tables would name the same monthly posting twice. A subscription
 * whose schedule is paused posts nothing and is correctly absent.
 */
export async function listPersonCommitments(businessId: string, personId: string) {
  const [subs, ownSchedules] = await Promise.all([
    db
      .select()
      .from(subscriptionsTable)
      .where(
        and(
          eq(subscriptionsTable.businessId, businessId),
          eq(subscriptionsTable.personId, personId),
          inArray(subscriptionsTable.status, ["active", "trialing", "past_due"]),
        ),
      ),
    db
      .select()
      .from(recurringSchedulesTable)
      .where(
        and(
          eq(recurringSchedulesTable.businessId, businessId),
          eq(recurringSchedulesTable.personId, personId),
          eq(recurringSchedulesTable.status, "active"),
        ),
      ),
  ]);

  // A subscription can name the person while its schedule does not, so pick up
  // those schedules too before deciding what is live.
  const missing = subs.map((s) => s.scheduleId).filter((id) => !ownSchedules.some((s) => s.id === id));
  const extra = missing.length
    ? await db
        .select()
        .from(recurringSchedulesTable)
        .where(and(eq(recurringSchedulesTable.businessId, businessId), inArray(recurringSchedulesTable.id, missing)))
    : [];

  const live = [...ownSchedules, ...extra].filter((s) => s.status === "active");
  if (live.length === 0) return [];

  const subscribedScheduleIds = new Set(subs.map((s) => s.scheduleId));
  const revenueIds = live.map((s) => s.revenueItemId).filter((id): id is string => !!id);
  const expenseIds = live.map((s) => s.expenseItemId).filter((id): id is string => !!id);
  const [revenueNames, expenseNames] = await Promise.all([
    revenueIds.length
      ? db
          .select({ id: revenueItemsTable.id, name: revenueItemsTable.name })
          .from(revenueItemsTable)
          .where(and(eq(revenueItemsTable.businessId, businessId), inArray(revenueItemsTable.id, revenueIds)))
      : Promise.resolve([]),
    expenseIds.length
      ? db
          .select({ id: expenseItemsTable.id, name: expenseItemsTable.name })
          .from(expenseItemsTable)
          .where(and(eq(expenseItemsTable.businessId, businessId), inArray(expenseItemsTable.id, expenseIds)))
      : Promise.resolve([]),
  ]);
  const nameById = new Map([...revenueNames, ...expenseNames].map((r) => [r.id, r.name]));

  return live
    .map((s) => ({
      scheduleId: s.id,
      kind: subscribedScheduleIds.has(s.id) ? ("subscription" as const) : ("recurring" as const),
      direction: s.direction as "in" | "out",
      itemName: nameById.get(s.revenueItemId ?? s.expenseItemId ?? "") ?? "Unnamed",
      amountCents: s.amountCents ?? null,
      interval: s.interval as RecurInterval,
      intervalCount: s.intervalCount,
      nextRunAt: s.nextRunAt.toISOString(),
    }))
    .sort((a, b) => a.nextRunAt.localeCompare(b.nextRunAt));
}

/** Records/advances a person's first_transaction_at when a sale links to them — only within `businessId`. */
export async function touchFirstTransaction(businessId: string, personId: string, occurredAt: Date): Promise<void> {
  await db
    .update(peopleTable)
    .set({ firstTransactionAt: sql`LEAST(coalesce(${peopleTable.firstTransactionAt}, ${occurredAt.toISOString()}::timestamptz), ${occurredAt.toISOString()}::timestamptz)` })
    .where(and(eq(peopleTable.id, personId), eq(peopleTable.businessId, businessId)));
}
