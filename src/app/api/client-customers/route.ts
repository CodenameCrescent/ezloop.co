import type { NextRequest } from "next/server";
import { and, eq, asc } from "drizzle-orm";
import { listClientCustomers as listClientCustomersContract, createClientCustomer as createClientCustomerContract } from "@workspace/api-contract";
import { db, peopleTable } from "@workspace/db";
import { toApi } from "./functions";
import { businessOf } from "@/lib/api/functions/http/guards";
import { findOrCreatePerson } from "@/lib/api/functions/services/person";
import { handle } from "@/lib/api/functions/http/handler";

export async function GET(request: NextRequest) {
  return handle(request, listClientCustomersContract, {}, async ({ req }) => {
    const business = businessOf(req);
    const rows = await db
      .select()
      .from(peopleTable)
      .where(and(eq(peopleTable.businessId, business.id), eq(peopleTable.kind, "customer")))
      .orderBy(asc(peopleTable.displayName));
    return rows.map(toApi);
  });
}

export async function POST(request: NextRequest) {
  return handle(request, createClientCustomerContract, { write: true }, async ({ req, body }) => {
    const business = businessOf(req);
    const person = await findOrCreatePerson(business.id, { name: body.name, email: body.email ?? null, kind: "customer" });
    // Apply any extra contact fields the caller supplied.
    const [updated] = await db
      .update(peopleTable)
      .set({ phone: body.phone ?? person.phone, company: body.companyName ?? person.company, notes: body.notes ?? person.notes, updatedAt: new Date() })
      .where(eq(peopleTable.id, person.id))
      .returning();
    return toApi(updated);
  });
}
