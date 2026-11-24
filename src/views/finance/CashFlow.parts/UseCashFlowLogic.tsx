import { useMemo } from "react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { type LadderStep } from "@/components/charts/Ladder";
import { type ShareSegment } from "@/components/charts/ShareBar";
import type { Column } from "@/components/DataTable";
import { useGlobalPeriod } from "@/lib/globalPeriod";
import { useStore, useFormatters } from "@/lib/store";
import { calculateCashFlowAnalysis } from "@/lib/finance";
import { useOwed } from "@/api/hooks";
import { figureState } from "@/lib/figureState";
import { cn } from "@/lib/utils";

/**
 * Cash Flow — "did the money actually arrive?"
 *
 * The page had no picture at all, which is odd for a question that is entirely
 * about flow. It had eight cards each carrying a caption sentence, four tables
 * in which EVERY row carried its own explanatory sentence underneath it, and a
 * 41-word closing paragraph explaining what the page is not. The densest
 * label-prose in the app, for the most inherently visual question in it.
 *
 * Now: one ladder showing cash in becoming cash out becoming what is left, one
 * hero figure, one sentence. The per-row explanations became tooltips on the
 * row labels — still one hover away, no longer stacked under every line.
 *
 * Every figure comes from `calculateCashFlowAnalysis` exactly as before; this
 * pass changed the surface, not the arithmetic. Note these are MAJOR units from
 * the legacy store, not cents, which is why this page uses `f.money`.
 */

export type MovementRow = { label: string; help: string; amount: number; kind: "in" | "out" | "neutral" | "total" };

/** CashFlow's state and handlers, kept out of its render so each file stays short. */
export function useCashFlowLogic() {
  /* Not on the audit list, but it reads the same store the Budget page does,
     and its three frames were passing a hard `false` for loading — which the
     `FigureState` rename would have frozen into a permanent "settled", the
     exact assumption this whole pass exists to remove.

     Converting the frames alone was not enough, and the half-conversion was
     worse than either end of it: the three ChartFrames correctly said "The
     server didn't answer." while the tiles directly beneath them printed
     "Still owed to you Rs 0 · Every sale is paid for" and "Bills not paid
     Rs 0 · Nothing outstanding" — all-clears about money the page had not
     managed to look at, sitting under a frame admitting it could not look.
     Every figure on this page is derived from the store's arrays, and each of
     those is a `?? []` when its request fails or pauses, so `dataState` gates
     all of them. */
  const { orders, adSpend, expenses, settings, dataState } = useStore();
  const f = useFormatters();
  const dateRange = useGlobalPeriod();
  const { range } = dateRange;

  const analysis = useMemo(
    () => calculateCashFlowAnalysis(orders, adSpend, expenses, range, settings.cashBuffer),
    [orders, adSpend, expenses, range, settings.cashBuffer],
  );
  /*
   * The two unpaid tiles ask the server, not the legacy store.
   *
   * `calculateCashFlowAnalysis` sums unpaid rows in the period and knows
   * nothing about advances, so this page said "Bills not paid Rs 1,154,000"
   * while Money owed said Rs 1,004,000 — the difference being a deposit that
   * had already settled part of a bill. `/reports/owed` is the one place that
   * rule lives. It is also period-free on purpose: a bill nobody has paid is
   * outstanding whichever month the header shows, which is what these two
   * tiles have always meant.
   *
   * Scoped to these two figures. The rest of the page is still the legacy
   * calculation, and moving it needs the cash-basis endpoint that does not
   * exist yet (REWRITE_PLAN §12, piece C).
   */
  const owedQuery = useOwed();
  const owed = owedQuery.data;
  const owedState = figureState(owedQuery, owed != null);

  const {
    cashFlow,
    ownerWithdrawals,
    totalCashIn,
    totalCashOut,
    availableCashEstimate,
    cashPressure,
    cashInRows,
    cashOutRows,
    positionRows,
    warnings,
  } = analysis;

  // Server/lib-computed, not derived here — the UI never does money math.
  const net = cashFlow.netCashFlow;
  const positive = net >= 0;
  const empty = totalCashIn === 0 && totalCashOut === 0;

  /* ── The flow, as a ladder. ───────────────────────────────────────────── */
  const steps: LadderStep[] = [
    { id: "in", label: "Came in", value: totalCashIn, kind: "start" },
    { id: "out", label: "Went out", value: totalCashOut, kind: "deduction" },
    { id: "net", label: "Left over", value: net, kind: "end" },
  ];

  const toSegments = (rows: MovementRow[], tone: "gain" | "neutral"): ShareSegment[] =>
    rows
      .filter((row) => row.kind !== "total" && row.amount !== 0)
      .map((row) => ({ id: row.label, label: row.label, value: Math.abs(row.amount), tone }));

  const movementColumns: Column<MovementRow>[] = [
    {
      key: "label",
      header: "Cash item",
      render: (row) => (
        /* The per-row explanation used to sit under every single line. It is
           one hover away now, which is where a definition belongs once the
           picture above has already answered the question. */
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="cursor-help border-b border-dotted border-[color:var(--pl-hairline)]">
              {row.label}
            </span>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">{row.help}</TooltipContent>
        </Tooltip>
      ),
    },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      bar: (row) => (row.kind === "total" ? null : Math.abs(row.amount)),
      render: (row) => (
        <span
          className={cn(
            "t-num",
            row.kind === "total" && "font-semibold",
            row.kind === "in"
              ? "text-[color:var(--pl-green)]"
              : row.kind === "out"
                ? "text-[color:var(--pl-red)]"
                : row.kind === "total" && row.amount < 0
                  ? "text-[color:var(--pl-red)]"
                  : "text-[color:var(--pl-ink)]",
          )}
        >
          {row.kind === "out" || row.amount < 0 ? "−" : ""}
          {f.money(Math.abs(row.amount))}
        </span>
      ),
    },
  ];

  const caption = empty
    ? "Nothing has moved in or out this period."
    : positive
      ? `${f.money(totalCashIn)} came in and ${f.money(totalCashOut)} went out, leaving ${f.money(net)}.`
      : `${f.money(totalCashOut)} went out against ${f.money(totalCashIn)} in — ${f.money(-net)} more than arrived.`;

  return {
    dataState,
    empty,
    positive,
    f,
    net,
    caption,
    movementColumns,
    positionRows,
    steps,
    owedState,
    owed,
    ownerWithdrawals,
    availableCashEstimate,
    totalCashIn,
    cashInRows,
    toSegments,
    totalCashOut,
    cashOutRows,
    warnings,
    cashPressure,
  };
}
