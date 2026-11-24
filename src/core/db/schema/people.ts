import { boolean, index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { businessesTable } from "./businesses";
import { importBatchesTable } from "./imports";

export const personKindValues = ["customer", "vendor", "employee", "other"] as const;
export type PersonKind = (typeof personKindValues)[number];

export const personStatusValues = ["active", "archived"] as const;
export type PersonStatus = (typeof personStatusValues)[number];

/**
 * Everyone the business exchanges money with — customers, vendors, employees.
 * Replaces the pre-rewrite client_customers table (business-scoped now, with a
 * real Transaction.person_id FK). Derived metrics (LTV, order count, MRR, spend)
 * are computed at query time, never stored.
 */
export const peopleTable = pgTable(
  "people",
  {
    id: text("id").primaryKey(),
    businessId: text("business_id")
      .notNull()
      .references(() => businessesTable.id),
    kind: text("kind").notNull().default("customer"),
    displayName: text("display_name").notNull(),
    email: text("email"),
    phone: text("phone"),
    company: text("company"),
    /**
     * Display-only descriptor for employee-kind rows ("Senior Dev"), the
     * counterpart to `company` on a customer. Never used in any calculation.
     */
    roleLabel: text("role_label"),
    /**
     * Null today, and deliberately so: this is the column that turns a team
     * member record into a login when roles and permissions are built. Nothing
     * reads it yet — see "Forward compatibility" in the client spec.
     */
    userId: text("user_id"),
    /** First money event with this person — set by backfill/first transaction; cohort anchor. */
    firstTransactionAt: timestamp("first_transaction_at", { withTimezone: true }),
    /** Name-only auto-created people are flagged for the owner to confirm/merge. */
    needsReview: boolean("needs_review").notNull().default(false),
    status: text("status").notNull().default("active"),
    notes: text("notes"),
    /** Set when this row arrived from a CSV import; drives undo. */
    importBatchId: text("import_batch_id").references(() => importBatchesTable.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One person per email per business (case-insensitive), when email is set.
    uniqueIndex("people_business_email_uq").on(t.businessId, sql`lower(${t.email})`).where(sql`${t.email} IS NOT NULL`),
    index("people_business_kind_idx").on(t.businessId, t.kind),
    index("people_business_name_idx").on(t.businessId, t.displayName),
    index("people_import_batch_idx").on(t.importBatchId),
  ],
);

export type Person = typeof peopleTable.$inferSelect;
