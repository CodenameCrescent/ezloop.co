import { useMemo, useState } from "react";
import { BadgePercent, Calculator, Goal, Package, Target } from "lucide-react";
import { formatQuantity, quantityFieldLabel } from "@workspace/domain";
import { TopBar } from "@/components/TopBar";
import { MoneyTabBar } from "@/components/MoneyTabBar";
import { Surface } from "@/components/Surface";
import { Reveal, Stagger } from "@/components/Reveal";
import { FigureSlot } from "@/components/FigureSlot";
import { ChartFrame } from "@/components/charts/ChartFrame";
import { ShareBar } from "@/components/charts/ShareBar";
import { useGlobalPeriod } from "@/lib/globalPeriod";
import { useFormatters } from "@/lib/store";
import { figureState, figureStateSentence } from "@/lib/figureState";
import { toApiRange, useBreakEven } from "@/api/hooks";

/**
 * How much you have to sell before the month stops costing you money.
 *
 * Split out from the old Budget & break-even page, which had two halves that
 * shared nothing: this one, computed on the server from the real ledger, and a
 * budget half that read a legacy in-browser bridge and guessed actual spending
 * by searching expense names for words. That half is gone; this is what
 * survived, unchanged in substance.
 */
export default function BreakEven() {
  const f = useFormatters();
  const { range } = useGlobalPeriod();
  const [targetProfit, setTargetProfit] = useState("100000");

  const targetProfitCents = Math.max(0, Math.round((Number(targetProfit) || 0) * 100));
  const query = useBreakEven(useMemo(() => toApiRange(range), [range]), targetProfitCents);
  const breakEven = query.data;
  const state = figureState(query, breakEven != null);
  const money = f.moneyCents;

  /**
   * One sentence, chosen by the SERVER's own reason rather than guessed from a
   * missing value — an owner with no sales this period must not be told they
   * break even at Rs 0.
   */
  const headline = (() => {
    if (!breakEven) {
      return state === "loading"
        ? "Working it out…"
        : (figureStateSentence(state, "your break-even point") ?? "Break-even is unavailable right now.");
    }
    switch (breakEven.reason) {
      case "ok":
        return `You need ${money(breakEven.breakEvenRevenueCents!)} of sales in this period to cover your costs.`;
      case "no_fixed_costs":
        return "You have no costs that stay the same in this period, so every sale is already profit.";
      case "no_sales":
        return "No sales in this period yet, so there is no margin to work out a target from.";
      case "no_margin":
        return "Right now each sale costs more than it brings in, so selling more will not cover your fixed costs. Fix the margin first.";
    }
  })();

  return (
    <>
      <TopBar
        title="Break-even"
        subtitle="How much you have to sell before the period stops costing you money"
      />
      <MoneyTabBar />
      <div className="app-page-shell">
        <Stagger className="space-y-5">
          <Reveal>
            <Surface variant="hero" padding="md">
              <p className="t-body text-[color:var(--pl-ink)]">{headline}</p>
              {breakEven?.breakEvenTransactions != null && (
                <p className="t-secondary mt-2 text-[color:var(--pl-ink-2)]">
                  That is around {breakEven.breakEvenTransactions} sales at the size you have been
                  selling at.
                </p>
              )}
              {breakEven?.breakEvenUnits != null && (
                <p className="t-secondary mt-1 text-[color:var(--pl-ink-2)]">
                  Or around {formatQuantity(String(breakEven.breakEvenUnits), breakEven.breakEvenUnitLabel)} sold.
                </p>
              )}
            </Surface>
          </Reveal>

          <Reveal>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Surface padding="md">
                <p className="t-micro text-[color:var(--pl-ink-3)]">Sales needed</p>
                <p className="t-title mt-1 text-[color:var(--pl-ink)]">
                  <FigureSlot state={state}>
                    {breakEven?.breakEvenRevenueCents == null ? "—" : money(breakEven.breakEvenRevenueCents)}
                  </FigureSlot>
                </p>
                <p className="t-micro mt-1 text-[color:var(--pl-ink-3)]">To cover this period's costs</p>
              </Surface>

              <Surface padding="md">
                <p className="t-micro text-[color:var(--pl-ink-3)]">Left over from each sale</p>
                <p className="t-title mt-1 text-[color:var(--pl-ink)]">
                  <FigureSlot state={state}>
                    {breakEven?.contributionMarginPct == null
                      ? "—"
                      : `${breakEven.contributionMarginPct.toFixed(1)}%`}
                  </FigureSlot>
                </p>
                <p className="t-micro mt-1 text-[color:var(--pl-ink-3)]">Once the costs that scale are paid</p>
              </Surface>

              <Surface padding="md">
                <p className="t-micro text-[color:var(--pl-ink-3)]">
                  {breakEven?.breakEvenUnitLabel
                    ? `${quantityFieldLabel(breakEven.breakEvenUnitLabel)} needed`
                    : "Units needed"}
                </p>
                <p className="t-title mt-1 text-[color:var(--pl-ink)]">
                  <FigureSlot state={state}>
                    {breakEven?.breakEvenUnits == null ? "—" : String(breakEven.breakEvenUnits)}
                  </FigureSlot>
                </p>
                <p className="t-micro mt-1 text-[color:var(--pl-ink-3)]">
                  {breakEven?.breakEvenUnits == null
                    ? "You sell in more than one unit — use the sales figure"
                    : "At this period's average price"}
                </p>
              </Surface>

              <Surface padding="md">
                <p className="t-micro text-[color:var(--pl-ink-3)]">How far you got</p>
                <p className="t-title mt-1 text-[color:var(--pl-ink)]">
                  <FigureSlot state={state}>
                    {breakEven?.coveredPct == null ? "—" : `${breakEven.coveredPct.toFixed(0)}%`}
                  </FigureSlot>
                </p>
                <p className="t-micro mt-1 text-[color:var(--pl-ink-3)]">Of the sales needed to break even</p>
              </Surface>
            </div>
          </Reveal>

          {breakEven && (breakEven.fixedExpensesCents > 0 || breakEven.variableExpensesCents > 0) && (
            <Reveal>
              <Surface padding="md">
                <ChartFrame
                  title="What your costs are made of"
                  hint="Fixed costs must be covered before any sale pays you"
                  height={64}
                  state="settled"
                  surface={false}
                >
                  <ShareBar
                    segments={[
                      { id: "fixed", label: "Stay the same", value: breakEven.fixedExpensesCents, tone: "cat-1" },
                      { id: "variable", label: "Grow with sales", value: breakEven.variableExpensesCents, tone: "cat-3" },
                    ]}
                    layout="stacked"
                    format={money}
                    size="sm"
                  />
                </ChartFrame>
              </Surface>
            </Reveal>
          )}

          <Reveal>
            <div className="grid gap-5 xl:grid-cols-2">
              <Surface padding="md" className="space-y-4">
                <div className="flex items-start gap-3">
                  <span className="rounded-[length:var(--pl-r-md)] bg-[color:var(--pl-orange-tint)] p-2 text-[color:var(--pl-orange-text)]">
                    <Calculator className="h-4 w-4" />
                  </span>
                  <div>
                    <h2 className="t-section text-[color:var(--pl-ink)]">Aiming higher than break-even</h2>
                    <p className="t-micro mt-0.5 text-[color:var(--pl-ink-3)]">
                      Break-even is survival. This is what a profit on top would take.
                    </p>
                  </div>
                </div>
                <label className="block">
                  <span className="t-micro text-[color:var(--pl-ink-2)]">Profit you want on top</span>
                  <input
                    type="number"
                    min="0"
                    value={targetProfit}
                    onChange={(event) => setTargetProfit(event.target.value)}
                    className="mt-1 w-full rounded-[length:var(--pl-r-sm)] border border-[color:var(--pl-grid-line)] bg-[color:var(--pl-surface)] px-3 py-2.5 text-[color:var(--pl-ink)] outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--pl-orange)]"
                  />
                </label>
                <p className="t-body text-[color:var(--pl-ink)]">
                  {breakEven?.revenueForTargetProfitCents != null
                    ? `To make ${money(targetProfitCents)} profit on top, you need ${money(breakEven.revenueForTargetProfitCents)} of sales.`
                    : "A profit target needs a working margin before it can be costed."}
                </p>
              </Surface>

              <Surface padding="md" className="space-y-3">
                <h2 className="t-section text-[color:var(--pl-ink)]">Where you stand</h2>
                {breakEven?.surplusCents != null && (
                  <p className="t-body text-[color:var(--pl-ink)]">
                    {breakEven.surplusCents >= 0 ? (
                      <>
                        You are{" "}
                        <span className="font-semibold text-[color:var(--pl-green)]">
                          +{money(breakEven.surplusCents)}
                        </span>{" "}
                        past break-even this period.
                      </>
                    ) : (
                      <>
                        You are{" "}
                        <span className="font-semibold text-[color:var(--pl-red)]">
                          -{money(Math.abs(breakEven.surplusCents))}
                        </span>{" "}
                        short of break-even this period.
                      </>
                    )}
                  </p>
                )}
                {breakEven != null && breakEven.unclassifiedExpensesCents > 0 && (
                  <p className="t-secondary rounded-[length:var(--pl-r-md)] bg-[color:var(--pl-amber-tint)] p-3 text-[color:var(--pl-amber)]">
                    {money(breakEven.unclassifiedExpensesCents)} of spend is not linked to an expense item
                    yet, so it is counted as growing with sales. Link it on the Expenses page to
                    sharpen this number.
                  </p>
                )}
                {breakEven != null && breakEven.fixedCostBreakdown.length > 0 && (
                  <div>
                    <p className="t-micro text-[color:var(--pl-ink-3)]">
                      What makes up the costs that stay the same
                    </p>
                    <ul className="mt-2 space-y-1.5">
                      {breakEven.fixedCostBreakdown.map((row) => (
                        <li key={row.id} className="flex items-center justify-between gap-3">
                          <span className="t-secondary truncate text-[color:var(--pl-ink)]">
                            {row.name}
                            {row.costNature === "semi_variable" && (
                              <span className="t-micro ml-1.5 text-[color:var(--pl-ink-3)]">
                                (partly grows with sales)
                              </span>
                            )}
                          </span>
                          <span className="t-num shrink-0 text-[color:var(--pl-ink-2)]">
                            {money(row.amountCents)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </Surface>
            </div>
          </Reveal>
        </Stagger>
      </div>
    </>
  );
}
