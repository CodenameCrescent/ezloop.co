import { Download } from "lucide-react";
import { useStore, useFormatters } from "@/lib/store";
import { useState, useMemo, useId } from "react";
import { buildDateRange } from "@/lib/exportReport";
import type { DateRange } from "@/lib/exportReport";
import type { ReportPayload } from "@/lib/reportSheets";
import { toApiRange, usePnl, useRevenueItems, useExpenseItems, useSettings } from "@/api/hooks";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { type FigureState, FIGURE_STATE_COPY, figureState, combineFigureStates, figureStateSentence } from "@/lib/figureState";

// ─── Date range preset selector ───────────────────────────────────────────────

export type RangePreset = "all" | "today" | "week" | "month" | "90days";

export const RANGE_OPTIONS: { value: RangePreset; label: string }[] = [
  { value: "all", label: "All Time" },
  { value: "today", label: "Today" },
  { value: "week", label: "This Week" },
  { value: "month", label: "This Month" },
  { value: "90days", label: "Last 90 Days" },
];

// ─── KPI pill ─────────────────────────────────────────────────────────────────

/**
 * `value` is null when the figure is not known yet. A pill never invents one:
 * a skeleton while the server figure is in flight, a dash if the request
 * settled without one, and the state's own words if the request failed or
 * stopped. A zero here would be a claim, not a placeholder — and a dash on a
 * request that never arrived quietly understates it, which is the gap
 * DECISIONS.md left open on 2026-08-27 and this closes.
 *
 * Amber, not red. Colour in this app means money (DESIGN.md §2) and a request
 * that did not land is not money lost; amber is already the signal for
 * something about the DATA needing attention, as the People gap strip reasons.
 */
export function StatPill({
  label,
  value,
  state,
}: {
  label: string;
  value: string | null;
  state: FigureState;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      {state === "loading" ? (
        <Skeleton className="h-5 w-24" />
      ) : state === "settled" ? (
        <span className="text-sm font-semibold tabular-nums">{value ?? "—"}</span>
      ) : (
        /* No `tabular-nums`: this is words, not a figure, and giving it the
           figure's typography is how it starts being read as one. */
        <span className="text-sm font-semibold text-[color:var(--pl-amber)]">
          {FIGURE_STATE_COPY[state].slot}
        </span>
      )}
    </div>
  );
}

// ─── Export card ──────────────────────────────────────────────────────────────

