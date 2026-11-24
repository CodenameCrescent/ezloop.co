import { boolean, doublePrecision, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { businessesTable } from "./businesses";

/**
 * Preferences that belong to ONE SET OF BOOKS.
 *
 * These all used to sit on `user_settings`, which was correct while a user had
 * exactly one business and became wrong the moment they could have two: a cash
 * buffer, a margin threshold and a budget describe a business, not a person. An
 * owner running a shop and a studio needs different answers for each, and
 * sharing them would have made every threshold on the second business a
 * leftover from the first.
 *
 * What stayed behind on `user_settings` is the short list that really is about
 * the account: the plan, the Paddle ids, the locale, and whether toasts show.
 *
 * NOTE ON THE FLOATS. `default_cost_price`, `default_selling_price` and
 * `cash_buffer` are `double precision`, which the money invariant forbids —
 * they are carried across unchanged BECAUSE this migration is a move, not a
 * repair, and changing storage and location at once makes a reconciliation
 * impossible to read. They are legacy form prefills and a display threshold; no
 * ledger figure is computed from them. Converting them to minor units is its
 * own small piece of work.
 */
export const businessSettingsTable = pgTable("business_settings", {
  businessId: text("business_id")
    .primaryKey()
    .references(() => businessesTable.id),
  /** Prefills the "what did it cost / what do you charge" boxes. Not money math. */
  defaultCostPrice: doublePrecision("default_cost_price").notNull().default(0),
  defaultSellingPrice: doublePrecision("default_selling_price").notNull().default(0),
  /** Insight thresholds — when to call something worth scaling or worth stopping. */
  scaleMargin: doublePrecision("scale_margin").notNull().default(25),
  stopScore: doublePrecision("stop_score").notNull().default(-30),
  minOrders: integer("min_orders").notNull().default(3),
  adAttributionPct: doublePrecision("ad_attribution_pct").notNull().default(70),
  /** The floor a cash position is measured against on the Cash Flow screen. */
  cashBuffer: doublePrecision("cash_buffer").notNull().default(0),
  /** JSON string, parsed by `lib/businessModels.ts`. */
  businessModels: text("business_models").notNull().default("[]"),
  /** When sample data was last loaded into this business. */
  seededAt: timestamp("seeded_at", { withTimezone: true }),
  /** Kept for the onboarding screens to know a business has been set up once. */
  onboarded: boolean("onboarded").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type BusinessSettings = typeof businessSettingsTable.$inferSelect;
