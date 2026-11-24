/**
 * Server code used only by `/api/recurring`. Shared code stays in
 * `src/lib/api/functions`. Server-only: nothing in components, views or the
 * client helpers may import this file.
 */
import { and, desc, eq } from "drizzle-orm";
import type { RecurringScheduleShape } from "@workspace/api-contract";
import { db, peopleTable, recurringPostingsTable, revenueItemsTable, expenseItemsTable, type RecurringSchedule } from "@workspace/db";
import type { RecurInterval } from "@workspace/domain";

// ── mappers ─────────────────────────────────────────────────────

/** Every name is resolved WITHIN the business: a stored id from elsewhere shows as "?", never as another business's name. */
export async function toApi(businessId: string, s: RecurringSchedule): Promise<RecurringScheduleShape> {
  const [itemName, personName, lastPosted] = await Promise.all([
    s.revenueItemId
      ? db.select({ name: revenueItemsTable.name }).from(revenueItemsTable).where(and(eq(revenueItemsTable.id, s.revenueItemId), eq(revenueItemsTable.businessId, businessId))).then((r) => r[0]?.name ?? "?")
      : db.select({ name: expenseItemsTable.name }).from(expenseItemsTable).where(and(eq(expenseItemsTable.id, s.expenseItemId!), eq(expenseItemsTable.businessId, businessId))).then((r) => r[0]?.name ?? "?"),
    s.personId ? db.select({ name: peopleTable.displayName }).from(peopleTable).where(and(eq(peopleTable.id, s.personId), eq(peopleTable.businessId, businessId))).then((r) => r[0]?.name ?? null) : Promise.resolve(null),
    db.select().from(recurringPostingsTable).where(eq(recurringPostingsTable.scheduleId, s.id)).orderBy(desc(recurringPostingsTable.scheduledFor)).limit(1).then((r) => r[0] ?? null),
  ]);
  return {
    id: s.id,
    direction: s.direction as "in" | "out",
    itemName,
    personName,
    amountCents: s.amountCents ?? null,
    qty: s.qty,
    interval: s.interval as RecurInterval,
    intervalCount: s.intervalCount,
    anchorDay: s.anchorDay ?? null,
    nextRunAt: s.nextRunAt.toISOString(),
    lastPostedAt: lastPosted?.postedAt ? lastPosted.postedAt.toISOString() : null,
    occurrencesPosted: s.occurrencesPosted,
    postingMode: s.postingMode as "auto_post" | "confirm_first",
    status: s.status as "active" | "paused" | "canceled" | "completed",
    createdAt: s.createdAt.toISOString(),
  };
}
