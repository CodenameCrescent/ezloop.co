import {
  db,
  recurIntervalValues,
  recurringPostingsTable,
  recurringSchedulesTable,
  subscriptionsTable,
  transactionsTable,
  transactionLinesTable,
  type RecurringSchedule,
} from "@workspace/db";
import { dueDatesUpTo, nextRunDate, type RecurInterval } from "@workspace/domain";
import { and, asc, eq, lte, ne } from "drizzle-orm";
import { uid } from "../lib/uid";
import { invalid, notFound } from "./errors";
import { assertOwnedRefs } from "./ownership";
import { createTransaction } from "./ledger";
import { recordSubscriptionPayment } from "./subscription";

/**
 * The recurring engine: one machine for both directions. It posts through the
 * SAME ledger service the UI uses (CLAUDE.md — engines never write raw SQL for
 * money), with occurred_at set to the SCHEDULED date so a snapshot freezes the
 * components effective then. The (schedule, scheduled_for) unique row is the
 * idempotency lock: a re-run hits the conflict and skips silently.
 */

export interface CreateScheduleInput {
  direction: "in" | "out";
  revenueItemId?: string | null;
  expenseItemId?: string | null;
  personId?: string | null;
  sourceId: string;
  amountCents?: number | null;
  qty?: string;
  interval: RecurInterval;
  intervalCount?: number;
  anchorDay?: number | null;
  startDate: Date;
  endDate?: Date | null;
  maxOccurrences?: number | null;
  postingMode?: "auto_post" | "confirm_first";
}

export async function createSchedule(businessId: string, input: CreateScheduleInput): Promise<RecurringSchedule> {
  if (!recurIntervalValues.includes(input.interval)) throw invalid(`Unknown interval "${input.interval}"`);
  if (input.direction === "in" && !input.revenueItemId) throw invalid("Money-in schedules need a revenue item");
  if (input.direction === "out" && !input.expenseItemId) throw invalid("Money-out schedules need an expense item");
  if (input.revenueItemId && input.expenseItemId) throw invalid("A schedule posts exactly one item");
  // Everything the schedule will post through must be this business's own.
  await assertOwnedRefs(businessId, {
    revenueItemIds: [input.revenueItemId],
    expenseItemIds: [input.expenseItemId],
    personIds: [input.personId],
    sourceIds: [input.sourceId],
  });

  // Month-based intervals remember the start day as the anchor (never degraded).
  const monthBased = input.interval === "monthly" || input.interval === "quarterly" || input.interval === "yearly";
  const anchorDay = input.anchorDay ?? (monthBased ? input.startDate.getUTCDate() : null);

  const [schedule] = await db
    .insert(recurringSchedulesTable)
    .values({
      id: uid("sched"),
      businessId,
      direction: input.direction,
      revenueItemId: input.revenueItemId ?? null,
      expenseItemId: input.expenseItemId ?? null,
      personId: input.personId ?? null,
      sourceId: input.sourceId,
      amountCents: input.amountCents ?? null,
      qty: input.qty ?? "1",
      interval: input.interval,
      intervalCount: input.intervalCount ?? 1,
      anchorDay,
      startDate: input.startDate,
      endDate: input.endDate ?? null,
      maxOccurrences: input.maxOccurrences ?? null,
      nextRunAt: input.startDate,
      postingMode: input.postingMode ?? "auto_post",
      status: "active",
    })
    .returning();
  return schedule;
}

export interface RunResult {
  schedulesProcessed: number;
  postsCreated: number;
  cappedScheduleIds: string[];
}

/**
 * Post every schedule that's due on or before `today`. Idempotent: re-running
 * the same day creates nothing new (the posting unique constraint blocks
 * duplicates). Catch-up posts every missed scheduled date (capped at 12).
 */
