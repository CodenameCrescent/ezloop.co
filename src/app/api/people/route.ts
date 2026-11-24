import type { NextRequest } from "next/server";
import { and, eq, asc } from "drizzle-orm";
import { listPeople as listPeopleContract, createPerson as createPersonContract } from "@workspace/api-contract";
import { db, peopleTable } from "@workspace/db";
import { type AuthedRequest, businessOf } from "@/lib/api/functions/http/guards";
import { computePeopleMetrics, personView, findDuplicates } from "@/lib/api/functions/services/analytics";
import { findOrCreatePerson } from "@/lib/api/functions/services/person";
import { handle } from "@/lib/api/functions/http/handler";

export async function GET(request: NextRequest) {
  return handle(request, listPeopleContract, {}, async ({ req, query }) => {
    const userId = (req as AuthedRequest).userId;
    const business = businessOf(req);
    const [rows, metrics] = await Promise.all([
      db.select().from(peopleTable).where(query.kind ? and(eq(peopleTable.businessId, business.id), eq(peopleTable.kind, query.kind)) : eq(peopleTable.businessId, business.id)).orderBy(asc(peopleTable.displayName)),
      computePeopleMetrics(business.id),
    ]);
    // No status asked for means active, because that is what a picker wants.
    const want = query.status ?? "active";
    const items = rows
      .filter((p) => want === "all" || p.status === want)
      .map((p) => personView(p, metrics.get(p.id)));
    // Always computed over the ACTIVE rows only, whatever is being listed:
    // findDuplicates skips archived people, so a merged-away record does not
    // keep proposing itself as a duplicate of the record it merged into.
    return { items, possibleDuplicates: findDuplicates(rows) };
  });
}

export async function POST(request: NextRequest) {
  return handle(request, createPersonContract, { write: true }, async ({ req, body }) => {
    const business = businessOf(req);
    const person = await findOrCreatePerson(business.id, { name: body.displayName, email: body.email ?? null, kind: body.kind });
    const [updated] = await db
      .update(peopleTable)
      .set({ phone: body.phone ?? person.phone, company: body.company ?? person.company, notes: body.notes ?? person.notes, updatedAt: new Date() })
      .where(eq(peopleTable.id, person.id))
      .returning();
    const metrics = await computePeopleMetrics(business.id);
    return personView(updated, metrics.get(updated.id));
  });
}
