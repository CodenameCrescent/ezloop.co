import {
  budgetLinesTable,
  budgetsTable,
  db,
  projectsTable,
  type Budget,
  type BudgetLine,
} from "@workspace/db";
import {
  budgetPace,
  computeBudget,
  expenseLineSpends,
  monthsInSpan,
  netLineRevenue,
  orderDiscountShares,
  revenueForTargetProfit,
  type BudgetLineInput,
  type LedgerAmount,
} from "@workspace/domain";
import { and, eq, inArray } from "drizzle-orm";
import { uid } from "../lib/uid";
import { invalid, notFound } from "./errors";
import { assertOwnedRefs } from "./ownership";
import {
  computeBreakEvenReport,
  computePnl,
  lineCategoryId,
  loadNameMaps,
  loadPeriodTransactions,
  profitLine,
} from "./read";

/**
 * Budgets: gathering the plan and the reality, and handing both to the domain.
 *
 * The MATCHING and the arithmetic are `lib/domain/budget.ts`. Nothing here
 * decides what counts as over budget, and nothing here searches a name for a
 * word — which is what the screen this replaces did.
 */

export async function listBudgets(businessId: string, status?: string): Promise<Budget[]> {
  const conditions = [eq(budgetsTable.businessId, businessId)];
  if (status) conditions.push(eq(budgetsTable.status, status));
  return db.select().from(budgetsTable).where(and(...conditions)).orderBy(budgetsTable.periodStart);
}

export async function getBudgetRow(businessId: string, budgetId: string): Promise<Budget> {
  const [row] = await db
    .select()
    .from(budgetsTable)
    .where(and(eq(budgetsTable.id, budgetId), eq(budgetsTable.businessId, businessId)));
  if (!row) throw notFound("Budget");
  return row;
}

async function linesOf(budgetId: string): Promise<BudgetLine[]> {
  return db.select().from(budgetLinesTable).where(eq(budgetLinesTable.budgetId, budgetId));
}

export interface BudgetLineWrite {
  side: "in" | "out";
  expenseItemId?: string | null;
  revenueItemId?: string | null;
  categoryId?: string | null;
  label?: string | null;
  amountCents: number;
  basis?: "total" | "per_month";
}

export interface BudgetWrite {
  name: string;
  scope?: "period" | "project";
  projectId?: string | null;
  periodStart: string;
  periodEnd: string;
  targetProfitCents?: number | null;
  status?: string;
  lines?: BudgetLineWrite[];
}

function assertOneMatch(line: BudgetLineWrite) {
  const named = [line.expenseItemId, line.revenueItemId, line.categoryId, line.label?.trim() || null].filter(
    (value) => value != null && value !== "",
  );
  if (named.length !== 1) {
    throw invalid("Each budget line has to name exactly one thing to budget for");
  }
}

/** The project and every line's item/category must be this business's own — checked before any write. */
async function assertBudgetRefs(businessId: string, input: Partial<BudgetWrite>) {
  const lines = input.lines ?? [];
  await assertOwnedRefs(businessId, {
    projectIds: [input.projectId],
    revenueItemIds: lines.map((l) => l.revenueItemId),
    expenseItemIds: lines.map((l) => l.expenseItemId),
    categoryIds: lines.map((l) => l.categoryId),
  });
}

async function writeLines(budgetId: string, lines: BudgetLineWrite[]) {
  for (const line of lines) assertOneMatch(line);
  /**
   * Lines are REPLACED, not merged. A budget is edited as a whole — the screen
   * sends the list it is showing — and merging would leave a removed line
   * silently in place, still claiming money the owner thinks is unbudgeted.
   */
  await db.delete(budgetLinesTable).where(eq(budgetLinesTable.budgetId, budgetId));
  if (lines.length === 0) return;
  await db.insert(budgetLinesTable).values(
    lines.map((line) => ({
      id: uid("bl"),
      budgetId,
      side: line.side,
      expenseItemId: line.expenseItemId ?? null,
      revenueItemId: line.revenueItemId ?? null,
      categoryId: line.categoryId ?? null,
      label: line.label?.trim() || null,
      amountCents: line.amountCents,
      basis: line.basis ?? "total",
    })),
  );
}

