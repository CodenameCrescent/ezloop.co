import { useMemo, useState } from "react";
import { Info } from "lucide-react";
import { TopBar } from "@/components/TopBar";
import { MoneyTabBar } from "@/components/MoneyTabBar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ChartFrame } from "@/components/charts/ChartFrame";
import { Ladder, type LadderStep } from "@/components/charts/Ladder";
import { ShareBar, type ShareSegment } from "@/components/charts/ShareBar";
import type { Column } from "@/components/DataTable";
import { Reveal, Stagger } from "@/components/Reveal";
import { useGlobalPeriod } from "@/lib/globalPeriod";
import { useFormatters } from "@/lib/store";
import { usePnl, toApiRange } from "@/api/hooks";
import { figureState } from "@/lib/figureState";
import { cn } from "@/lib/utils";
import { ACCOUNTING_BASES, BASIS_LABELS, LADDER_LABELS, type AccountingBasis } from "@workspace/domain";

/**
 * Profit & Loss — the ladder, drawn.
 *
 * The exemplar for the chart system: the page leads with a picture of the
 * ladder shrinking from gross revenue to true profit, states the outcome once
 * as the page's single hero figure, and shows the three breakdowns that used
 * to hide inside one-at-a-time accordions as share bars readable side by side.
 *
 * Exactly ONE sentence of prose survives, as the caption under the figure.
 * The eight text rows the old page led with live on in full behind the
 * frame's table toggle — nothing was lost, it just stopped being the first
 * thing an owner has to read.
 *
 * The rung vocabulary comes verbatim from LADDER_LABELS — the ladder is
 * computed in exactly one module and named with exactly one vocabulary
 * (CLAUDE.md), and this page does not paraphrase it.
 *
 * Two bugs died in this rewrite: the page rendered TWO date filters bound to
 * the same global period (TopBar's PageHeader already carries one), and it was
 * written in a second token system (shadcn classes and the legacy pl-glass
 * alias) that themed through a different code path from every other page.
 */

type GroupKey = "type" | "category" | "source";

type LadderRowView = { id: string; label: string; amountCents: number; deduction: boolean };

