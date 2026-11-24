import { and, eq, inArray } from "drizzle-orm";
import {
  categoriesTable,
  db,
  expenseItemsTable,
  peopleTable,
  projectsTable,
  revenueItemsTable,
  sourcesTable,
} from "@workspace/db";
import { notFound } from "./errors";

/**
 * Every id a request REFERENCES must belong to the business the request is
 * about — not just the row it edits.
 *
 * The business guard proves the caller owns business A. It cannot know that
 * the body also names a person, category or project, and the foreign keys only
 * prove those ids exist SOMEWHERE. Without this, an owner of A who learned an
 * id from business B could attach B's customer to A's sale (and write to that
 * customer's row), or read B's names back through a response that resolves
 * them. So every service that stores a reference checks it here, BEFORE
 * writing anything.
 *
 * An id from another business answers exactly like an id that does not exist:
 * 404, never 403 — a 403 would confirm the row is real.
 */

type Ids = ReadonlyArray<string | null | undefined> | undefined;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface OwnedRefs {
  personIds?: Ids;
  categoryIds?: Ids;
  projectIds?: Ids;
  revenueItemIds?: Ids;
  expenseItemIds?: Ids;
  sourceIds?: Ids;
}

const KINDS = [
  { key: "personIds", table: peopleTable, label: "Person" },
  { key: "categoryIds", table: categoriesTable, label: "Category" },
  { key: "projectIds", table: projectsTable, label: "Project" },
  { key: "revenueItemIds", table: revenueItemsTable, label: "Revenue item" },
  { key: "expenseItemIds", table: expenseItemsTable, label: "Expense item" },
  { key: "sourceIds", table: sourcesTable, label: "Source" },
] as const;

function distinct(ids: Ids): string[] {
  return [...new Set((ids ?? []).filter((id): id is string => typeof id === "string" && id.length > 0))];
}

/** Throws `not_found` unless every given id belongs to `businessId`. No ids, no query. */
export async function assertOwnedRefs(businessId: string, refs: OwnedRefs, exec: typeof db | Tx = db): Promise<void> {
  for (const kind of KINDS) {
    const ids = distinct(refs[kind.key]);
    if (ids.length === 0) continue;
    const rows = await exec
      .select({ id: kind.table.id })
      .from(kind.table)
      .where(and(eq(kind.table.businessId, businessId), inArray(kind.table.id, ids)));
    if (rows.length !== ids.length) throw notFound(kind.label);
  }
}
