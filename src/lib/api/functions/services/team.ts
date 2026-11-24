import { businessesTable, db, expenseItemsTable, peopleTable, teamMemberRatesTable } from "@workspace/db";
import {
  computeTeamCost,
  DEFAULT_BILLABLE_TARGET_HOURS,
  isTeamCostType,
  isValidBillableTarget,
  normalizePersonName,
  overheadPerHead,
  type OverheadDefault,
  type TeamCostType,
} from "@workspace/domain";
import { and, asc, desc, eq, isNull, lte } from "drizzle-orm";
import { uid } from "../lib/uid";
import { invalid, notFound } from "./errors";
import { computeBreakEvenReport } from "./read";

/**
 * Team members: who costs money, and how much an hour of their time costs.
 *
 * A team member IS a person (`kind = 'employee'`) — identity, archival and
 * de-duplication come from the same table customers and vendors use. Only the
 * money is versioned, in `team_member_rates`, so a pay rise never creates a
 * second copy of the human.
 */

// ---------------------------------------------------------------------------
// The overhead default
// ---------------------------------------------------------------------------

export interface OverheadDefaultResult extends OverheadDefault {
  /** Human label for the month the pool came from, e.g. "June 2026". */
  periodLabel: string;
  /** What went into the pool, biggest first — so the screen can show its working. */
  breakdown: Array<{ name: string; amountCents: number }>;
}

/** The month before the one containing `today` — the last one with complete data. */
function lastCompleteMonth(today: Date): { start: Date; end: Date; label: string } {
  const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1) - 1);
  const label = start.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  return { start, end, label };
}

/**
 * Works the overhead share out FOR the owner, from the ledger they already
 * keep: a month of fixed operating costs divided by headcount.
 *
 * Asking them to type a number instead is the failure mode this exists to
 * avoid — most people leave it blank, and a zero overhead share silently
 * understates every cost rate in the system with nothing on screen to show it.
 *
 * PAYROLL IS EXCLUDED FROM THE POOL, and that is not a detail. Salaries are
 * fixed operating costs, so a naive "all fixed expenses ÷ headcount" would hand
 * every person a slice of everybody's salary — on top of their own, which is
 * already their `monthlyCostCents`. Each salary would be counted roughly twice.
 * Only the costs of HAVING a team — rent, software, admin — belong here.
 */
export async function computeOverheadDefault(
  businessId: string,
  userId: string,
  today = new Date(),
): Promise<OverheadDefaultResult> {
  const { start, end, label } = lastCompleteMonth(today);

  // Reuse the break-even report's fixed-cost breakdown rather than deciding a
  // second time what "fixed operating expenses" means. That figure is already
  // asserted to reconcile with the profit ladder to the cent, so the overhead
  // default cannot drift away from what the Budget screen shows.
  const [breakEven, items, headcountRows] = await Promise.all([
    computeBreakEvenReport(businessId, userId, { start, end }),
    db.select().from(expenseItemsTable).where(eq(expenseItemsTable.businessId, businessId)),
    db
      .select({ id: peopleTable.id })
      .from(peopleTable)
      .where(
        and(
          eq(peopleTable.businessId, businessId),
          eq(peopleTable.kind, "employee"),
          eq(peopleTable.status, "active"),
        ),
      ),
  ]);

  const itemById = new Map(items.map((i) => [i.id, i]));
  const breakdown = breakEven.fixedCostBreakdown
    // THE exclusion. Salaries are fixed operating costs, so a naive
    // "all fixed expenses ÷ headcount" hands everyone a slice of everybody's
    // salary on top of their own — which is already monthlyCostCents. Each
    // salary would be counted roughly twice, and every hourly rate inflated.
    .filter((row) => itemById.get(row.id)?.type !== "payroll")
    .map((row) => ({ name: row.name, amountCents: row.amountCents }));

  const fixedCostPoolCents = breakdown.reduce((sum, row) => sum + row.amountCents, 0);
  const split = overheadPerHead(fixedCostPoolCents, headcountRows.length);

  return { ...split, periodLabel: label, breakdown };
}

// ---------------------------------------------------------------------------
// Team members
// ---------------------------------------------------------------------------

export interface TeamRateInput {
  costType: TeamCostType;
  monthlyCostCents?: number;
  hourlyRateCents?: number | null;
  overheadShareCents?: number;
  billableTargetHours?: string;
  /** When this rate starts applying. Defaults to now. */
  effectiveFrom?: Date;
}

