import { bigint, customType, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { businessesTable } from "./businesses";
import { transactionsTable } from "./transactions";

/** Raw file bytes. Drizzle has no first-class bytea; Buffer in/out. */
const bytea = customType<{ data: Buffer }>({
  dataType() {
    return "bytea";
  },
});

/**
 * Receipts/attachments on a transaction. Metadata, not money — append-only
 * does not apply, but every access is business-scoped and uploads are
 * server-side capped (size + MIME allowlist). Stored in Postgres so local +
 * Replit deployments need zero extra infra; the download route abstracts the
 * storage so a later move to object storage is contained.
 */
export const transactionAttachmentsTable = pgTable(
  "transaction_attachments",
  {
    id: text("id").primaryKey(),
    businessId: text("business_id")
      .notNull()
      .references(() => businessesTable.id),
    transactionId: text("transaction_id")
      .notNull()
      .references(() => transactionsTable.id),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    data: bytea("data").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("transaction_attachments_txn_idx").on(t.transactionId)],
);

export type TransactionAttachment = typeof transactionAttachmentsTable.$inferSelect;
