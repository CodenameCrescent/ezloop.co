import { z } from "zod";
import { defineEndpoint, moneyCents, splitTargetType } from "./shared";
import { accountingBasis } from "./transactions";

/**
 * Client profitability — attributing labour cost to whatever earns money.
 *
 * Everything under this path is gated on the `client_profitability` feature and
 * ENFORCED server-side: an ecommerce business gets 403, not merely a hidden nav
 * entry. Phase 1 ships the schema, the seeded internal buckets and the gate;
 * team members, engagements, time entry and the profitability engine follow.
 *
 * A standing rule for every endpoint added here: no response may carry raw
 * salary or overhead figures. Cost is derived server-side, because the schemas
 * in this file are what will keep salaries out of a Manager's payload the day
 * roles ship.
 */

/** An internal bucket that absorbs labour — Admin, Sales & pitching, and so on. */
export const internalTimeCategory = z.object({
  id: z.string(),
  name: z.string(),
});

/**
 * The buckets time can be logged against when it isn't for a client or for
 * something the business sells. Seeded per business, editable afterwards
 * through the ordinary category surface.
 */
export const listInternalTimeCategories = defineEndpoint({
  method: "GET",
  path: "/client-profitability/internal-categories",
  response: z.object({
    categories: z.array(internalTimeCategory),
  }),
});

// ---------------------------------------------------------------------------
// Team members
// ---------------------------------------------------------------------------

export const teamCostType = z.enum(["salaried", "hourly", "contractor"]);

/**
 * A team member as the screen sees them.
 *
 * NOTE WHAT IS ABSENT: monthlyCostCents, hourlyRateCents and overheadShareCents
 * never appear. Only the DERIVED per-hour figures are sent. That is the
 * forward-compatibility constraint from the spec made structural — when the
 * Manager role ships, a salary cannot leak through a payload that never
 * carried it.
 */
