import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * What kind of business this is. Deliberately a small open list stored as text
 * rather than a Postgres enum, so adding "retail" or "digital" later is a
 * one-line change with no type migration. Only these two are supported today.
 */
export const businessTypeValues = ["ecommerce", "service"] as const;
export type BusinessType = (typeof businessTypeValues)[number];

/**
 * Owner overrides for individually gated features, keyed by feature id.
 * A key that is absent means "follow my business type" — which must stay
 * distinguishable from an explicit false, so changing type later still moves
 * the default for anyone who never expressed a preference.
 */
export type FeatureOverrides = Record<string, boolean>;

/**
 * A business is the WORKSPACE: one user may own several, each a wholly separate
 * set of books. Every money row hangs off `business_id`, which is why going from
 * one to many needed no change to any money table — only the removal of the
 * unique index that used to pin a user to a single row.
 *
 * Because a business id now arrives from the client rather than being implied by
 * the session, ownership is verified on EVERY request. See
 * `resolveBusiness` in `src/lib/api/functions/http/guards.ts`; nothing else may resolve a business.
 */
export const businessesTable = pgTable(
  "businesses",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    name: text("name").notNull().default("My Business"),
    baseCurrency: text("base_currency").notNull().default("PKR"),
    /** Display only. The symbol is a LABEL — the server never converts (CLAUDE.md). */
    currencySymbol: text("currency_symbol").notNull().default("Rs"),
    /** Drives which features are visible, and which expense types get seeded. */
    businessType: text("business_type").notNull().default("ecommerce"),
    featureOverrides: jsonb("feature_overrides").$type<FeatureOverrides>().notNull().default({}),
    /**
     * Retired, not deleted. A business owns ledger rows and the ledger is
     * append-only, so there is no honest way to remove one — it leaves the
     * switcher and stops being selectable, and its books stay intact.
     */
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("businesses_user_idx").on(t.userId)],
);

export type Business = typeof businessesTable.$inferSelect;
