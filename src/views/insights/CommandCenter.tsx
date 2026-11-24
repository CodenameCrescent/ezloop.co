import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { LiquidGlassCard } from "@/components/LiquidGlassCard";
import { Skeleton } from "@/components/ui/skeleton";
import { ChartFrame } from "@/components/charts/ChartFrame";
import { DivergingBar } from "@/components/charts/DivergingBar";
import { InsightFeed } from "@/components/InsightFeed";
import { figureState, figureStateSentence } from "@/lib/figureState";
import { cn } from "@/lib/utils";
import { VerdictStrip, MadeMoneyBlock, type CommandCenterState, useCommandCenterLogic } from "./CommandCenter.parts/UseCommandCenterLogic";

export default function CommandCenter() {
  const {
    range,
    f,
    current,
    drivers,
    leaks,
    momentum,
    insightFeed,
    retention,
    money,
    ladder,
    priorLadder,
    currentState,
    driversState,
    leaksState,
    momentumState,
    delta,
    marginPct,
    chartData,
  } = useCommandCenterLogic();

  if (!range) return null;
  return (
    <div className="mx-auto max-w-[1500px] space-y-5 px-4 py-5 sm:px-6 lg:px-8">
      {/* ── Verdict strip: the 30-second read ── */}
      <VerdictStrip current={current} range={range} f={f} ladder={ladder} currentState={currentState} delta={delta} marginPct={marginPct} chartData={chartData} />

      {/* ── What needs your attention: the ranked card feed ──
          This replaced a four-item list of one-line signals. The list said what
          was wrong; a card says what it COST, shows the arithmetic behind that
          figure, and offers the one action that fixes it — which is the whole
          difference between a dashboard and a verdict. */}
      <InsightFeed
        insights={insightFeed.data?.insights ?? []}
        leaks={insightFeed.data?.leaks ?? []}
        totalLeakCents={insightFeed.data?.totalLeakCents ?? 0}
        symbol={f.symbol}
        state={figureState(insightFeed, insightFeed.data != null)}
      />

      {/* ── Block 1 · Did I make money? ── */}
      <MadeMoneyBlock range={range} f={f} ladder={ladder} currentState={currentState} chartData={chartData} priorLadder={priorLadder} money={money} />

      {/* ── Block 2 · What changed? ── */}
      <LiquidGlassCard padding="lg">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-[color:var(--pl-ink)]">What changed?</h2>
            <p className="mt-1 text-xs text-[color:var(--pl-ink-2)]">
              The biggest movers in profit versus the previous period — each explains part of the change.
            </p>
          </div>
          <Link href="/insights/profit" className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-[color:var(--pl-orange-text)] hover:underline">
            Explore profit <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
        {!drivers.data ? (
          driversState === "loading" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full rounded-lg" />)}
            </div>
          ) : (
            <p className="text-sm text-[color:var(--pl-amber)]">
              {figureStateSentence(driversState, "what changed")}
            </p>
          )
        ) : (
          (() => {
            /*
             * One diverging bar rather than two columns of one-sided bars.
             * Splitting gained from lost into separate lists meant the two
             * halves were on the same numeric scale but nowhere near each
             * other, so "did the gains outweigh the losses" — the actual
             * question — had to be answered by memory. A centre rule puts both
             * directions on one axis where the eye does that comparison for
             * free, and the position carries the sign without relying on
             * colour (DESIGN.md 3a).
             */
            const movers = drivers.data.profit
              .filter((r) => r.deltaCents !== 0)
              .sort((a, b) => b.deltaCents - a.deltaCents)
              .slice(0, 8);
            if (movers.length === 0) {
              return <p className="text-sm text-[color:var(--pl-ink-2)]">Not enough history yet to compare periods.</p>;
            }
            return (
              <ChartFrame
                height={Math.max(120, movers.length * 46)}
                state="settled"
                surface={false}
              >
                <DivergingBar
                  rows={movers.map((r) => ({ id: r.key, label: r.label, value: r.deltaCents }))}
                  format={money}
                  zeroLine="centre"
                />
              </ChartFrame>
            );
          })()
        )}
      </LiquidGlassCard>

      {/* ── Block 3 · Where am I leaking? ── */}
      <LiquidGlassCard padding="lg">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-[color:var(--pl-ink)]">Where am I leaking?</h2>
            <p className="mt-1 text-xs text-[color:var(--pl-ink-2)]">Money that came in but didn't stay — refunds, discounts, fees, and unpaid sales.</p>
          </div>
          <Link href="/insights/leaks" className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-[color:var(--pl-orange-text)] hover:underline">
            See all leaks <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
        {!leaks.data ? (
          leaksState === "loading" ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}</div>
          ) : (
            <p className="text-sm text-[color:var(--pl-amber)]">
              {figureStateSentence(leaksState, "where you're leaking")}
            </p>
          )
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <LeakTile label="Refunds" value={money(leaks.data.refunds.totalCents)} sub={`${leaks.data.refunds.ratePct.toFixed(1)}% of gross revenue`} />
            <LeakTile label="Discounts given" value={money(leaks.data.discounts.totalCents)} sub={`${leaks.data.discounts.pctOfGross.toFixed(1)}% of gross revenue`} />
            <LeakTile
              label="Fees"
              value={money(leaks.data.fees.reduce((s, x) => s + x.currentCents, 0))}
              sub={leaks.data.fees[0] ? `${leaks.data.fees[0].name} is the biggest` : "no processor fees"}
            />
            <LeakTile
              label="Unpaid sales"
              value={money(leaks.data.unpaidAging.totalCents)}
              sub={`${leaks.data.unpaidAging.buckets[2]?.count ?? 0} over 30 days old`}
              warn={leaks.data.unpaidAging.totalCents > 0}
            />
          </div>
        )}
      </LiquidGlassCard>

      {/* ── Block 4 · What's working? ── */}
      <WhatsWorkingBlock momentum={momentum} retention={retention} momentumState={momentumState} money={money} />
    </div>
  );
}