function validateRate(input: TeamRateInput) {
  if (!isTeamCostType(input.costType)) throw invalid(`Unknown cost type "${input.costType}"`);
  const billableTargetHours = input.billableTargetHours ?? DEFAULT_BILLABLE_TARGET_HOURS;
  if (!isValidBillableTarget(billableTargetHours)) {
    throw invalid("Billable hours a month must be a positive number");
  }
  const monthlyCostCents = input.monthlyCostCents ?? 0;
  const overheadShareCents = input.overheadShareCents ?? 0;
  const hourlyRateCents = input.hourlyRateCents ?? null;
  for (const [field, value] of [
    ["monthlyCostCents", monthlyCostCents],
    ["overheadShareCents", overheadShareCents],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 0) throw invalid(`${field} must be non-negative integer cents`);
  }
  if (hourlyRateCents !== null && (!Number.isSafeInteger(hourlyRateCents) || hourlyRateCents < 0)) {
    throw invalid("hourlyRateCents must be non-negative integer cents");
  }
  if (input.costType === "salaried" && monthlyCostCents <= 0) {
    throw invalid("A salaried team member needs a monthly cost");
  }
  if (input.costType !== "salaried" && (hourlyRateCents === null || hourlyRateCents <= 0)) {
    throw invalid("An hourly team member or contractor needs an hourly rate");
  }

  const cost = computeTeamCost({
    costType: input.costType,
    monthlyCostCents,
    hourlyRateCents,
    overheadShareCents,
    billableTargetHours,
  });
  return { billableTargetHours, monthlyCostCents, overheadShareCents, hourlyRateCents, cost };
}

/** The rate in force right now — the one row with no end date. */
export async function openRateFor(businessId: string, personId: string) {
  const [rate] = await db
    .select()
    .from(teamMemberRatesTable)
    .where(
      and(
        eq(teamMemberRatesTable.businessId, businessId),
        eq(teamMemberRatesTable.personId, personId),
        isNull(teamMemberRatesTable.effectiveTo),
      ),
    );
  return rate ?? null;
}

/** Whatever rate applied on a given day — what a time entry freezes against. */
export async function rateOnDate(businessId: string, personId: string, on: Date) {
  const [rate] = await db
    .select()
    .from(teamMemberRatesTable)
    .where(
      and(
        eq(teamMemberRatesTable.businessId, businessId),
        eq(teamMemberRatesTable.personId, personId),
        lte(teamMemberRatesTable.effectiveFrom, on),
      ),
    )
    .orderBy(desc(teamMemberRatesTable.effectiveFrom))
    .limit(1);
  if (!rate) return null;
  if (rate.effectiveTo && rate.effectiveTo < on) return null;
  return rate;
}

/**
 * When a team member's FIRST rate starts, if the owner didn't say.
 *
 * Not "today". Adding someone on a Thursday and then being unable to log their
 * Monday is a trap with no upside: a first rate has no predecessor, so there is
 * no earlier work for backdating to restate. It runs from the business's own
 * start date, which is as far back as any hours could possibly exist.
 *
 * Every LATER rate still defaults to now, because by then backdating really
 * would rewrite work already costed.
 */
async function firstRateStart(businessId: string): Promise<Date> {
  const [business] = await db.select().from(businessesTable).where(eq(businessesTable.id, businessId));
  return business?.createdAt ?? new Date();
}

export async function createTeamMember(
  businessId: string,
  input: { name: string; roleLabel?: string | null; email?: string | null; rate: TeamRateInput },
) {
  const name = input.name.trim();
  if (!name) throw invalid("A team member needs a name");
  const validated = validateRate(input.rate);

  // Say so rather than quietly creating a second Sara. Two people records for
  // one human would split their hours, so each would look half as busy and the
  // work they did would carry only half its cost.
  const existing = await db
    .select({ id: peopleTable.id, displayName: peopleTable.displayName })
    .from(peopleTable)
    .where(and(eq(peopleTable.businessId, businessId), eq(peopleTable.kind, "employee")));
  const clash = existing.find((p) => normalizePersonName(p.displayName) === normalizePersonName(name));
  if (clash) throw invalid(`You already have a team member called "${clash.displayName}"`);

  const [person] = await db
    .insert(peopleTable)
    .values({
      id: uid("per"),
      businessId,
      kind: "employee",
      displayName: name,
      roleLabel: input.roleLabel?.trim() || null,
      email: input.email?.trim() || null,
    })
    .returning();

  await insertRate(
    businessId,
    person.id,
    { ...input.rate, effectiveFrom: input.rate.effectiveFrom ?? (await firstRateStart(businessId)) },
    validated,
  );
  return person;
}

async function insertRate(
  businessId: string,
  personId: string,
  input: TeamRateInput,
  validated: ReturnType<typeof validateRate>,
) {
  await db.insert(teamMemberRatesTable).values({
    id: uid("tmr"),
    businessId,
    personId,
    costType: input.costType,
    monthlyCostCents: validated.monthlyCostCents,
    hourlyRateCents: validated.hourlyRateCents,
    overheadShareCents: validated.overheadShareCents,
    billableTargetHours: validated.billableTargetHours,
    effectiveHourlyCostCents: validated.cost.effectiveHourlyCostCents,
    effectiveFrom: input.effectiveFrom ?? new Date(),
  });
}

/**
 * Changes what someone costs, from a date forward.
 *
 * A rate is NEVER edited in place. The open row is closed and a successor
 * inserted, exactly as cost components work — because time entries freeze the
 * rate that applied on their day, and rewriting a rate would silently restate
 * the cost of work already done and reported on.
 */
