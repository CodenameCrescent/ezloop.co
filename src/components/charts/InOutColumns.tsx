import { useChartFrameGuard } from "./ChartFrame";
import { inOutFractions } from "./inOutScale";
import { TONE_STYLE } from "@/lib/chartTone";
import { cn } from "@/lib/utils";

/**
 * What came in and what went out, bucket by bucket, either side of one baseline.
 *
 * The two directions are NOT netted. A day that took Rs 200 and spent Rs 30 is
 * not a day that made Rs 170 — and the netted version hides the spending
 * entirely, which is the half an owner is more likely to be surprised by.
 *
 * Direction is carried by POSITION (above the rule, below it), which is the
 * second channel DESIGN.md 3a requires and the only one that still reads with
 * the colour stripped out. Money in is the gain green; money out is neutral
 * grey rather than red, because ordinary spending is not a loss — red belongs
 * to money that actually went backwards, like a refund.
 *
 * Plain chart-shaped input, no endpoint types: the page maps its response into
 * these buckets, and this file knows nothing about the API.
 */

export type InOutColumn = {
  /** Stable key — the bucket's start, but this component never parses it. */
  key: string;
  label: string;
  inCents: number;
  outCents: number;
};

/** Labels thin out as buckets multiply — never one per column (DESIGN.md 8). */
function labelEvery(count: number): number {
  if (count <= 12) return 1;
  return Math.ceil(count / 8);
}

export function InOutColumns({
  columns,
  format,
  height = 148,
  className,
}: {
  columns: InOutColumn[];
  format: (cents: number) => string;
  height?: number;
  className?: string;
}) {
  useChartFrameGuard("InOutColumns");

  const { rows } = inOutFractions(columns);
  const step = labelEvery(columns.length);

  return (
    <div className={cn("w-full", className)}>
      {/* Hovering a column quiets the others, so the one being read stands
          out without a second colour being introduced. */}
      <div className="group/cols relative flex w-full items-stretch gap-[2px]" style={{ height }}>
        {/* One rule across the whole plot rather than a segment per column: it is
            the zero line, so it has to read as continuous. Solid, never dashed. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-1/2 h-px"
          style={{ background: "var(--pl-grid-line)" }}
        />
        {columns.map((column, i) => {
          const { inFraction, outFraction } = rows[i];
          return (
            <div
              key={column.key}
              className="flex min-w-0 flex-1 flex-col rounded-md transition-opacity duration-150 group-hover/cols:opacity-40 hover:!opacity-100"
              /* The exact figures live in the frame's table view; this is the
                 quick read for a pointer, and it costs no layout. */
              title={`${column.label} — in ${format(column.inCents)}, out ${format(column.outCents)}`}
            >
              <div className="flex flex-1 items-end justify-center">
                <div
                  className="pl-bar-y w-full max-w-[24px] rounded-t-[4px]"
                  style={{
                    height: `${inFraction * 100}%`,
                    background: TONE_STYLE.gain.stroke,
                    /* A bar of zero still renders as a hairline of nothing; keep
                       it out of the layout so the baseline stays clean. */
                    minHeight: column.inCents > 0 ? 2 : 0,
                  }}
                />
              </div>
              <div className="flex flex-1 items-start justify-center">
                <div
                  className="pl-bar-y w-full max-w-[24px] rounded-b-[4px]"
                  style={{
                    height: `${outFraction * 100}%`,
                    background: TONE_STYLE.neutral.stroke,
                    minHeight: column.outCents > 0 ? 2 : 0,
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex w-full gap-[2px]">
        {columns.map((column, i) => (
          <div key={column.key} className="t-micro min-w-0 flex-1 truncate text-center text-[color:var(--pl-ink-3)]">
            {i % step === 0 ? column.label : " "}
          </div>
        ))}
      </div>
    </div>
  );
}