function WhatsWorkingBlock({ momentum, retention, momentumState, money }: Pick<CommandCenterState, "momentum" | "retention" | "momentumState" | "money">) {
  return (
    <LiquidGlassCard padding="lg">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-[color:var(--pl-ink)]">What's working?</h2>
            <p className="mt-1 text-xs text-[color:var(--pl-ink-2)]">Your risers and stallers, what sells together, and whether customers come back.</p>
          </div>
          <Link href="/insights/customers" className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-[color:var(--pl-orange-text)] hover:underline">
            Customer insights <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        {!momentum.data ? (
          momentumState === "loading" ? (
            <Skeleton className="h-40 w-full rounded-xl" />
          ) : (
            <p className="text-sm text-[color:var(--pl-amber)]">
              {figureStateSentence(momentumState, "what's working")}
            </p>
          )
        ) : (
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-[color:var(--pl-ink-2)]">
                Risers and stallers
              </div>
              {/* These are the same `driverRow` shape the block above draws as
                  bars; here they were plain text rows, two columns apart, so
                  the same data had two different treatments on one page. One
                  diverging list, one scale, both directions comparable. */}
              {momentum.data.itemWinners.length === 0 && momentum.data.itemLosers.length === 0 ? (
                <p className="text-sm text-[color:var(--pl-ink-2)]">Nothing moved this period.</p>
              ) : (
                <ChartFrame height={200} state="settled" surface={false}>
                  <DivergingBar
                    rows={[
                      ...momentum.data.itemWinners.slice(0, 4),
                      ...momentum.data.itemLosers.slice(0, 4),
                    ]
                      .sort((a, b) => b.deltaCents - a.deltaCents)
                      .map((r) => ({ id: r.key, label: r.label, value: r.deltaCents }))}
                    format={money}
                    zeroLine="centre"
                  />
                </ChartFrame>
              )}
            </div>
            <div>
              <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-[color:var(--pl-ink-2)]">Often bought together</div>
              <div className="space-y-2">
                {momentum.data.pairs.length ? momentum.data.pairs.slice(0, 4).map((p) => (
                  <div key={`${p.aName}-${p.bName}`} className="text-sm">
                    <span className="text-[color:var(--pl-ink)]">{p.aName}</span>
                    <span className="text-[color:var(--pl-ink-2)]"> + </span>
                    <span className="text-[color:var(--pl-ink)]">{p.bName}</span>
                    <span className="text-[11px] text-[color:var(--pl-mid-grey)]"> · {p.count}×</span>
                  </div>
                )) : <p className="text-sm text-[color:var(--pl-ink-2)]">Not enough multi-item orders yet.</p>}
              </div>
            </div>
          </div>
        )}

        {retention.data && (
          <div className="mt-5 rounded-lg bg-[color:var(--glass-bg-tinted)] p-3 text-sm text-[color:var(--pl-ink-2)]">
            <span className="font-semibold text-[color:var(--pl-ink)]">{retention.data.repeat.repeatRatePct.toFixed(0)}% of customers come back</span>
            {retention.data.repeat.medianDaysToSecondPurchase != null && (
              <> — typically within {retention.data.repeat.medianDaysToSecondPurchase} days of their first purchase.</>
            )}
          </div>
        )}
      </LiquidGlassCard>
  );
}

function LeakTile({ label, value, sub, warn }: { label: string; value: string; sub: string; warn?: boolean }) {
  return (
    <div className={cn("rounded-lg border p-3", warn ? "border-[color:color-mix(in_srgb,var(--pl-red)_22%,transparent)] bg-[color:var(--pl-red-tint)]" : "bg-[color:var(--glass-bg-tinted)]")}>
      <div className="text-xs text-[color:var(--pl-ink-2)]">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums text-[color:var(--pl-ink)]">{value}</div>
      <div className="mt-1 text-[11px] text-[color:var(--pl-mid-grey)]">{sub}</div>
    </div>
  );
}
