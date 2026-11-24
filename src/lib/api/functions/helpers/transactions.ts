import type { z } from "zod";
import { createTransaction as createTransactionContract, transactionTemplatePayload } from "@workspace/api-contract";
import { getManualSource } from "../services/business";
import { resolvePersonByName } from "../services/person";
import { invalid, notFound } from "../services/errors";
import type { CreateTransactionInput } from "../services/ledger";
import { convertEntryToBase, EnteredCurrencyError, entryAmountCents } from "@workspace/domain";

type CreateBody = z.infer<typeof createTransactionContract.body>;

/**
 * An entry typed in another currency becomes a base-currency entry here, before
 * anything else sees it: the ledger, the preview, cost snapshots and every
 * screen downstream only ever meet base money. What was typed rides along.
 */
function convertEntered(body: CreateBody, baseCurrency: string): { body: CreateBody; entered: CreateTransactionInput["entered"] } {
  const enteredIn = body.enteredIn;
  if (!enteredIn) return { body, entered: null };
  if (enteredIn.currency === baseCurrency) {
    throw invalid(`${baseCurrency} is already this business's own currency — no conversion needed`);
  }
  if (body.currency !== undefined || body.fxRateToBase !== undefined) {
    throw invalid("Send either enteredIn or currency/fxRateToBase, not both");
  }
  let converted: CreateBody;
  try {
    converted = convertEntryToBase(body, enteredIn.fxRate);
  } catch (err) {
    if (err instanceof EnteredCurrencyError) throw invalid(err.message);
    throw err;
  }
  const amountCents = entryAmountCents({
    direction: body.direction,
    orderDiscountCents: body.orderDiscountCents ?? 0,
    shippingChargedCents: body.shippingChargedCents ?? 0,
    lines: body.lines.map((l) => ({
      direction: l.direction,
      qty: l.qty ?? "1",
      // Present on every line: convertEntryToBase refused the entry otherwise.
      unitPriceCents: l.unitPriceCents!,
      lineDiscountCents: l.lineDiscountCents ?? 0,
      costSnapshot: null,
    })),
  });
  const { enteredIn: _typed, ...rest } = converted;
  return { body: rest, entered: { currency: enteredIn.currency, fxRate: enteredIn.fxRate, amountCents } };
}

export async function toInput(
  businessId: string,
  userId: string,
  typed: CreateBody,
  baseCurrency: string,
): Promise<CreateTransactionInput> {
  const { body, entered } = convertEntered(typed, baseCurrency);
  const sourceId = body.sourceId ?? (await getManualSource(businessId))?.id;
  if (!sourceId) throw notFound("Source");
  let personId = body.personId ?? null;
  if (!personId && body.personName?.trim()) {
    personId = await resolvePersonByName(businessId, body.personName, new Date(body.occurredAt));
  }

  return {
    direction: body.direction,
    occurredAt: new Date(body.occurredAt),
    // undefined = paid on the day it happened; explicit null = not paid yet.
    paidAt: body.paidAt === undefined ? undefined : body.paidAt === null ? null : new Date(body.paidAt),
    // A plain calendar day, kept as typed: terms are agreed in days, and giving
    // a deadline a time of day would make it late at an hour nobody chose.
    dueDate: body.dueDate === undefined ? undefined : body.dueDate ?? null,
    sourceId,
    personId,
    status: body.status,
    origin: "manual",
    notes: body.notes ?? null,
    referenceNumber: body.referenceNumber ?? null,
    discountCode: body.discountCode ?? null,
    orderDiscountCents: body.orderDiscountCents,
    shippingChargedCents: body.shippingChargedCents,
    taxCollectedCents: body.taxCollectedCents,
    taxPaidCents: body.taxPaidCents,
    taxReclaimable: body.taxReclaimable,
    currency: body.currency,
    fxRateToBase: body.fxRateToBase,
    entered,
    lines: body.lines.map((l) => ({
      direction: l.direction,
      revenueItemId: l.revenueItemId ?? null,
      expenseItemId: l.expenseItemId ?? null,
      label: l.label ?? null,
      categoryId: l.categoryId ?? null,
      qty: l.qty,
      unitPriceCents: l.unitPriceCents,
      lineDiscountCents: l.lineDiscountCents,
      spreadMonths: l.spreadMonths ?? null,
      isAdvance: l.isAdvance ?? false,
      wastedQty: l.wastedQty ?? null,
      targetType: l.targetType ?? null,
      targetId: l.targetId ?? null,
      split: l.split ?? null,
    })),
  };
}

// ── Transaction templates (reusable Quick-Add drafts) ───────────────────────

export function templateView(row: { id: string; name: string; payload: unknown; createdAt: Date }) {
  return {
    id: row.id,
    name: row.name,
    // Stored payloads are re-validated so a drifted old draft fails loudly in
    // dev (response validation) instead of silently mis-posting later.
    payload: transactionTemplatePayload.parse(row.payload),
    createdAt: row.createdAt.toISOString(),
  };
}

// ── Attachments / receipts ──────────────────────────────────────────────────
//
// Upload + download move raw bytes, so they are raw routes rather than contract ones; the
// service enforces the MIME allowlist, the 5 MB cap, and business scoping.
// Metadata list/delete stay on the typed contract like everything else.

export const attachmentView = (row: { id: string; filename: string; mimeType: string; sizeBytes: number; createdAt: Date }) => ({
  id: row.id,
  filename: row.filename,
  mimeType: row.mimeType,
  sizeBytes: row.sizeBytes,
  createdAt: row.createdAt.toISOString(),
});