export default function ProfitLoss() {
  const period = useGlobalPeriod();
  const f = useFormatters();
  const range = useMemo(() => toApiRange(period.range), [period.range]);
  /**
   * Which date the ladder measures by. Profit is the default and the honest
   * answer to "did I make money"; cash answers "did the money arrive", and the
   * two differ exactly when something is billed in one month and paid in another.
   */
  const [basis, setBasis] = useState<AccountingBasis>("accrual");
  const pnl = usePnl(range, basis);
  const [groupBy, setGroupBy] = useState<GroupKey>("type");

  const money = f.moneyCents;
  const l = pnl.data?.ladder;
  /*
   * Why there is no ladder, when there is no ladder.
   *
   * `loading` was `isLoading && !data`, so a failed or paused request left it
   * false with nothing behind it — and the three breakdown frames below read
   * `empty={!loading && segments.length === 0}`, which meant they printed "No
   * revenue recorded in this period.", "No direct costs recorded" and "No
   * expenses recorded in this period." off a request that never arrived.
   * Three sentences about the business, from no data at all, on the page the
   * Dashboard promises never to disagree with.
   */
  const state = figureState(pnl, pnl.data != null);
  const empty = state === "settled" && !!l && l.grossRevenue === 0 && l.periodExpenses === 0;

  const steps: LadderStep[] = l
    ? [
        { id: "gross", label: LADDER_LABELS.grossRevenue.label, value: l.grossRevenue, kind: "start" },
        { id: "discounts", label: "Discounts", value: l.discounts, kind: "deduction" },
        {
          id: "refunds",
          label: "Refunds",
          value: l.refunds,
          kind: "deduction",
          rungLabel: LADDER_LABELS.netRevenue.label,
          runningTotal: l.netRevenue,
        },
        {
          id: "direct",
          label: "Direct costs & fees",
          value: l.directCosts,
          kind: "deduction",
          rungLabel: LADDER_LABELS.contributionProfit.label,
          runningTotal: l.contributionProfit,
        },
        { id: "expenses", label: "Period expenses", value: l.periodExpenses, kind: "deduction" },
        { id: "true", label: LADDER_LABELS.trueProfit.label, value: l.trueProfit, kind: "end" },
      ]
    : [];

  /* The same facts as numbers — the WCAG-clean twin behind the frame's table
     toggle. The old page WAS this table; nothing is lost. */
  const tableRows: LadderRowView[] = l
    ? [
        { id: "gross", label: LADDER_LABELS.grossRevenue.label, amountCents: l.grossRevenue, deduction: false },
        { id: "discounts", label: "Discounts", amountCents: -l.discounts, deduction: true },
        { id: "refunds", label: "Refunds", amountCents: -l.refunds, deduction: true },
        { id: "net", label: LADDER_LABELS.netRevenue.label, amountCents: l.netRevenue, deduction: false },
        { id: "direct", label: "Direct costs & fees", amountCents: -l.directCosts, deduction: true },
        { id: "contribution", label: LADDER_LABELS.contributionProfit.label, amountCents: l.contributionProfit, deduction: false },
        { id: "expenses", label: "Period expenses", amountCents: -l.periodExpenses, deduction: true },
        { id: "true", label: LADDER_LABELS.trueProfit.label, amountCents: l.trueProfit, deduction: false },
      ]
    : [];

  const tableColumns: Column<LadderRowView>[] = [
    {
      key: "rung",
      header: "Rung",
      render: (row) => (
        <span className={cn(row.deduction ? "t-secondary" : "font-medium text-[color:var(--pl-ink)]")}>
          {row.label}
        </span>
      ),
    },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      render: (row) => (
        <span className={cn("t-num", !row.deduction && "font-semibold")}>
          {money(row.amountCents)}
        </span>
      ),
    },
  ];

  /* ── The one sentence this page keeps. ──────────────────────────────────── */
  const caption = !l
    ? ""
    : l.netRevenue <= 0
      ? "Nothing came in this period."
      : l.trueProfit >= 0
        ? `Of the ${money(l.netRevenue)} that came in, you kept ${money(l.trueProfit)}.`
        : `You spent ${money(-l.trueProfit)} more than the ${money(l.netRevenue)} that came in.`;

  const profitable = (l?.trueProfit ?? 0) >= 0;

  const toSegments = (
    rows: Array<{ id: string; label: string; value: number }>,
  ): ShareSegment[] =>
    rows
      .filter((row) => row.value !== 0)
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
      .map((row) => ({ id: row.id, label: row.label, value: row.value }));

  const revenueSegments = pnl.data
    ? toSegments(
        pnl.data.revenueGroups[groupBy].map((row) => ({
          id: row.key,
          label: row.label,
          value: row.amountCents,
        })),
      )
    : [];
  const costSegments = pnl.data
    ? toSegments(
        pnl.data.costComponents.map((component) => ({
          id: component.name,
          label: component.kind === "fee" ? `${component.name} (fee)` : component.name,
          value: component.totalCents,
        })),
      )
    : [];
  const expenseSegments = pnl.data
    ? toSegments(
        pnl.data.expenseGroups.map((group) => ({
          id: group.key,
          label: group.label,
          value: group.amountCents,
        })),
      )
    : [];

  return (
    <>
      <TopBar title="Profit & Loss" subtitle="Your profit ladder for the selected period." />
      <MoneyTabBar />
      <div className="app-page-shell">
        <Stagger className="space-y-5" step={0.05}>
          {/* Accrual vs cash. A real control with a real explanation — kept. */}
          <Reveal className="flex flex-wrap items-center gap-3">
            <div className="flex gap-1 rounded-lg bg-[color:var(--pl-recessed)] p-1">
              {ACCOUNTING_BASES.map((b) => (
                <button
                  key={b}
                  onClick={() => setBasis(b)}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                    basis === b
                      ? "bg-[color:var(--pl-surface)] text-[color:var(--pl-ink)]"
                      : "text-[color:var(--pl-ink-2)] hover:text-[color:var(--pl-ink)]",
                  )}
                >
                  {BASIS_LABELS[b].label}
                </button>
              ))}
            </div>
            <p className="t-secondary text-xs">{BASIS_LABELS[basis].help}</p>
          </Reveal>

          {/* ── The ladder, led by its outcome. ─────────────────────────────── */}
          <Reveal>
            <ChartFrame<LadderRowView>
              title="The profit ladder"
              hint="Each bar takes a bite out of the one above it"
              figure={
                l && !empty ? (
                  <div>
                    {/* The page's one hero figure, wearing its verdict colour AND
                        its sign — colour is never the only channel on money.
                        Compact above a million: ".51" at 56px is noise, and the
                        exact figure is one sentence below and in the table. */}
                    <p
                      className="t-hero"
                      style={{ color: profitable ? "var(--pl-green)" : "var(--pl-red)" }}
                    >
                      {Math.abs(l.trueProfit) >= 1_000_000_00
                        ? `${l.trueProfit > 0 ? "+" : ""}${f.compactCents(l.trueProfit)}`
                        : f.moneyCentsSigned(l.trueProfit)}
                    </p>
                    <p className="t-verdict mt-1 text-[color:var(--pl-ink-2)]">{caption}</p>
                  </div>
                ) : undefined
              }
              height={300}
              state={state}
              empty={empty}
              emptyMessage="Record a sale or an expense and the ladder will build itself."
              tableView={{ columns: tableColumns, rows: tableRows, getRowKey: (row) => row.id }}
            >
              <Ladder steps={steps} format={money} />
            </ChartFrame>
          </Reveal>

          {/* ── The three breakdowns, all readable at once. ──────────────────
                They used to live one-at-a-time inside accordions, so comparing
                two of them was impossible by construction. Identity colours —
                the validated categorical slots — because a source is not "more"
                than a category, only different from it. */}
          <Reveal as="section" className="grid gap-5 xl:grid-cols-3">
            <ChartFrame
              title="Where revenue came from"
              action={
                <div className="flex gap-1 rounded-lg bg-[color:var(--pl-recessed)] p-1">
                  {(["type", "category", "source"] as GroupKey[]).map((g) => (
                    <button
                      key={g}
                      onClick={() => setGroupBy(g)}
                      className={cn(
                        "rounded-md px-2.5 py-1 text-xs capitalize transition-colors",
                        groupBy === g
                          ? "bg-[color:var(--pl-surface)] font-medium text-[color:var(--pl-ink)]"
                          : "text-[color:var(--pl-ink-2)] hover:text-[color:var(--pl-ink)]",
                      )}
                    >
                      {g}
                    </button>
                  ))}
                </div>
              }
              height={160}
              state={state}
              empty={revenueSegments.length === 0}
              emptyMessage="No revenue recorded in this period."
              surface="sm"
            >
              <ShareBar segments={revenueSegments} layout="rows" format={money} size="sm" />
            </ChartFrame>

            <ChartFrame
              title="What the sold things cost"
              hint="From the frozen cost snapshots"
              height={160}
              state={state}
              empty={costSegments.length === 0}
              emptyMessage="No direct costs recorded — add costs to what you sell and they appear here."
              surface="sm"
            >
              <ShareBar segments={costSegments} layout="rows" format={money} size="sm" />
            </ChartFrame>

            <ChartFrame
              title="What the period cost"
              hint="Bills and running costs, by type"
              height={160}
              state={state}
              empty={expenseSegments.length === 0}
              emptyMessage="No expenses recorded in this period."
              surface="sm"
            >
              <ShareBar segments={expenseSegments} layout="rows" format={money} size="sm" />
            </ChartFrame>
          </Reveal>

          {/* The rung definitions, for whoever wants them — tooltips, not prose. */}
          <Reveal className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
            {(Object.keys(LADDER_LABELS) as Array<keyof typeof LADDER_LABELS>).map((key) => (
              <Tooltip key={key}>
                <TooltipTrigger asChild>
                  <span className="t-micro inline-flex cursor-help items-center gap-1">
                    <Info className="h-3 w-3" />
                    {LADDER_LABELS[key].label}
                  </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">{LADDER_LABELS[key].tooltip}</TooltipContent>
              </Tooltip>
            ))}
          </Reveal>
        </Stagger>
      </div>
    </>
  );
}
