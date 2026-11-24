/**
 * Receipt/attachment storage for transactions. Metadata, not money. Every
 * operation is business-scoped; uploads are validated SERVER-SIDE (never trust
 * the client): MIME allowlist + hard size cap + filename sanitization.
 */
import { and, desc, eq } from "drizzle-orm";
import { db, transactionAttachmentsTable, transactionsTable } from "@workspace/db";
import { uid } from "../lib/uid";
import { invalid, notFound } from "./errors";

export const ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024; // 5 MB
export const ATTACHMENT_ALLOWED_MIME = new Set(["image/png", "image/jpeg", "image/webp", "application/pdf"]);

/** Strip path separators, reserved characters, and control chars; keep a readable basename. */
export function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "attachment";
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[<>:"|?*\u0000-\u001F]/g, "").trim();
  return (cleaned || "attachment").slice(0, 140);
}

async function requireOwnedTransaction(businessId: string, transactionId: string) {
  const [txn] = await db
    .select({ id: transactionsTable.id })
    .from(transactionsTable)
    .where(and(eq(transactionsTable.businessId, businessId), eq(transactionsTable.id, transactionId)));
  if (!txn) throw notFound("Transaction");
}

export async function addAttachment(
  businessId: string,
  transactionId: string,
  input: { filename: string; mimeType: string; data: Buffer },
) {
  if (!ATTACHMENT_ALLOWED_MIME.has(input.mimeType)) {
    throw invalid("Only PNG, JPEG, WebP images or PDF receipts can be attached");
  }
  if (input.data.length === 0) throw invalid("The file is empty");
  if (input.data.length > ATTACHMENT_MAX_BYTES) {
    throw invalid("Attachments are capped at 5 MB");
  }
  await requireOwnedTransaction(businessId, transactionId);

  const [row] = await db
    .insert(transactionAttachmentsTable)
    .values({
      id: uid("att"),
      businessId,
      transactionId,
      filename: sanitizeFilename(input.filename),
      mimeType: input.mimeType,
      sizeBytes: input.data.length,
      data: input.data,
    })
    .returning({
      id: transactionAttachmentsTable.id,
      filename: transactionAttachmentsTable.filename,
      mimeType: transactionAttachmentsTable.mimeType,
      sizeBytes: transactionAttachmentsTable.sizeBytes,
      createdAt: transactionAttachmentsTable.createdAt,
    });
  return row;
}

/** Metadata only — bytes stay in the DB until a download asks for them. */
export async function listAttachments(businessId: string, transactionId: string) {
  await requireOwnedTransaction(businessId, transactionId);
  return db
    .select({
      id: transactionAttachmentsTable.id,
      filename: transactionAttachmentsTable.filename,
      mimeType: transactionAttachmentsTable.mimeType,
      sizeBytes: transactionAttachmentsTable.sizeBytes,
      createdAt: transactionAttachmentsTable.createdAt,
    })
    .from(transactionAttachmentsTable)
    .where(eq(transactionAttachmentsTable.transactionId, transactionId))
    .orderBy(desc(transactionAttachmentsTable.createdAt));
}

/** Business-scoped fetch — a foreign business's id is a 404, never a leak. */
export async function getAttachment(businessId: string, id: string) {
  const [row] = await db
    .select()
    .from(transactionAttachmentsTable)
    .where(and(eq(transactionAttachmentsTable.businessId, businessId), eq(transactionAttachmentsTable.id, id)));
  if (!row) throw notFound("Attachment");
  return row;
}

export async function deleteAttachment(businessId: string, id: string) {
  const deleted = await db
    .delete(transactionAttachmentsTable)
    .where(and(eq(transactionAttachmentsTable.businessId, businessId), eq(transactionAttachmentsTable.id, id)))
    .returning({ id: transactionAttachmentsTable.id });
  if (deleted.length === 0) throw notFound("Attachment");
  return { ok: true };
}
