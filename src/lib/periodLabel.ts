/**
 * The selected window, written out beside the page title.
 *
 * "This Year" is the name of a preset, not a fact — two people reading the same
 * screen in different months are looking at different windows, and the number
 * under the title only means something once the window is stated. So the header
 * says both: the preset in the filter, the actual dates beside the heading.
 *
 * It is derived from the live range, never typed: change the filter and this
 * changes with it. The repeated year is dropped (a range inside one year says
 * the year once, at the end) because the reader is scanning a date, not
 * parsing two of them.
 */

const MONTH_DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const MONTH_DAY_YEAR = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

function sameCalendarDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * `Sep 24, 2026` · `Jul 1 to Sep 24, 2026` · `Dec 1, 2025 to Sep 24, 2026`.
 *
 * Returns null for a range it cannot read, so the header renders nothing rather
 * than the word "Invalid Date" next to the money (DESIGN.md §9 — no screen
 * shows a figure it does not have).
 */
export function formatRangeLabel(start: Date, end: Date): string | null {
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;

  // A one-day window is a date, not a range. "Sep 24 to Sep 24" reads as a
  // formatting bug, which is what "Today" looked like before this.
  if (sameCalendarDay(start, end)) return MONTH_DAY_YEAR.format(start);

  const sameYear = start.getFullYear() === end.getFullYear();
  return `${sameYear ? MONTH_DAY.format(start) : MONTH_DAY_YEAR.format(start)} to ${MONTH_DAY_YEAR.format(end)}`;
}
