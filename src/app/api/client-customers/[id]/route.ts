import type { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { updateClientCustomer as updateClientCustomerContract, deleteClientCustomer as deleteClientCustomerContract } from "@workspace/api-contract";
import { db, peopleTable } from "@workspace/db";
import { toApi } from "../functions";
import { businessOf } from "@/lib/api/functions/http/guards";
import { notFound } from "@/lib/api/functions/services/errors";
import { getPerson } from "@/lib/api/functions/services/person";
import { handle } from "@/lib/api/functions/http/handler";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(request, updateClientCustomerContract, { write: true, params }, async ({ req, params, body }) => {
    const business = businessOf(req);
    await getPerson(business.id, params.id);
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (body.name !== undefined) patch.displayName = body.name;
    if (body.phone !== undefined) patch.phone = body.phone ?? null;
    if (body.email !== undefined) patch.email = body.email ?? null;
    if (body.companyName !== undefined) patch.company = body.companyName ?? null;
    if (body.notes !== undefined) patch.notes = body.notes ?? null;
    const [updated] = await db
      .update(peopleTable)
      .set(patch)
      .where(and(eq(peopleTable.businessId, business.id), eq(peopleTable.id, params.id)))
      .returning();
    if (!updated) throw notFound("Person");
    return toApi(updated);
  });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(request, deleteClientCustomerContract, { write: true, params }, async ({ req, params }) => {
    const business = businessOf(req);
    // Never hard-delete a person with money history — archive instead.
    await db
      .update(peopleTable)
      .set({ status: "archived", updatedAt: new Date() })
      .where(and(eq(peopleTable.businessId, business.id), eq(peopleTable.id, params.id)));
    return { ok: true };
  });
}
