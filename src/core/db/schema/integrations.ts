import { index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { businessesTable } from "./businesses";
import { sourcesTable } from "./sources";

export const integrationKindValues = [
  "shopify",
  "daraz",
  "meta_ads",
  "google_ads",
  "tiktok_ads",
] as const;

export type IntegrationKind = (typeof integrationKindValues)[number];

/**
 * A connected account (a Shopify store, an ad account) belongs to a BUSINESS,
 * not to a person: the money it brings in lands in one set of books, so anything
 * else would leave imported transactions with nowhere honest to go.
 *
 * The old `unique(user_id, kind)` is why a seller could never connect a second
 * Shopify store — REWRITE_PLAN known-broken #10. Keyed on the business instead,
 * two stores is simply two businesses, which is also the only arrangement in
 * which their profit can be told apart.
 */
export const integrationsTable = pgTable(
  "integrations",
  {
    id: text("id").primaryKey(),
    /** Kept alongside business_id: the OAuth flows verify the caller by user. */
    userId: text("user_id").notNull(),
    businessId: text("business_id")
      .notNull()
      .references(() => businessesTable.id),
    kind: text("kind").notNull(),
    displayName: text("display_name").notNull(),
    externalAccount: text("external_account"),
    /**
     * The channel this connected account posts money through.
     *
     * A connected store IS a source — "a store, a marketplace account, a bank"
     * is the definition — and every transaction needs a `source_id`, so the two
     * were always the same thing named twice. Holding the id here rather than
     * matching sources by name means renaming the channel on screen cannot
     * silently split one store's history into two.
     *
     * Nullable: rows predate this, and the sync creates one on first use.
     */
    sourceId: text("source_id").references(() => sourcesTable.id),
    connectedAt: timestamp("connected_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    accessToken: text("access_token"),
  },
  (t) => [
    uniqueIndex("integrations_business_kind_idx").on(t.businessId, t.kind),
    index("integrations_user_idx").on(t.userId),
  ],
);

export const insertIntegrationSchema = createInsertSchema(integrationsTable).omit({
  id: true,
  userId: true,
  businessId: true,
  connectedAt: true,
  lastSyncedAt: true,
});
export type InsertIntegration = z.infer<typeof insertIntegrationSchema>;
export type Integration = typeof integrationsTable.$inferSelect;
