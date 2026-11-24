import { cn } from "@/lib/utils";
import { moneyMark } from "@/lib/chartTone";
import { useChartFrameGuard } from "./ChartFrame";

/**
 * Before → after, per row.
 *
 * This app is full of pairs written out as prose: margin erosion ("48.2% · was
 * 54.3%"), the revenue-leader-versus-profit-leader flip, agreed rate against
 * effective rate. A pair is a distance, and a distance is the one thing a
 * sentence is worst at conveying — the reader has to subtract two numbers in
 * their head to find out whether they should care.
 *
 * Two dots and the line between them says it without arithmetic: the length IS
 * the change, and which dot is on the right IS the direction.
 */

export type DumbbellRow = {
  id: string;
  label: string;
  from: number;
  to: number;
  /**
   * Overrides the set's direction for this row alone. Necessary because a set
   * can mix directions: revenue rising is good news and costs rising is not,
   * and colouring both green would be the chart congratulating you on a bigger
   * bill.
   */
  goodDirection?: "up-is-good" | "down-is-good" | "neutral";
};

export function Dumbbell({
  rows,
  format,
  fromLabel = "was",
  toLabel = "now",
  goodDirection = "up-is-good",
  className,
}: {
  rows: DumbbellRow[];
  format: (value: number) => string;
  fromLabel?: string;
  toLabel?: string;
  goodDirection?: "up-is-good" | "down-is-good" | "neutral";
  className?: string;
}) {
  useChartFrameGuard("Dumbbell");

  if (rows.length === 0) return null;

  // One shared scale across every row, so the rows are comparable with each
  // other and not just each with itself.
  const all = rows.flatMap((r) => [r.from, r.to]);
  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = max - min || 1;
  const pos = (v: number) => ((v - min) / span) * 100;

  return (
    <div className={cn("flex flex-col gap-3.5", className)}>
      {rows.map((row) => {
        const mark = moneyMark(row.to - row.from, row.goodDirection ?? goodDirection);
        const a = pos(row.from);
        const b = pos(row.to);
        const left = Math.min(a, b);
        const width = Math.abs(b - a);

        return (
          <div key={row.id} className="grid grid-cols-[1fr_auto] items-baseline gap-x-3 gap-y-1.5">
            <span className="t-body min-w-0 truncate text-[color:var(--pl-ink)]">{row.label}</span>
            <span className="t-num shrink-0 text-sm text-[color:var(--pl-ink-2)]">
              {format(row.from)} <span aria-hidden>→</span>{" "}
              {/* The "after" value wears the verdict colour; the "before" stays
                  quiet, because only one of the two is news. */}
              <span className={cn("font-semibold", mark.text)}>{format(row.to)}</span>
            </span>

            <div className="col-span-2 relative h-3">
              <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-[color:var(--pl-chart-track)]" />
              {/* The connector is the change. Its length is the magnitude and
                  its direction is the sign — no reading required for either. */}
              <div
                className="absolute top-1/2 h-0.5 -translate-y-1/2 rounded-full transition-[left,width] duration-[var(--pl-dur-slow)] ease-[var(--pl-ease-out)]"
                style={{ left: `${left}%`, width: `${width}%`, background: mark.fill }}
              />
              <span
                aria-hidden
                className="absolute top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full"
                style={{ left: `${a}%`, background: "var(--pl-chart-neutral)" }}
                title={`${fromLabel} ${format(row.from)}`}
              />
              {/* The 2px surface ring keeps the two dots legible where a small
                  change puts them almost on top of each other. */}
              <span
                aria-hidden
                className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full"
                style={{
                  left: `${b}%`,
                  background: mark.fill,
                  boxShadow: "0 0 0 2px var(--pl-surface)",
                }}
                title={`${toLabel} ${format(row.to)}`}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
