/**
 * Which agreement applies to the period being looked at.
 *
 * A client can hold one live arrangement and any number of finished ones — a
 * project, then a retainer, is the normal agency path. So "what did we agree
 * with Acme" is not a question with one answer; it is a question about a
 * window.
 *
 * The report used to answer it by taking the ACTIVE engagement and nothing
 * else, which had a consequence nobody intended: marking a client Finished
 * erased their scope-creep record. The overrun really happened, their hours and
 * revenue still counted in every other figure, but "you went 47% over on Acme"
 * vanished from the report the moment the owner marked them done — which is
 * exactly when they would sit down to review it.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Stand-ins for "no date given", which means open at that end. Only ever used
 * to RANK candidates by overlap — neither ever reaches a figure on screen.
 */
const DAWN = "0001-01-01";
const DUSK = "9999-12-31";

const clean = (iso: string | null | undefined, fallback: string) =>
  iso && ISO_DATE.test(iso) ? iso : fallback;

/** Days between two ISO dates, inclusive. Dates compare as strings, so no parsing. */
function overlapDays(aFrom: string, aTo: string, bFrom: string, bTo: string): number {
  const from = aFrom > bFrom ? aFrom : bFrom;
  const to = aTo < bTo ? aTo : bTo;
  if (from > to) return 0;
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Number.isNaN(ms) ? 0 : ms / 86_400_000 + 1;
}

/**
 * The minimum an engagement must expose to be picked. Deliberately structural
 * rather than the database's row type, so no Drizzle type crosses into the
 * domain — but loose enough that a row can be passed straight in.
 */
export interface EngagementCandidate {
  id: string;
  engagementStatus: string;
  startDate: string | null;
  endDate: string | null;
  /** Only ever used to break a tie. A Date or an ISO string; both compare fine. */
  createdAt: string | Date;
}

/** Timestamps arrive as Dates from the database and strings from a test. */
const stamp = (value: string | Date): string => (typeof value === "string" ? value : value.toISOString());

/**
 * Picks the engagement that best describes a window, or null if none does.
 *
 * The rule, in order:
 *
 *   1. It has to OVERLAP the window. An engagement with no dates is open at
 *      both ends, so it always overlaps — which is the common case, because the
 *      dialog never sets dates, and it is what fixes the vanishing bug: a
 *      finished, undated engagement is now always found.
 *   2. Most overlap wins. An arrangement covering the whole quarter describes
 *      it better than one covering a fortnight of it.
 *   3. Then the live one, then the later start, then the later creation, then
 *      the id. That last step is not decoration — without a total order the
 *      answer depends on the order Postgres happened to return rows in, and the
 *      same report would give different numbers on different days.
 *
 * Nothing overlapping returns NULL, and the caller drops the row rather than
 * showing a figure: measuring July's hours against an agreement that ended in
 * March is a comparison the owner never made.
 *
 * KNOWN LIMIT, deliberate: a client with two undated finished engagements in
 * one window gets one of them by tiebreak. Splitting a period's hours across
 * several agreements by date is a different feature, and pretending this does
 * it would be worse than not doing it.
 */
export function selectEngagementForPeriod<T extends EngagementCandidate>(
  engagements: readonly T[],
  windowStart?: string | null,
  windowEnd?: string | null,
): T | null {
  if (engagements.length === 0) return null;

  const from = clean(windowStart, DAWN);
  const to = clean(windowEnd, DUSK);

  const scored = engagements
    .map((engagement) => ({
      engagement,
      days: overlapDays(clean(engagement.startDate, DAWN), clean(engagement.endDate, DUSK), from, to),
    }))
    .filter((row) => row.days > 0);

  if (scored.length === 0) return null;

  scored.sort((a, b) => {
    if (a.days !== b.days) return b.days - a.days;

    const liveA = a.engagement.engagementStatus === "active" ? 0 : 1;
    const liveB = b.engagement.engagementStatus === "active" ? 0 : 1;
    if (liveA !== liveB) return liveA - liveB;

    const startA = a.engagement.startDate ?? "";
    const startB = b.engagement.startDate ?? "";
    if (startA !== startB) return startB.localeCompare(startA);

    const madeA = stamp(a.engagement.createdAt);
    const madeB = stamp(b.engagement.createdAt);
    if (madeA !== madeB) return madeB.localeCompare(madeA);
    // The last resort, so the answer can never depend on row order.
    return a.engagement.id.localeCompare(b.engagement.id);
  });

  return scored[0].engagement;
}
