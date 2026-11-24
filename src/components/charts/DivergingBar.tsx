import { cn } from "@/lib/utils";
import { moneyMark } from "@/lib/chartTone";
import { useChartFrameGuard } from "./ChartFrame";

/**
 * What moved, and which way — gains right of a centre rule, losses left of it.
 *
 * This is the form that discharges the colour-blind rule properly. Money green
 * and money red separate by ΔE 4.9 under deuteranopia, below the floor of 6, and
 * no re-stepping fixes it. The bar this replaces anchored both directions at the
 * left edge, so colour and a `+`/`−` glyph were the only things telling a gain
 * from a loss. Splitting the axis adds POSITION, which survives colour being
 * removed entirely and — the better half — needs no reading at all. Right is up,
 * left is down, before anyone has looked at a number.
 *
 * Every row is scaled against the largest absolute mover in the set, so the bars
 * are comparable with each other. Scaling each row to itself would make a Rs 50
 * change look like a Rs 5,000 one.
 */

export type DivergingRow = {
  id: string;
  label: string;
  sub?: string;
  /** Signed. The sign is the whole point. */
  value: number;
};

export function DivergingBar({
  rows,
  max,
  format,
  zeroLine = "centre",
  goodDirection = "up-is-good",
  onRowClick,
  className,
}: {
  rows: DivergingRow[];
  /** Largest absolute value to scale against. Defaults to the set's own max. */
  max?: number;
  format: (value: number) => string;
  /** `centre` splits the axis — the accessible default. `left` for a plain ranking. */
  zeroLine?: "centre" | "left";
  /** Which way is good. Costs falling is good news, and the colour should say so. */
  goodDirection?: "up-is-good" | "down-is-good" | "neutral";
  onRowClick?: (id: string) => void;
  className?: string;
}) {
  useChartFrameGuard("DivergingBar");

  const scale = max ?? Math.max(...rows.map((r) => Math.abs(r.value)), 1);
  if (rows.length === 0) return null;

  return (
    <div className={cn("flex flex-col gap-2.5", className)}>
      {rows.map((row) => {
        const mark = moneyMark(row.value, goodDirection);
        // Half the track each side, so a gain and a loss of equal size draw
        // equal bars in opposite directions.
        const pct = (Math.abs(row.value) / scale) * (zeroLine === "centre" ? 50 : 100);
        const rose = row.value > 0;

        const body = (
          <div className="grid grid-cols-[1fr_auto] items-baseline gap-x-3 gap-y-1.5">
            <div className="min-w-0">
              <div className="t-body truncate font-medium text-[color:var(--pl-ink)]">
                {row.label}
              </div>
              {row.sub && <div className="t-micro truncate">{row.sub}</div>}
            </div>

            {/* The text token, not the fill token: this is a word and needs
                4.5:1, where the bar beside it is a fill and needs 3:1. */}
            <div className={cn("t-num shrink-0 text-sm font-semibold", mark.text)}>
              {mark.sign}
              {format(Math.abs(row.value))}
            </div>

            <div className="col-span-2 relative h-2">
              <div className="absolute inset-0 rounded-full bg-[color:var(--pl-chart-track)]" />
              {zeroLine === "centre" && (
                /* The rule the bars hang off. Solid hairline, never dashed —
                   a dash reads as "threshold" when this is just zero. */
                <div
                  aria-hidden
                  className="absolute inset-y-[-2px] left-1/2 w-px -translate-x-1/2"
                  style={{ background: "var(--pl-chart-baseline)" }}
                />
              )}
              <div
                className="pl-bar-x absolute top-0 h-2 rounded-full"
                style={{
                  width: `${pct}%`,
                  background: mark.fill,
                  ...(zeroLine === "centre"
                    ? rose
                      ? { left: "50%" }
                      : { right: "50%" }
                    : { left: 0 }),
                }}
              />
            </div>
          </div>
        );

        return onRowClick ? (
          <button
            key={row.id}
            type="button"
            onClick={() => onRowClick(row.id)}
            className="w-full rounded-lg px-1 py-0.5 text-left transition-colors hover:bg-[color:var(--pl-recessed)]"
          >
            {body}
          </button>
        ) : (
          <div key={row.id}>{body}</div>
        );
      })}
    </div>
  );
}
