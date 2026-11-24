import {
  db,
  projectsTable,
  timeEntriesTable,
  transactionLinesTable,
  transactionsTable,
  type Project,
} from "@workspace/db";
import {
  buildRetentionSplit,
  computeProjectProfit,
  isCapitalised,
  lineSubtotal,
  netLineRevenue,
  orderDiscountShares,
  type ProjectProfit,
} from "@workspace/domain";
import { and, eq, inArray } from "drizzle-orm";
import { uid } from "../lib/uid";
import { invalid, notFound } from "./errors";
import { assertOwnedRefs } from "./ownership";
import { profitLine } from "./read";
import { createTransaction } from "./ledger";
import { getManualSource } from "./business";
import { findOrCreatePerson } from "./person";

/**
 * Projects: the container, and the money that reaches it.
 *
 * The arithmetic is `lib/domain/projectProfit.ts`; this file only gathers the
 * four totals it needs. Nothing here decides what contribution profit means.
 */

/** Statuses whose money still counts as live work. Cancelled work is history. */
export const LIVE_PROJECT_STATUSES = ["quoted", "active", "on_hold"] as const;

export async function listProjects(businessId: string, status?: string): Promise<Project[]> {
  const conditions = [eq(projectsTable.businessId, businessId)];
  if (status) conditions.push(eq(projectsTable.status, status));
  return db.select().from(projectsTable).where(and(...conditions)).orderBy(projectsTable.createdAt);
}

export async function getProject(businessId: string, projectId: string): Promise<Project> {
  const [row] = await db
    .select()
    .from(projectsTable)
    .where(and(eq(projectsTable.id, projectId), eq(projectsTable.businessId, businessId)));
  if (!row) throw notFound("Project");
  return row;
}

export interface ProjectInput {
  name: string;
  code?: string | null;
  status?: string;
  personId?: string | null;
  personName?: string | null;
  contractValueCents?: number | null;
  startDate?: string | null;
  endDate?: string | null;
  expectedEndDate?: string | null;
  outputQty?: string | null;
  outputUnitLabel?: string | null;
  notes?: string | null;
}

/** Resolves a free-typed customer name the same way the ledger does. */
async function resolvePerson(businessId: string, input: ProjectInput): Promise<string | null> {
  if (input.personId) {
    await assertOwnedRefs(businessId, { personIds: [input.personId] });
    return input.personId;
  }
  if (input.personName?.trim()) {
    const person = await findOrCreatePerson(businessId, { name: input.personName.trim(), kind: "customer" });
    return person.id;
  }
  return null;
}

export async function createProject(businessId: string, input: ProjectInput): Promise<Project> {
  const personId = await resolvePerson(businessId, input);
  const [created] = await db
    .insert(projectsTable)
    .values({
      id: uid("prj"),
      businessId,
      name: input.name,
      code: input.code ?? null,
      status: input.status ?? "active",
      personId,
      contractValueCents: input.contractValueCents ?? null,
      startDate: input.startDate ?? null,
      endDate: input.endDate ?? null,
      expectedEndDate: input.expectedEndDate ?? null,
      outputQty: input.outputQty ?? null,
      outputUnitLabel: input.outputUnitLabel ?? null,
      notes: input.notes ?? null,
    })
    .returning();
  return created;
}

export async function updateProject(
  businessId: string,
  projectId: string,
  patch: Partial<ProjectInput>,
): Promise<Project> {
  await getProject(businessId, projectId);
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.name !== undefined) updates.name = patch.name;
  if (patch.code !== undefined) updates.code = patch.code ?? null;
  if (patch.status !== undefined) updates.status = patch.status;
  if (patch.contractValueCents !== undefined) updates.contractValueCents = patch.contractValueCents ?? null;
  if (patch.startDate !== undefined) updates.startDate = patch.startDate ?? null;
  if (patch.endDate !== undefined) updates.endDate = patch.endDate ?? null;
  if (patch.expectedEndDate !== undefined) updates.expectedEndDate = patch.expectedEndDate ?? null;
  if (patch.outputQty !== undefined) updates.outputQty = patch.outputQty ?? null;
  if (patch.outputUnitLabel !== undefined) updates.outputUnitLabel = patch.outputUnitLabel ?? null;
  if (patch.notes !== undefined) updates.notes = patch.notes ?? null;
  if (patch.personId !== undefined || patch.personName !== undefined) {
    updates.personId = await resolvePerson(businessId, patch as ProjectInput);
  }

  const [updated] = await db
    .update(projectsTable)
    .set(updates)
    .where(and(eq(projectsTable.id, projectId), eq(projectsTable.businessId, businessId)))
    .returning();
  return updated;
}

