import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { GlobalPeriodFilter } from "./GlobalPeriodFilter";
import { ThemeToggleCompact } from "./ThemeToggle";

/**
 * The one page header. Every screen renders through this.
 *
 * That is the point: the period filter has to be in the SAME place on every
 * page, so it stops being something to hunt for. It is sticky, so it stays put
 * while the page scrolls, and it carries the page background rather than a
 * border — the shell has no lines in it anywhere (DESIGN.md).
 *
 * Sits as the first child of `.app-page-shell`; the negative margins let it
 * span the full width while the shell keeps its padding.
 */
export function PageHeader({
  title,
  meta,
  subtitle,
  period = true,
  actions,
  children,
  className,
}: {
  title: string;
  /**
   * One quiet fact ON the title line — today that is the window the figures
   * below cover.
   *
   * It sits beside the heading rather than under it because it is part of what
   * the heading says: "Summary" of WHAT. A preset name in the filter ("This
   * Year") is not that — two people reading the same screen in different
   * months are looking at different windows. Normal weight and secondary ink,
   * so the title still reads as the title.
   */
  meta?: string | null;
  subtitle?: string;
  /** Show the app-wide period filter. Off for pages where a range is meaningless. */
  period?: boolean;
  /** Primary action, right of the filter. */
  actions?: ReactNode;
  /** Tabs or a sub-nav, on their own row beneath the title. */
  children?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        /* Translucent rather than opaque, so the page visibly passes UNDER the
           header as it scrolls instead of being clipped by an invisible box.
           The blur is what keeps the title readable over whatever slides
           beneath it, and both colours come from the page token, so it is
           correct in dark without a second rule. */
        "@container sticky top-0 z-20 -mx-4 -mt-4 mb-6 bg-[color:color-mix(in_srgb,var(--pl-bg)_82%,transparent)] px-4 pt-4 pb-4 backdrop-blur-xl sm:-mx-6 sm:-mt-6 sm:px-6 sm:pt-6",
        className,
      )}
    >
      {/* Side by side only when the HEADER is wide enough, not the window. On
          a tablet the sidebar takes a third of the screen, so a window-width
          breakpoint put the title and the filter in one row that was ~560px
          of buttons in ~475px of room: the title squeezed to nothing and
          "This Year" and "Custom" sat off the right edge. */}
      <div className="flex flex-col gap-3 @4xl:flex-row @4xl:items-start @4xl:justify-between @4xl:gap-6">
        <div className="min-w-0">
          {/* Baseline-aligned, so the date sits ON the title's line rather than
              floating beside a taller word. It wraps below the title on a
              phone instead of truncating — a half-shown date range is worse
              than a second line. */}
          <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
            <h1 className="t-title truncate text-[color:var(--pl-ink)]">{title}</h1>
            {meta && (
              <p className="t-secondary shrink-0">
                <span aria-hidden className="mr-2.5 text-[color:var(--pl-ink-3)]">
                  ·
                </span>
                {meta}
              </p>
            )}
          </div>
          {subtitle && <p className="t-secondary mt-1">{subtitle}</p>}
        </div>

        {/* The filter is LAST so it sits flush to the right edge and lands on
            the same pixel on every screen. Ordered the other way it shifted a
            little from page to page as the action button's label changed
            width, which is exactly the hunting-for-it problem this solves. */}
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {actions}
          {period && <GlobalPeriodFilter />}
          {/* Phones have no sidebar, so this is the only place the appearance
              control can live and still be reachable from every screen. */}
          <ThemeToggleCompact className="-mr-1.5 sm:hidden" />
        </div>
      </div>

      {children && <div className="mt-4">{children}</div>}
    </header>
  );
}
