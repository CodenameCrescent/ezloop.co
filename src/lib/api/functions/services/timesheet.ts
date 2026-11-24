import {
  categoriesTable,
  clientEngagementsTable,
  db,
  peopleTable,
  projectsTable,
  revenueItemsTable,
  timeEntriesTable,
} from "@workspace/db";
import {
  EXPECTED_DAILY_HOURS,
  addHours,
  checkDay,
  costOfHours,
  isTimeTargetType,
  isValidHours,
  isWorkType,
  weekDays,
  weekStartOf,
  type TimeTargetType,
  type WorkType,
} from "@workspace/domain";
import { and, asc, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import { LIVE_PROJECT_STATUSES } from "./project";
import { uid } from "../lib/uid";
import { invalid, notFound } from "./errors";
import { rateOnDate } from "./team";

/**
 * The weekly grid: hours in, cost frozen, nothing invented.
 *
 * A cell is one person, on one target, on one day. Writing a number upserts it;
 * clearing the cell deletes it — an empty cell means "no hours", which is not
 * the same as a zero-hour entry and must not become one.
 *
 * The cost on each entry is FROZEN from the rate that applied on that entry's
 * date, exactly like a transaction line's cost snapshot. A raise in August must
 * never restate what July's work cost.
 */

// ---------------------------------------------------------------------------
// Targets — the things time can be logged against
// ---------------------------------------------------------------------------

export interface TimeTarget {
  targetType: TimeTargetType;
  targetId: string;
  label: string;
  /** Grouping hint for the picker: "Clients", "What you sell", "Internal". */
  group: string;
}

/**
 * Everything the owner could log time against. The grid shows only the ones
 * they have added — a firm with 200 past clients should not open a 200-row
 * screen — but the picker needs the full list.
 */
export async function listTimeTargets(businessId: string): Promise<TimeTarget[]> {
  const [engagements, people, items, categories, projects] = await Promise.all([
    db
      .select()
      .from(clientEngagementsTable)
      .where(and(eq(clientEngagementsTable.businessId, businessId), eq(clientEngagementsTable.engagementStatus, "active"))),
    db.select().from(peopleTable).where(eq(peopleTable.businessId, businessId)),
    db
      .select()
      .from(revenueItemsTable)
      .where(and(eq(revenueItemsTable.businessId, businessId), eq(revenueItemsTable.status, "active"))),
    db
      .select()
      .from(categoriesTable)
      .where(and(eq(categoriesTable.businessId, businessId), eq(categoriesTable.appliesTo, "time"))),
    // Live work only. A finished site should not clutter the picker, and its
    // existing hours and costs keep their target regardless — the grid falls
    // back to the real name for anything the picker no longer offers.
    db
      .select()
      .from(projectsTable)
      .where(
        and(
          eq(projectsTable.businessId, businessId),
          inArray(projectsTable.status, [...LIVE_PROJECT_STATUSES]),
        ),
      ),
  ]);

  const nameById = new Map(people.map((p) => [p.id, p.displayName]));
  const targets: TimeTarget[] = [];

  for (const engagement of engagements) {
    targets.push({
      targetType: "client",
      targetId: engagement.personId,
      label: nameById.get(engagement.personId) ?? "Client",
      group: "Clients",
    });
  }
  for (const item of items) {
    // Only leaves are sellable, and only leaves absorb labour meaningfully.
    if (items.some((other) => other.parentId === item.id)) continue;
    targets.push({ targetType: "revenue_item", targetId: item.id, label: item.name, group: "What you sell" });
  }
  for (const category of categories) {
    targets.push({ targetType: "internal", targetId: category.id, label: category.name, group: "Internal" });
  }
  for (const project of projects) {
    // The group heading is generic here; the screens re-label it with the
    // trade's own word via `projectLabel(businessType)`.
    targets.push({
      targetType: "project",
      targetId: project.id,
      label: project.code ? `${project.name} (${project.code})` : project.name,
      group: "Projects",
    });
  }
  return targets;
}

/**
 * Exported because expense lines target the SAME list hours do. A cost booked
 * against a client and an hour booked against that client have to mean the same
 * client, or the profitability page adds up two different businesses.
 */
export async function assertTargetExists(businessId: string, targetType: TimeTargetType, targetId: string) {
  const targets = await listTimeTargets(businessId);
  const found = targets.some((t) => t.targetType === targetType && t.targetId === targetId);
  if (!found) throw notFound("Target");
}

// ---------------------------------------------------------------------------
// Reading a week
// ---------------------------------------------------------------------------

export interface TimesheetCell {
  personId: string;
  targetType: TimeTargetType;
  targetId: string;
  entryDate: string;
  hours: string;
  isEstimated: boolean;
  workType: WorkType;
  billable: boolean;
}

export async function getTimesheet(businessId: string, weekStartInput: Date) {
  const weekStart = weekStartOf(weekStartInput);
  const days = weekDays(weekStart);
  const weekEnd = days[days.length - 1];

  // Everyone in the business, once: the grid's member list is a filter of this,
  // and the name fallback below needs the ones the picker no longer offers.
  const [allPeople, entries, targets, items] = await Promise.all([
    db.select().from(peopleTable).where(eq(peopleTable.businessId, businessId)).orderBy(asc(peopleTable.displayName)),
    db
      .select()
      .from(timeEntriesTable)
      .where(
        and(
          eq(timeEntriesTable.businessId, businessId),
          gte(timeEntriesTable.entryDate, days[0]),
          lte(timeEntriesTable.entryDate, weekEnd),
        ),
      ),
    listTimeTargets(businessId),
    db.select().from(revenueItemsTable).where(eq(revenueItemsTable.businessId, businessId)),
  ]);

  const members = allPeople.filter((p) => p.kind === "employee" && p.status === "active");

  /**
   * Labels come from the picker, which offers only live clients and products —
   * so a client marked Finished mid-week used to watch their own row rename
   * itself to "(removed)". Their hours are still there and still counted, so
   * the row falls back to the real name.
   *
   * FOR DISPLAY ONLY. `listTimeTargets` stays live-only on purpose: it is what
   * `assertTargetExists` checks before a write, and widening it would let hours
   * be logged against a finished client — which would make the warning on the
   * Clients screen a lie.
   */
  const labelFor = new Map(targets.map((t) => [`${t.targetType}:${t.targetId}`, t.label]));
  const nameById = new Map<string, string>([
    ...allPeople.map((p) => [`client:${p.id}`, p.displayName] as const),
    ...items.map((i) => [`revenue_item:${i.id}`, i.name] as const),
  ]);
  const labelOf = (targetType: string, targetId: string) =>
    labelFor.get(`${targetType}:${targetId}`) ?? nameById.get(`${targetType}:${targetId}`) ?? "(removed)";

  /**
   * A cell is one person, one target, one day — and it may be several rows.
   *
   * Typing into the grid only ever makes one row, but a CSV import makes one
   * per work type, so a Monday can hold six delivery hours and two of rework.
   * The cell must therefore show the SUM. Showing whichever row came back last
   * would put a different number on this screen than profitability counts, and
   * two screens disagreeing about the same hours is the failure every guard in
   * this codebase exists to prevent.
   */
  const byCell = new Map<string, TimesheetCell>();
  for (const e of entries) {
    const key = `${e.personId}|${e.targetType}|${e.targetId}|${e.entryDate}`;
    const existing = byCell.get(key);
    if (!existing) {
      byCell.set(key, {
        personId: e.personId,
        targetType: e.targetType as TimeTargetType,
        targetId: e.targetId,
        entryDate: e.entryDate,
        hours: e.hours,
        isEstimated: e.isEstimated,
        workType: e.workType as WorkType,
        billable: e.billable,
      });
      continue;
    }
    existing.hours = addHours(existing.hours, e.hours);
    // An estimate anywhere in the cell makes the whole cell an estimate: the
    // softer claim is the honest one when the parts disagree.
    existing.isEstimated = existing.isEstimated || e.isEstimated;
    existing.billable = existing.billable || e.billable;
  }
  const cells: TimesheetCell[] = [...byCell.values()];

  // Rows the grid must show: every person/target pair that already has hours.
  // The owner adds more from the picker; nothing else appears uninvited.
  const rows = [...new Set(cells.map((c) => `${c.personId}|${c.targetType}|${c.targetId}`))].map((key) => {
    const [personId, targetType, targetId] = key.split("|");
    return {
      personId,
      targetType: targetType as TimeTargetType,
      targetId,
      label: labelOf(targetType, targetId),
    };
  });

  return {
    weekStart: days[0],
    days,
    expectedDailyHours: EXPECTED_DAILY_HOURS,
    members: members.map((m) => ({ id: m.id, name: m.displayName, roleLabel: m.roleLabel ?? null })),
    targets,
    rows,
    cells,
  };
}

// ---------------------------------------------------------------------------
// Writing one cell
// ---------------------------------------------------------------------------

export interface SetCellInput {
  personId: string;
  targetType: TimeTargetType;
  targetId: string;
  entryDate: string;
  /** Empty or "0" removes the entry — a blank cell is not a zero-hour entry. */
  hours: string;
  workType?: WorkType;
  billable?: boolean;
  isEstimated?: boolean;
  note?: string | null;
}

export async function setTimesheetCell(businessId: string, input: SetCellInput) {
  if (!isTimeTargetType(input.targetType)) throw invalid(`Unknown target type "${input.targetType}"`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.entryDate)) throw invalid("entryDate must be YYYY-MM-DD");
  const workType = input.workType ?? "delivery";
  if (!isWorkType(workType)) throw invalid(`Unknown work type "${workType}"`);

  const [person] = await db
    .select()
    .from(peopleTable)
    .where(and(eq(peopleTable.businessId, businessId), eq(peopleTable.id, input.personId), eq(peopleTable.kind, "employee")));
  if (!person) throw notFound("Team member");

  /**
   * Every row in this cell, not just one of them.
   *
   * An import can leave two rows here — six delivery hours and two of rework —
   * and typing a number over them means "this day was N hours", so all of them
   * are replaced. Updating only the first would leave the others behind and the
   * cell would total more than the owner just typed.
   */
  const inCell = await db
    .select()
    .from(timeEntriesTable)
    .where(
      and(
        eq(timeEntriesTable.businessId, businessId),
        eq(timeEntriesTable.personId, input.personId),
        eq(timeEntriesTable.targetType, input.targetType),
        eq(timeEntriesTable.targetId, input.targetId),
        eq(timeEntriesTable.entryDate, input.entryDate),
      ),
    );
  // The manual row, if one exists — the one an edit restates.
  const existing = inCell.find((e) => e.source === "manual") ?? inCell[0];
  const supersededIds = inCell.filter((e) => e.id !== existing?.id).map((e) => e.id);

  const raw = input.hours?.trim() ?? "";
  const clearing = raw === "" || Number(raw) === 0;

  if (clearing) {
    if (inCell.length > 0) {
      await db.delete(timeEntriesTable).where(inArray(timeEntriesTable.id, inCell.map((e) => e.id)));
    }
    return { entry: null, dayCheck: await checkPersonDay(businessId, input.personId, input.entryDate) };
  }

  if (!isValidHours(raw)) throw invalid("Hours must be more than 0 and no more than 24");
  await assertTargetExists(businessId, input.targetType, input.targetId);

  // The rate that applied ON THE DAY THE WORK HAPPENED, frozen onto the entry.
  const rate = await rateOnDate(businessId, input.personId, new Date(`${input.entryDate}T12:00:00Z`));
  if (!rate) {
    throw invalid(`${person.displayName} has no pay rate covering ${input.entryDate}. Set one on the Team page first.`);
  }
  const costRateSnapshotCents = rate.effectiveHourlyCostCents;
  const costAmountCents = costOfHours(raw, costRateSnapshotCents);

  if (existing) {
    // Anything else that was in this cell is gone: the typed number is the whole
    // day now. Done BEFORE the update so a failure can't leave a doubled cell.
    if (supersededIds.length > 0) {
      await db.delete(timeEntriesTable).where(inArray(timeEntriesTable.id, supersededIds));
    }
    // Re-freezing on edit is correct: the entry is being restated for the same
    // day, so it takes the rate for that day — not today's.
    const [updated] = await db
      .update(timeEntriesTable)
      .set({
        hours: raw,
        workType,
        billable: input.billable ?? existing.billable,
        // The estimate's own note goes with the estimate — keeping it would
        // caption a real logged day with "estimated, not logged day by day".
        note: input.note === undefined ? (existing.source === "estimate" ? null : existing.note) : input.note,
        costRateSnapshotCents,
        costAmountCents,
        // A hand-edited row is a hand-entered row, whatever brought it in. It
        // drops its import id so a later re-import respects the correction
        // instead of restating it back to what the file said, and it stops
        // being an estimate — somebody has now told us what the day actually
        // was, so it must not keep carrying the "roughly" marker.
        source: "manual",
        externalId: null,
        isEstimated: input.isEstimated ?? false,
        updatedAt: new Date(),
      })
      .where(eq(timeEntriesTable.id, existing.id))
      .returning();
    return { entry: updated, dayCheck: await checkPersonDay(businessId, input.personId, input.entryDate) };
  }

  const [created] = await db
    .insert(timeEntriesTable)
    .values({
      id: uid("te"),
      businessId,
      personId: input.personId,
      targetType: input.targetType,
      targetId: input.targetId,
      entryDate: input.entryDate,
      hours: raw,
      workType,
      billable: input.billable ?? true,
      isEstimated: input.isEstimated ?? false,
      note: input.note ?? null,
      costRateSnapshotCents,
      costAmountCents,
      source: "manual",
    })
    .returning();
  return { entry: created, dayCheck: await checkPersonDay(businessId, input.personId, input.entryDate) };
}

