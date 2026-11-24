import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { businessesTable } from "./businesses";
import { peopleTable } from "./people";
import { recurringSchedulesTable } from "./recurring";
import { revenueItemsTable } from "./revenueItems";

export const subscriptionStatusValues = ["trialing", "active", "past_due", "paused", "canceled"] as const;
export type SubscriptionStatus = (typeof subscriptionStatusValues)[number];

export const subscriptionEventValues = [
  "created",
  "trial_started",
  "activated",
  "payment_posted",
  "payment_missed",
  "paused",
  "resumed",
  "canceled",
  "plan_changed",
] as const;
export type SubscriptionEventKind = (typeof subscriptionEventValues)[number];

/** A thin lifecycle on top of a recurring schedule; the event stream IS the churn/MRR dataset. */
export const subscriptionsTable = pgTable(
  "subscriptions",
  {
    id: text("id").primaryKey(),
    businessId: text("business_id")
      .notNull()
      .references(() => businessesTable.id),
    revenueItemId: text("revenue_item_id")
      .notNull()
      .references(() => revenueItemsTable.id),
    personId: text("person_id")
      .notNull()
      .references(() => peopleTable.id),
    scheduleId: text("schedule_id")
      .notNull()
      .references(() => recurringSchedulesTable.id),
    status: text("status").notNull().default("active"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
    canceledAt: timestamp("canceled_at", { withTimezone: true }),
    cancelReason: text("cancel_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("subscriptions_business_idx").on(t.businessId),
    index("subscriptions_person_idx").on(t.personId),
  ],
);

export type Subscription = typeof subscriptionsTable.$inferSelect;

export const subscriptionEventsTable = pgTable(
  "subscription_events",
  {
    id: text("id").primaryKey(),
    subscriptionId: text("subscription_id")
      .notNull()
      .references(() => subscriptionsTable.id),
    event: text("event").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("subscription_events_sub_idx").on(t.subscriptionId, t.occurredAt)],
);

export type SubscriptionEvent = typeof subscriptionEventsTable.$inferSelect;