export async function createBudget(businessId: string, input: BudgetWrite): Promise<Budget> {
  if (input.scope === "project" && !input.projectId) {
    throw invalid("A project budget has to say which project it is for");
  }
  await assertBudgetRefs(businessId, input);
  const [created] = await db
    .insert(budgetsTable)
    .values({
      id: uid("bud"),
      businessId,
      name: input.name,
      scope: input.scope ?? "period",
      projectId: input.scope === "project" ? input.projectId! : null,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      targetProfitCents: input.targetProfitCents ?? null,
      status: input.status ?? "active",
    })
    .returning();
  if (input.lines) await writeLines(created.id, input.lines);
  return created;
}

export async function updateBudget(
  businessId: string,
  budgetId: string,
  patch: Partial<BudgetWrite>,
): Promise<Budget> {
  await getBudgetRow(businessId, budgetId);
  await assertBudgetRefs(businessId, patch);
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.name !== undefined) updates.name = patch.name;
  if (patch.periodStart !== undefined) updates.periodStart = patch.periodStart;
  if (patch.periodEnd !== undefined) updates.periodEnd = patch.periodEnd;
  if (patch.targetProfitCents !== undefined) updates.targetProfitCents = patch.targetProfitCents ?? null;
  if (patch.status !== undefined) updates.status = patch.status;

  const [updated] = await db
    .update(budgetsTable)
    .set(updates)
    .where(and(eq(budgetsTable.id, budgetId), eq(budgetsTable.businessId, businessId)))
    .returning();
  if (patch.lines) await writeLines(budgetId, patch.lines);
  return updated;
}

// ---------------------------------------------------------------------------
// The comparison
// ---------------------------------------------------------------------------

/**
 * Every line of real money in the span, flattened to what the matcher needs.
 *
 * Costs use `expenseLineSpends`, which is the ladder's own per-line spend —
 * so a capitalised purchase contributes nothing here and its monthly slices do,
 * exactly as they do in the profit figures. Getting this from anywhere else is
 * how a budget starts disagreeing with the P&L beside it.
 */
async function loadActuals(businessId: string, budget: Budget): Promise<LedgerAmount[]> {
  const [txns, maps] = await Promise.all([
    loadPeriodTransactions(businessId, {
      start: new Date(`${budget.periodStart}T00:00:00Z`),
      end: new Date(`${budget.periodEnd}T23:59:59.999Z`),
    }),
    // Needed for one thing: a line that names a catalogue item carries no
    // category of its own, so a category budget line would match nothing at all
    // without the item's category behind it. `lineCategoryId` is the same
    // fallback every other reader uses.
    loadNameMaps(businessId, ""),
  ]);

  const out: LedgerAmount[] = [];
  for (const { header, lines } of txns) {
    if (header.status === "void" || header.status === "pending") continue;
    // A refund reverses a sale that is already counted; letting it through as
    // its own row would double the movement rather than cancel it.
    if (header.adjustmentType) continue;
    // A project budget only counts money that named that project.
    const relevant =
      budget.scope === "project"
        ? lines.filter((line) => line.targetType === "project" && line.targetId === budget.projectId)
        : lines;
    if (relevant.length === 0) continue;

    const profitLines = relevant.map(profitLine);
    const revenueLines = relevant.filter((line) => line.direction === "in");
    const costLines = relevant.filter((line) => line.direction === "out");

    if (revenueLines.length > 0) {
      const rev = revenueLines.map(profitLine);
      const shares = orderDiscountShares(header.orderDiscountCents, rev);
      revenueLines.forEach((line, i) => {
        out.push({
          side: "in",
          amountCents: netLineRevenue(rev[i], shares[i]),
          expenseItemId: null,
          revenueItemId: line.revenueItemId ?? null,
          categoryId: lineCategoryId(line, maps),
          label: line.label ?? null,
        });
      });
    }

    if (costLines.length > 0) {
      const spends = expenseLineSpends(
        profitLines.filter((_, i) => relevant[i].direction === "out"),
        // The order discount is shared across revenue lines above; applying it
        // again here would subtract it twice.
        0,
      );
      costLines.forEach((line, i) => {
        out.push({
          side: "out",
          amountCents: spends[i],
          expenseItemId: line.expenseItemId ?? null,
          revenueItemId: null,
          categoryId: lineCategoryId(line, maps),
          label: line.label ?? null,
        });
      });
    }
  }
  return out;
}

