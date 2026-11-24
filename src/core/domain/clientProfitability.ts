/**
 * Client profitability — the vocabulary shared by the server and the UI.
 *
 * A service business has no unit cost. Its real cost is people's time, and
 * salaries arrive as one lump, so it cannot answer the question that decides
 * the business: which client, product or subscription is actually worth having.
 * This module names the pieces that answer it.
 *
 * ── The rule everything here depends on ─────────────────────────────────────
 *
 * Attributed labour is a DISTRIBUTION of payroll the ledger has already
 * counted, never a second cost. Salaries are period expenses in the ledger the
 * moment they are entered; time entries only say WHICH target absorbed them.
 *
 * So nothing computed from these types may be added to the profit ladder, and
 * no total here may be reconciled against true profit as though they should
 * agree. See docs/client-profitability-spec.md.
 */

// ---------------------------------------------------------------------------
// What can absorb labour cost
// ---------------------------------------------------------------------------

/**
 * Time points at one of four things. It is deliberately NOT clients-only: an
 * agency that writes a book or builds its own SaaS spends real labour on it,
 * and if that time could only land on a client it would land in Internal
 * instead — leaving the product showing revenue with no labour cost, which is
 * a fake margin. This is the module's most important structural decision, and
 * `project` is the same argument again: hours on a site that could only be
 * booked to the client would leave every site looking equally expensive.
 */
export const TIME_TARGET_TYPES = ["client", "revenue_item", "internal", "project"] as const;
export type TimeTargetType = (typeof TIME_TARGET_TYPES)[number];

export function isTimeTargetType(value: unknown): value is TimeTargetType {
  return typeof value === "string" && (TIME_TARGET_TYPES as readonly string[]).includes(value);
}

export const TIME_TARGET_LABELS: Record<TimeTargetType, string> = {
  client: "Client",
  revenue_item: "Something you sell",
  internal: "Internal",
  // Deliberately generic: the trade's own word for it comes from
  // `projectLabel(businessType)` in capabilities.ts, which this module cannot
  // reach without knowing the business.
  project: "Project",
};

/**
 * What the hours were spent doing. Not decoration:
 * - `rework` is the leading indicator of a bad client — someone who cannot
 *   settle on a brief — and it is invisible inside a plain hours total.
 * - `build` vs `maintenance` separates investment from running cost: 60 hours
 *   writing a book earns for years, 3 hours a month keeping a SaaS alive is an
 *   ongoing drag. Both have to be reportable separately.
 */
export const WORK_TYPES = ["delivery", "rework", "build", "maintenance", "pitching", "admin"] as const;
export type WorkType = (typeof WORK_TYPES)[number];

export function isWorkType(value: unknown): value is WorkType {
  return typeof value === "string" && (WORK_TYPES as readonly string[]).includes(value);
}

export const WORK_TYPE_LABELS: Record<WorkType, string> = {
  delivery: "Doing the work",
  rework: "Redoing the work",
  build: "Building something new",
  maintenance: "Keeping it running",
  pitching: "Winning work",
  admin: "Running the business",
};

// ---------------------------------------------------------------------------
// Team members
// ---------------------------------------------------------------------------

/** How someone is paid. `hourly`/`contractor` skip the monthly-to-hourly division. */
export const TEAM_COST_TYPES = ["salaried", "hourly", "contractor"] as const;
export type TeamCostType = (typeof TEAM_COST_TYPES)[number];

export function isTeamCostType(value: unknown): value is TeamCostType {
  return typeof value === "string" && (TEAM_COST_TYPES as readonly string[]).includes(value);
}

export const TEAM_COST_TYPE_LABELS: Record<TeamCostType, string> = {
  salaried: "On a salary",
  hourly: "Paid by the hour",
  contractor: "Contractor",
};

/**
 * Billable hours a month, the divisor turning a salary into an hourly cost.
 *
 * 130, not 160. A full month of working hours assumes every hour is billable,
 * which nobody achieves — and the flattering hourly cost that falls out makes
 * every client look more profitable than they are. The form shows the derived
 * cost live as this is edited so the trade-off is visible rather than buried.
 */
export const DEFAULT_BILLABLE_TARGET_HOURS = "130";

// ---------------------------------------------------------------------------
// Client engagements
// ---------------------------------------------------------------------------

/**
 * Where the relationship stands. A lifecycle flag, NOT a pipeline: three
 * values, no stage transitions, no workflow. This module is not a CRM.
 *
 * Distinct from `people.status`, which is identity-level (archived hides
 * someone from pickers). A churned client is still an active person.
 */
export const ENGAGEMENT_STATUSES = ["active", "completed", "churned"] as const;
export type EngagementStatus = (typeof ENGAGEMENT_STATUSES)[number];

export function isEngagementStatus(value: unknown): value is EngagementStatus {
  return typeof value === "string" && (ENGAGEMENT_STATUSES as readonly string[]).includes(value);
}

