import type { NextRequest } from "next/server";
import { getTransaction as getTransactionContract, updateTransaction as updateContract } from "@workspace/api-contract";
import { type AuthedRequest, businessOf } from "@/lib/api/functions/http/guards";
import { notFound } from "@/lib/api/functions/services/errors";
import * as ledger from "@/lib/api/functions/services/ledger";
import { resolvePersonByName } from "@/lib/api/functions/services/person";
import { getTransactionDetail } from "@/lib/api/functions/services/read";
import { handle } from "@/lib/api/functions/http/handler";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(request, getTransactionContract, { params }, async ({ req, params }) => {
    const userId = (req as AuthedRequest).userId;
    const business = businessOf(req);
    const detail = await getTransactionDetail(business.id, userId, params.id);
    if (!detail) throw notFound("Transaction");
    return detail;
  });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(request, updateContract, { write: true, params }, async ({ req, params, body }) => {
    const userId = (req as AuthedRequest).userId;
    const business = businessOf(req);

    // Resolve a final person value: undefined = leave as-is; null = clear.
    let personId: string | null | undefined = undefined;
    if (body.personId !== undefined) {
      personId = body.personId;
    } else if (body.personName !== undefined) {
      personId = body.personName?.trim()
        ? await resolvePersonByName(
            business.id,
            body.personName,
            body.occurredAt ? new Date(body.occurredAt) : new Date(),
          )
        : null;
    }

    await ledger.updateTransactionHeader(business.id, params.id, {
      notes: body.notes === undefined ? undefined : body.notes ?? null,
      referenceNumber: body.referenceNumber === undefined ? undefined : body.referenceNumber ?? null,
      occurredAt: body.occurredAt ? new Date(body.occurredAt) : undefined,
      personId,
      // undefined = leave as is; null = mark unpaid; a date = mark paid then.
      paidAt: body.paidAt === undefined ? undefined : body.paidAt === null ? null : new Date(body.paidAt),
      dueDate: body.dueDate === undefined ? undefined : body.dueDate ?? null,
    });
    const detail = await getTransactionDetail(business.id, userId, params.id);
    return detail!.transaction;
  });
}
