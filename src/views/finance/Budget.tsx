import { useState } from "react";
import { Plus, Sparkles } from "lucide-react";
import type { EndpointResponse, listBudgets } from "@workspace/api-contract";
import { TopBar } from "@/components/TopBar";
import { MoneyTabBar } from "@/components/MoneyTabBar";
import { Surface } from "@/components/Surface";
import { Reveal, Stagger } from "@/components/Reveal";
import { Meter } from "@/components/charts/Meter";
import { FigureSlot } from "@/components/FigureSlot";
import { figureState } from "@/lib/figureState";
import { useFormatters } from "@/lib/store";
import { useBudget, useBudgets } from "@/api/hooks";
import { cn } from "@/lib/utils";
import { type BudgetDetail, NewBudgetForm, SuggestionPanel } from "./Budget.parts/SuggestionPanel";
type BudgetSummary = EndpointResponse<typeof listBudgets>["items"][number];

/**
 * What you planned, against what actually happened.
 *
 * The screen this replaces stored six fixed categories in a settings blob and
 * found "actual spend" by searching expense names for words — so "Rent" also
 * claimed "Equipment rental", and anything matching nothing simply DISAPPEARED
 * from the comparison. A business could be far over its real spending while
 * every line read comfortably under. That is why the unbudgeted figure below is
 * not a footnote: it is the number that stops this screen lying.
 */

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

/** How the goal is going, in the order an owner asks it. */
function GoalPanel({ pace }: { pace: NonNullable<BudgetDetail["pace"]> }) {
  const f = useFormatters();
  return (
    <Surface variant="hero" padding="md" className="space-y-3">
      <h2 className="t-section text-[color:var(--pl-ink)]">Your goal</h2>
      <p className="t-body text-[color:var(--pl-ink)]">
        To make {f.moneyCents(pace.targetProfitCents)} you need{" "}
        {pace.revenueNeededCents === null
          ? "a working margin before that can be costed"
          : `${f.moneyCents(pace.revenueNeededCents)} of sales`}
        .
      </p>
      <p className="t-body text-[color:var(--pl-ink)]">
        You are {pace.monthsElapsed} of {pace.monthsTotal} months in with{" "}
        {f.moneyCents(pace.profitSoFarCents)}, which is{" "}
        <span
          className={cn(
            pace.onTrack ? "text-[color:var(--pl-green)]" : "text-[color:var(--pl-red)]",
            "font-semibold",
          )}
        >
          {/* Sign as well as colour: green and red do not separate under colour
              blindness (DESIGN.md §3a). */}
          {pace.aheadByCents >= 0 ? "+" : "-"}
          {f.moneyCents(Math.abs(pace.aheadByCents))}
        </span>{" "}
        {pace.aheadByCents >= 0 ? "ahead of" : "behind"} a steady run at it.
      </p>
      <p className="t-body text-[color:var(--pl-ink)]">
        {pace.neededPerRemainingMonthCents === null
          ? "The period has ended, so there are no months left to make it up in."
          : pace.neededPerRemainingMonthCents === 0
            ? "You have already passed the target."
            : `To finish on target you need ${f.moneyCents(pace.neededPerRemainingMonthCents)} of profit a month for the ${pace.monthsRemaining} months left.`}
      </p>
    </Surface>
  );
}

function LineRow({ line }: { line: BudgetDetail["lines"][number] }) {
  const f = useFormatters();
  return (
    <li className="flex flex-wrap items-center gap-3 py-3 sm:flex-nowrap">
      <span className="t-secondary min-w-0 flex-1 truncate text-[color:var(--pl-ink)]">
        {line.name}
        {line.basis === "per_month" && (
          <span className="t-micro ml-2 text-[color:var(--pl-ink-3)]">
            {f.moneyCents(line.amountCents)}/mo
          </span>
        )}
      </span>
      <span className="t-num w-28 shrink-0 text-right text-[color:var(--pl-ink-2)]">
        {f.moneyCents(line.budgetedCents)}
      </span>
      <span
        className={cn(
          "t-num w-28 shrink-0 text-right",
          line.over ? "text-[color:var(--pl-red)]" : "text-[color:var(--pl-ink)]",
        )}
      >
        {f.moneyCents(line.actualCents)}
      </span>
      <span className="w-32 shrink-0">
        {/* A full bar is bad news here: 100% of a budget spent is the ceiling,
            not a score. Green below 85, neutral to 100, red past it. */}
        <Meter
          value={Math.min(100, line.pctUsed ?? 0)}
          tone={line.over ? "loss" : (line.pctUsed ?? 0) > 85 ? "neutral" : "gain"}
          inline
        />
      </span>
      <span className="t-micro w-14 shrink-0 text-right text-[color:var(--pl-ink-3)]">
        {line.pctUsed === null ? "—" : `${line.pctUsed.toFixed(0)}%`}
      </span>
    </li>
  );
}