export function ExportCard({
  icon,
  title,
  description,
  badge,
  badgeColor,
  onClick,
  buttonLabel,
  buttonVariant = "default",
  disabledReason,
  reasonId,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  badge: string;
  badgeColor: string;
  onClick: () => void;
  buttonLabel: string;
  buttonVariant?: "default" | "outline";
  /**
   * Why the download cannot run yet, or `undefined` when it can. The card is
   * disabled by the REASON rather than by a boolean, so it can never be greyed
   * out without one existing somewhere for the reader to find.
   */
  disabledReason?: string;
  /** Element holding that reason on screen, for `aria-describedby`. */
  reasonId?: string;
}) {
  return (
    <div className="rounded-xl border border-card-border bg-card p-6 flex flex-col gap-4">
      <div className="flex items-start justify-between">
        <div className="p-2.5 rounded-lg bg-muted/40 text-muted-foreground">{icon}</div>
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${badgeColor}`}>
          {badge}
        </span>
      </div>
      <div>
        <h3 className="font-semibold text-sm">{title}</h3>
        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{description}</p>
      </div>
      <Button
        onClick={onClick}
        variant={buttonVariant}
        className="gap-2 w-full"
        disabled={!!disabledReason}
        aria-describedby={disabledReason ? reasonId : undefined}
      >
        <Download className="h-4 w-4" />
        {buttonLabel}
      </Button>
    </div>
  );
}

/** ReportsOverview's state and handlers, kept out of its render so each file stays short. */
export function useReportsOverviewLogic() {
  // Only the business's own name comes from the store now. Every figure on this
  // page and in the file it produces comes from the server.
  const { settings } = useStore();
  const f = useFormatters();
  const [rangePreset, setRangePreset] = useState<RangePreset>("all");

  const dateRange: DateRange | undefined = useMemo(
    () => buildDateRange(rangePreset),
    [rangePreset],
  );

  // Snapshot money comes from the SERVER ladder and from nowhere else — same
  // numbers as the P&L page and Dashboard. "All Time" = no range bounds (the
  // server treats that as all-time). There is deliberately no local fallback:
  // the page used to fill the wait with a browser-side float total, so the
  // figure changed under the reader once the real one arrived.
  const apiRange = useMemo(
    () => (dateRange ? toApiRange({ start: dateRange.startDate, end: dateRange.endDate }) : {}),
    [dateRange],
  );
  const pnlQuery = usePnl(apiRange);
  // The two catalogue lists that fill the file's other sheets, asked for over
  // the SAME `apiRange` as the ladder — so the three answers describe one period
  // by construction, and the sheets cannot disagree with the screen.
  const revenueItemsQuery = useRevenueItems(apiRange);
  const expenseItemsQuery = useExpenseItems(apiRange);
  // The file is HEADED with the business's name and currency, and `useStore()`
  // serves those from DEFAULT_SETTINGS ("My Store", "PKR") until this query
  // lands. A workbook stamped with a placeholder name carries nothing to say it
  // is a placeholder, so the export waits for the real one like it waits for
  // the real figures.
  const settingsQuery = useSettings();
  const ladder = pnlQuery.data?.ladder;

  // Cents throughout — no /100. `f.moneyCents` takes minor units and does the
  // formatting, which is the one path that cannot pair a currency symbol with an
  // unconverted figure. `null` means "no figure yet", never zero.
  const revenueCents = ladder?.netRevenue ?? null;
  // "Total costs" is everything the ladder subtracts on the way from net revenue
  // down to true profit: the direct costs of what was sold, plus the period's
  // expenses. Written as that sum — the same expression the Forecasts page uses —
  // rather than as `netRevenue - trueProfit`, so a reader comparing the two pages
  // can see they are one figure instead of having to prove it.
  const totalCostsCents = ladder ? ladder.directCosts + ladder.periodExpenses : null;
  const profitCents = ladder?.trueProfit ?? null;
  const marginPct =
    ladder && ladder.netRevenue > 0 ? (ladder.trueProfit / ladder.netRevenue) * 100 : null;

  const rangeLabel = RANGE_OPTIONS.find((o) => o.value === rangePreset)?.label ?? "All Time";

  /**
   * Everything the download needs, and nothing it does not. No raw rows cross
   * this boundary: the old export summed the store's 200-row page and reported a
   * quarter of the business, and the only durable fix is that the figures arrive
   * already totalled by the server.
   *
   * `null` means "not exportable yet" and is the single source of truth for the
   * buttons — there is no second, looser condition under which a file can be
   * written, because a file leaves the building and cannot be corrected after.
   */
  const reportPayload: ReportPayload | null = useMemo(() => {
    const pnl = pnlQuery.data;
    const items = revenueItemsQuery.data?.items;
    const expenseItems = expenseItemsQuery.data?.items;
    // Settings is guarded alongside the figures because the heading of the file
    // is as much a claim about the business as the figures are.
    if (!pnl || !items || !expenseItems || !settingsQuery.data) return null;
    return {
      businessName: settings.businessName,
      // The code and the glyph are taken from the SAME place, so a file can
      // never label itself one currency while its figures carry another.
      currency: f.currency,
      symbol: f.symbol,
      periodLabel: rangeLabel,
      ladder: pnl.ladder,
      expenseGroups: pnl.expenseGroups,
      transactionCount: pnl.transactionCount,
      offers: items.map((i) => ({
        name: i.name,
        unitsSold: i.stats.unitsSold,
        netRevenueCents: i.stats.netRevenueCents,
        contributionProfitCents: i.stats.contributionProfitCents,
        marginPct: i.stats.marginPct,
        refundedCents: i.stats.refundedCents,
        transactionCount: i.stats.transactionCount,
      })),
      costs: expenseItems.map((e) => ({
        name: e.name,
        type: e.type,
        costNature: e.costNature,
        spentCents: e.stats.spentCents,
        jobCostCents: e.stats.jobCostCents,
        shareOfExpensesPct: e.stats.shareOfExpensesPct,
        transactionCount: e.stats.transactionCount,
      })),
    };
  }, [
    pnlQuery.data,
    revenueItemsQuery.data,
    expenseItemsQuery.data,
    settingsQuery.data,
    settings.businessName,
    f.currency,
    f.symbol,
    rangeLabel,
  ]);

  /**
   * The four states the snapshot pills can be in — one query, one figure.
   * Read from `figureState` rather than `isLoading`, because a request that
   * failed and a request that stopped dead both report `isLoading: false` and
   * would otherwise fall through to the same em dash an empty period gets.
   */
  const pnlState = figureState(pnlQuery, ladder != null);

  /**
   * Why the download is unavailable, or `undefined` when it is available. A
   * blocked button that says nothing reads as a broken button; the waits are
   * distinguished because only one of them ends by itself.
   *
   * All four requests are folded into ONE state, because the file needs all
   * four and the reader needs one sentence. `combineFigureStates` ranks them so
   * the sentence names whatever best explains the absence — being offline
   * explains all four at once, and outranks any single failure.
   */
  const exportState = combineFigureStates([
    figureState(pnlQuery, pnlQuery.data != null),
    figureState(revenueItemsQuery, revenueItemsQuery.data != null),
    figureState(expenseItemsQuery, expenseItemsQuery.data != null),
    figureState(settingsQuery, settingsQuery.data != null),
  ]);

  /*
   * `undefined` here ENABLES both buttons, so it must never be reachable while
   * `reportPayload` is null — a button that looks live and writes no file is
   * worse than a blocked one. The fallback is what makes that true regardless
   * of what the four states combine to.
   */
  const exportBlockedReason = reportPayload
    ? undefined
    : (figureStateSentence(exportState, "this period's figures") ??
      "Waiting for this period's figures.");

  /*
   * The reason is rendered as VISIBLE TEXT, not a `title` tooltip.
   *
   * `disabled:pointer-events-none` in button.tsx means a disabled button is
   * skipped by hit-testing entirely, so the browser resolves the hover to the
   * ancestor element and shows ITS tooltip — never the button's. A `title` here
   * sits in the DOM, passes any test that inspects attributes, and shows the
   * reader nothing at all: four greyed-out buttons and no explanation, which
   * reads as broken software. Visible text also survives touch, where hover
   * does not exist, and is read out rather than being a hidden affordance.
   *
   * Two ids because one string is shown twice — beside the header pair, and
   * above the two cards — and an id may name only one element.
   */
  const reasonIdBase = useId();
  const headerReasonId = `${reasonIdBase}-header`;
  const cardsReasonId = `${reasonIdBase}-cards`;

  return {
    exportBlockedReason,
    headerReasonId,
    reportPayload,
    rangePreset,
    setRangePreset,
    rangeLabel,
    revenueCents,
    f,
    pnlState,
    totalCostsCents,
    profitCents,
    marginPct,
    cardsReasonId,
  };
}