export const teamMember = z.object({
  id: z.string(),
  name: z.string(),
  roleLabel: z.string().nullable(),
  email: z.string().nullable(),
  status: z.enum(["active", "archived"]),
  costType: teamCostType.nullable(),
  billableTargetHours: z.string().nullable(),
  /** What you pay them per hour — the half that belongs in contribution. */
  payHourlyCents: moneyCents.nullable(),
  /** Their overhead per hour — an allocation, never part of contribution. */
  overheadHourlyCents: moneyCents.nullable(),
  /** The two added: the fully-loaded hourly cost. */
  effectiveHourlyCostCents: moneyCents.nullable(),
  rateEffectiveFrom: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const listTeamMembers = defineEndpoint({
  method: "GET",
  path: "/client-profitability/team-members",
  query: z.object({ status: z.enum(["active", "archived"]).optional() }),
  response: z.object({ members: z.array(teamMember) }),
});

export const teamRateBody = z.object({
  costType: teamCostType,
  /** Salary or retainer, for `salaried`. */
  monthlyCostCents: moneyCents.optional(),
  /** The agreed rate, for `hourly`/`contractor`. */
  hourlyRateCents: moneyCents.nullish(),
  /** Their share of rent, software and admin. Defaults from the ledger. */
  overheadShareCents: moneyCents.optional(),
  /** Decimal string; defaults to "130". */
  billableTargetHours: z.string().optional(),
  /** When this rate starts. Defaults to now. */
  effectiveFrom: z.string().optional(),
});

export const createTeamMember = defineEndpoint({
  method: "POST",
  path: "/client-profitability/team-members",
  body: z.object({
    name: z.string().min(1).max(255),
    roleLabel: z.string().max(255).nullish(),
    email: z.string().max(255).nullish(),
    rate: teamRateBody,
  }),
  response: teamMember,
});

/** Identity only. What someone costs moves through the rate endpoint. */
export const updateTeamMember = defineEndpoint({
  method: "PATCH",
  path: "/client-profitability/team-members/:id",
  params: z.object({ id: z.string() }),
  body: z.object({
    name: z.string().min(1).max(255).optional(),
    roleLabel: z.string().max(255).nullish(),
    email: z.string().max(255).nullish(),
    status: z.enum(["active", "archived"]).optional(),
  }),
  response: teamMember,
});

/**
 * Changes what someone costs from a date forward. Never an in-place edit: the
 * open rate is closed and a successor opened, because time entries freeze the
 * rate that applied on their day.
 */
export const setTeamMemberRate = defineEndpoint({
  method: "POST",
  path: "/client-profitability/team-members/:id/rate",
  params: z.object({ id: z.string() }),
  body: teamRateBody,
  response: teamMember,
});

/** Every version of someone's rate — the audit trail of pay changes. */
export const getTeamMemberRateHistory = defineEndpoint({
  method: "GET",
  path: "/client-profitability/team-members/:id/rate-history",
  params: z.object({ id: z.string() }),
  response: z.object({
    history: z.array(
      z.object({
        id: z.string(),
        costType: teamCostType,
        billableTargetHours: z.string(),
        effectiveHourlyCostCents: moneyCents,
        effectiveFrom: z.string(),
        effectiveTo: z.string().nullable(),
      }),
    ),
  }),
});

/**
 * The overhead share worked out FROM THE LEDGER, so the owner doesn't have to.
 *
 * Asking them to type a number is the failure this exists to prevent: most
 * leave it blank, and a zero overhead share quietly understates every cost rate
 * in the system. `reason` says why a figure is missing rather than sending a
 * zero that reads as a real answer.
 */
export const getOverheadDefault = defineEndpoint({
  method: "GET",
  path: "/client-profitability/overhead-default",
  response: z.object({
    perPersonCents: moneyCents.nullable(),
    fixedCostPoolCents: moneyCents,
    headcount: z.number().int(),
    reason: z.enum(["ok", "no_team", "no_fixed_costs"]),
    /** The month the pool came from, e.g. "June 2026". */
    periodLabel: z.string(),
    /** What went into the pool, biggest first — so the screen shows its working. */
    breakdown: z.array(z.object({ name: z.string(), amountCents: moneyCents })),
  }),
});

// ---------------------------------------------------------------------------
// Clients and engagements
// ---------------------------------------------------------------------------

export const engagementStatus = z.enum(["active", "completed", "churned"]);

/**
 * Whether an agreed figure is for the whole job or for every month. Asked
 * separately for the hours and the money, because quoting "forty hours a month"
 * against a fixed total fee is a real way to price a retainer — and forcing one
 * basis onto both would misprice the job by the length of the contract.
 */
export const agreedPeriod = z.enum(["total", "monthly"]);

/**
 * A client is a PERSON with commercial terms attached. Revenue is not stored
 * here — it reaches them through the ledger, and `revenueToDateCents` below is
 * read from it. Nothing on this shape is profit: labour is not attributed until
 * the profitability engine lands.
 */
export const client = z.object({
  engagementId: z.string(),
  personId: z.string(),
  name: z.string(),
  email: z.string().nullable(),
  engagementStatus,
  agreedAmountCents: moneyCents.nullable(),
  /** Whether the amount above is the whole fee or a monthly one. */
  agreedAmountPeriod: agreedPeriod,
  /** Decimal string — what scope creep gets measured against. */
  agreedHours: z.string().nullable(),
  /** Whether the hours above are for the whole job or per month. */
  agreedHoursPeriod: agreedPeriod,
  currency: z.string(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  notes: z.string().nullable(),
  /** Lifetime net revenue from the ledger — the same figure the People page shows. */
  revenueToDateCents: moneyCents,
  orderCount: z.number().int(),
  lastActivityAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const listClients = defineEndpoint({
  method: "GET",
  path: "/client-profitability/clients",
  query: z.object({ status: engagementStatus.optional() }),
  response: z.object({ clients: z.array(client) }),
});

/**
 * Who might already BE this client, before one is created.
 *
 * A service business has usually invoiced its clients already, so they exist as
 * customers. This is what stops a second Acme appearing beside the one carrying
 * two years of revenue.
 */
export const findClientMatches = defineEndpoint({
  method: "GET",
  path: "/client-profitability/client-matches",
  query: z.object({ name: z.string(), email: z.string().optional() }),
  response: z.object({
    matches: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        email: z.string().nullable(),
        /** exact_* may be reused automatically; `similar` needs a human. */
        strength: z.enum(["exact_email", "exact_name", "similar"]),
        reason: z.string(),
        lifetimeRevenueCents: moneyCents,
        orderCount: z.number().int(),
        alreadyAClient: z.boolean(),
      }),
    ),
  }),
});

export const engagementBody = z.object({
  engagementStatus: engagementStatus.optional(),
  agreedAmountCents: moneyCents.nullish(),
  agreedAmountPeriod: agreedPeriod.optional(),
  agreedHours: z.string().nullish(),
  agreedHoursPeriod: agreedPeriod.optional(),
  currency: z.string().length(3).optional(),
  startDate: z.string().nullish(),
  endDate: z.string().nullish(),
  notes: z.string().max(2000).nullish(),
});

export const createClient = defineEndpoint({
  method: "POST",
  path: "/client-profitability/clients",
  body: z.object({
    /** Ignored when personId is given. */
    name: z.string().max(255).optional(),
    email: z.string().max(255).nullish(),
    /** Reuses a record the owner picked from the match list. */
    personId: z.string().nullish(),
    engagement: engagementBody.optional(),
  }),
  response: client,
});

export const updateClientEngagement = defineEndpoint({
  method: "PATCH",
  path: "/client-profitability/clients/:engagementId",
  params: z.object({ engagementId: z.string() }),
  body: engagementBody,
  response: client,
});

// ---------------------------------------------------------------------------
// Timesheet — the weekly grid
// ---------------------------------------------------------------------------

/** The same list expense lines target — one definition, in ./shared. */
export const timeTargetType = splitTargetType;
export const workType = z.enum(["delivery", "rework", "build", "maintenance", "pitching", "admin"]);

export const timeTarget = z.object({
  targetType: timeTargetType,
  targetId: z.string(),
  label: z.string(),
  /** Picker grouping: "Clients", "What you sell", "Internal". */
  group: z.string(),
});

/** One person, one target, one day. A missing cell means no hours — not zero. */
export const timesheetCell = z.object({
  personId: z.string(),
  targetType: timeTargetType,
  targetId: z.string(),
  entryDate: z.string(),
  hours: z.string(),
  isEstimated: z.boolean(),
  workType,
  billable: z.boolean(),
});

/**
 * Whether a person's day looks half-filled. Returned ALONGSIDE a successful
 * save, never instead of it — the save has already happened, and nothing here
 * fills the missing hours in.
 */
export const dayCheck = z.object({
  entryDate: z.string(),
  isShort: z.boolean(),
  loggedHours: z.string(),
  expectedHours: z.string(),
  missingHours: z.string(),
});

export const getTimesheet = defineEndpoint({
  method: "GET",
  path: "/client-profitability/timesheet",
  query: z.object({ weekStart: z.string().optional() }),
  response: z.object({
    weekStart: z.string(),
    days: z.array(z.string()),
    expectedDailyHours: z.string(),
    members: z.array(z.object({ id: z.string(), name: z.string(), roleLabel: z.string().nullable() })),
    /** Everything time COULD be logged against — the picker's list. */
    targets: z.array(timeTarget),
    /** The rows already in play this week; the owner adds more from the picker. */
    rows: z.array(
      z.object({
        personId: z.string(),
        targetType: timeTargetType,
        targetId: z.string(),
        label: z.string(),
      }),
    ),
    cells: z.array(timesheetCell),
  }),
});

/**
 * Writes one cell. Sending empty hours removes the entry, because a cleared
 * cell means no hours rather than a zero-hour entry.
 */
export const setTimesheetCell = defineEndpoint({
  method: "POST",
  path: "/client-profitability/timesheet/cell",
  body: z.object({
    personId: z.string(),
    targetType: timeTargetType,
    targetId: z.string(),
    entryDate: z.string(),
    hours: z.string(),
    workType: workType.optional(),
    billable: z.boolean().optional(),
    isEstimated: z.boolean().optional(),
    note: z.string().max(500).nullish(),
  }),
  response: z.object({
    /** Null when the cell was cleared. */
    saved: timesheetCell.nullable(),
    dayCheck,
  }),
});

/** Removes a whole row for the week — every day of that person/target. */
export const clearTimesheetRow = defineEndpoint({
  method: "POST",
  path: "/client-profitability/timesheet/clear-row",
  body: z.object({
    personId: z.string(),
    targetType: timeTargetType,
    targetId: z.string(),
    weekStart: z.string(),
  }),
  response: z.object({ ok: z.boolean() }),
});

// ---------------------------------------------------------------------------
// CSV import — hours from Toggl, Clockify, or a spreadsheet
// ---------------------------------------------------------------------------

export const importPreset = z.enum(["toggl", "clockify", "custom"]);

/** Which column holds what. Header NAMES, so a reordered export still works. */
export const importColumnMapping = z.object({
  person: z.string().optional(),
  target: z.string().optional(),
  date: z.string().optional(),
  duration: z.string().optional(),
  description: z.string().optional(),
  billable: z.string().optional(),
  workType: z.string().optional(),
});

/**
 * The import request. The FILE is the input, every time — including on commit.
 *
 * Commit re-parses and re-costs from the same text rather than accepting rows
 * the preview produced, because hours become money the moment they land and a
 * list that travelled through a browser is not evidence of anything.
 */
export const timeImportBody = z.object({
  csv: z.string().max(2_000_000),
  mapping: importColumnMapping.optional(),
  /** Name in the file → team member id, for names the owner placed by hand. */
  personMap: z.record(z.string(), z.string()).optional(),
  /** Name in the file → "targetType:targetId", likewise. */
  targetMap: z.record(z.string(), z.string()).optional(),
});

/** What will happen to one cell of the grid if this import goes ahead. */
export const importPreviewEntry = z.object({
  /** Which lines of the file fed this cell — several, when a day had several timers. */
  lineNumbers: z.array(z.number().int()),
  personName: z.string(),
  targetName: z.string(),
  personId: z.string().nullable(),
  targetType: timeTargetType.nullable(),
  targetId: z.string().nullable(),
  entryDate: z.string(),
  hours: z.string(),
  workType,
  billable: z.boolean(),
  /** Null when the row can't be costed — never a zero standing in for unknown. */
  costAmountCents: moneyCents.nullable(),
  outcome: z.enum(["new", "update", "unchanged", "conflict", "blocked"]),
  issue: z.string().nullable(),
});

/** A name in the file that matches nothing, with whoever came closest. */
export const importUnmatchedName = z.object({
  name: z.string(),
  rowCount: z.number().int(),
  hours: z.string(),
  suggestions: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      reason: z.string(),
      targetType: timeTargetType.optional(),
    }),
  ),
});