export default function Budget() {
  const budgets = useBudgets();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const f = useFormatters();

  const items: BudgetSummary[] = budgets.data?.items ?? [];
  const activeId = selectedId ?? items[0]?.id ?? null;
  const detail = useBudget(activeId);
  const state = figureState(detail, detail.data != null);
  const data = detail.data;

  const costLines = (data?.lines ?? []).filter((line) => line.side === "out");
  const incomeLines = (data?.lines ?? []).filter((line) => line.side === "in");

  return (
    <>
      <TopBar title="Budget" subtitle="What you planned, against what actually happened" />
      <MoneyTabBar />
      <div className="app-page-shell">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setSelectedId(item.id)}
                className={cn(
                  "pl-press rounded-[length:var(--pl-r-full)] px-3 py-1.5",
                  item.id === activeId
                    ? "bg-[color:var(--pl-orange)] font-semibold text-[color:var(--pl-on-orange)]"
                    : "border border-[color:var(--pl-grid-line)] text-[color:var(--pl-ink-2)] hover:bg-[color:var(--pl-recessed)]",
                )}
              >
                {item.name}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            {data && (
              <button
                type="button"
                onClick={() => setSuggesting(true)}
                className="pl-press inline-flex items-center gap-2 rounded-[length:var(--pl-r-full)] border border-[color:var(--pl-grid-line)] px-4 py-2 text-[color:var(--pl-ink)] transition-colors hover:bg-[color:var(--pl-recessed)]"
              >
                <Sparkles className="h-4 w-4" />
                Build it from my history
              </button>
            )}
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="pl-press inline-flex items-center gap-2 rounded-[length:var(--pl-r-full)] border border-[color:var(--pl-grid-line)] px-4 py-2 font-medium text-[color:var(--pl-ink)] transition-colors hover:bg-[color:var(--pl-recessed)]"
            >
              <Plus className="h-4 w-4" />
              New budget
            </button>
          </div>
        </div>

        {adding && (
          <NewBudgetForm
            onDone={(id) => {
              setAdding(false);
              setSelectedId(id);
              setSuggesting(true);
            }}
          />
        )}

        {suggesting && data && (
          <SuggestionPanel budget={data.budget} onDone={() => setSuggesting(false)} />
        )}

        {budgets.isSuccess && items.length === 0 && !adding && (
          <Surface padding="lg" className="text-center">
            <p className="t-section text-[color:var(--pl-ink)]">No budget yet</p>
            <p className="t-secondary mx-auto mt-2 max-w-md text-[color:var(--pl-ink-2)]">
              Make one and Profit Loop will offer to fill it in from what you already spend, so
              you are correcting a draft rather than staring at an empty form.
            </p>
          </Surface>
        )}

        {activeId && (
          <Stagger className="space-y-5">
            {data?.pace && (
              <Reveal>
                <GoalPanel pace={data.pace} />
              </Reveal>
            )}

            <Reveal>
              <div className="grid gap-4 sm:grid-cols-3">
                <Surface padding="md">
                  <p className="t-micro text-[color:var(--pl-ink-3)]">Planned spending</p>
                  <p className="t-title mt-1 text-[color:var(--pl-ink)]">
                    <FigureSlot state={state}>{f.moneyCents(data?.totals.out.budgetedCents ?? 0)}</FigureSlot>
                  </p>
                </Surface>
                <Surface padding="md">
                  <p className="t-micro text-[color:var(--pl-ink-3)]">Actually spent</p>
                  <p className="t-title mt-1 text-[color:var(--pl-ink)]">
                    <FigureSlot state={state}>{f.moneyCents(data?.totals.out.actualCents ?? 0)}</FigureSlot>
                  </p>
                </Surface>
                <Surface padding="md">
                  <p className="t-micro text-[color:var(--pl-ink-3)]">Not in any budget line</p>
                  <p className="t-title mt-1 text-[color:var(--pl-ink)]">
                    <FigureSlot state={state}>{f.moneyCents(data?.unbudgeted.outCents ?? 0)}</FigureSlot>
                  </p>
                  {/* The figure that stops this page lying. The screen this
                      replaces dropped unmatched money entirely, so it could
                      report "under budget" for a business that was not. */}
                  <p className="t-micro mt-1 text-[color:var(--pl-ink-3)]">
                    {state === "settled" && data
                      ? data.unbudgeted.count === 0
                        ? "Every cost is covered by a line."
                        : data.unbudgeted.count === 1
                          ? "1 cost is not covered by any line, and is counted in the total above."
                          : `${data.unbudgeted.count} costs are not covered by any line, and are counted in the total above.`
                      : " "}
                  </p>
                </Surface>
              </div>
            </Reveal>

            {costLines.length > 0 && (
              <Reveal>
                <Surface padding="none" className="overflow-hidden">
                  <div className="flex items-center gap-3 border-b border-[color:var(--pl-grid-line)] px-4 py-3">
                    <span className="t-secondary flex-1 font-semibold text-[color:var(--pl-ink)]">Costs</span>
                    <span className="t-micro w-28 text-right text-[color:var(--pl-ink-3)]">Planned</span>
                    <span className="t-micro w-28 text-right text-[color:var(--pl-ink-3)]">Actual</span>
                    <span className="w-32" />
                    <span className="w-14" />
                  </div>
                  <ul className="divide-y divide-[color:var(--pl-grid-line)] px-4">
                    {costLines.map((line) => (
                      <LineRow key={line.id} line={line} />
                    ))}
                  </ul>
                </Surface>
              </Reveal>
            )}

            {incomeLines.length > 0 && (
              <Reveal>
                <Surface padding="none" className="overflow-hidden">
                  <div className="flex items-center gap-3 border-b border-[color:var(--pl-grid-line)] px-4 py-3">
                    <span className="t-secondary flex-1 font-semibold text-[color:var(--pl-ink)]">Income</span>
                    <span className="t-micro w-28 text-right text-[color:var(--pl-ink-3)]">Planned</span>
                    <span className="t-micro w-28 text-right text-[color:var(--pl-ink-3)]">Actual</span>
                    <span className="w-32" />
                    <span className="w-14" />
                  </div>
                  <ul className="divide-y divide-[color:var(--pl-grid-line)] px-4">
                    {incomeLines.map((line) => (
                      <LineRow key={line.id} line={line} />
                    ))}
                  </ul>
                </Surface>
              </Reveal>
            )}

            {state === "settled" && data && data.lines.length === 0 && !suggesting && (
              <Reveal>
                <Surface padding="lg" className="text-center">
                  <p className="t-section text-[color:var(--pl-ink)]">Nothing budgeted yet</p>
                  <p className="t-secondary mx-auto mt-2 max-w-md text-[color:var(--pl-ink-2)]">
                    Let Profit Loop propose a starting point from what you already spend.
                  </p>
                  <button
                    type="button"
                    onClick={() => setSuggesting(true)}
                    className="pl-press mt-4 inline-flex items-center gap-2 rounded-[length:var(--pl-r-full)] bg-[color:var(--pl-orange)] px-5 py-2.5 font-semibold text-[color:var(--pl-on-orange)]"
                  >
                    <Sparkles className="h-4 w-4" />
                    Build it from my history
                  </button>
                </Surface>
              </Reveal>
            )}
          </Stagger>
        )}
      </div>
    </>
  );
}
