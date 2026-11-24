import {
  db,
  recurringPostingsTable,
  recurringSchedulesTable,
  subscriptionEventsTable,
  subscriptionsTable,
  transactionsTable,
  type Subscription,
  type SubscriptionEventKind,
} from "@workspace/db";
import { and, eq, lte } from "drizzle-orm";
import { uid } from "../lib/uid";
import { invalid, notFound } from "./errors";
import { assertOwnedRefs } from "./ownership";
import { editThisAndFuture, setScheduleStatus } from "./recurring";

/**
 * The subscription lifecycle — a thin layer on a recurring schedule. Every
 * status change writes a SubscriptionEvent; that event stream IS the churn/MRR
 * dataset (CLAUDE.md/R4). Payments come from the recurring engine, not from
 * here.
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = typeof db | Tx;

async function writeEvent(
  exec: Executor,
  subscriptionId: string,
  event: SubscriptionEventKind,
  occurredAt: Date,
  metadata?: Record<string, unknown>,
): Promise<void> {
  await exec.insert(subscriptionEventsTable).values({
    id: uid("subev"),
    subscriptionId,
    event,
    occurredAt,
    metadata: metadata ?? null,
  });
}

export interface CreateSubscriptionInput {
  revenueItemId: string;
  personId: string;
  scheduleId: string;
  startedAt: Date;
  trialEndsAt?: Date | null;
  status?: "trialing" | "active";
}

export async function createSubscription(businessId: string, input: CreateSubscriptionInput): Promise<Subscription> {
  const status = input.status ?? (input.trialEndsAt ? "trialing" : "active");
  await assertOwnedRefs(businessId, { personIds: [input.personId], revenueItemIds: [input.revenueItemId] });
  return db.transaction(async (tx) => {
    const [sub] = await tx
      .insert(subscriptionsTable)
      .values({
        id: uid("sub"),
        businessId,
        revenueItemId: input.revenueItemId,
        personId: input.personId,
        scheduleId: input.scheduleId,
        status,
        startedAt: input.startedAt,
        trialEndsAt: input.trialEndsAt ?? null,
      })
      .returning();
    await writeEvent(tx, sub.id, "created", input.startedAt);
    if (status === "trialing") await writeEvent(tx, sub.id, "trial_started", input.startedAt);
    else await writeEvent(tx, sub.id, "activated", input.startedAt);
    return sub;
  });
}

/** Called by the recurring engine after a subscription schedule posts a payment. */
export async function recordSubscriptionPayment(scheduleId: string, scheduledFor: Date, transactionId: string): Promise<void> {
  const [sub] = await db.select().from(subscriptionsTable).where(eq(subscriptionsTable.scheduleId, scheduleId));
  if (!sub) return;
  await db.transaction(async (tx) => {
    await writeEvent(tx, sub.id, "payment_posted", scheduledFor, { transactionId });
    // A payment clears trialing / past_due → active.
    if (sub.status === "trialing" || sub.status === "past_due") {
      await tx.update(subscriptionsTable).set({ status: "active", updatedAt: new Date() }).where(eq(subscriptionsTable.id, sub.id));
      if (sub.status === "trialing") await writeEvent(tx, sub.id, "activated", scheduledFor);
    }
  });
}

export async function getSubscription(businessId: string, subscriptionId: string): Promise<Subscription> {
  const [sub] = await db
    .select()
    .from(subscriptionsTable)
    .where(and(eq(subscriptionsTable.businessId, businessId), eq(subscriptionsTable.id, subscriptionId)));
  if (!sub) throw notFound("Subscription");
  return sub;
}

export async function cancelSubscription(businessId: string, subscriptionId: string, reason?: string): Promise<Subscription> {
  const sub = await getSubscription(businessId, subscriptionId);
  if (sub.status === "canceled") return sub;
  const now = new Date();
  await setScheduleStatus(businessId, sub.scheduleId, "canceled");
  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(subscriptionsTable)
      .set({ status: "canceled", canceledAt: now, cancelReason: reason ?? null, updatedAt: now })
      .where(eq(subscriptionsTable.id, subscriptionId))
      .returning();
    await writeEvent(tx, subscriptionId, "canceled", now, reason ? { reason } : undefined);
    return updated;
  });
}

