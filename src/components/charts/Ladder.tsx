import Link from "next/link";
import { cn } from "@/lib/utils";
import { useChartFrameGuard } from "./ChartFrame";
import { ladderRowFigure, ladderRowPresentation } from "./ladderRow";

/**
 * An ordered run of steps where each one takes a bite out of the last — a
 * waterfall, a funnel, the profit ladder.
 *
 * Drawn as horizontal bars rather than the floating-block waterfall, because
 * the floating version needs the reader to already know the convention. Here the
 * top bar is everything that came in, each bar below it is a bite out of that,
 * and the bottom bar is what survived. Legible without anyone explaining it
 * first, which is the whole brief.
 *
 * This is `Waterfall` with its API coupling removed. That component typed its
 * props as `EndpointResponse<typeof getWaterfall>`, which welded it to one
 * endpoint and meant no second page could ever import it — which is exactly why
 * five other pages hand-rolled their own bars. Every primitive here takes a
 * plain shape and lets the page do the mapping.
 *
 * Colour follows the one rule: grey for money in, red for a deduction, green for
 * what is kept or credited back. Orange never appears — it is the brand mark.
 */

export type LadderStep = {
  id: string;
  label: string;
  /**
   * Positive for every step that is an OPERATION — `kind` carries its
   * direction, not the sign.
   *
   * An `end` step is the exception, and the only one: it is a result, so it
   * carries its own sign and a loss arrives here negative. Treating the two
   * alike is what once printed a loss as a positive figure under a minus sign
   * borrowed from the rung above it.
   */
  value: number;
  kind: "start" | "deduction" | "credit" | "end";
  /** The rung name where one lands, printed verbatim from the domain labels. */
  rungLabel?: string;
  runningTotal?: number;
  href?: string;
};

const FILL: Record<LadderStep["kind"], string> = {
  start: "var(--pl-chart-neutral)",
  deduction: "var(--pl-chart-loss)",
  credit: "var(--pl-chart-gain)",
  end: "var(--pl-chart-gain)",
};

const TEXT: Record<LadderStep["kind"], string> = {
  start: "var(--pl-ink)",
  deduction: "var(--pl-red)",
  credit: "var(--pl-green)",
  end: "var(--pl-green)",
};

export function Ladder({
  steps,
  format,
  className,
}: {
  steps: LadderStep[];
  format: (value: number) => string;
  className?: string;
}) {
  useChartFrameGuard("Ladder");

  if (steps.length === 0) return null;

  /*
   * ONE scale for every bar: the largest thing on the chart. Scaling each bar to
   * its own row would make a Rs 50 fee look the same size as a Rs 5,000 one,
   * which is the chart lying in the most ordinary way available to it.
   */
  const scale = Math.max(...steps.map((s) => Math.abs(s.value)), 1);

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {steps.map((step) => {
        /* Colour, operator and sign are three questions, not one — see
           ladderRow.ts for what happened when they were answered together. */
        const { fillKind: kind, prefix: sign, signed } = ladderRowPresentation(step.kind, step.value);
        const width = Math.max(0, (Math.abs(step.value) / scale) * 100);

        const body = (
          <div className="flex items-center gap-3 py-1">
            <span
              className={cn(
                "w-40 shrink-0 truncate text-right t-body",
                step.kind === "end"
                  ? "font-semibold text-[color:var(--pl-ink)]"
                  : "text-[color:var(--pl-ink-2)]",
              )}
              title={step.label}
            >
              {sign}
              {step.label}
            </span>

            <div className="min-w-0 flex-1">
              <div
                /* 4px round at the data end, square where it meets the baseline. */
                className={cn("pl-bar-x rounded-r-[4px]", step.kind === "end" ? "h-7" : "h-5")}
                style={{ width: `${width}%`, background: FILL[kind], minWidth: width > 0 ? "2px" : 0 }}
              />
            </div>

            <span
              className={cn(
                "t-num w-32 shrink-0 text-right",
                kind !== "deduction" && kind !== "credit" && "font-semibold",
              )}
              style={{ color: TEXT[kind] }}
            >
              {ladderRowFigure(step.value, signed, format)}
            </span>
          </div>
        );

        return (
          <div key={step.id}>
            {step.href ? (
              <Link
                href={step.href}
                className="block rounded-lg transition-colors hover:bg-[color:var(--pl-recessed)]"
              >
                {body}
              </Link>
            ) : (
              body
            )}

            {step.rungLabel && step.kind !== "end" && step.runningTotal !== undefined && (
              <div className="flex items-center gap-3 pb-1 pt-0.5">
                <span className="t-micro w-40 shrink-0 text-right">{step.rungLabel}</span>
                <div className="min-w-0 flex-1 border-t border-dashed border-[color:var(--pl-hairline)]" />
                <span className="t-micro t-num w-32 shrink-0 text-right">
                  {format(step.runningTotal)}
                </span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
