import { createContext, useContext, type ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Surface } from "./Surface";
import { Sparkline } from "./charts/Sparkline";

/**
 * A strip of figures: ONE bordered object with hairline divisions, not a row
 * of floating cards. This is the dense-analytical form every stat row in the
 * app uses, extracted from the dashboard so five pages cannot each rebuild it
 * a little differently.
 *
 * Tiles inside it turn dense through context — the page just swaps its grid
 * wrapper for <StatStrip> and the tiles follow, skeletons and conditionals
 * included, with no prop threading.
 */
const StripContext = createContext(false);

const stripColumns = {
  2: "grid-cols-1 divide-y divide-[color:var(--pl-grid-line)] sm:grid-cols-2 sm:divide-x sm:divide-y-0",
  3: "grid-cols-1 divide-y divide-[color:var(--pl-grid-line)] sm:grid-cols-3 sm:divide-x sm:divide-y-0",
  4: "grid-cols-2 divide-x divide-y divide-[color:var(--pl-grid-line)] xl:grid-cols-4 xl:divide-y-0",
} as const;

export function StatStrip({
  columns = 4,
  className,
  children,
}: {
  columns?: keyof typeof stripColumns;
  className?: string;
  children: ReactNode;
}) {
  return (
    <StripContext.Provider value={true}>
      <Surface variant="bordered" className={cn("grid", stripColumns[columns], className)}>
        {children}
      </Surface>
    </StripContext.Provider>
  );
}

/**
 * Label, value, and how it moved. Nothing else.
 *
 * No icon in a coloured circle, no accent fill, no border on the default
 * (card) form. The only colour a tile carries is on the delta, and only
 * because up and down genuinely mean gained and lost.
 *
 * The delta is a tinted pill rather than loose coloured text, so it matches
 * the hero's change pill exactly — a row of tiles under the hero should read
 * as the same family of thing, at a smaller size.
 *
 * `goodDirection` says which way is GOOD, which is not always up: expenses
 * rising is bad, expenses falling is good. Pass "down-is-good" for cost tiles.
 *
 * `dense` drops the tile's own card entirely — no background, border or
 * radius — so it can sit edge to edge inside a parent
 * `Surface variant="bordered"` grid and share that grid's hairline instead
 * of getting one of its own.
 */
export function StatTile({
  label,
  value,
  delta,
  deltaLabel,
  goodDirection = "up-is-good",
  hint,
  trend,
  dense = false,
  className,
}: {
  label: string;
  value: ReactNode;
  /** Signed percentage change. Omit when there is nothing to compare against. */
  delta?: number | null;
  /** What the delta is measured against, e.g. "vs last month". */
  deltaLabel?: string;
  goodDirection?: "up-is-good" | "down-is-good" | "neutral";
  hint?: string;
  /**
   * This figure's recent history, oldest first, for a line beside it.
   *
   * The delta answers "up or down since last time"; the line answers "is this
   * where it has been". Those are different questions and a tile that answers
   * only the first makes a steady climb and a one-off spike look identical.
   *
   * It takes the SAME tone the delta pill took, from the one calculation
   * above — a line coloured separately could call a period good news while the
   * pill beside it called it bad. Fewer than two points draws nothing rather
   * than a placeholder shape.
   */
  trend?: number[];
  /**
   * Render as a borderless, background-less cell for a bordered grid strip.
   * Inside a <StatStrip> this is automatic; the prop remains for the odd
   * bespoke grid that manages its own borders.
   */
  dense?: boolean;
  className?: string;
}) {
  const inStrip = useContext(StripContext);
  const isDense = dense || inStrip;
  const hasDelta = typeof delta === "number" && Number.isFinite(delta);
  const rose = hasDelta && delta > 0;
  const flat = hasDelta && Math.abs(delta) < 0.005;
  const neutral = !hasDelta || flat || goodDirection === "neutral";
  const good =
    !neutral && ((rose && goodDirection === "up-is-good") || (!rose && goodDirection === "down-is-good"));

  const tint = neutral
    ? "var(--pl-recessed)"
    : good
      ? "var(--pl-green-tint)"
      : "var(--pl-red-tint)";
  const tone = neutral
    ? "var(--pl-ink-2)"
    : good
      ? "var(--pl-green)"
      : "var(--pl-red)";

  // The arrow says which way the number MOVED. The colour says whether that
  // was good news. Those are different facts and a cost tile needs both.
  const Arrow = flat ? Minus : rose ? ArrowUpRight : ArrowDownRight;

  const content = (
    <>
      <span className="t-micro">{label}</span>
      {/* Proportional figures, deliberately NOT `t-num`: tabular digits give
          every digit the width of a zero, which makes a large standalone value
          like "121" sit loose. Tabular belongs where numbers align vertically —
          table columns, axis ticks — and on the animated hero, where digits
          changing width mid-count would jitter. A tile value is neither. */}
      <span
        className={cn(
          "font-semibold text-[color:var(--pl-ink)]",
          isDense ? "text-lg" : "text-2xl",
        )}
      >
        {value}
      </span>
      {hasDelta ? (
        <span className="flex flex-wrap items-center gap-1.5">
          <span
            className="t-num inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-semibold"
            style={{ backgroundColor: tint, color: tone }}
          >
            <Arrow className="h-3 w-3" aria-hidden="true" />
            {flat ? "no change" : `${Math.abs(delta).toFixed(1)}%`}
          </span>
          {deltaLabel && <span className="text-[11px] text-[color:var(--pl-ink-3)]">{deltaLabel}</span>}
        </span>
      ) : (
        hint && <span className="t-secondary text-xs">{hint}</span>
      )}
    </>
  );

  if (isDense) {
    return <div className={cn("flex flex-col gap-1.5 p-3", className)}>{content}</div>;
  }

  /* The line sits to the RIGHT of the figure, not under it: the label, the
     value and the change are one reading column, and dropping a chart into the
     middle of that column breaks it. `min-w-0` on the column is what stops a
     long money figure squeezing the line to nothing. */
  const line = trend && trend.length > 1 && (
    <div className="h-10 w-16 shrink-0 self-center sm:w-20" aria-hidden>
      <Sparkline values={trend} tone={neutral ? "neutral" : good ? "gain" : "loss"} showEnd inline />
    </div>
  );

  return (
    <Surface padding="md" className={cn("flex items-start justify-between gap-3", className)}>
      <div className="flex min-w-0 flex-col gap-2">{content}</div>
      {line}
    </Surface>
  );
}
