/**
 * Server code used only by `/api/client-profitability`. Shared code stays in
 * `src/lib/api/functions`. Server-only: nothing in components, views or the
 * client helpers may import this file.
 */
import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { clientEngagementsTable, db, peopleTable, revenueItemsTable, timeEntriesTable } from "@workspace/db";
import { findPersonMatches, isAgreedPeriod, isEngagementStatus, isReusable, type AgreedPeriod, type EngagementStatus, ESTIMATE_NOTE, addHours, costOfHours, estimateSentence, isSpreadable, isTimeTargetType, isWorkType, spreadHours, workingDaysBetween, type TimeTargetType, type WorkType, aggregateImportRows, importExternalId, isValidHours, normalizePersonName, parseTimeImport, type AggregatedEntry, type ColumnMapping, type ImportPreset, type ResolvedImportRow } from "@workspace/domain";
import { uid } from "@/lib/api/functions/lib/uid";
import { computePeopleMetrics } from "@/lib/api/functions/services/analytics";
import { invalid, notFound } from "@/lib/api/functions/services/errors";
import { findOrCreatePerson } from "@/lib/api/functions/services/person";
import * as team from "@/lib/api/functions/services/team";
import { rateOnDate } from "@/lib/api/functions/services/team";
import { listTimeTargets } from "@/lib/api/functions/services/timesheet";

// ── client ───────────────────────────────────────────────────────

/**
 * Clients: the commercial terms of working with someone.
 *
 * A client IS a person (`kind = 'customer'`). Revenue already reaches them
 * through `transactions.person_id`, so nothing about revenue is stored here —
 * an engagement only records what was AGREED, which is what scope creep is
 * measured against later.
 *
 * ── Why creation goes through findOrCreatePerson ────────────────────────────
 *
 * A service business almost always has its clients already: they have been
 * invoiced, so they are customers on the ledger. Creating a client with a bare
 * insert would mint a second Acme beside the one carrying two years of revenue,
 * splitting their history in half and making them look worth half as much.
 * So the person is RESOLVED, never assumed new.
 */

export interface EngagementInput {
  engagementStatus?: EngagementStatus;
  agreedAmountCents?: number | null;
  /** Whether the amount is the whole fee or a monthly one. */
  agreedAmountPeriod?: AgreedPeriod;
  agreedHours?: string | null;
  /** Whether the hours are for the whole job or per month. */
  agreedHoursPeriod?: AgreedPeriod;
  currency?: string;
  startDate?: string | null;
  endDate?: string | null;
  notes?: string | null;
}

function validateEngagement(input: EngagementInput) {
  const engagementStatus = input.engagementStatus ?? "active";
  // `total` is what every figure meant before the toggles existed, so it stays
  // the default — an existing row must not change meaning under anyone's feet.
  const agreedAmountPeriod = input.agreedAmountPeriod ?? "total";
  const agreedHoursPeriod = input.agreedHoursPeriod ?? "total";
  if (!isEngagementStatus(engagementStatus)) throw invalid(`Unknown status "${engagementStatus}"`);
  if (!isAgreedPeriod(agreedAmountPeriod)) throw invalid(`Unknown period "${agreedAmountPeriod}"`);
  if (!isAgreedPeriod(agreedHoursPeriod)) throw invalid(`Unknown period "${agreedHoursPeriod}"`);

  const agreed = input.agreedAmountCents ?? null;
  if (agreed !== null && (!Number.isSafeInteger(agreed) || agreed < 0)) {
    throw invalid("Agreed amount must be non-negative integer cents");
  }
  const agreedHours = input.agreedHours?.trim() || null;
  if (agreedHours !== null && (!/^\d+(\.\d+)?$/.test(agreedHours) || Number(agreedHours) <= 0)) {
    throw invalid("Agreed hours must be a positive number");
  }
  return { engagementStatus, agreedAmountPeriod, agreedHoursPeriod, agreedAmountCents: agreed, agreedHours };
}

/** Everyone who might already BE this client. The UI shows these before creating. */
export async function findClientMatches(businessId: string, input: { name: string; email?: string | null }) {
  const people = await db
    .select()
    .from(peopleTable)
    .where(and(eq(peopleTable.businessId, businessId), eq(peopleTable.status, "active")));

  const metrics = await computePeopleMetrics(businessId);
  const engagements = await db
    .select()
    .from(clientEngagementsTable)
    .where(eq(clientEngagementsTable.businessId, businessId));
  const engagedPersonIds = new Set(engagements.filter((e) => e.engagementStatus === "active").map((e) => e.personId));

  return findPersonMatches(input, people.map((p) => ({ id: p.id, displayName: p.displayName, email: p.email }))).map(
    (match) => ({
      id: match.person.id,
      name: match.person.displayName,
      email: match.person.email,
      strength: match.strength,
      reason: match.reason,
      /** So the owner can see this really is the client they mean. */
      lifetimeRevenueCents: metrics.get(match.person.id)?.lifetimeNetRevenueCents ?? 0,
      orderCount: metrics.get(match.person.id)?.orderCount ?? 0,
      alreadyAClient: engagedPersonIds.has(match.person.id),
    }),
  );
}