/**
 * Shows exactly what an import would do, and writes nothing.
 *
 * This is the whole safety story of the phase: an unmatched name is REPORTED,
 * never guessed at. Four hours filed against the wrong client is worse than
 * four hours not imported, because nobody ever finds it afterwards.
 */
export const previewTimeImport = defineEndpoint({
  method: "POST",
  path: "/client-profitability/time-import/preview",
  body: timeImportBody,
  response: z.object({
    preset: importPreset,
    /** The file's own headers, so the owner can map an unrecognised export. */
    headers: z.array(z.string()),
    mapping: importColumnMapping,
    entries: z.array(importPreviewEntry),
    /** Rows that couldn't be read at all, with the line number and why. */
    problems: z.array(z.object({ lineNumber: z.number().int(), reason: z.string() })),
    unmatchedPeople: z.array(importUnmatchedName),
    unmatchedTargets: z.array(importUnmatchedName),
    totals: z.object({
      new: z.number().int(),
      update: z.number().int(),
      unchanged: z.number().int(),
      conflict: z.number().int(),
      blocked: z.number().int(),
    }),
    /** False while anything is unmatched or blocked. Commit refuses too. */
    canCommit: z.boolean(),
  }),
});

/**
 * Writes the import, or refuses the whole thing.
 *
 * All-or-nothing while names are unmatched, deliberately: importing "the rest
 * of it" would leave the owner believing a week is complete when someone's
 * hours are missing, and a quietly incomplete timesheet understates cost on
 * every client that person touched.
 */
