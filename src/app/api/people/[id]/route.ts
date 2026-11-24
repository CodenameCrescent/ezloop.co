import type { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { getPersonDetail as getPersonDetailContract, updatePerson as updatePersonContract } from "@workspace/api-contract";
import { db, peopleTable } from "@workspace/db";
import { type AuthedRequest, businessOf } from "@/lib/api/functions/http/guards";
import { computePeopleMetrics, personView } from "@/lib/api/functions/services/analytics";
import { notFound } from "@/lib/api/functions/services/errors";
import { getPerson, listPersonCommitments } from "@/lib/api/functions/services/person";
import { listTransactions } from "@/lib/api/functions/services/read";
import { handle } from "@/lib/api/functions/http/handler";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(request, getPersonDetailContract, { params }, async ({ req, params }) => {
    const userId = (req as AuthedRequest).userId;
    const business = businessOf(req);
    const person = await getPerson(business.id, params.id);
    const metrics = await computePeopleMetrics(business.id);
    // The person's own transactions (filter the ledger by person).
    const all = await listTransactions(business.id, userId, { limit: 200 });
    const transactions = all.items.filter((t) => t.personId === params.id);
    const commitments = await listPersonCommitments(business.id, params.id);
    return { person: personView(person, metrics.get(person.id)), transactions, commitments };
  });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(request, updatePersonContract, { write: true, params }, async ({ req, params, body }) => {
    const business = businessOf(req);
    await getPerson(business.id, params.id);
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (body.displayName !== undefined) patch.displayName = body.displayName;
    if (body.kind !== undefined) patch.kind = body.kind;
    if (body.email !== undefined) patch.email = body.email ?? null;
    if (body.phone !== undefined) patch.phone = body.phone ?? null;
    if (body.company !== undefined) patch.company = body.company ?? null;
    if (body.notes !== undefined) patch.notes = body.notes ?? null;
    if (body.status !== undefined) patch.status = body.status;
    if (body.needsReview !== undefined) patch.needsReview = body.needsReview;
    const [updated] = await db.update(peopleTable).set(patch).where(and(eq(peopleTable.businessId, business.id), eq(peopleTable.id, params.id))).returning();
    if (!updated) throw notFound("Person");
    const metrics = await computePeopleMetrics(business.id);
    return personView(updated, metrics.get(updated.id));
  });
}