export async function activeEngagementFor(businessId: string, personId: string) {
  const [engagement] = await db
    .select()
    .from(clientEngagementsTable)
    .where(
      and(
        eq(clientEngagementsTable.businessId, businessId),
        eq(clientEngagementsTable.personId, personId),
        eq(clientEngagementsTable.engagementStatus, "active"),
      ),
    );
  return engagement ?? null;
}

/**
 * Adds a client. `personId` reuses a record the owner picked from the match
 * list; otherwise the name is resolved against existing people first, so an
 * exact match is reused rather than duplicated.
 */
export async function createClient(
  businessId: string,
  input: { name?: string; email?: string | null; personId?: string | null; engagement?: EngagementInput },
) {
  const validated = validateEngagement(input.engagement ?? {});

  let personId = input.personId ?? null;
  if (!personId) {
    const name = input.name?.trim();
    if (!name) throw invalid("A client needs a name");
    // Resolves an existing customer by email, then by name, before creating.
    // This is what stops a second Acme appearing beside the invoiced one.
    const person = await findOrCreatePerson(businessId, { name, email: input.email ?? null, kind: "customer" });
    personId = person.id;
  } else {
    const [exists] = await db
      .select()
      .from(peopleTable)
      .where(and(eq(peopleTable.businessId, businessId), eq(peopleTable.id, personId)));
    if (!exists) throw notFound("Person");
  }

  if (validated.engagementStatus === "active") {
    const open = await activeEngagementFor(businessId, personId);
    if (open) {
      throw invalid("This client already has a live engagement. Finish that one before starting another.");
    }
  }

  const [engagement] = await db
    .insert(clientEngagementsTable)
    .values({
      id: uid("eng"),
      businessId,
      personId,
      engagementStatus: validated.engagementStatus,
      agreedAmountCents: validated.agreedAmountCents,
      agreedAmountPeriod: validated.agreedAmountPeriod,
      agreedHours: validated.agreedHours,
      agreedHoursPeriod: validated.agreedHoursPeriod,
      currency: input.engagement?.currency ?? "PKR",
      startDate: input.engagement?.startDate ?? null,
      endDate: input.engagement?.endDate ?? null,
      notes: input.engagement?.notes ?? null,
    })
    .returning();
  return engagement;
}

export async function getEngagement(businessId: string, engagementId: string) {
  const [engagement] = await db
    .select()
    .from(clientEngagementsTable)
    .where(and(eq(clientEngagementsTable.businessId, businessId), eq(clientEngagementsTable.id, engagementId)));
  if (!engagement) throw notFound("Engagement");
  return engagement;
}

export async function updateEngagement(businessId: string, engagementId: string, input: EngagementInput) {
  const existing = await getEngagement(businessId, engagementId);
  const validated = validateEngagement({ ...existing, ...input } as EngagementInput);

  // Reviving a finished engagement must not create a second live one.
  if (validated.engagementStatus === "active" && existing.engagementStatus !== "active") {
    const open = await activeEngagementFor(businessId, existing.personId);
    if (open && open.id !== engagementId) {
      throw invalid("This client already has a live engagement. Finish that one first.");
    }
  }

  const patch: Record<string, unknown> = { updatedAt: new Date(), ...validated };
  if (input.currency !== undefined) patch.currency = input.currency;
  if (input.startDate !== undefined) patch.startDate = input.startDate;
  if (input.endDate !== undefined) patch.endDate = input.endDate;
  if (input.notes !== undefined) patch.notes = input.notes;

  const [updated] = await db
    .update(clientEngagementsTable)
    .set(patch)
    .where(eq(clientEngagementsTable.id, engagementId))
    .returning();
  return updated;
}

/**
 * Clients with what they have actually paid, from the ledger.
 *
 * `revenueToDateCents` is lifetime net revenue against that person — the same
 * figure the People page shows, because it is the same person. Nothing here is
 * profit: labour is not attributed until the profitability engine lands.
 */
