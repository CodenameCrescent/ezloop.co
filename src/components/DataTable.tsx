import { Fragment, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Surface } from "./Surface";

/**
 * The one table shell.
 *
 * There were fourteen hand-built `<table>` blocks in this app, each with its
 * own padding, header treatment and idea of how a number should align. The
 * visual recipe now lives once in index.css (`.app-table`): recessed header,
 * hairline rows, figures right-aligned and tabular so columns line up.
 *
 * Hairlines between rows are the one place a line is allowed — see DESIGN.md.
 */
export type Column<T> = {
  /** Stable id, also used as the React key. */
  key: string;
  header: ReactNode;
  /** Numbers go right; everything else goes left. */
  align?: "left" | "right";
  /** Cell contents. */
  render: (row: T) => ReactNode;
  /**
   * Magnitude for an in-cell bar — a faint fill behind the figure, sized
   * against the column's largest value. Return null for a row with nothing to
   * measure.
   *
   * This is what turns a column of numbers into a shape: the reader sees which
   * rows dominate without comparing digits in their head, and every number is
   * still there for the ones they care about. Purely additive — no cell loses
   * its figure.
   */
  bar?: (row: T) => number | null;
  /** Hide below the `sm` breakpoint — the first thing to drop on a phone. */
  hideOnMobile?: boolean;
  width?: string;
  className?: string;
};

/**
 * Rows under a heading, with an optional subtotal line.
 *
 * Grouping is a real table feature, not a one-page quirk — the catalogue groups
 * by type or category and shows a running subtotal per group. Putting it here
 * rather than letting one page keep its own `<table>` is the whole reason this
 * component exists.
 */
export type Section<T> = {
  key: string;
  /** Omit for a single unlabelled section — the plain, ungrouped case. */
  label?: string;
  rows: T[];
  /** Subtotal cells, keyed by column key. Columns not named here stay blank. */
  summary?: Record<string, ReactNode>;
};

export function DataTable<T>({
  columns,
  rows,
  sections,
  getRowKey,
  onRowClick,
  isRowActive,
  empty,
  caption,
  className,
}: {
  columns: Column<T>[];
  /** The plain case. Ignored when `sections` is given. */
  rows?: T[];
  /** The grouped case — headings and subtotals. */
  sections?: Section<T>[];
  getRowKey: (row: T, index: number) => string;
  onRowClick?: (row: T) => void;
  isRowActive?: (row: T) => boolean;
  /** Shown instead of the body when there are no rows. An instruction, not an apology. */
  empty?: ReactNode;
  caption?: string;
  className?: string;
}) {
  const resolved: Section<T>[] = sections ?? [{ key: "all", rows: rows ?? [] }];
  // Bars are scaled across EVERY row, not per section — otherwise the biggest
  // row in a small group would draw as long as the biggest row overall, and the
  // groups would stop being comparable with each other.
  const allRows = resolved.flatMap((s) => s.rows);

  // Each barred column's max, once per render rather than once per cell.
  const barMax = new Map<string, number>();
  for (const col of columns) {
    if (!col.bar) continue;
    let max = 0;
    for (const row of allRows) {
      const v = col.bar(row);
      if (v !== null && Number.isFinite(v)) max = Math.max(max, Math.abs(v));
    }
    barMax.set(col.key, max);
  }

  return (
    <Surface className={cn("overflow-hidden", className)}>
      <div className="app-scrollbar overflow-x-auto">
        <table className="app-table">
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead>
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  style={col.width ? { width: col.width } : undefined}
                  className={cn(
                    col.align === "right" && "text-right",
                    col.hideOnMobile && "hidden sm:table-cell",
                    col.className,
                  )}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {resolved.map((section) => (
              <Fragment key={section.key}>
                {(section.label || section.summary) && (
                  <tr className="bg-[color:var(--pl-recessed)]">
                    {columns.map((col, i) => (
                      <td
                        key={col.key}
                        className={cn(
                          "text-xs font-semibold",
                          col.align === "right" && "text-right tabular-nums",
                          col.hideOnMobile && "hidden sm:table-cell",
                        )}
                      >
                        {i === 0 ? (
                          <span className="capitalize text-[color:var(--pl-ink-2)]">{section.label}</span>
                        ) : (
                          section.summary?.[col.key] ?? null
                        )}
                      </td>
                    ))}
                  </tr>
                )}
                {section.rows.map((row, index) => {
              const active = isRowActive?.(row);
              return (
                <tr
                  key={getRowKey(row, index)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={cn(
                    "transition-colors",
                    onRowClick && "cursor-pointer",
                    active
                      ? "bg-[color:var(--pl-orange-tint)]"
                      : onRowClick && "hover:bg-[color:var(--pl-recessed)]",
                  )}
                >
                  {columns.map((col) => {
                    const raw = col.bar ? col.bar(row) : null;
                    const max = barMax.get(col.key) ?? 0;
                    const share =
                      raw !== null && Number.isFinite(raw) && max > 0
                        ? Math.abs(raw) / max
                        : null;
                    return (
                      <td
                        key={col.key}
                        className={cn(
                          col.align === "right" && "text-right tabular-nums",
                          col.hideOnMobile && "hidden sm:table-cell",
                          col.className,
                        )}
                      >
                        {share === null ? (
                          col.render(row)
                        ) : (
                          <span className="relative inline-block min-w-0 max-w-full">
                            {/* Behind the figure, anchored to the reading edge of
                                the cell, quiet enough that the digits stay the
                                foreground. Width is the true share — an empty
                                bar stays empty. */}
                            <span
                              aria-hidden
                              className={cn(
                                "absolute inset-y-[-2px] rounded-sm",
                                col.align === "right" ? "right-[-6px]" : "left-[-6px]",
                              )}
                              style={{
                                width: `calc(${(share * 100).toFixed(1)}% + 6px)`,
                                background:
                                  "color-mix(in srgb, var(--pl-chart-neutral) 14%, transparent)",
                              }}
                            />
                            <span className="relative">{col.render(row)}</span>
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {allRows.length === 0 && empty && (
        <div className="px-6 py-12 text-center">{empty}</div>
      )}
    </Surface>
  );
}

/** Empty states are instructions, not apologies. Never "No data available". */
export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mx-auto flex max-w-sm flex-col items-center gap-2">
      <p className="t-section text-[color:var(--pl-ink)]">{title}</p>
      {hint && <p className="t-secondary">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
