import { bigint, boolean, check, date, index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { businessesTable } from "./businesses";
import { peopleTable } from "./people";

/**
 * Client profitability: attributing labour cost to whatever earns money.
 *
 * THE RULE THIS SCHEMA SERVES: attributed labour is a DISTRIBUTION of payroll
 * the ledger has already counted, never a second cost. Salaries land in the
 * ledger as period expenses the moment they are entered; a time entry only
 * says which target absorbed them. Nothing derived from these tables may be
 * added to the profit ladder. See docs/client-profitability-spec.md.
 *
 * Note what is NOT here: no clients table and no team_members table. A client
 * is a `people` row of kind 'customer' and a team member is one of kind
 * 'employee'. Revenue already attaches to people through transactions.person_id,
 * so a parallel identity table would either be unreachable from the ledger or
 * force a second customer link onto every transaction.
 */

export const teamCostTypeValues = ["salaried", "hourly", "contractor"] as const;
export type TeamCostType = (typeof teamCostTypeValues)[number];

/**
 * What a person costs, effective-dated. Mirrors cost_components exactly: an
 * edit closes the open row and inserts a successor, so a raise in August never
 * rewrites July. Identity lives on `people`; only the money is versioned here,
 * which is why a pay change does not create a second copy of the human.
 */
export const teamMemberRatesTable = pgTable(
  "team_member_rates",
  {
    id: text("id").primaryKey(),
    businessId: text("business_id")
      .notNull()
      .references(() => businessesTable.id),
    personId: text("person_id")
      .notNull()
      .references(() => peopleTable.id),
    costType: text("cost_type").notNull(),
    /** Salary or retainer for `salaried`; the basis of the hourly derivation. */
    monthlyCostCents: bigint("monthly_cost_cents", { mode: "number" }).notNull().default(0),
    /** Used directly for `hourly`/`contractor`, skipping the division. */
    hourlyRateCents: bigint("hourly_rate_cents", { mode: "number" }),
    /**
     * This person's share of rent, software and admin. Feeds ONLY the secondary
     * fully-loaded figure — never the primary contribution, because allocating
     * fixed costs per item is forbidden by CLAUDE.md.
     */
    overheadShareCents: bigint("overhead_share_cents", { mode: "number" }).notNull().default(0),
    /** Decimal string. Defaults to "130", not a full month — see the domain module. */
    billableTargetHours: text("billable_target_hours").notNull().default("130"),
    /** Derived and stored: (monthly_cost + overhead_share) ÷ billable_target. */
    effectiveHourlyCostCents: bigint("effective_hourly_cost_cents", { mode: "number" }).notNull().default(0),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull(),
    /** Null = the open, current version. Exactly one per person at a time. */
    effectiveTo: timestamp("effective_to", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("team_member_rates_business_idx").on(t.businessId),
    index("team_member_rates_person_idx").on(t.personId, t.effectiveFrom),
    // One open version per person, enforced by the database rather than by hope.
    uniqueIndex("team_member_rates_open_uq")
      .on(t.personId)
      .where(sql`${t.effectiveTo} IS NULL`),
  ],
);

export type TeamMemberRate = typeof teamMemberRatesTable.$inferSelect;

export const engagementStatusValues = ["active", "completed", "churned"] as const;
export type EngagementStatus = (typeof engagementStatusValues)[number];

/** How an agreed figure is quoted. Its own answer for the hours and the money. */
export const agreedPeriodValues = ["total", "monthly"] as const;
export type AgreedPeriod = (typeof agreedPeriodValues)[number];

/**
 * The commercial terms of working with a client. The client themself is a
 * `people` row; revenue reaches them through the ledger, so nothing about
 * revenue is duplicated here.
 *
 * SHAPED AS A COLLECTION ON PURPOSE. The code resolves a single engagement
 * today, but a client who does a project and then signs a retainer is the
 * normal agency path, not an edge case — so `person_id` carries NO unique
 * constraint. What is enforced is one ACTIVE engagement at a time; completed
 * ones accumulate beside it. When multi-engagement is wanted, the resolution
 * rule is already storable: the engagement whose date range contains the
 * transaction. Nothing here needs unwinding for that to arrive.
 */
export const clientEngagementsTable = pgTable(
  "client_engagements",
  {
    id: text("id").primaryKey(),
    businessId: text("business_id")
      .notNull()
      .references(() => businessesTable.id),
    personId: text("person_id")
      .notNull()
      .references(() => peopleTable.id),
    /** Lifecycle, not a pipeline. Distinct from people.status, which is identity-level. */
    engagementStatus: text("engagement_status").notNull().default("active"),
    agreedAmountCents: bigint("agreed_amount_cents", { mode: "number" }),
    /**
     * Whether the amount above is the whole fee or a monthly one. Its own answer
     * rather than the hours', because "forty hours a month against a fixed total
     * fee" is a real way to quote a retainer, and forcing one basis onto both
     * would misprice the job by the length of the contract.
     */
    agreedAmountPeriod: text("agreed_amount_period").notNull().default("total"),
    /** Decimal string — what scope creep is measured against. */
    agreedHours: text("agreed_hours"),
    /**
     * Whether the hours above are for the whole job or per month. `total` is
     * what every row written before this column existed meant, which is why it
     * is the default.
     */
    agreedHoursPeriod: text("agreed_hours_period").notNull().default("total"),
    /** A default that pre-fills billing. NOT a conversion path — FX rides the transaction. */
    currency: text("currency").notNull().default("PKR"),
    startDate: date("start_date"),
    endDate: date("end_date"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("client_engagements_business_idx").on(t.businessId),
    index("client_engagements_person_idx").on(t.personId),
    // One LIVE engagement per client; history is unlimited.
    uniqueIndex("client_engagements_active_uq")
      .on(t.businessId, t.personId)
      .where(sql`${t.engagementStatus} = 'active'`),
  ],
);

export type ClientEngagement = typeof clientEngagementsTable.$inferSelect;

export const timeTargetTypeValues = ["client", "revenue_item", "internal", "project"] as const;
export type TimeTargetType = (typeof timeTargetTypeValues)[number];

export const workTypeValues = ["delivery", "rework", "build", "maintenance", "pitching", "admin"] as const;
export type WorkType = (typeof workTypeValues)[number];

/**
 * Where an entry came from. `estimate` is deliberately its own value rather
 * than leaning on `is_estimated`: the three sources rank against each other.
 * Hours typed by hand outrank everything, an import outranks an estimate
 * (real hours beat a guess), and an estimate is only ever replaced, never
 * added to. A boolean could not express that ordering.
 */
export const timeEntrySourceValues = ["manual", "csv_import", "estimate"] as const;
export type TimeEntrySource = (typeof timeEntrySourceValues)[number];

/**
 * Hours, and what they cost. `target_type` + `target_id` point at a client (a
 * person), a revenue item, or an internal category — deliberately not
 * clients-only, so labour spent on a product the business sells lands on that
 * product instead of disappearing into Internal and leaving a fake margin.
 */
export const timeEntriesTable = pgTable(
  "time_entries",
  {
    id: text("id").primaryKey(),
    businessId: text("business_id")
      .notNull()
      .references(() => businessesTable.id),
    /** The team member: a people row of kind 'employee'. */
    personId: text("person_id")
      .notNull()
      .references(() => peopleTable.id),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    entryDate: date("entry_date").notNull(),
    /** Decimal string, like every other quantity here. Floats are banned from money math. */
    hours: text("hours").notNull(),
    billable: boolean("billable").notNull().default(true),
    workType: text("work_type").notNull().default("delivery"),
    /**
     * FROZEN at write from the rate open on entry_date, exactly like a line's
     * cost snapshot. Never recomputed, under any circumstance.
     */
    costRateSnapshotCents: bigint("cost_rate_snapshot_cents", { mode: "number" }).notNull(),
    /** hours × snapshot, computed with decimal.js and stored. */
    costAmountCents: bigint("cost_amount_cents", { mode: "number" }).notNull(),
    /** True for target-level estimates. Must be visible everywhere the figure appears. */
    isEstimated: boolean("is_estimated").notNull().default(false),
    note: text("note"),
    source: text("source").notNull().default("manual"),
    externalId: text("external_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("time_entries_business_date_idx").on(t.businessId, t.entryDate),
    index("time_entries_person_date_idx").on(t.personId, t.entryDate),
    index("time_entries_target_idx").on(t.targetType, t.targetId),
    // Re-importing the same CSV is a no-op — the same idempotency shape the
    // ledger gets from unique(source_id, external_ref).
    uniqueIndex("time_entries_source_external_uq")
      .on(t.businessId, t.source, t.externalId)
      .where(sql`${t.externalId} IS NOT NULL`),
    // Hours above a full day are a typo, not a long shift.
    check("time_entries_hours_check", sql`hours::numeric > 0 AND hours::numeric <= 24`),
  ],
);

export type TimeEntry = typeof timeEntriesTable.$inferSelect;