/**
 * Totals one person's day and says whether it looks half-filled.
 *
 * Returned WITH the save, never instead of it. The save has already happened by
 * the time this is computed — the warning cannot block it, and nothing here
 * writes the missing hours anywhere.
 */
export async function checkPersonDay(businessId: string, personId: string, entryDate: string) {
  const rows = await db
    .select({ hours: timeEntriesTable.hours })
    .from(timeEntriesTable)
    .where(
      and(
        eq(timeEntriesTable.businessId, businessId),
        eq(timeEntriesTable.personId, personId),
        eq(timeEntriesTable.entryDate, entryDate),
      ),
    );
  const logged = addHours(...rows.map((r) => r.hours));
  return { entryDate, ...checkDay(logged) };
}

/** Removes a whole row from the grid — every day of that person/target in the week. */
export async function clearTimesheetRow(
  businessId: string,
  input: { personId: string; targetType: TimeTargetType; targetId: string; weekStart: string },
) {
  const days = weekDays(new Date(`${input.weekStart}T00:00:00Z`));
  await db
    .delete(timeEntriesTable)
    .where(
      and(
        eq(timeEntriesTable.businessId, businessId),
        eq(timeEntriesTable.personId, input.personId),
        eq(timeEntriesTable.targetType, input.targetType),
        eq(timeEntriesTable.targetId, input.targetId),
        inArray(timeEntriesTable.entryDate, days),
      ),
    );
}