export const commitTimeImport = defineEndpoint({
  method: "POST",
  path: "/client-profitability/time-import/commit",
  body: timeImportBody,
  response: z.object({
    added: z.number().int(),
    /** Days already imported whose hours changed — restated, never duplicated. */
    updated: z.number().int(),
    /** Days already imported and identical. The re-import case: nothing happens. */
    unchanged: z.number().int(),
    /** Estimated days the real hours replaced. A guess never survives a fact. */
    estimatesReplaced: z.number().int(),
    /** Cells left alone because hours were typed there by hand. */
    skippedConflicts: z.number().int(),
    unreadableRows: z.number().int(),
  }),
});

// ---------------------------------------------------------------------------
// Estimated hours — a rough figure, honestly labelled
// ---------------------------------------------------------------------------

/**
 * "Sara spent roughly 80 hours on Acme in July."
 *
 * The alternative to this is not a better number, it is NO number: a business
 * that will not fill a timesheet gets nothing at all from the profitability
 * screen. Every hour written this way carries `is_estimated`, and that flag has
 * to survive to the screen — an estimate that reads like a logged figure would
 * be trusted exactly as much as a real one, which is the whole danger.
 */
export const estimateBody = z.object({
  personId: z.string(),
  targetType: timeTargetType,
  targetId: z.string(),
  /** Inclusive, YYYY-MM-DD. */
  periodStart: z.string(),
  periodEnd: z.string(),
  /** Decimal string — the TOTAL for the stretch, not a daily figure. */
  hours: z.string(),
  workType: workType.optional(),
  billable: z.boolean().optional(),
});