export async function listClients(businessId: string, status?: EngagementStatus) {
  const conditions = [eq(clientEngagementsTable.businessId, businessId)];
  if (status) conditions.push(eq(clientEngagementsTable.engagementStatus, status));

  const [engagements, people, metrics] = await Promise.all([
    db.select().from(clientEngagementsTable).where(and(...conditions)),
    db.select().from(peopleTable).where(eq(peopleTable.businessId, businessId)),
    computePeopleMetrics(businessId),
  ]);
  const personById = new Map(people.map((p) => [p.id, p]));

  return engagements
    .map((engagement) => {
      const person = personById.get(engagement.personId);
      const m = metrics.get(engagement.personId);
      return {
        engagementId: engagement.id,
        personId: engagement.personId,
        name: person?.displayName ?? "Unknown",
        email: person?.email ?? null,
        engagementStatus: engagement.engagementStatus as EngagementStatus,
        agreedAmountCents: engagement.agreedAmountCents ?? null,
        agreedAmountPeriod: engagement.agreedAmountPeriod as AgreedPeriod,
        agreedHours: engagement.agreedHours ?? null,
        agreedHoursPeriod: engagement.agreedHoursPeriod as AgreedPeriod,
        currency: engagement.currency,
        startDate: engagement.startDate ?? null,
        endDate: engagement.endDate ?? null,
        notes: engagement.notes ?? null,
        revenueToDateCents: m?.lifetimeNetRevenueCents ?? 0,
        orderCount: m?.orderCount ?? 0,
        lastActivityAt: m?.lastActivityAt ?? null,
        createdAt: engagement.createdAt.toISOString(),
        updatedAt: engagement.updatedAt.toISOString(),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Every engagement a client has had, newest first — the history behind the live one. */
export async function listEngagementsFor(businessId: string, personId: string) {
  const rows = await db
    .select()
    .from(clientEngagementsTable)
    .where(and(eq(clientEngagementsTable.businessId, businessId), eq(clientEngagementsTable.personId, personId)))
    .orderBy(asc(clientEngagementsTable.createdAt));
  return rows.reverse();
}

export { isReusable };

// ── estimates ────────────────────────────────────────────────────

/**
 * Target-level estimates: "Sara spent roughly 80 hours on Acme in July".
 *
 * The alternative to this feature is not a more accurate number — it is NO
 * number. A business that will not fill a timesheet this month gets nothing at
 * all from the profitability screen, and "we can't tell you" helps nobody.
 * A rough figure that is visibly labelled rough is more useful and just as
 * honest, and it is usually the step before logging properly.
 *
 * Three rules hold the honesty in place:
 *
 * 1. EVERY hour written here carries `is_estimated`, and the flag survives to
 *    the screen. An estimate that reads like a logged figure would be trusted
 *    exactly as much as a real one, which is the whole danger.
 * 2. AN ESTIMATE IS REPLACED, NEVER STACKED. Re-estimating the same stretch
 *    wipes the previous one first, so the second guess is the answer rather
 *    than the second guess plus the first.
 * 3. IT NEVER TOUCHES REAL HOURS. If anything was actually logged in that
 *    stretch, the estimate is refused with a reason rather than added on top —
 *    guessing over facts would double them, invisibly.
 */

const ESTIMATE_SOURCE = "estimate";

export interface EstimateInput {
  personId: string;
  targetType: TimeTargetType;
  targetId: string;
  /** Inclusive, YYYY-MM-DD. */
  periodStart: string;
  periodEnd: string;
  /** Decimal string. The TOTAL for the stretch, not a daily figure. */
  hours: string;
  workType?: WorkType;
  billable?: boolean;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function validate(input: EstimateInput) {
  if (!isTimeTargetType(input.targetType)) throw invalid(`Unknown target type "${input.targetType}"`);
  if (!ISO_DATE.test(input.periodStart) || !ISO_DATE.test(input.periodEnd)) {
    throw invalid("Dates must be YYYY-MM-DD");
  }
  if (input.periodStart > input.periodEnd) throw invalid("The end date is before the start date");
  const workType = input.workType ?? "delivery";
  if (!isWorkType(workType)) throw invalid(`Unknown work type "${workType}"`);

  const hours = input.hours?.trim() ?? "";
  if (!/^\d+(\.\d+)?$/.test(hours) || Number(hours) <= 0) {
    throw invalid("Give a number of hours greater than zero");
  }
  return { workType, hours, billable: input.billable ?? true };
}

/** Which person, on which target, over which stretch — the estimate's identity. */
type PeriodKey = Pick<EstimateInput, "personId" | "targetType" | "targetId" | "periodStart" | "periodEnd">;

/** Everything already stored for one person on one target across a stretch. */
async function entriesInPeriod(businessId: string, input: PeriodKey) {
  return db
    .select()
    .from(timeEntriesTable)
    .where(
      and(
        eq(timeEntriesTable.businessId, businessId),
        eq(timeEntriesTable.personId, input.personId),
        eq(timeEntriesTable.targetType, input.targetType),
        eq(timeEntriesTable.targetId, input.targetId),
        gte(timeEntriesTable.entryDate, input.periodStart),
        lte(timeEntriesTable.entryDate, input.periodEnd),
      ),
    )
    .orderBy(asc(timeEntriesTable.entryDate));
}

export interface EstimatePreview {
  personName: string;
  targetLabel: string;
  workingDays: number;
  /** How many days will actually carry hours. */
  dayCount: number;
  hoursPerDay: string;
  totalHours: string;
  /** Null when a day in the stretch has no pay rate — never a zero. */
  totalCostCents: number | null;
  /** What replacing an existing estimate would remove. "0" when there is none. */
  replacesHours: string;
  /** Hours actually logged in this stretch. Anything above zero blocks it. */
  loggedHours: string;
  sentence: string;
  note: string;
  blockedReason: string | null;
}

/**
 * What an estimate would do, without doing it.
 *
 * Same shape of promise the CSV import makes: the owner sees the effect — how
 * many days, how many hours each, what it costs — before anything is written.
 */
export async function previewEstimate(businessId: string, input: EstimateInput): Promise<EstimatePreview> {
  const { hours } = validate(input);

  const [person] = await db
    .select()
    .from(peopleTable)
    .where(
      and(eq(peopleTable.businessId, businessId), eq(peopleTable.id, input.personId), eq(peopleTable.kind, "employee")),
    );
  if (!person) throw notFound("Team member");

  const targets = await listTimeTargets(businessId);
  const target = targets.find((t) => t.targetType === input.targetType && t.targetId === input.targetId);
  if (!target) throw notFound("Target");

  const days = workingDaysBetween(input.periodStart, input.periodEnd);
  const existing = await entriesInPeriod(businessId, input);
  const logged = existing.filter((e) => e.source !== ESTIMATE_SOURCE);
  const priorEstimate = existing.filter((e) => e.source === ESTIMATE_SOURCE);

  const base = {
    personName: person.displayName,
    targetLabel: target.label,
    workingDays: days.length,
    replacesHours: addHours(...priorEstimate.map((e) => e.hours)),
    loggedHours: addHours(...logged.map((e) => e.hours)),
    note: ESTIMATE_NOTE,
  };

  const blocked = (reason: string): EstimatePreview => ({
    ...base,
    dayCount: 0,
    hoursPerDay: "0",
    totalHours: "0",
    totalCostCents: null,
    sentence: reason,
    blockedReason: reason,
  });

  if (days.length === 0) {
    return blocked("There are no working days between those two dates.");
  }
  // Guessing on top of facts would double them, and nothing on screen would say so.
  if (Number(base.loggedHours) > 0) {
    return blocked(
      `${person.displayName} already has ${base.loggedHours} hours logged against ${target.label} in that stretch. ` +
        `Clear those first, or estimate a different stretch — an estimate on top of real hours would count them twice.`,
    );
  }
  if (!isSpreadable(hours, days.length)) {
    return blocked(`${hours} hours across ${days.length} working days is more than anyone can work in a day.`);
  }

  const spread = spreadHours(hours, days.length);

  // Each day is costed at ITS OWN rate, exactly as a logged day would be. An
  // estimate spanning a pay rise must not price April at August's salary.
  let totalCostCents: number | null = 0;
  for (let i = 0; i < spread.dayCount; i += 1) {
    const rate = await rateOnDate(businessId, input.personId, new Date(`${days[i]}T12:00:00Z`));
    if (!rate) {
      return blocked(
        `${person.displayName} has no pay rate covering ${days[i]}. Set one on the Team page first, ` +
          `or estimate a stretch their rate covers.`,
      );
    }
    totalCostCents += costOfHours(spread.perDay[i], rate.effectiveHourlyCostCents);
  }

  return {
    ...base,
    dayCount: spread.dayCount,
    hoursPerDay: spread.perDay[0] ?? "0",
    totalHours: spread.total,
    totalCostCents,
    sentence: estimateSentence(person.displayName, target.label, spread, days.length),
    blockedReason: null,
  };
}

/**
 * Writes the estimate, replacing any previous one for the same stretch.
 *
 * Delete-then-insert inside one transaction: a re-estimate that half-failed
 * would leave the old guess and the new one side by side, which is exactly the
 * doubling this is built to avoid.
 */
export async function setTargetEstimate(businessId: string, input: EstimateInput) {
  const { workType, hours, billable } = validate(input);
  const preview = await previewEstimate(businessId, input);
  if (preview.blockedReason) throw invalid(preview.blockedReason);

  const days = workingDaysBetween(input.periodStart, input.periodEnd);
  const spread = spreadHours(hours, days.length);

  // Rates are resolved before the transaction opens: they are reads, and
  // holding a transaction across them buys nothing.
  const rates = new Map<string, number>();
  for (let i = 0; i < spread.dayCount; i += 1) {
    const rate = await rateOnDate(businessId, input.personId, new Date(`${days[i]}T12:00:00Z`));
    if (!rate) throw invalid(`No pay rate covering ${days[i]}`);
    rates.set(days[i], rate.effectiveHourlyCostCents);
  }

  const existing = await entriesInPeriod(businessId, input);
  const stale = existing.filter((e) => e.source === ESTIMATE_SOURCE).map((e) => e.id);

  await db.transaction(async (tx) => {
    if (stale.length > 0) {
      await tx.delete(timeEntriesTable).where(inArray(timeEntriesTable.id, stale));
    }
    for (let i = 0; i < spread.dayCount; i += 1) {
      const day = days[i];
      const costRateSnapshotCents = rates.get(day) as number;
      await tx.insert(timeEntriesTable).values({
        id: uid("te"),
        businessId,
        personId: input.personId,
        targetType: input.targetType,
        targetId: input.targetId,
        entryDate: day,
        hours: spread.perDay[i],
        workType,
        billable,
        // The flag the whole feature rests on. Everything downstream reads it.
        isEstimated: true,
        note: ESTIMATE_NOTE,
        costRateSnapshotCents,
        costAmountCents: costOfHours(spread.perDay[i], costRateSnapshotCents),
        source: ESTIMATE_SOURCE,
      });
    }
  });

  return {
    daysWritten: spread.dayCount,
    daysReplaced: stale.length,
    totalHours: spread.total,
    totalCostCents: preview.totalCostCents ?? 0,
    sentence: preview.sentence,
  };
}

/**
 * Removes an estimate for a stretch.
 *
 * Filters on the estimate source rather than trusting the date range alone:
 * a stretch can hold logged hours too, and a "clear the guess" action must
 * never take real ones with it.
 */
export async function clearTargetEstimate(businessId: string, input: PeriodKey) {
  if (!ISO_DATE.test(input.periodStart) || !ISO_DATE.test(input.periodEnd)) {
    throw invalid("Dates must be YYYY-MM-DD");
  }
  const estimated = (await entriesInPeriod(businessId, input)).filter((e) => e.source === ESTIMATE_SOURCE);
  if (estimated.length === 0) return { removed: 0, hours: "0" };

  const hours = addHours(...estimated.map((e) => e.hours));
  await db.delete(timeEntriesTable).where(inArray(timeEntriesTable.id, estimated.map((e) => e.id)));
  return { removed: estimated.length, hours };
}

export interface EstimateSummary {
  personId: string;
  personName: string;
  targetType: TimeTargetType;
  targetId: string;
  targetLabel: string;
  firstDate: string;
  lastDate: string;
  dayCount: number;
  hours: string;
  costCents: number;
}

/**
 * Every estimate in a window, grouped back into the stretches they were entered
 * as — so the owner sees "80 hours on Acme in July", not 23 rows of 3.48.
 */
export async function listTargetEstimates(
  businessId: string,
  range: { start?: string; end?: string } = {},
): Promise<EstimateSummary[]> {
  const conditions = [eq(timeEntriesTable.businessId, businessId), eq(timeEntriesTable.source, ESTIMATE_SOURCE)];
  if (range.start) conditions.push(gte(timeEntriesTable.entryDate, range.start));
  if (range.end) conditions.push(lte(timeEntriesTable.entryDate, range.end));

  const [rows, people, targets] = await Promise.all([
    db.select().from(timeEntriesTable).where(and(...conditions)).orderBy(asc(timeEntriesTable.entryDate)),
    db.select().from(peopleTable).where(eq(peopleTable.businessId, businessId)),
    listTimeTargets(businessId),
  ]);

  const nameById = new Map(people.map((p) => [p.id, p.displayName]));
  const labelById = new Map(targets.map((t) => [`${t.targetType}:${t.targetId}`, t.label]));

  /**
   * The picker only lists live clients and products, so an estimate against one
   * that has since been finished or archived read as "(no longer listed)" — as
   * though the record had gone, when only the arrangement had. Falls back to the
   * real name, the same way the profitability report already does.
   */
  const items = await db.select().from(revenueItemsTable).where(eq(revenueItemsTable.businessId, businessId));
  const fallbackLabel = new Map<string, string>([
    ...people.map((p) => [`client:${p.id}`, p.displayName] as const),
    ...items.map((i) => [`revenue_item:${i.id}`, i.name] as const),
  ]);
  const labelOf = (targetType: string, targetId: string) =>
    labelById.get(`${targetType}:${targetId}`) ?? fallbackLabel.get(`${targetType}:${targetId}`) ?? "(no longer listed)";

  const grouped = new Map<string, EstimateSummary>();
  for (const row of rows) {
    // Grouped by month, which is the unit these are entered in and read in.
    const month = row.entryDate.slice(0, 7);
    const key = `${row.personId}|${row.targetType}|${row.targetId}|${month}`;
    const found = grouped.get(key);
    if (found) {
      found.hours = addHours(found.hours, row.hours);
      found.costCents += row.costAmountCents;
      found.dayCount += 1;
      found.lastDate = row.entryDate;
      continue;
    }
    grouped.set(key, {
      personId: row.personId,
      personName: nameById.get(row.personId) ?? "Unknown",
      targetType: row.targetType as TimeTargetType,
      targetId: row.targetId,
      targetLabel: labelOf(row.targetType, row.targetId),
      firstDate: row.entryDate,
      lastDate: row.entryDate,
      dayCount: 1,
      hours: row.hours,
      costCents: row.costAmountCents,
    });
  }

  return [...grouped.values()].sort((a, b) => b.firstDate.localeCompare(a.firstDate));
}

// ── timeImport ───────────────────────────────────────────────────

/**
 * Importing a timesheet export — with a preview that tells the truth first.
 *
 * The shape of this service is set by one rule: NOTHING IS WRITTEN UNTIL THE
 * OWNER HAS SEEN WHAT WILL BE WRITTEN. Preview resolves every row against real
 * people and real clients and reports what it could not place; commit re-does
 * that work from the same file and refuses if anything is still unplaced.
 *
 * Commit deliberately re-parses the FILE rather than trusting a list of rows
 * from the browser. Hours become cost the moment they land, so accepting
 * pre-computed rows would let a page send whatever cost it liked. The file is
 * the input; everything else is derived here.
 */

const IMPORT_SOURCE = "csv_import";
// ESTIMATE_SOURCE ("estimate") is declared with the estimates code above.

export interface ImportInput {
  csv: string;
  mapping?: Partial<ColumnMapping>;
  /** Normalised name → personId, for names the owner placed by hand. */
  personMap?: Record<string, string>;
  /** Normalised name → "targetType:targetId", likewise. */
  targetMap?: Record<string, string>;
}

/**
 * What will happen to a cell:
 *   new       — will be added
 *   update    — already imported once; the hours will be restated
 *   unchanged — already imported with exactly these hours; nothing to do
 *   conflict  — hours were typed by hand here; left alone
 *   blocked   — cannot be written, with a reason
 */
export type EntryOutcome = "new" | "update" | "unchanged" | "conflict" | "blocked";

export interface PreviewEntry {
  lineNumbers: number[];
  personName: string;
  targetName: string;
  personId: string | null;
  targetType: TimeTargetType | null;
  targetId: string | null;
  entryDate: string;
  hours: string;
  workType: WorkType;
  billable: boolean;
  /** Null when the row can't be costed — never a zero standing in for unknown. */
  costAmountCents: number | null;
  outcome: EntryOutcome;
  issue: string | null;
}

/** A name in the file that matches nobody, with whoever came closest. */
export interface UnmatchedName {
  name: string;
  rowCount: number;
  hours: string;
  suggestions: Array<{ id: string; label: string; reason: string; targetType?: TimeTargetType }>;
}

// ---------------------------------------------------------------------------
// Resolving names to records
// ---------------------------------------------------------------------------

interface Resolver {
  people: Array<{ id: string; displayName: string; email: string | null }>;
  targets: Awaited<ReturnType<typeof listTimeTargets>>;
  personByName: Map<string, string>;
  targetByName: Map<string, { targetType: TimeTargetType; targetId: string }>;
}

async function buildResolver(businessId: string, input: ImportInput): Promise<Resolver> {
  const [people, targets] = await Promise.all([
    db
      .select()
      .from(peopleTable)
      .where(and(eq(peopleTable.businessId, businessId), eq(peopleTable.kind, "employee"), eq(peopleTable.status, "active"))),
    listTimeTargets(businessId),
  ]);

  // Exact name matches only. A "similar" match is offered as a suggestion and
  // never applied on its own — importing someone else's hours against a client
  // is invisible once done, so a near-miss must stay a human decision.
  const personByName = new Map<string, string>();
  for (const person of people) personByName.set(normalizePersonName(person.displayName), person.id);

  const targetByName = new Map<string, { targetType: TimeTargetType; targetId: string }>();
  for (const target of targets) {
    const key = normalizePersonName(target.label);
    // Clients win ties: a client and a product sharing a name is rare, and the
    // client is what an agency's export means by that column.
    if (!targetByName.has(key) || target.targetType === "client") {
      targetByName.set(key, { targetType: target.targetType, targetId: target.targetId });
    }
  }

  // The owner's own decisions from the preview, applied over the automatic ones.
  const validPeople = new Set(people.map((p) => p.id));
  for (const [name, personId] of Object.entries(input.personMap ?? {})) {
    if (!validPeople.has(personId)) throw invalid("That team member no longer exists. Reload and try again.");
    personByName.set(normalizePersonName(name), personId);
  }
  const validTargets = new Set(targets.map((t) => `${t.targetType}:${t.targetId}`));
  for (const [name, key] of Object.entries(input.targetMap ?? {})) {
    if (!validTargets.has(key)) throw invalid("That client or product no longer exists. Reload and try again.");
    const [targetType, targetId] = key.split(":");
    targetByName.set(normalizePersonName(name), { targetType: targetType as TimeTargetType, targetId });
  }

  return { people, targets, personByName, targetByName };
}

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

export async function previewTimeImport(businessId: string, input: ImportInput) {
  const parsed = parseTimeImport(input.csv, input.mapping);
  const resolver = await buildResolver(businessId, input);

  // Rows split two ways: those we can place, and those whose names are unknown.
  const placed: ResolvedImportRow[] = [];
  const unmatchedPeople = new Map<string, { name: string; rows: typeof parsed.rows }>();
  const unmatchedTargets = new Map<string, { name: string; rows: typeof parsed.rows }>();

  for (const row of parsed.rows) {
    const personId = resolver.personByName.get(normalizePersonName(row.personName));
    const target = resolver.targetByName.get(normalizePersonName(row.targetName));

    if (!personId) {
      const key = normalizePersonName(row.personName);
      const bucket = unmatchedPeople.get(key) ?? { name: row.personName, rows: [] };
      bucket.rows.push(row);
      unmatchedPeople.set(key, bucket);
    }
    if (!target) {
      const key = normalizePersonName(row.targetName);
      const bucket = unmatchedTargets.get(key) ?? { name: row.targetName, rows: [] };
      bucket.rows.push(row);
      unmatchedTargets.set(key, bucket);
    }
    if (!personId || !target) continue;

    placed.push({ ...row, personId, targetType: target.targetType, targetId: target.targetId });
  }

  const cells = aggregateImportRows(placed);
  const entries = await describeEntries(businessId, cells, resolver);

  const totals = {
    new: entries.filter((e) => e.outcome === "new").length,
    update: entries.filter((e) => e.outcome === "update").length,
    unchanged: entries.filter((e) => e.outcome === "unchanged").length,
    conflict: entries.filter((e) => e.outcome === "conflict").length,
    blocked: entries.filter((e) => e.outcome === "blocked").length,
  };

  return {
    preset: parsed.preset as ImportPreset,
    headers: parsed.headers,
    mapping: parsed.mapping,
    entries,
    problems: parsed.problems,
    unmatchedPeople: [...unmatchedPeople.values()].map((b) => describeUnmatchedPerson(b, resolver)),
    unmatchedTargets: [...unmatchedTargets.values()].map((b) => describeUnmatchedTarget(b, resolver)),
    totals,
    /** The one thing the owner needs to know: can this be committed as it stands? */
    canCommit: unmatchedPeople.size === 0 && unmatchedTargets.size === 0 && totals.blocked === 0,
  };
}

/**
 * Works out what would happen to each cell, and what it would cost.
 *
 * The cost is computed here so the preview shows the real figure. It is
 * recomputed on commit from the same rates rather than carried across, because
 * a number that travelled through the browser is not evidence of anything.
 */
async function describeEntries(
  businessId: string,
  cells: AggregatedEntry[],
  resolver: Resolver,
): Promise<PreviewEntry[]> {
  if (cells.length === 0) return [];

  const nameById = new Map(resolver.people.map((p) => [p.id, p.displayName]));
  const labelById = new Map(resolver.targets.map((t) => [`${t.targetType}:${t.targetId}`, t.label]));

  // Everything already stored for these days, so an existing cell is recognised.
  const dates = [...new Set(cells.map((c) => c.entryDate))];
  const existing = await db
    .select()
    .from(timeEntriesTable)
    .where(and(eq(timeEntriesTable.businessId, businessId), inArray(timeEntriesTable.entryDate, dates)));

  const cellKey = (e: { personId: string; targetType: string; targetId: string; entryDate: string }) =>
    `${e.personId}|${e.targetType}|${e.targetId}|${e.entryDate}`;

  const importedByExternal = new Map(
    existing.filter((e) => e.source === IMPORT_SOURCE && e.externalId).map((e) => [e.externalId as string, e]),
  );
  // Only hours somebody TYPED are protected. An estimate is a guess, and real
  // hours arriving from the time tracker are exactly what it was standing in
  // for — so an import replaces an estimate rather than being turned away by it.
  const manualCells = new Set(existing.filter((e) => e.source === "manual").map(cellKey));
  const estimatedCells = new Set(existing.filter((e) => e.source === ESTIMATE_SOURCE).map(cellKey));

  const out: PreviewEntry[] = [];
  for (const cell of cells) {
    const base = {
      lineNumbers: cell.lineNumbers,
      personName: nameById.get(cell.personId) ?? cell.personId,
      targetName: labelById.get(`${cell.targetType}:${cell.targetId}`) ?? cell.targetId,
      personId: cell.personId,
      targetType: cell.targetType,
      targetId: cell.targetId,
      entryDate: cell.entryDate,
      hours: cell.hours,
      workType: cell.workType,
      billable: cell.billable,
    };

    // A day's rows can sum past 24 hours. That is a broken export, not a shift.
    if (!isValidHours(cell.hours)) {
      out.push({
        ...base,
        costAmountCents: null,
        outcome: "blocked",
        issue: `That adds up to ${cell.hours} hours in one day, which can't be right.`,
      });
      continue;
    }

    // Hours typed by hand are never overwritten or added to. Doing either would
    // silently change or double what a person entered themselves.
    if (manualCells.has(cellKey(cell))) {
      out.push({
        ...base,
        costAmountCents: null,
        outcome: "conflict",
        issue: "You already entered hours here by hand, so this row is being left out.",
      });
      continue;
    }

    const rate = await rateOnDate(businessId, cell.personId, new Date(`${cell.entryDate}T12:00:00Z`));
    if (!rate) {
      out.push({
        ...base,
        costAmountCents: null,
        outcome: "blocked",
        issue: `${base.personName} has no pay rate covering ${cell.entryDate}. Set one on the Team page first.`,
      });
      continue;
    }

    const costAmountCents = costOfHours(cell.hours, rate.effectiveHourlyCostCents);
    const already = importedByExternal.get(cell.externalId);
    const replacesEstimate = estimatedCells.has(cellKey(cell));
    out.push({
      ...base,
      costAmountCents,
      outcome: !already ? "new" : already.hours === cell.hours ? "unchanged" : "update",
      issue:
        already && already.hours !== cell.hours
          ? `Already imported as ${already.hours} hours; this will change it to ${cell.hours}.`
          : replacesEstimate
            ? "Replaces the estimate on this day with the real hours."
            : null,
    });
  }
  return out;
}

function describeUnmatchedPerson(
  bucket: { name: string; rows: Array<{ hours: string }> },
  resolver: Resolver,
): UnmatchedName {
  const matches = findPersonMatches(
    { name: bucket.name },
    resolver.people.map((p) => ({ id: p.id, displayName: p.displayName, email: p.email })),
  );
  return {
    name: bucket.name,
    rowCount: bucket.rows.length,
    hours: sumHours(bucket.rows),
    suggestions: matches.slice(0, 5).map((m) => ({ id: m.person.id, label: m.person.displayName, reason: m.reason })),
  };
}

function describeUnmatchedTarget(
  bucket: { name: string; rows: Array<{ hours: string }> },
  resolver: Resolver,
): UnmatchedName {
  const matches = findPersonMatches(
    { name: bucket.name },
    resolver.targets.map((t) => ({ id: `${t.targetType}:${t.targetId}`, displayName: t.label, email: null })),
  );
  return {
    name: bucket.name,
    rowCount: bucket.rows.length,
    hours: sumHours(bucket.rows),
    suggestions: matches.slice(0, 5).map((m) => ({
      id: m.person.id,
      label: m.person.displayName,
      reason: m.reason,
      targetType: m.person.id.split(":")[0] as TimeTargetType,
    })),
  };
}

function sumHours(rows: Array<{ hours: string }>): string {
  // The domain's exact addition, never a float sum.
  return addHours(...rows.map((r) => r.hours));
}

// ---------------------------------------------------------------------------
// Commit
// ---------------------------------------------------------------------------

/**
 * Writes the import. Refuses outright while anything is unplaced.
 *
 * The refusal is the point of the whole phase: a file with one unknown name
 * must not import "the rest of it" and leave the owner believing a week is
 * complete when a person's hours are missing. Partial silence is the failure;
 * a blocked commit with a clear reason is not.
 */
export async function commitTimeImport(businessId: string, input: ImportInput) {
  const preview = await previewTimeImport(businessId, input);

  if (preview.unmatchedPeople.length > 0) {
    const names = preview.unmatchedPeople.map((p) => p.name).join(", ");
    throw invalid(`Nothing was imported. These people aren't on your team yet: ${names}. Match them first.`);
  }
  if (preview.unmatchedTargets.length > 0) {
    const names = preview.unmatchedTargets.map((t) => t.name).join(", ");
    throw invalid(`Nothing was imported. These clients aren't set up yet: ${names}. Match them first.`);
  }
  if (preview.totals.blocked > 0) {
    const first = preview.entries.find((e) => e.outcome === "blocked");
    throw invalid(`Nothing was imported. ${first?.issue ?? "Some rows can't be imported yet."}`);
  }

  let added = 0;
  let updated = 0;
  let unchanged = 0;
  let estimatesReplaced = 0;

  for (const entry of preview.entries) {
    if (entry.outcome === "conflict") continue;
    if (entry.outcome === "unchanged") {
      unchanged += 1;
      continue;
    }
    if (!entry.personId || !entry.targetType || !entry.targetId || entry.costAmountCents === null) continue;

    const rate = await rateOnDate(businessId, entry.personId, new Date(`${entry.entryDate}T12:00:00Z`));
    if (!rate) continue; // Already reported as blocked above; belt and braces.

    // Real hours land where a guess used to be, and the guess goes. Leaving it
    // would double the day: the grid sums a cell, so the estimate and the
    // imported hours would add together into a figure nobody worked.
    const cleared = await db
      .delete(timeEntriesTable)
      .where(
        and(
          eq(timeEntriesTable.businessId, businessId),
          eq(timeEntriesTable.personId, entry.personId),
          eq(timeEntriesTable.targetType, entry.targetType),
          eq(timeEntriesTable.targetId, entry.targetId),
          eq(timeEntriesTable.entryDate, entry.entryDate),
          eq(timeEntriesTable.source, ESTIMATE_SOURCE),
        ),
      )
      .returning({ id: timeEntriesTable.id });
    estimatesReplaced += cleared.length;

    const externalId = importExternalIdFor(entry);
    const values = {
      hours: entry.hours,
      workType: entry.workType,
      billable: entry.billable,
      note: null as string | null,
      // Frozen from the rate that applied ON THE DAY, exactly as manual entry
      // does. An import must not re-cost old work at today's rate.
      costRateSnapshotCents: rate.effectiveHourlyCostCents,
      costAmountCents: entry.costAmountCents,
      updatedAt: new Date(),
    };

    // The unique index does the de-duplicating, so a re-import is settled by the
    // database rather than by a check that could race with a second tab.
    const [written] = await db
      .insert(timeEntriesTable)
      .values({
        id: uid("te"),
        businessId,
        personId: entry.personId,
        targetType: entry.targetType,
        targetId: entry.targetId,
        entryDate: entry.entryDate,
        isEstimated: false,
        source: IMPORT_SOURCE,
        externalId,
        ...values,
      })
      .onConflictDoUpdate({
        target: [timeEntriesTable.businessId, timeEntriesTable.source, timeEntriesTable.externalId],
        // The index is partial, so Postgres needs its predicate to match it.
        targetWhere: sql`external_id IS NOT NULL`,
        set: values,
      })
      .returning({ id: timeEntriesTable.id, createdAt: timeEntriesTable.createdAt });

    if (written && entry.outcome === "new") added += 1;
    else updated += 1;
  }

  return {
    added,
    updated,
    unchanged,
    estimatesReplaced,
    skippedConflicts: preview.totals.conflict,
    unreadableRows: preview.problems.length,
  };
}

/** The cell's id, rebuilt from the resolved entry rather than trusted. */
function importExternalIdFor(entry: PreviewEntry): string {
  return importExternalId({
    personId: entry.personId as string,
    targetType: entry.targetType as TimeTargetType,
    targetId: entry.targetId as string,
    entryDate: entry.entryDate,
    workType: entry.workType,
    billable: entry.billable,
  });
}

// ── mappers ───────────────────────────────────────────

// ---------------------------------------------------------------------------
// Team members
// ---------------------------------------------------------------------------

/** One member in the contract shape — re-read so the derived cost is current. */
export async function memberView(businessId: string, personId: string) {
  const members = await team.listTeamMembers(businessId);
  const found = members.find((m) => m.id === personId);
  if (!found) throw notFound("Team member");
  return found;
}

// ---------------------------------------------------------------------------
// Clients and engagements
// ---------------------------------------------------------------------------

/** One client in the contract shape — re-read so ledger revenue is current. */
export async function clientView(businessId: string, engagementId: string) {
  const all = await listClients(businessId);
  const found = all.find((c) => c.engagementId === engagementId);
  if (!found) throw notFound("Client");
  return found;
}
