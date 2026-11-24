import { bigint, date, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { businessesTable } from "./businesses";
import { peopleTable } from "./people";

export const projectStatusValues = ["quoted", "active", "on_hold", "completed", "cancelled"] as const;
export type ProjectStatus = (typeof projectStatusValues)[number];

/**
 * A discrete piece of work with its own money: a site, a contract, a production
 * run. The container costs and revenue point at, so an owner can ask "did I make
 * money on THAT one" rather than only "how was August".
 *
 * ── Not a renamed engagement ────────────────────────────────────────────────
 *
 * `client_engagements` is the TERMS OF A RELATIONSHIP with a client — an agreed
 * fee, agreed hours, one live at a time. A project is a unit of WORK. One client
 * with one engagement can run five projects, so these are different levels, not
 * two names for the same thing. Twenty-six files depend on engagements; nothing
 * here disturbs them.
 *
 * ── No new money path ───────────────────────────────────────────────────────
 *
 * Money reaches a project through `transaction_lines.target_type = 'project'`
 * and `time_entries.target_type = 'project'` — machinery that already exists and
 * is already tested. Splitting a bill across projects, spreading a purchase
 * whose slices keep the project, freezing cost snapshots: all of it works the
 * day the enum value lands, because none of it knows what a target IS.
 */
export const projectsTable = pgTable(
  "projects",
  {
    id: text("id").primaryKey(),
    businessId: text("business_id")
      .notNull()
      .references(() => businessesTable.id),
    name: text("name").notNull(),
    /** The owner's own job number, if they use one. Never generated for them. */
    code: text("code"),
    /** The customer, when there is one. A production run usually has none. */
    personId: text("person_id").references(() => peopleTable.id),
    status: text("status").notNull().default("active"),
    /** What the work is worth, if it was agreed. Null when it was not. */
    contractValueCents: bigint("contract_value_cents", { mode: "number" }),
    startDate: date("start_date"),
    /** When it actually finished. */
    endDate: date("end_date"),
    /** When it is meant to finish — kept apart from `end_date`, which is a fact. */
    expectedEndDate: date("expected_end_date"),
    /**
     * Units produced, as a decimal string like every other quantity here.
     * Turns cost-to-date into cost per unit made, which is the manufacturing
     * question this table exists to answer.
     */
    outputQty: text("output_qty"),
    /** What those units are counted in — "unit", "tonne", "sq ft". */
    outputUnitLabel: text("output_unit_label"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("projects_business_status_idx").on(t.businessId, t.status),
    index("projects_person_idx").on(t.personId),
  ],
);

export type Project = typeof projectsTable.$inferSelect;