export const ENGAGEMENT_STATUS_LABELS: Record<EngagementStatus, string> = {
  active: "Working with them",
  completed: "Finished",
  churned: "Left",
};

/**
 * WHAT STATUS DOES NOT DO: filter a report.
 *
 * Every client appears in every period they have revenue or hours in, whatever
 * their status. A finished client's overrun really happened, and both
 * reconciliation guards require their money and their hours to stay in the
 * lens — excluding them would make client-lens revenue short by exactly their
 * revenue and the report would refuse to serve at all.
 *
 * Status decides what can be WRITTEN (only a live client can take new hours),
 * never what can be read. See lib/domain/src/engagementSelection.ts.
 */

// ---------------------------------------------------------------------------
// Time entry provenance
// ---------------------------------------------------------------------------

/**
 * Where an hour came from, and the order they rank in: typed hours outrank an
 * import, an import outranks an estimate (real hours beat a guess and replace
 * it), and an estimate is only ever replaced. `estimate` was added in Phase 8
 * and this list was missed at the time — it must stay in step with
 * `timeEntrySourceValues` in the database schema.
 */
export const TIME_ENTRY_SOURCES = ["manual", "csv_import", "estimate"] as const;
export type TimeEntrySource = (typeof TIME_ENTRY_SOURCES)[number];

export function isTimeEntrySource(value: unknown): value is TimeEntrySource {
  return typeof value === "string" && (TIME_ENTRY_SOURCES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Internal time categories
// ---------------------------------------------------------------------------

/**
 * Seeded per business, user-editable afterwards. Splitting internal time into
 * buckets is the whole point: "we lost 73 hours" is useless, "we spent 40 hours
 * pitching and won nothing" is something an owner can act on.
 *
 * These are ordinary rows in the existing category tree, tagged `time` so they
 * stay out of the revenue and expense pickers — not a third category system.
 */
export const INTERNAL_TIME_CATEGORIES = [
  "Admin",
  "Sales & pitching",
  "Own marketing",
  "Training",
  "Rework (unattributed)",
] as const;

// ---------------------------------------------------------------------------
// Hours
// ---------------------------------------------------------------------------

/** A day nobody can exceed. Hours above this are a typo, not a long shift. */
export const MAX_HOURS_PER_ENTRY = 24;

/**
 * Hours travel as decimal strings and are computed with decimal.js, exactly
 * like transaction quantities — floats are banned from anything that ends up
 * multiplied by money (CLAUDE.md).
 */
export function isValidHours(hours: unknown): hours is string {
  if (typeof hours !== "string" || !/^\d+(\.\d+)?$/.test(hours)) return false;
  const value = Number(hours);
  return value > 0 && value <= MAX_HOURS_PER_ENTRY;
}

/**
 * Is what somebody has typed SO FAR still on its way to a valid entry?
 *
 * `isValidHours` judges a finished value; the grid needs a verdict on every
 * keystroke, and shouting at a half-typed number would make the warning
 * worthless. "7" and "7." are both fine on the way to "7.25", and an empty box
 * means "no hours" rather than a mistake.
 *
 * What it does reject is text that no further keystroke can rescue — a currency
 * symbol, a minus sign, a second decimal point — and anything already past a
 * full day, since typing more only takes it further away.
 */
export function isPartialHoursEntry(value: string): boolean {
  if (value === "") return true;
  if (!/^\d*(\.\d*)?$/.test(value)) return false;
  if (value === ".") return true;
  return Number(value) <= MAX_HOURS_PER_ENTRY;
}

/**
 * What a half-typed cell contributes to a running total.
 *
 * The grid totals what is on screen AS YOU TYPE, and decimal.js throws on
 * anything it cannot parse — which is how a currency symbol in an hours box
 * took down the entire page rather than warning about one cell. Nothing drawn
 * on screen may be able to do that, so a value that is not yet a number counts
 * as nothing until it becomes one. The warning comes from
 * `isPartialHoursEntry`; this one only keeps the arithmetic alive.
 */
/**
 * What is wrong with a TOTAL number of hours for a stretch of time, if anything.
 *
 * Deliberately not `isValidHours`: that judges one day's cell and caps at 24,
 * while "roughly 80 hours in July" is an ordinary estimate that must not trip
 * the same rule. How many hours a day the total works out to is the server's
 * business — it refuses a spread nobody could have worked, and says why.
 *
 * An empty box is not a mistake; it is a box nobody has filled in yet.
 */
export type HoursTotalProblem = "not_a_number" | "not_positive" | null;

export function checkHoursTotal(value: string): HoursTotalProblem {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^\d*\.?\d*$/.test(trimmed) || trimmed === ".") return "not_a_number";
  return Number(trimmed) > 0 ? null : "not_positive";
}

export function hoursForTotal(value: string): string {
  // Exactly the shapes decimal.js accepts as a plain decimal: digits around at
  // most one point, with at least one digit present.
  return /^\d+\.?\d*$|^\.\d+$/.test(value) ? value : "0";
}
