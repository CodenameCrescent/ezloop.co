/**
 * Calendar days and instants, in somebody's own time zone.
 *
 * A date written in a spreadsheet is a CALENDAR DAY — "the 20th" — not an
 * instant. The ledger stores instants. Turning one into the other needs a zone,
 * and picking the wrong one moves money to a different day.
 *
 * The importer used to pick UTC. Every window in the app is built from the
 * reader's LOCAL day, so west of Greenwich a row imported "today" landed before
 * today began and the ledger read empty; east of Greenwich the same conversion
 * pushes a row onto the previous day, which is worse, because it lands in a
 * month that may already have been reported on.
 *
 * `Intl` is a language built-in rather than an import, so this stays inside the
 * purity rule (`purity.test.ts` reads imports) and needs no dependency.
 *
 * Unknown or malformed zones fall back to UTC rather than throwing. An import
 * that refuses a whole file because a browser sent an unfamiliar zone name would
 * trade a wrong day for no data at all.
 */

const UTC = "UTC";

function partsIn(instant: Date, timeZone: string): Record<string, number> | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(instant);
    const out: Record<string, number> = {};
    for (const part of parts) {
      if (part.type !== "literal") out[part.type] = Number(part.value);
    }
    // `hour12: false` emits hour 24 for midnight on some engines. Left as 24 it
    // would read as the next day and put the offset out by a whole day.
    if (out.hour === 24) out.hour = 0;
    return Number.isFinite(out.year) ? out : null;
  } catch {
    return null;
  }
}

/** Milliseconds a zone is ahead of UTC at a given instant. DST-aware. */
function offsetMsAt(instant: Date, timeZone: string): number {
  const parts = partsIn(instant, timeZone);
  if (!parts) return 0;
  const wallAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return wallAsUtc - instant.getTime();
}

/**
 * The instant at which a calendar day BEGINS in a zone.
 *
 * `isoDay` is `YYYY-MM-DD`. An unparseable day gives an Invalid Date, matching
 * what `new Date("...")` already did at every call site, so existing guards on
 * `Number.isNaN(d.getTime())` keep working.
 *
 * The offset is applied twice on purpose. The first guess uses the offset at
 * the UTC instant of that day, which is the wrong side of a DST change when the
 * change falls near midnight; re-reading the offset at the corrected instant
 * settles it. Where midnight does not exist at all (a zone that springs forward
 * AT midnight) the result is the first instant that does, which is still inside
 * the day the owner meant.
 */
export function zonedDayStart(isoDay: string, timeZone: string = UTC): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDay);
  if (!match) return new Date(NaN);
  const [, y, m, d] = match;
  const utcGuess = Date.UTC(Number(y), Number(m) - 1, Number(d));
  const firstPass = new Date(utcGuess - offsetMsAt(new Date(utcGuess), timeZone));
  return new Date(utcGuess - offsetMsAt(firstPass, timeZone));
}

/** The last millisecond of a calendar day in a zone. */
export function zonedDayEnd(isoDay: string, timeZone: string = UTC): Date {
  const start = zonedDayStart(isoDay, timeZone);
  if (Number.isNaN(start.getTime())) return start;
  // Built from the NEXT day's start rather than by adding 24 hours, so a day
  // that is 23 or 25 hours long across a DST change still ends where it ends.
  const nextUtc = new Date(start.getTime() + 36 * 60 * 60 * 1000);
  const nextDay = calendarDayIn(nextUtc, timeZone);
  const nextStart = zonedDayStart(nextDay, timeZone);
  return new Date(nextStart.getTime() - 1);
}

/** Which calendar day an instant falls on, in a zone. `YYYY-MM-DD`. */
export function calendarDayIn(instant: Date, timeZone: string = UTC): string {
  if (Number.isNaN(instant.getTime())) return "";
  const parts = partsIn(instant, timeZone);
  if (!parts) return instant.toISOString().slice(0, 10);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${String(parts.year).padStart(4, "0")}-${pad(parts.month)}-${pad(parts.day)}`;
}
