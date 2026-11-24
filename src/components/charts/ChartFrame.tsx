import * as React from "react";
import { Table2, BarChart3 } from "lucide-react";
import { Surface, type SurfacePadding } from "@/components/Surface";
import { DataTable, type Column } from "@/components/DataTable";
import { cn } from "@/lib/utils";
import { toneFill, type ChartTone } from "@/lib/chartTone";
import { FIGURE_STATE_COPY, type FigureState } from "@/lib/figureState";

/**
 * The frame every chart in this app sits in.
 *
 * It owns the five things a chart needs around its marks — title, legend,
 * loading, empty, and the table view — and it owns them EXCLUSIVELY. No
 * primitive underneath renders any of them.
 *
 * ── Why state is a required prop ───────────────────────────────────────────
 *
 * Two charts in this app used to tell owners "Record a sale and this will show
 * how your income moves over time" on every single page load, because they had
 * no idea they were loading: an empty array during fetch and an empty array
 * because the business is new looked identical to them. "No data yet" and "not
 * arrived yet" are different states and the reader deserves to be told which.
 *
 * That prop was `loading: boolean`, and a boolean turned out to be one state
 * short. A request that FAILED and a request that PAUSED both report
 * `isLoading: false`, so both landed on the same `empty` branch — and every
 * `emptyMessage` in this app is a sentence about the business ("No revenue
 * recorded in this period."). A chart that could not reach the server was
 * telling the owner their period was empty. So the prop is now the four-state
 * `FigureState`, and `empty` is read ONLY when the state is `settled`: the
 * server answered, and the answer was nothing.
 *
 * It stays REQUIRED for the original reason. A caller who forgets it fails
 * typecheck instead of silently defaulting and reintroducing the bug, and
 * `emptyMessage` is still unreachable from any primitive underneath, so there
 * is no second place the sentence could come from.
 *
 * ── Why height is required ─────────────────────────────────────────────────
 *
 * The frame reserves the plot box before any data lands, so placeholder → chart
 * → refetch never moves the page under a reading eye.
 *
 * ── Refetching holds, it does not flash ────────────────────────────────────
 *
 * Changing the period should not blank the screen. The last good render stays
 * put at reduced opacity while the next one is in flight, which reads as "this
 * is updating" rather than "this is gone".
 */

const ChartFrameContext = React.createContext(false);

/**
 * Called by every chart primitive. It does not return anything useful — its job
 * is to complain, loudly and only in development, when a primitive has been
 * mounted outside a frame and has therefore silently lost its loading and empty
 * handling. Same self-policing shape InsightCard already uses.
 */
export function useChartFrameGuard(name: string, exempt = false): void {
  const inFrame = React.useContext(ChartFrameContext);
  React.useEffect(() => {
    if (!inFrame && !exempt && (process.env.NODE_ENV !== "production")) {
      console.error(
        `<${name}> is outside a <ChartFrame>. It has no loading or empty state of ` +
          `its own by design, so it will render nothing while data is in flight. ` +
          `Wrap it in <ChartFrame state={…} height={…}>.`,
      );
    }
  }, [inFrame, name]);
}

export type LegendItem = {
  label: string;
  tone: ChartTone;
  /** How the mark is drawn, so the key matches what is on the chart. */
  shape?: "line" | "area" | "square" | "dot";
};

export type ChartFrameProps<T> = {
  title?: React.ReactNode;
  /** One quiet line under the title. */
  hint?: string;
  /** A control on the right of the title row — a period switcher, a link. */
  action?: React.ReactNode;
  /**
   * The one figure this chart is about, shown large beside the title. The
   * symbol belongs here, once, which is why axis ticks drop it.
   */
  figure?: React.ReactNode;
  /**
   * Always present for two or more series — identity must never rest on colour
   * matching alone. A single series needs none: the title already names it.
   */
  legend?: LegendItem[];
  /** Reserved before data lands. Required — see the note above. */
  height: number | string;
  /** Why there is no chart, when there is no chart. Required — see the note above. */
  state: FigureState;
  /** Read ONLY when `state` is `settled`. */
  empty?: boolean;
  /** An instruction, never an apology. Only ever shown for a period that really is empty. */
  emptyMessage?: React.ReactNode;
  /**
   * The WCAG-clean twin. Every chart should be able to become its own numbers,
   * because a picture is an aid and never the only way to read a value.
   */
  tableView?: {
    columns: Column<T>[];
    rows: T[];
    getRowKey: (row: T, index: number) => string;
  };
  /** `false` when the caller already owns the Surface around this. */
  surface?: SurfacePadding | false;
  className?: string;
  children: React.ReactNode;
};