// ---------------------------------------------------------------------------
// The money
// ---------------------------------------------------------------------------

interface ProjectTotals {
  billedCents: number;
  receivedCents: number;
  directCostCents: number;
  labourCostCents: number;
}

/**
 * The four totals `computeProjectProfit` needs, for many projects at once.
 *
 * One pass over every line that names a project, rather than a query per
 * project: the list screen shows every project's money, and N round-trips there
 * is how a page that felt instant at three projects stops being usable at fifty.
 */
async function loadTotals(businessId: string, projectIds: string[]): Promise<Map<string, ProjectTotals>> {
  const totals = new Map<string, ProjectTotals>();
  for (const id of projectIds) {
    totals.set(id, { billedCents: 0, receivedCents: 0, directCostCents: 0, labourCostCents: 0 });
  }
  if (projectIds.length === 0) return totals;

  const rows = await db
    .select({ line: transactionLinesTable, header: transactionsTable })
    .from(transactionLinesTable)
    .innerJoin(transactionsTable, eq(transactionLinesTable.transactionId, transactionsTable.id))
    .where(
      and(
        eq(transactionsTable.businessId, businessId),
        eq(transactionLinesTable.targetType, "project"),
        inArray(transactionLinesTable.targetId, projectIds),
      ),
    );

  // Grouped by transaction so an order-level discount can be shared across the
  // revenue lines it actually applies to, exactly as the ladder does it.
  const byTransaction = new Map<string, { header: typeof rows[number]["header"]; lines: typeof rows[number]["line"][] }>();
  for (const row of rows) {
    const entry = byTransaction.get(row.header.id) ?? { header: row.header, lines: [] };
    entry.lines.push(row.line);
    byTransaction.set(row.header.id, entry);
  }

  for (const { header, lines } of byTransaction.values()) {
    // Void rows are not money; `pending` means the owner has not confirmed it
    // happened, which is not the same as it having happened.
    if (header.status === "void" || header.status === "pending") continue;

    /**
     * A refund REVERSES what it refunds.
     *
     * Refund lines inherit the original line's direction — a refunded sale
     * produces "in" lines — so without this sign a refund would ADD to what the
     * project had billed. They also inherit its target (see `createRefund`),
     * which is what lets the reversal find its way back here at all: before
     * that, a site billed Rs 2,000,000 and refunded Rs 500,000 went on
     * reporting Rs 2,000,000 earned, for ever.
     */
    const sign = header.adjustmentType ? -1 : 1;

    const revenueLines = lines.filter((line) => line.direction === "in");
    const costLines = lines.filter((line) => line.direction === "out");

    if (revenueLines.length > 0) {
      const profitLines = revenueLines.map(profitLine);
      const shares = orderDiscountShares(header.orderDiscountCents, profitLines);
      revenueLines.forEach((line, i) => {
        const amount = netLineRevenue(profitLines[i], shares[i]);
        const totals_ = totals.get(line.targetId!);
        if (!totals_) return;
        totals_.billedCents += sign * amount;
        // Received is the same money, counted only once the cash moved. Two
        // questions off one row: what the project has earned, and what of that
        // has actually arrived.
        if (header.paidAt) totals_.receivedCents += sign * amount;
      });
    }

    for (const line of costLines) {
      const totals_ = totals.get(line.targetId!);
      if (!totals_) continue;
      /**
       * A CAPITALISED line spends nothing. Slices of a spread purchase carry
       * their line's target, so a machine bought for a site charges that site
       * across the months it covers — and both the original purchase and every
       * slice reach this query, because both name the project.
       *
       * Counting the parent as well as its slices charges the site twice for one
       * machine, which a Rs 240,000 purchase proved by arriving as Rs 480,000.
       * `lineSubtotal` does not know about spreading — that rule lives in
       * `defersToSlices` inside the ladder — so it is applied explicitly here.
       *
       * This is the ACCRUAL answer, which is the right one for "what has this
       * project consumed": the cash left the bank in April, but the machine is
       * used across the whole job.
       */
      if (isCapitalised(line.spreadMonths)) continue;
      totals_.directCostCents += sign * lineSubtotal(profitLine(line));
    }
  }

  // Labour: hours booked to the project at their FROZEN rates. Never recomputed
  // from today's pay — a raise in August must not restate July's site cost.
  const hours = await db
    .select({ targetId: timeEntriesTable.targetId, costAmountCents: timeEntriesTable.costAmountCents })
    .from(timeEntriesTable)
    .where(
      and(
        eq(timeEntriesTable.businessId, businessId),
        eq(timeEntriesTable.targetType, "project"),
        inArray(timeEntriesTable.targetId, projectIds),
      ),
    );
  for (const entry of hours) {
    const totals_ = totals.get(entry.targetId);
    if (totals_) totals_.labourCostCents += entry.costAmountCents;
  }

  return totals;
}

