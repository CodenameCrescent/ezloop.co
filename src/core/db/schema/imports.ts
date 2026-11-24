import { bigint, index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { businessesTable } from "./businesses";
import { sourcesTable } from "./sources";

export const importKindValues = ["transactions", "revenue_items", "expense_items", "people"] as const;
export type ImportKindValue = (typeof importKindValues)[number];

export const importBatchStatusValues = ["applied", "undone"] as const;
export type ImportBatchStatus = (typeof importBatchStatusValues)[number];

/**
 * One upload. Every row an import creates points back here, which is what makes
 * "undo this import" a single, honest operation rather than a hunt.
 *
 * The resolved mapping is kept because it is the only record of how the file
 * was read — and because remembering it per source is the obvious next feature.
 */
export const importBatchesTable = pgTable(
  "import_batches",
  {
    id: text("id").primaryKey(),
    businessId: text("business_id")
      .notNull()
      .references(() => businessesTable.id),
    kind: text("kind").notNull(),
    filename: text("filename").notNull(),
    /** Null for catalog imports, which do not belong to a channel. */
    sourceId: text("source_id").references(() => sourcesTable.id),
    status: text("status").notNull().default("applied"),
    /** Rows in the file, before grouping. */
    sourceRowCount: bigint("source_row_count", { mode: "number" }).notNull().default(0),
    createdCount: bigint("created_count", { mode: "number" }).notNull().default(0),
    skippedCount: bigint("skipped_count", { mode: "number" }).notNull().default(0),
    failedCount: bigint("failed_count", { mode: "number" }).notNull().default(0),
    /** field -> header, plus dateOrder / totalsAre. The record of how it was read. */
    mappingJson: jsonb("mapping_json"),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    undoneAt: timestamp("undone_at", { withTimezone: true }),
    undoneBy: text("undone_by"),
  },
  (t) => [index("import_batches_business_created_idx").on(t.businessId, t.createdAt)],
);

export type ImportBatch = typeof importBatchesTable.$inferSelect;