export function ChartFrame<T>({
  title,
  hint,
  action,
  figure,
  legend,
  height,
  state,
  empty = false,
  emptyMessage = "Nothing to show for this period yet.",
  tableView,
  surface = "md",
  className,
  children,
}: ChartFrameProps<T>) {
  const [asTable, setAsTable] = React.useState(false);

  /*
   * The last render that had real data in it. Holding the NODE rather than the
   * data means the frame does not need to know anything about what it is
   * framing — it works the same for a line chart and a stacked bar.
   */
  const held = React.useRef<React.ReactNode>(null);
  if (state === "settled" && !empty) held.current = children;

  const showHeld = state === "loading" && held.current !== null;
  const showPlaceholder = state === "loading" && held.current === null;
  const showEmpty = state === "settled" && empty;
  /* The two states that are not about the business at all. They are checked
     before `empty` can be reached, which is the whole point: `emptyMessage` is
     a claim ("No revenue recorded in this period.") and a chart that never
     arrived is in no position to make one. */
  const failure = state === "offline" || state === "failed" ? state : null;

  const plot = (
    <div style={{ minHeight: height }} className="relative">
      {showPlaceholder ? (
        /* No shimmer and no spinner: a box the exact size of the chart that is
           about to arrive, so nothing moves when it does. */
        <div
          className="flex h-full items-center justify-center rounded-lg bg-[color:var(--pl-chart-track)]"
          style={{ minHeight: height }}
        >
          <span className="t-secondary">Working it out…</span>
        </div>
      ) : failure ? (
        /* Amber, not red. Colour in this app means money (DESIGN.md §2) and a
           request that did not land is not money lost. */
        <div
          className="flex h-full items-center justify-center rounded-lg bg-[color:var(--pl-chart-track)] px-6 text-center"
          style={{ minHeight: height }}
        >
          <p className="t-secondary text-[color:var(--pl-amber)]">
            {FIGURE_STATE_COPY[failure].why}
          </p>
        </div>
      ) : showEmpty ? (
        <div
          className="flex h-full items-center justify-center rounded-lg bg-[color:var(--pl-chart-track)] px-6 text-center"
          style={{ minHeight: height }}
        >
          <p className="t-secondary">{emptyMessage}</p>
        </div>
      ) : showHeld ? (
        <div
          aria-busy="true"
          className="pointer-events-none transition-opacity"
          style={{ opacity: "var(--pl-chart-hold)" }}
        >
          {held.current}
        </div>
      ) : (
        children
      )}
    </div>
  );

  const body = (
    <ChartFrameContext.Provider value={true}>
      {(title || figure || action || tableView) && (
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            {title && <h3 className="t-section text-[color:var(--pl-ink)]">{title}</h3>}
            {hint && <p className="t-secondary mt-0.5">{hint}</p>}
            {figure && <div className="mt-2">{figure}</div>}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {action}
            {tableView && !showPlaceholder && !showEmpty && !failure && (
              <button
                type="button"
                onClick={() => setAsTable((v) => !v)}
                aria-pressed={asTable}
                title={asTable ? "Show the chart" : "Show the numbers"}
                className="pl-press inline-flex h-8 w-8 items-center justify-center rounded-lg text-[color:var(--pl-ink-2)] transition-colors hover:bg-[color:var(--pl-recessed)] hover:text-[color:var(--pl-ink)]"
              >
                {asTable ? <BarChart3 className="h-4 w-4" /> : <Table2 className="h-4 w-4" />}
                <span className="sr-only">{asTable ? "Show the chart" : "Show the numbers"}</span>
              </button>
            )}
          </div>
        </div>
      )}

      {legend && legend.length > 1 && (
        <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1.5">
          {legend.map((item) => (
            <span key={item.label} className="flex items-center gap-1.5">
              <LegendMark tone={item.tone} shape={item.shape ?? "square"} />
              {/* Text wears text tokens, never the data colour — the mark beside
                  it carries the identity. A light slot is illegible as a word. */}
              <span className="t-secondary">{item.label}</span>
            </span>
          ))}
        </div>
      )}

      {asTable && tableView ? (
        <DataTable
          columns={tableView.columns}
          rows={tableView.rows}
          getRowKey={tableView.getRowKey}
        />
      ) : (
        plot
      )}
    </ChartFrameContext.Provider>
  );

  if (surface === false) return <div className={className}>{body}</div>;
  return (
    <Surface padding={surface} className={className}>
      {body}
    </Surface>
  );
}

function LegendMark({ tone, shape }: { tone: ChartTone; shape: NonNullable<LegendItem["shape"]> }) {
  const fill = toneFill(tone);
  if (shape === "line") {
    return <span aria-hidden className="h-0.5 w-4 shrink-0 rounded-full" style={{ background: fill }} />;
  }
  if (shape === "area") {
    return (
      <span
        aria-hidden
        className="h-2.5 w-4 shrink-0 rounded-sm border"
        style={{ background: `color-mix(in srgb, ${fill} 22%, transparent)`, borderColor: fill }}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={cn("h-2.5 w-2.5 shrink-0", shape === "dot" ? "rounded-full" : "rounded-sm")}
      style={{ background: fill }}
    />
  );
}
