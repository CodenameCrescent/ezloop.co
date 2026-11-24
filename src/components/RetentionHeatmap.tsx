import { Fragment } from "react";
import { cn } from "@/lib/utils";

/**
 * Cohort retention heatmap (Lifetimely-style): rows are acquisition months,
 * columns are months-since-first-purchase, cell colour = share of the cohort
 * that bought again that month. Token-driven colour ramp — correct in both
 * themes. Pure presentation: percentages arrive server-computed.
 */
export interface RetentionHeatmapCohort {
  cohortMonth: string; // "YYYY-MM"
  size: number;
  activePctByOffset: number[];
}

function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { month: "short", year: "2-digit" }).format(new Date(Date.UTC(y, m - 1, 1)));
}

/**
 * 0% → transparent; 100% → the full green. The label flips to white once the
 * fill is dark enough that ink stops being readable on it: at 85% green, ink
 * scored 4.14, and white on the same fill was no better at 4.0. Only the full
 * green clears both ways (white on it reaches 5.23).
 */
const INK_READABLE_CEILING = 50;

function cellStyle(pct: number): React.CSSProperties {
  const strength = pct <= 0 ? 0 : Math.max(10, Math.min(100, pct));
  if (strength > INK_READABLE_CEILING) {
    return { backgroundColor: "var(--pl-green)", color: "var(--pl-on-fill)" };
  }
  return {
    backgroundColor: `color-mix(in srgb, var(--pl-green) ${strength}%, transparent)`,
    color: "var(--pl-ink)",
  };
}

export function RetentionHeatmap({ cohorts, maxOffset }: { cohorts: RetentionHeatmapCohort[]; maxOffset: number }) {
  if (cohorts.length === 0) {
    return <p className="text-sm text-[color:var(--pl-grey)]">Customer cohorts appear once repeat purchases exist.</p>;
  }
  const columns = maxOffset + 1;

  return (
    <div className="app-scrollbar overflow-x-auto">
      <div
        className="grid min-w-[520px] gap-1 text-xs"
        style={{ gridTemplateColumns: `minmax(88px,auto) minmax(44px,auto) repeat(${columns}, minmax(52px, 1fr))` }}
      >
        <div />
        <div className="pb-1 text-right font-semibold text-[color:var(--pl-mid-grey)]">Size</div>
        {Array.from({ length: columns }, (_, i) => (
          <div key={i} className="pb-1 text-center font-semibold text-[color:var(--pl-mid-grey)]">
            {i === 0 ? "1st mo" : `+${i} mo`}
          </div>
        ))}

        {cohorts.map((cohort) => (
          // A row: cohort label, size, then one cell per month offset.
          <Fragment key={cohort.cohortMonth}>
            <div className="flex items-center font-semibold text-[color:var(--pl-black)]">
              {monthLabel(cohort.cohortMonth)}
            </div>
            <div className="flex items-center justify-end tabular-nums text-[color:var(--pl-grey)]">
              {cohort.size}
            </div>
            {Array.from({ length: columns }, (_, offset) => {
              const pct = cohort.activePctByOffset[offset];
              const future = pct === undefined;
              return (
                <div
                  key={`${cohort.cohortMonth}-${offset}`}
                  title={future ? "Not reached yet" : `${monthLabel(cohort.cohortMonth)} cohort, ${offset === 0 ? "first month" : `${offset} month(s) later`}: ${pct}% bought`}
                  className={cn(
                    "flex h-9 items-center justify-center rounded-md tabular-nums",
                    future
                      ? "bg-[color:var(--pl-recessed)] text-[color:var(--pl-ink-3)]"
                      : "font-medium",
                  )}
                  style={future ? undefined : cellStyle(pct)}
                >
                  {future ? "·" : `${pct}%`}
                </div>
              );
            })}
          </Fragment>
        ))}
      </div>
    </div>
  );
}