export async function runDueSchedules(today: Date = new Date(), businessId?: string): Promise<RunResult> {
  const where = businessId
    ? and(eq(recurringSchedulesTable.status, "active"), eq(recurringSchedulesTable.businessId, businessId), lte(recurringSchedulesTable.nextRunAt, today))
    : and(eq(recurringSchedulesTable.status, "active"), lte(recurringSchedulesTable.nextRunAt, today));
  const due = await db.select().from(recurringSchedulesTable).where(where).orderBy(asc(recurringSchedulesTable.nextRunAt));

  let postsCreated = 0;
  const cappedScheduleIds: string[] = [];

  for (const schedule of due) {
    const plan = dueDatesUpTo({
      nextRunAt: schedule.nextRunAt,
      today,
      interval: schedule.interval as RecurInterval,
      intervalCount: schedule.intervalCount,
      anchorDay: schedule.anchorDay,
      endDate: schedule.endDate,
      maxOccurrences: schedule.maxOccurrences,
      occurrencesPosted: schedule.occurrencesPosted,
    });
    if (plan.capped) cappedScheduleIds.push(schedule.id);

    let posted = 0;
    for (const scheduledFor of plan.dates) {
      const didPost = await postOneOccurrence(schedule, scheduledFor);
      if (didPost) posted += 1;
    }

    await db
      .update(recurringSchedulesTable)
      .set({
        occurrencesPosted: schedule.occurrencesPosted + posted,
        nextRunAt: plan.nextRunAt ?? schedule.nextRunAt,
        status: plan.completed ? "completed" : schedule.status,
        updatedAt: new Date(),
      })
      .where(eq(recurringSchedulesTable.id, schedule.id));

    postsCreated += posted;
  }

  return { schedulesProcessed: due.length, postsCreated, cappedScheduleIds };
}

/**
 * Posts a single occurrence atomically. Returns false when the idempotency
 * lock already holds this (schedule, date) — the safe no-op on a re-run.
 */
async function postOneOccurrence(schedule: RecurringSchedule, scheduledFor: Date): Promise<boolean> {
  const status = schedule.postingMode === "confirm_first" ? "pending" : "completed";
  try {
    const result = await db.transaction(async (tx) => {
      // Claim the lock first; a conflict throws and we treat it as "already posted".
      await tx.insert(recurringPostingsTable).values({
        id: uid("post"),
        scheduleId: schedule.id,
        scheduledFor,
        skipped: false,
      });

      const created = await createTransaction(schedule.businessId, {
        direction: schedule.direction as "in" | "out",
        occurredAt: scheduledFor,
        sourceId: schedule.sourceId,
        personId: schedule.personId,
        status,
        origin: "recurring_engine",
        lines: [
          schedule.direction === "in"
            ? { revenueItemId: schedule.revenueItemId!, qty: schedule.qty, unitPriceCents: schedule.amountCents ?? undefined }
            : { expenseItemId: schedule.expenseItemId!, qty: schedule.qty, unitPriceCents: schedule.amountCents ?? undefined },
        ],
      });

      await tx
        .update(recurringPostingsTable)
        .set({ transactionId: created.transaction.id, postedAt: new Date() })
        .where(and(eq(recurringPostingsTable.scheduleId, schedule.id), eq(recurringPostingsTable.scheduledFor, scheduledFor)));

      return created.transaction.id;
    });

    // Subscription bookkeeping (auto-posts count as a payment immediately;
    // confirm_first counts when confirmed).
    if (status === "completed") await recordSubscriptionPayment(schedule.id, scheduledFor, result);
    return true;
  } catch (err) {
    // 23505 = unique_violation on the posting lock → already handled elsewhere.
    if ((err as { code?: string }).code === "23505") return false;
    throw err;
  }
}

// ── Pending queue (confirm_first) ───────────────────────────────────────────

export async function confirmPending(businessId: string, transactionId: string) {
  const [txn] = await db
    .select()
    .from(transactionsTable)
    .where(and(eq(transactionsTable.businessId, businessId), eq(transactionsTable.id, transactionId)));
  if (!txn) throw notFound("Transaction");
  if (txn.status !== "pending" || txn.origin !== "recurring_engine") throw invalid("Only pending recurring posts can be confirmed");

  // Confirming says the event happened AND was settled, which is what the
  // owner means by "yes, that rent went out". They can still mark it unpaid
  // afterwards if it was only agreed, not paid.
  const [updated] = await db
    .update(transactionsTable)
    .set({ status: "completed", paidAt: txn.occurredAt, updatedAt: new Date() })
    .where(eq(transactionsTable.id, transactionId))
    .returning();

  const [posting] = await db.select().from(recurringPostingsTable).where(eq(recurringPostingsTable.transactionId, transactionId));
  if (posting) await recordSubscriptionPayment(posting.scheduleId, posting.scheduledFor, transactionId);
  return updated;
}

export async function skipPending(businessId: string, transactionId: string) {
  const [txn] = await db
    .select()
    .from(transactionsTable)
    .where(and(eq(transactionsTable.businessId, businessId), eq(transactionsTable.id, transactionId)));
  if (!txn) throw notFound("Transaction");
  if (txn.status !== "pending") throw invalid("Only pending posts can be skipped");

  return db.transaction(async (tx) => {
    await tx.update(transactionsTable).set({ status: "void", updatedAt: new Date() }).where(eq(transactionsTable.id, transactionId));
    await tx
      .update(recurringPostingsTable)
      .set({ skipped: true })
      .where(eq(recurringPostingsTable.transactionId, transactionId));
    return { ok: true };
  });
}