/** Shows what an estimate would do, and writes nothing. */
export const previewEstimate = defineEndpoint({
  method: "POST",
  path: "/client-profitability/estimates/preview",
  body: estimateBody,
  response: z.object({
    personName: z.string(),
    targetLabel: z.string(),
    workingDays: z.number().int(),
    /** How many days will carry hours — fewer than `workingDays` for tiny totals. */
    dayCount: z.number().int(),
    hoursPerDay: z.string(),
    totalHours: z.string(),
    /** Null when a day has no pay rate. Never a zero standing in for unknown. */
    totalCostCents: moneyCents.nullable(),
    /** Hours in an existing estimate this would replace. Replaced, never stacked. */
    replacesHours: z.string(),
    /** Hours actually logged in the stretch. Anything above zero blocks it. */
    loggedHours: z.string(),
    sentence: z.string(),
    note: z.string(),
    /** Non-null means this cannot be saved, and says why in plain English. */
    blockedReason: z.string().nullable(),
  }),
});

/**
 * Writes the estimate. Replaces any previous estimate for the same stretch, and
 * refuses outright if real hours were logged there — guessing on top of facts
 * would double them, and nothing on screen would say so.
 */
export const setTargetEstimate = defineEndpoint({
  method: "POST",
  path: "/client-profitability/estimates",
  body: estimateBody,
  response: z.object({
    daysWritten: z.number().int(),
    daysReplaced: z.number().int(),
    totalHours: z.string(),
    totalCostCents: moneyCents,
    sentence: z.string(),
  }),
});