export async function pauseSubscription(businessId: string, subscriptionId: string): Promise<Subscription> {
  const sub = await getSubscription(businessId, subscriptionId);
  await setScheduleStatus(businessId, sub.scheduleId, "paused");
  const now = new Date();
  return db.transaction(async (tx) => {
    const [updated] = await tx.update(subscriptionsTable).set({ status: "paused", updatedAt: now }).where(eq(subscriptionsTable.id, subscriptionId)).returning();
    await writeEvent(tx, subscriptionId, "paused", now);
    return updated;
  });
}

export async function resumeSubscription(businessId: string, subscriptionId: string): Promise<Subscription> {
  const sub = await getSubscription(businessId, subscriptionId);
  await setScheduleStatus(businessId, sub.scheduleId, "active");
  const now = new Date();
  return db.transaction(async (tx) => {
    const [updated] = await tx.update(subscriptionsTable).set({ status: "active", updatedAt: now }).where(eq(subscriptionsTable.id, subscriptionId)).returning();
    await writeEvent(tx, subscriptionId, "resumed", now);
    return updated;
  });
}

/** Plan change = "this and future" edit on the schedule + a plan_changed event. */
export async function changePlan(businessId: string, subscriptionId: string, amountCents: number): Promise<Subscription> {
  const sub = await getSubscription(businessId, subscriptionId);
  if (!Number.isSafeInteger(amountCents) || amountCents < 0) throw invalid("Plan amount must be non-negative integer cents");
  const [oldSchedule] = await db.select().from(recurringSchedulesTable).where(eq(recurringSchedulesTable.id, sub.scheduleId));
  const previousAmountCents = oldSchedule?.amountCents ?? null;
  await editThisAndFuture(businessId, sub.scheduleId, { amountCents });
  const refreshed = await getSubscription(businessId, subscriptionId); // scheduleId repointed by the edit
  await writeEvent(db, subscriptionId, "plan_changed", new Date(), { amountCents, previousAmountCents });
  return refreshed;
}

/**
 * Daily sweep: a confirm_first subscription payment left pending > 3 days past
 * its scheduled date means the customer didn't pay → past_due + payment_missed.
 * Part of the recurring job.
 */
export async function sweepPastDue(today: Date = new Date(), businessId?: string): Promise<number> {
  const cutoff = new Date(today.getTime() - 3 * 86_400_000);
  const activeSubs = await db
    .select()
    .from(subscriptionsTable)
    .where(businessId ? and(eq(subscriptionsTable.businessId, businessId), eq(subscriptionsTable.status, "active")) : eq(subscriptionsTable.status, "active"));

  let flagged = 0;
  for (const sub of activeSubs) {
    // A pending recurring post older than the cutoff that was never confirmed.
    const overdue = await db
      .select({ id: recurringPostingsTable.id, scheduledFor: recurringPostingsTable.scheduledFor, status: transactionsTable.status })
      .from(recurringPostingsTable)
      .innerJoin(transactionsTable, eq(recurringPostingsTable.transactionId, transactionsTable.id))
      .where(
        and(
          eq(recurringPostingsTable.scheduleId, sub.scheduleId),
          eq(recurringPostingsTable.skipped, false),
          eq(transactionsTable.status, "pending"),
          lte(recurringPostingsTable.scheduledFor, cutoff),
        ),
      );
    if (overdue.length === 0) continue;

    await db.transaction(async (tx) => {
      await tx.update(subscriptionsTable).set({ status: "past_due", updatedAt: new Date() }).where(eq(subscriptionsTable.id, sub.id));
      await writeEvent(tx, sub.id, "payment_missed", today, { scheduledFor: overdue[0].scheduledFor.toISOString() });
    });
    flagged += 1;
  }
  return flagged;
}
