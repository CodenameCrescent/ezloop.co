import { SelectItem } from "@/components/ui/select";
import { todayInputValue } from "@/lib/period";

/**
 * "Roughly 80 hours on Acme in July."
 *
 * For the business that will not fill a timesheet this month. Without this they
 * get NO profit figure for any client, and "we can't tell you" helps nobody —
 * a rough number that is visibly labelled rough is more useful and just as
 * honest. In practice it is usually the step before logging properly.
 *
 * The screen's job is to keep the "rough" visible. It says what will be written
 * before writing it, it marks the result as an estimate wherever it appears,
 * and it refuses outright rather than piling a guess on top of hours somebody
 * actually logged.
 */

/**
 * The month containing `today`, as the two dates the endpoint wants — ending
 * TODAY when the month is still running. Offering the whole of a month that has
 * not finished invites an estimate covering days nobody has worked yet, which
 * would put labour cost against work that has not happened.
 */
export function monthOf(today: Date) {
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth();
  const monthEnd = new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10);
  const todayValue = todayInputValue(today);
  return {
    start: new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10),
    end: monthEnd > todayValue ? todayValue : monthEnd,
  };
}

export function monthLabel(iso: string) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** A labelled block inside the target picker: Clients, What you sell, Internal. */
export function SelectGroupBlock({
  group,
  items,
}: {
  group: string;
  items: Array<{ targetType: string; targetId: string; label: string }>;
}) {
  return (
    <>
      <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {group}
      </div>
      {items.map((t) => (
        <SelectItem key={`${t.targetType}:${t.targetId}`} value={`${t.targetType}:${t.targetId}`}>
          {t.label}
        </SelectItem>
      ))}
    </>
  );
}