function toDomainLine(row: BudgetLine): BudgetLineInput {
  const match = row.expenseItemId
    ? { kind: "expense_item" as const, value: row.expenseItemId }
    : row.revenueItemId
      ? { kind: "revenue_item" as const, value: row.revenueItemId }
      : row.categoryId
        ? { kind: "category" as const, value: row.categoryId }
        : { kind: "label" as const, value: row.label! };
  return {
    id: row.id,
    side: row.side as "in" | "out",
    match,
    amountCents: row.amountCents,
    basis: row.basis as "total" | "per_month",
  };
}

export async function computeBudgetDetail(businessId: string, userId: string, budgetId: string) {
  const budget = await getBudgetRow(businessId, budgetId);
  const [rows, actuals, maps] = await Promise.all([
    linesOf(budgetId),
    loadActuals(businessId, budget),
    loadNameMaps(businessId, userId),
  ]);

  const months = monthsInSpan(budget.periodStart, budget.periodEnd);
  const result = computeBudget({ months, lines: rows.map(toDomainLine), actuals });

  const nameOf = (row: BudgetLine): string =>
    (row.expenseItemId ? maps.expenseItems.get(row.expenseItemId)?.name : null) ??
    (row.revenueItemId ? maps.revenueItems.get(row.revenueItemId)?.name : null) ??
    (row.categoryId ? maps.categories.get(row.categoryId)?.name : null) ??
    row.label ??
    "Unnamed";

  const byId = new Map(rows.map((row) => [row.id, row]));
  const lines = result.rows.map((computed) => {
    const row = byId.get(computed.id)!;
    return {
      id: row.id,
      side: computed.side,
      expenseItemId: row.expenseItemId ?? null,
      revenueItemId: row.revenueItemId ?? null,
      categoryId: row.categoryId ?? null,
      label: row.label ?? null,
      name: nameOf(row),
      amountCents: row.amountCents,
      basis: computed.basis,
      budgetedCents: computed.budgetedCents,
      actualCents: computed.actualCents,
      remainingCents: computed.remainingCents,
      overByCents: computed.overByCents,
      pctUsed: computed.pctUsed,
      over: computed.over,
    };
  });

  let projectName: string | null = null;
  if (budget.projectId) {
    const [project] = await db
      .select()
      .from(projectsTable)
      .where(and(eq(projectsTable.id, budget.projectId), eq(projectsTable.businessId, businessId)));
    projectName = project?.name ?? null;
  }

  return {
    budget: {
      id: budget.id,
      name: budget.name,
      scope: budget.scope as "period" | "project",
      projectId: budget.projectId ?? null,
      projectName,
      periodStart: budget.periodStart,
      periodEnd: budget.periodEnd,
      targetProfitCents: budget.targetProfitCents ?? null,
      status: budget.status as "draft" | "active" | "closed",
      monthsTotal: months,
    },
    lines,
    totals: result.totals,
    unbudgeted: {
      inCents: result.unbudgetedCents.in,
      outCents: result.unbudgetedCents.out,
      count: result.unbudgetedCount,
    },
    pace: await computePace(businessId, userId, budget, months),
  };
}

/**
 * Are you keeping up with the goal?
 *
 * The revenue answer comes from `revenueForTargetProfit` in breakeven.ts — the
 * module that already knows how to turn a profit target into a sales target and
 * reconciles to the ladder. Working it out again here would be a second opinion
 * on the same question.
 */