export async function setTeamMemberRate(businessId: string, personId: string, input: TeamRateInput) {
  const person = await getTeamMember(businessId, personId);
  const validated = validateRate(input);
  const effectiveFrom = input.effectiveFrom ?? new Date();

  const open = await openRateFor(businessId, person.id);
  if (open) {
    if (effectiveFrom <= open.effectiveFrom) {
      throw invalid("A new rate has to start after the current one — backdating would rewrite work already costed");
    }
    await db
      .update(teamMemberRatesTable)
      .set({ effectiveTo: new Date(effectiveFrom.getTime() - 1), updatedAt: new Date() })
      .where(eq(teamMemberRatesTable.id, open.id));
  }

  await insertRate(businessId, person.id, { ...input, effectiveFrom }, validated);
  return (await openRateFor(businessId, person.id))!;
}

export async function getTeamMember(businessId: string, personId: string) {
  const [person] = await db
    .select()
    .from(peopleTable)
    .where(and(eq(peopleTable.businessId, businessId), eq(peopleTable.id, personId), eq(peopleTable.kind, "employee")));
  if (!person) throw notFound("Team member");
  return person;
}

/** Identity only. Money moves through setTeamMemberRate and nowhere else. */
export async function updateTeamMember(
  businessId: string,
  personId: string,
  patch: { name?: string; roleLabel?: string | null; email?: string | null; status?: "active" | "archived" },
) {
  await getTeamMember(businessId, personId);
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.name !== undefined) {
    if (!patch.name.trim()) throw invalid("A team member needs a name");
    updates.displayName = patch.name.trim();
  }
  if (patch.roleLabel !== undefined) updates.roleLabel = patch.roleLabel?.trim() || null;
  if (patch.email !== undefined) updates.email = patch.email?.trim() || null;
  if (patch.status !== undefined) updates.status = patch.status;

  const [updated] = await db
    .update(peopleTable)
    .set(updates)
    .where(and(eq(peopleTable.id, personId), eq(peopleTable.businessId, businessId)))
    .returning();
  return updated;
}

export async function listTeamMembers(businessId: string, status?: "active" | "archived") {
  const conditions = [eq(peopleTable.businessId, businessId), eq(peopleTable.kind, "employee")];
  if (status) conditions.push(eq(peopleTable.status, status));

  const [people, rates] = await Promise.all([
    db.select().from(peopleTable).where(and(...conditions)).orderBy(asc(peopleTable.displayName)),
    db
      .select()
      .from(teamMemberRatesTable)
      .where(and(eq(teamMemberRatesTable.businessId, businessId), isNull(teamMemberRatesTable.effectiveTo))),
  ]);
  const rateByPerson = new Map(rates.map((r) => [r.personId, r]));

  return people.map((person) => {
    const rate = rateByPerson.get(person.id) ?? null;
    // Derived server-side and sent as ONE number. The raw salary and overhead
    // never leave the server — a Manager role must not be able to read them,
    // and the safest way to guarantee that is to never put them in a payload.
    const cost = rate
      ? computeTeamCost({
          costType: rate.costType as TeamCostType,
          monthlyCostCents: rate.monthlyCostCents,
          hourlyRateCents: rate.hourlyRateCents,
          overheadShareCents: rate.overheadShareCents,
          billableTargetHours: rate.billableTargetHours,
        })
      : null;

    return {
      id: person.id,
      name: person.displayName,
      roleLabel: person.roleLabel ?? null,
      email: person.email ?? null,
      status: person.status as "active" | "archived",
      costType: (rate?.costType ?? null) as TeamCostType | null,
      billableTargetHours: rate?.billableTargetHours ?? null,
      payHourlyCents: cost?.payHourlyCents ?? null,
      overheadHourlyCents: cost?.overheadHourlyCents ?? null,
      effectiveHourlyCostCents: cost?.effectiveHourlyCostCents ?? null,
      rateEffectiveFrom: rate ? rate.effectiveFrom.toISOString() : null,
      createdAt: person.createdAt.toISOString(),
      updatedAt: person.updatedAt.toISOString(),
    };
  });
}

/** Every version of someone's rate, newest first — the audit trail of pay changes. */
export async function listRateHistory(businessId: string, personId: string) {
  await getTeamMember(businessId, personId);
  const rows = await db
    .select()
    .from(teamMemberRatesTable)
    .where(and(eq(teamMemberRatesTable.businessId, businessId), eq(teamMemberRatesTable.personId, personId)))
    .orderBy(desc(teamMemberRatesTable.effectiveFrom));

  return rows.map((rate) => ({
    id: rate.id,
    costType: rate.costType as TeamCostType,
    billableTargetHours: rate.billableTargetHours,
    effectiveHourlyCostCents: rate.effectiveHourlyCostCents,
    effectiveFrom: rate.effectiveFrom.toISOString(),
    effectiveTo: rate.effectiveTo ? rate.effectiveTo.toISOString() : null,
  }));
}
