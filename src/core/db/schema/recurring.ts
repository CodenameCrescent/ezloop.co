import { bigint, boolean, check, index, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { businessesTable } from "./businesses";
import { expenseItemsTable } from "./expenseItems";
import { peopleTable } from "./people";
import { revenueItemsTable } from "./revenueItems";
import { sourcesTable } from "./sources";
import { transactionsTable } from "./transactions";

export const recurIntervalValues = ["daily", "weekly", "monthly", "quarterly", "yearly"] as const;
export type RecurIntervalValue = (typeof recurIntervalValues)[number];

export const postingModeValues = ["auto_post", "confirm_first"] as const;
export type PostingMode = (typeof postingModeValues)[number];

export const scheduleStatusValues = ["active", "paused", "canceled", "completed"] as const;
export type ScheduleStatus = (typeof scheduleStatusValues)[number];

/**
 * One recurring engine for both directions: a subscription you sell and rent
 * you pay are the same machinery. Exactly one of revenue_item_id /
 * expense_item_id is set, matching `direction`.
 */
export const recurringSchedulesTable = pgTable(
  "recurring_schedules",
  {
    id: text("id").primaryKey(),
    businessId: text("business_id")
      .notNull()
      .references(() => businessesTable.id),
    direction: text("direction").notNull(),
    revenueItemId: text("revenue_item_id").references(() => revenueItemsTable.id),
    expenseItemId: text("expense_item_id").references(() => expenseItemsTable.id),
    personId: text("person_id").references(() => peopleTable.id),
    sourceId: text("source_id")
      .notNull()
      .references(() => sourcesTable.id),
    /** Null = resolve the item's default amount at posting time. */
    amountCents: bigint("amount_cents", { mode: "number" }),
    qty: text("qty").notNull().default("1"),
    interval: text("interval").notNull(),
    intervalCount: integer("interval_count").notNull().default(1),
    /** Remembered day-of-month for month-based intervals (1–31); never degraded. */
    anchorDay: integer("anchor_day"),
    startDate: timestamp("start_date", { withTimezone: true }).notNull(),
    endDate: timestamp("end_date", { withTimezone: true }),
    maxOccurrences: integer("max_occurrences"),
    occurrencesPosted: integer("occurrences_posted").notNull().default(0),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }).notNull(),
    postingMode: text("posting_mode").notNull().default("auto_post"),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("recurring_schedules_business_idx").on(t.businessId),
    index("recurring_schedules_due_idx").on(t.status, t.nextRunAt),
    check(
      "recurring_schedules_direction_check",
      sql`(direction = 'in' AND revenue_item_id IS NOT NULL AND expense_item_id IS NULL)
          OR (direction = 'out' AND expense_item_id IS NOT NULL AND revenue_item_id IS NULL)`,
    ),
  ],
);

export type RecurringSchedule = typeof recurringSchedulesTable.$inferSelect;

/**
 * One row per (schedule, scheduled_for). The unique constraint is the
 * idempotency lock — a re-run of the job hits the conflict and skips silently
 * instead of double-posting.
 */
export const recurringPostingsTable = pgTable(
  "recurring_postings",
  {
    id: text("id").primaryKey(),
    scheduleId: text("schedule_id")
      .notNull()
      .references(() => recurringSchedulesTable.id),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),
    transactionId: text("transaction_id").references(() => transactionsTable.id),
    skipped: boolean("skipped").notNull().default(false),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("recurring_postings_schedule_date_uq").on(t.scheduleId, t.scheduledFor)],
);

export type RecurringPosting = typeof recurringPostingsTable.$inferSelect;