/** Edit the amount of a not-yet-confirmed recurring post (this occurrence only). */
export async function editPendingAmount(businessId: string, transactionId: string, amountCents: number) {
  const [txn] = await db
    .select()
    .from(transactionsTable)
    .where(and(eq(transactionsTable.businessId, businessId), eq(transactionsTable.id, transactionId)));
  if (!txn) throw notFound("Transaction");
  if (txn.status !== "pending") throw invalid("Only pending posts can be edited before confirming");
  if (!Number.isSafeInteger(amountCents) || amountCents < 0) throw invalid("Amount must be non-negative integer cents");

  const lines = await db.select().from(transactionLinesTable).where(eq(transactionLinesTable.transactionId, transactionId));
  if (lines.length !== 1) throw invalid("Recurring posts have a single editable line");
  await db.update(transactionLinesTable).set({ unitPriceCents: amountCents, qty: "1" }).where(eq(transactionLinesTable.id, lines[0].id));
  return { ok: true };
}

// ── Lifecycle ───────────────────────────────────────────────────────────────

export async function getSchedule(businessId: string, scheduleId: string): Promise<RecurringSchedule> {
  const [s] = await db
    .select()
    .from(recurringSchedulesTable)
    .where(and(eq(recurringSchedulesTable.businessId, businessId), eq(recurringSchedulesTable.id, scheduleId)));
  if (!s) throw notFound("Schedule");
  return s;
}

export async function setScheduleStatus(businessId: string, scheduleId: string, status: "active" | "paused" | "canceled") {
  await getSchedule(businessId, scheduleId);
  const [updated] = await db
    .update(recurringSchedulesTable)
    .set({ status, updatedAt: new Date() })
    .where(eq(recurringSchedulesTable.id, scheduleId))
    .returning();
  return updated;
}

/**
 * "This and future" edit: end-date the current schedule at its last posted date
 * and clone a fresh schedule (new amount/qty) starting from the next occurrence.
 * History stays frozen — amount changes become effective-dated for free.
 */
export async function editThisAndFuture(
  businessId: string,
  scheduleId: string,
  changes: { amountCents?: number | null; qty?: string },
): Promise<RecurringSchedule> {
  const current = await getSchedule(businessId, scheduleId);

  const lastPosting = await db
    .select()
    .from(recurringPostingsTable)
    .where(and(eq(recurringPostingsTable.scheduleId, scheduleId), eq(recurringPostingsTable.skipped, false)))
    .orderBy(asc(recurringPostingsTable.scheduledFor));
  const lastPostedDate = lastPosting.length ? lastPosting[lastPosting.length - 1].scheduledFor : null;
  const nextStart = current.nextRunAt;

  return db.transaction(async (tx) => {
    await tx
      .update(recurringSchedulesTable)
      .set({ status: "completed", endDate: lastPostedDate ?? current.startDate, updatedAt: new Date() })
      .where(eq(recurringSchedulesTable.id, scheduleId));

    const [clone] = await tx
      .insert(recurringSchedulesTable)
      .values({
        id: uid("sched"),
        businessId,
        direction: current.direction,
        revenueItemId: current.revenueItemId,
        expenseItemId: current.expenseItemId,
        personId: current.personId,
        sourceId: current.sourceId,
        amountCents: changes.amountCents !== undefined ? changes.amountCents : current.amountCents,
        qty: changes.qty ?? current.qty,
        interval: current.interval,
        intervalCount: current.intervalCount,
        anchorDay: current.anchorDay,
        startDate: nextStart,
        endDate: current.endDate,
        maxOccurrences: current.maxOccurrences,
        occurrencesPosted: 0,
        nextRunAt: nextStart,
        postingMode: current.postingMode,
        status: "active",
      })
      .returning();

    // Move any subscription onto the new schedule.
    await tx.update(subscriptionsTable).set({ scheduleId: clone.id, updatedAt: new Date() }).where(eq(subscriptionsTable.scheduleId, scheduleId));
    return clone;
  });
}

export async function listSchedules(businessId: string) {
  return db
    .select()
    .from(recurringSchedulesTable)
    .where(and(eq(recurringSchedulesTable.businessId, businessId), ne(recurringSchedulesTable.status, "canceled")))
    .orderBy(asc(recurringSchedulesTable.nextRunAt));
}

/** The projected next post date for a schedule (for UI display). */
export function projectNextRun(schedule: RecurringSchedule): Date {
  return nextRunDate(schedule.nextRunAt, schedule.interval as RecurInterval, schedule.intervalCount, schedule.anchorDay);
}