/** Removes an estimate. Only ever deletes estimated rows, never logged ones. */
export const clearTargetEstimate = defineEndpoint({
  method: "POST",
  path: "/client-profitability/estimates/clear",
  body: estimateBody.omit({ hours: true, workType: true, billable: true }),
  response: z.object({ removed: z.number().int(), hours: z.string() }),
});

/** Estimates grouped back into the stretches they were entered as. */
export const listTargetEstimates = defineEndpoint({
  method: "GET",
  path: "/client-profitability/estimates",
  query: z.object({ startDate: z.string().optional(), endDate: z.string().optional() }),
  response: z.object({
    estimates: z.array(
      z.object({
        personId: z.string(),
        personName: z.string(),
        targetType: timeTargetType,
        targetId: z.string(),
        targetLabel: z.string(),
        firstDate: z.string(),
        lastDate: z.string(),
        dayCount: z.number().int(),
        hours: z.string(),
        costCents: moneyCents,
      }),
    ),
  }),
});

// ---------------------------------------------------------------------------
// Client profitability — the answer
// ---------------------------------------------------------------------------

/**
 * One target's profitability for a period.
 *
 * EVERY labour-derived field is nullable, and null means ABSENT — never zero.
 * A client with revenue and no hours logged would otherwise compute to full
 * revenue at 100% margin, which is the most flattering possible lie about the
 * client most likely to be losing money. A blank sends the owner looking; a
 * confident wrong number stops them looking.
 */
export const targetProfit = z.object({
  targetType: timeTargetType,
  targetId: z.string(),
  label: z.string(),
  revenueCents: moneyCents,
  directCostCents: moneyCents,
  hoursLogged: z.string(),
  hasEstimates: z.boolean(),
  /** False when no hours exist — then every field below is null. */
  isCosted: z.boolean(),
  labourCostCents: moneyCents.nullable(),
  /** PRIMARY: revenue − labour − direct costs. */
  contributionCents: moneyCents.nullable(),
  marginPct: z.number().nullable(),
  /** SECONDARY: an allocation. Never called profit, never summed into the ladder. */
  afterOverheadCents: moneyCents.nullable(),
  /** What they really pay per hour of your time. */
  effectiveHourlyRateCents: moneyCents.nullable(),
});


/**
 * Three things the hours reveal that a profit figure alone does not.
 *
 * Each returns null rather than zero when its inputs are missing, for the same
 * reason profit does: an invented figure stops the owner looking, and these are
 * exactly the numbers worth looking at.
 */
export const scopeCreepRow = z.object({
  targetId: z.string(),
  label: z.string(),
  /** Agreed hours RESTATED for the window on screen. Scaled when quoted monthly. */
  agreedHours: z.string().nullable(),
  /** What the owner actually typed, unscaled — so the screen can show both. */
  agreedHoursPerPeriod: z.string().nullable(),
  agreedHoursPeriod: agreedPeriod,
  /** How many months the window is worth. Null when the window is unbounded. */
  periodMonths: z.string().nullable(),
  actualHours: z.string(),
  /** Hours beyond what was agreed. Negative means still under. */
  overHours: z.string().nullable(),
  overPct: z.number().nullable(),
  /**
   * What they believe they're paying: agreed amount ÷ agreed hours. Computed
   * from the RAW pair, so it does not move when the date filter does.
   */
  agreedHourlyRateCents: moneyCents.nullable(),
  /** Why there is no hourly price, when there isn't one. Never a zero instead. */
  rateReason: z.enum(["ok", "no_amount", "no_hours", "needs_dates"]),
  /** What you're actually earning: revenue ÷ actual hours. */
  effectiveHourlyRateCents: moneyCents.nullable(),
  rateGapCents: moneyCents.nullable(),
  isOver: z.boolean(),
  /** So a finished client's overrun reads "was over", not "is over". */
  engagementStatus,
});

