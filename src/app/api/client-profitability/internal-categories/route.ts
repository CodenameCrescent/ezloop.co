import type { NextRequest } from "next/server";
import { and, eq, asc } from "drizzle-orm";
import { listInternalTimeCategories as listInternalTimeCategoriesContract } from "@workspace/api-contract";
import { db, categoriesTable } from "@workspace/db";
import { businessOf } from "@/lib/api/functions/http/guards";
import { handle } from "@/lib/api/functions/http/handler";

/**
 * Client profitability. Every handler here carries `feature: "client_profitability"`,
 * so the server refuses when the business has it switched off — hiding the nav
 * entry is not gating.
 */
export async function GET(request: NextRequest) {
  return handle(request, listInternalTimeCategoriesContract, { feature: "client_profitability" }, async ({ req }) => {
    const business = businessOf(req);
    const rows = await db
      .select({ id: categoriesTable.id, name: categoriesTable.name })
      .from(categoriesTable)
      .where(and(eq(categoriesTable.businessId, business.id), eq(categoriesTable.appliesTo, "time")))
      .orderBy(asc(categoriesTable.name));
    return { categories: rows };
  });
}
