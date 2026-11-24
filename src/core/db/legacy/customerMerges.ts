import {
  pgTable,
  text,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const customerMergesTable = pgTable(
  "customer_merges",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    primaryKey: text("primary_key").notNull(),
    primaryLabel: text("primary_label").notNull(),
    mergedKey: text("merged_key").notNull(),
    mergedLabel: text("merged_label").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    userIdx: index("customer_merges_user_idx").on(t.userId),
    uniqEdge: uniqueIndex("customer_merges_user_edge_uq").on(
      t.userId,
      t.primaryKey,
      t.mergedKey,
    ),
  }),
);

export type CustomerMergeRow = typeof customerMergesTable.$inferSelect;