export const utilizationShape = z.object({
  billableHours: z.string(),
  totalHours: z.string(),
  nonBillableHours: z.string(),
  /** Null when nothing was logged — 0% would be a different, worse claim. */
  pct: z.number().nullable(),
});

export const workTypeSlice = z.object({
  workType,
  hours: z.string(),
  sharePct: z.number(),
});

export const getClientProfitability = defineEndpoint({
  method: "GET",
  path: "/client-profitability/profitability",
  query: z.object({
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    basis: accountingBasis.optional(),
  }),
  response: z.object({
    basis: accountingBasis,
    rows: z.array(targetProfit),
    summary: z.object({
      state: z.enum(["no_hours", "partial", "complete"]),
      costedCount: z.number().int(),
      uncostedCount: z.number().int(),
      /** Targets earning money with no hours — the ones that would have lied. */
      uncostedWithRevenueCount: z.number().int(),
      /** Totals over COSTED targets only. Null when nothing is costed. */
      costedRevenueCents: moneyCents.nullable(),
      costedLabourCents: moneyCents.nullable(),
      costedDirectCents: moneyCents.nullable(),
      costedContributionCents: moneyCents.nullable(),
      costedMarginPct: z.number().nullable(),
      /** Revenue on uncosted targets — reported apart, never blended in. */
      uncostedRevenueCents: moneyCents,
      hasEstimates: z.boolean(),
    }),
    /** Revenue naming no customer — outside the client lens, reported so it is never lost. */
    unattributedRevenueCents: moneyCents,
    /**
     * What every cost in the period did with itself — the three buckets sum to
     * the P&L's period expenses exactly, and the server refuses to answer if
     * they do not.
     *
     * `directCostCents` on a row stays a plain number rather than going
     * nullable, because unlike labour a direct cost of zero is very often TRUE:
     * a client with no subcontractor and no bought-in software really does cost
     * nothing beyond the hours. Nulling per client would suppress a correct
     * figure for the majority to hedge against a minority. The question is
     * asked once of the PERIOD instead — `fullyAttributed`.
     */
    costAttribution: z.object({
      /** Reached a client, an offer, or an internal bucket. */
      targetedCents: moneyCents,
      /** Could have named a target and did not. The only bucket that clearing drives to zero. */
      untargetedSplittableCents: moneyCents,
      /** Fixed overheads and unpointable fees — outside the client view by design, not by omission. */
      neverSplitCents: moneyCents,
      /**
       * True when nothing splittable is unassigned. THEN a zero cost to serve
       * means zero. False means contribution excludes `untargetedSplittableCents`
       * and the page must say so.
       */
      fullyAttributed: z.boolean(),
    }),
    /** Clients past the hours they agreed to, worst first. */
    scopeCreep: z.array(scopeCreepRow),
    /** Billable share, for the business and per person. */
    utilization: z.object({
      overall: utilizationShape,
      byMember: z.array(utilizationShape.extend({ personId: z.string(), name: z.string() })),
    }),
    /** How much of the book rests on one client. */
    concentration: z.object({
      slices: z.array(z.object({ label: z.string(), revenueCents: moneyCents, sharePct: z.number() })),
      totalRevenueCents: moneyCents,
      topSharePct: z.number().nullable(),
      topLabel: z.string().nullable(),
      risk: z.enum(["none", "watch", "high"]).nullable(),
    }),
    /** Where the hours went — rework stands alone, never inside delivery. */
    workTypes: z.array(workTypeSlice),
    reworkByClient: z.array(z.object({ targetId: z.string(), label: z.string(), hours: z.string(), sharePct: z.number() })),
    /** Does the time sheet account for the wage bill? A signal, not an error. */
    coverage: z.object({
      pct: z.number().nullable(),
      attributedCents: moneyCents,
      payrollCents: moneyCents,
      reason: z.enum(["ok", "no_payroll", "no_hours"]),
      direction: z.enum(["under", "over", "matched"]).nullable(),
    }),
  }),
});