export interface ProjectMoney extends ProjectProfit {
  billedCents: number;
  receivedCents: number;
  directCostCents: number;
  labourCostCents: number;
}

export async function computeProjectMoney(
  businessId: string,
  projects: Project[],
): Promise<Map<string, ProjectMoney>> {
  const totals = await loadTotals(businessId, projects.map((p) => p.id));
  const out = new Map<string, ProjectMoney>();
  for (const project of projects) {
    const t = totals.get(project.id)!;
    const profit = computeProjectProfit({
      contractValueCents: project.contractValueCents ?? null,
      billedCents: t.billedCents,
      receivedCents: t.receivedCents,
      directCostCents: t.directCostCents,
      labourCostCents: t.labourCostCents,
      outputQty: project.outputQty ?? null,
    });
    out.set(project.id, { ...profit, ...t });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Billing, with retention
// ---------------------------------------------------------------------------

export interface BillProjectInput {
  amountCents: number;
  occurredAt: Date;
  label: string;
  dueDate?: string | null;
  retentionPct?: string | null;
  retentionDueDate?: string | null;
  referenceNumber?: string | null;
}

/**
 * Raise an invoice against a project, optionally holding a percentage back.
 *
 * With a retention this writes TWO ordinary receivables through the ordinary
 * `createTransaction` path. It is not a part-payment and not a new money path:
 * two promises, made at once, with two different dates, only one of them owed
 * yet. Both land on the owed list and each states its own honest position.
 */
export async function billProject(businessId: string, projectId: string, input: BillProjectInput) {
  const project = await getProject(businessId, projectId);
  if (input.amountCents <= 0) throw invalid("An invoice has to be for more than nothing.");

  const source = await getManualSource(businessId);
  if (!source) throw notFound("Source");
  const sourceId = source.id;
  const retaining = !!input.retentionPct?.trim();

  if (retaining && !input.retentionDueDate) {
    // Without a release date the held-back part would sit undated for ever,
    // which is exactly the state this feature exists to avoid.
    throw invalid("Say when the held-back money is due, or don't hold any back.");
  }

  // RangeError from the domain guard becomes a 400 through contractError.
  const split = retaining
    ? buildRetentionSplit(input.amountCents, input.retentionPct!)
    : { nowCents: input.amountCents, heldBackCents: 0, pct: "0" };

  const common = {
    direction: "in" as const,
    occurredAt: input.occurredAt,
    paidAt: null,
    sourceId,
    personId: project.personId ?? undefined,
    referenceNumber: input.referenceNumber ?? null,
  };

  const transactionIds: string[] = [];

  const main = await createTransaction(businessId, {
    ...common,
    dueDate: input.dueDate ?? null,
    lines: [
      {
        label: input.label,
        qty: "1",
        unitPriceCents: split.nowCents,
        targetType: "project",
        targetId: project.id,
      },
    ],
  });
  transactionIds.push(main.transaction.id);

  if (split.heldBackCents > 0) {
    const held = await createTransaction(businessId, {
      ...common,
      dueDate: input.retentionDueDate!,
      lines: [
        {
          // Named so it is unmistakable on the owed list, where it will sit for
          // months beside ordinary invoices.
          label: `${input.label} — ${split.pct}% held back until sign-off`,
          qty: "1",
          unitPriceCents: split.heldBackCents,
          targetType: "project",
          targetId: project.id,
        },
      ],
    });
    transactionIds.push(held.transaction.id);
  }

  return { transactionIds, dueNowCents: split.nowCents, heldBackCents: split.heldBackCents };
}