async function computePace(businessId: string, userId: string, budget: Budget, months: number) {
  if (budget.targetProfitCents === null) return null;

  const range = {
    start: new Date(`${budget.periodStart}T00:00:00Z`),
    end: new Date(`${budget.periodEnd}T23:59:59.999Z`),
  };
  const [pnl, breakEven] = await Promise.all([
    computePnl(businessId, userId, range),
    computeBreakEvenReport(businessId, userId, range),
  ]);

  const pace = budgetPace({
    targetProfitCents: budget.targetProfitCents,
    profitSoFarCents: pnl.ladder.trueProfit,
    periodStart: budget.periodStart,
    periodEnd: budget.periodEnd,
    asOf: new Date().toISOString().slice(0, 10),
  });

  return {
    ...pace,
    targetProfitCents: budget.targetProfitCents,
    profitSoFarCents: pnl.ladder.trueProfit,
    revenueNeededCents: revenueForTargetProfit(
      {
        netRevenueCents: breakEven.netRevenueCents,
        contributionProfitCents: breakEven.contributionAfterVariableCents + breakEven.variableExpensesCents,
        fixedExpensesCents: breakEven.fixedExpensesCents,
        variableExpensesCents: breakEven.variableExpensesCents,
      },
      budget.targetProfitCents,
    ),
  };
}

// ---------------------------------------------------------------------------
// The first draft
// ---------------------------------------------------------------------------

/** The middle month. Resistant to the one big purchase a mean would smear. */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/**
 * A budget proposed from what the business actually does.
 *
 * The adoption feature: a blank budget form never gets filled in. It reads the
 * last N months, groups real spend by expense item and by revenue item, and
 * suggests a TYPICAL month — the median — with the mean beside it so a big gap
 * between the two is visible rather than hidden.
 *
 * Grouped by catalogue item only. A one-off label ("Skip hire, March") is a
 * thing that happened once, not a thing to budget for every month, and
 * suggesting it would fill the draft with noise.
 */
export async function suggestBudget(businessId: string, userId: string, monthsBack: number) {
  const now = new Date();
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0, 23, 59, 59, 999));
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsBack, 1));

  const [txns, maps] = await Promise.all([
    loadPeriodTransactions(businessId, { start, end }),
    loadNameMaps(businessId, userId),
  ]);

  /** key → month key → cents */
  const byKey = new Map<string, { side: "in" | "out"; id: string; months: Map<string, number> }>();
  const add = (side: "in" | "out", id: string, when: Date, cents: number) => {
    const key = `${side}:${id}`;
    const entry = byKey.get(key) ?? { side, id, months: new Map<string, number>() };
    const monthKey = `${when.getUTCFullYear()}-${when.getUTCMonth()}`;
    entry.months.set(monthKey, (entry.months.get(monthKey) ?? 0) + cents);
    byKey.set(key, entry);
  };

  for (const { header, lines } of txns) {
    if (header.status === "void" || header.status === "pending" || header.adjustmentType) continue;
    const profitLines = lines.map(profitLine);
    const revenueLines = lines.filter((line) => line.direction === "in");
    const costLines = lines.filter((line) => line.direction === "out");

    if (revenueLines.length > 0) {
      const rev = revenueLines.map(profitLine);
      const shares = orderDiscountShares(header.orderDiscountCents, rev);
      revenueLines.forEach((line, i) => {
        if (line.revenueItemId) add("in", line.revenueItemId, header.occurredAt, netLineRevenue(rev[i], shares[i]));
      });
    }
    if (costLines.length > 0) {
      const spends = expenseLineSpends(
        profitLines.filter((_, i) => lines[i].direction === "out"),
        0,
      );
      costLines.forEach((line, i) => {
        if (line.expenseItemId) add("out", line.expenseItemId, header.occurredAt, spends[i]);
      });
    }
  }

  const suggestions = [...byKey.values()]
    .map((entry) => {
      const values = [...entry.months.values()];
      const total = values.reduce((sum, value) => sum + value, 0);
      return {
        side: entry.side,
        expenseItemId: entry.side === "out" ? entry.id : null,
        revenueItemId: entry.side === "in" ? entry.id : null,
        categoryId: null,
        label: null,
        name:
          (entry.side === "out"
            ? maps.expenseItems.get(entry.id)?.name
            : maps.revenueItems.get(entry.id)?.name) ?? "Unnamed",
        medianMonthCents: median(values),
        meanMonthCents: Math.round(total / monthsBack),
        monthsSeen: values.length,
      };
    })
    .filter((row) => row.medianMonthCents > 0 || row.meanMonthCents > 0)
    .sort((a, b) => b.medianMonthCents - a.medianMonthCents);

  return { monthsConsidered: monthsBack, lines: suggestions };
}
