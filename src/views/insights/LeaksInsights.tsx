import { useMemo } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { LiquidGlassCard } from "@/components/LiquidGlassCard";
import { Skeleton } from "@/components/ui/skeleton";
import { ChartFrame } from "@/components/charts/ChartFrame";
import { Dumbbell } from "@/components/charts/Dumbbell";
import { ShareBar } from "@/components/charts/ShareBar";
import { useInsightsPeriod } from "@/lib/insightsContext";
import { useFormatters } from "@/lib/store";
import { useLeaks } from "@/api/hooks";
import { figureState, figureStateSentence } from "@/lib/figureState";
import { formatCents } from "@/lib/money";

/**
 * The profit-leaks deep page (Insights 2.0 → "See all leaks"). Full tables
 * behind Block 3: refunds by item/source, fee creep vs the prior period,
 * margin erosion, and an unpaid-invoice aging list with links to the ledger.
 */
export default function LeaksInsights() {
  const ctx = useInsightsPeriod();
  const f = useFormatters();
  const range = ctx?.range;

  const leaksRange = useMemo(
    () =>
      range
        ? { startDate: range.start.toISOString(), endDate: range.end.toISOString(), priorStartDate: range.priorStart.toISOString(), priorEndDate: range.priorEnd.toISOString() }
        : null,
    [range],
  );
  const leaks = useLeaks(leaksRange);

  if (!range) return null;
  const money = f.moneyCents;
  const d = leaks.data;

  /*
   * A skeleton is a promise that something is arriving. This page reached it
   * through `leaks.isLoading || !d`, and a request that failed or stopped dead
   * leaves `isLoading` false — so two grey rectangles pulsed here for ever,
   * indistinguishable from a slow connection.
   */
  const leaksState = figureState(leaks, d != null);
  if (!d) {
    return (
      <div className="mx-auto max-w-[1500px] space-y-5 px-4 py-5 sm:px-6 lg:px-8">
        {leaksState === "loading" ? (
          [0, 1].map((i) => <Skeleton key={i} className="h-64 w-full rounded-2xl" />)
        ) : (
          <LiquidGlassCard padding="lg">
            <p className="text-sm text-[color:var(--pl-amber)]">
              {figureStateSentence(leaksState, "your leaks")}
            </p>
            {leaksState === "failed" && (
              <button
                onClick={() => leaks.refetch()}
                className="mt-3 rounded-lg border border-[color:var(--glass-border)] px-3 py-1.5 text-xs font-medium text-[color:var(--pl-ink-2)] transition hover:text-[color:var(--pl-ink)]"
              >
                Try again
              </button>
            )}
          </LiquidGlassCard>
        )}
      </div>
    );
  }


  return (
    <div className="mx-auto max-w-[1500px] space-y-5 px-4 py-5 sm:px-6 lg:px-8">
      <div className="grid gap-5 lg:grid-cols-2">
        {/* Refunds */}
        <LiquidGlassCard padding="lg">
          <h2 className="text-base font-semibold text-[color:var(--pl-ink)]">Refunds</h2>
          <p className="mt-1 text-xs text-[color:var(--pl-ink-2)]">{money(d.refunds.totalCents)} refunded — {d.refunds.ratePct.toFixed(1)}% of gross revenue.</p>
          <div className="mt-4">
            <ChartFrame
              title="By item"
              height={Math.max(60, d.refunds.byItem.length * 44)}
              state="settled"
              empty={d.refunds.byItem.length === 0}
              emptyMessage="No refunds this period."
              surface={false}
            >
              <ShareBar
                segments={d.refunds.byItem.map((r) => ({
                  id: r.name,
                  label: `${r.name} · ${r.ratePct.toFixed(0)}% of its sales`,
                  value: r.cents,
                  tone: "loss",
                }))}
                layout="rows"
                format={money}
                size="sm"
              />
            </ChartFrame>
          </div>
        </LiquidGlassCard>

        {/* Fee creep */}
        <LiquidGlassCard padding="lg">
          <h2 className="text-base font-semibold text-[color:var(--pl-ink)]">Fee creep</h2>
          <p className="mt-1 text-xs text-[color:var(--pl-ink-2)]">Processor and platform fees, this period versus the last.</p>
          {/* A fee is a before/after PAIR, so it draws as one: two dots and the
              distance between them. The bar this replaces had to negate the
              delta to make growth read red — a sign flip carried purely so the
              colour would come out right. `down-is-good` states the same fact
              honestly, and the "now / was" figures stop needing a caption
              because both dots are on the chart. */}
          <div className="mt-4">
            <ChartFrame
              height={Math.max(60, d.fees.length * 46)}
              state="settled"
              empty={d.fees.length === 0}
              emptyMessage="No fees recorded this period."
              surface={false}
            >
              <Dumbbell
                rows={d.fees.map((fee) => ({
                  id: fee.name,
                  label: fee.name,
                  from: fee.priorCents,
                  to: fee.currentCents,
                }))}
                format={money}
                goodDirection="down-is-good"
              />
            </ChartFrame>
          </div>
        </LiquidGlassCard>
      </div>

      {/* Margin erosion */}
      {d.marginErosion.length > 0 && (
        <LiquidGlassCard padding="lg">
          <h2 className="text-base font-semibold text-[color:var(--pl-ink)]">Margin erosion</h2>
          <p className="mt-1 text-xs text-[color:var(--pl-ink-2)]">Items earning a thinner slice than they used to.</p>
          {/* "48.2% · −6.1 pts · was 54.3%" is three numbers asking the reader
              to picture a slide. The slide IS the picture: two dots and the
              gap between them, on one scale so the worst erosion is also the
              longest line. */}
          <div className="mt-4">
            <ChartFrame
              height={Math.max(60, d.marginErosion.length * 46)}
              state="settled"
              surface={false}
            >
              <Dumbbell
                rows={d.marginErosion.map((m) => ({
                  id: m.name,
                  label: m.name,
                  from: m.marginPriorPct,
                  to: m.marginNowPct,
                }))}
                format={(v) => `${v.toFixed(1)}%`}
                goodDirection="up-is-good"
              />
            </ChartFrame>
          </div>
        </LiquidGlassCard>
      )}

      {/* Unpaid aging */}
      <LiquidGlassCard padding="lg">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-[color:var(--pl-ink)]">Unpaid sales</h2>
            <p className="mt-1 text-xs text-[color:var(--pl-ink-2)]">{money(d.unpaidAging.totalCents)} recorded but not yet collected.</p>
          </div>
          {d.unpaidAging.totalCents > 0 && <AlertTriangle className="h-5 w-5 text-[color:var(--pl-yellow)]" />}
        </div>
        {/* Ageing is a DISTRIBUTION — how the debt is spread across time — and
            three centred tiles are the one shape that cannot show a spread.
            One stacked bar puts the answer in the proportions: a business owed
            a lot but all of it recent is in a completely different position
            from one owed the same total, all of it 31 days old. */}
        <div className="mt-4">
          <ChartFrame
            height={70}
            state="settled"
            empty={d.unpaidAging.totalCents === 0}
            emptyMessage="Every sale has been paid for."
            surface={false}
          >
            <ShareBar
              segments={d.unpaidAging.buckets
                .filter((b) => b.cents > 0)
                .map((b, i) => ({
                  id: b.label,
                  label: `${b.label} · ${b.count} sale${b.count === 1 ? "" : "s"}`,
                  value: b.cents,
                  // Older debt is worse debt: the ordinal ramp runs neutral →
                  // loss, so the eye reads age as severity without a legend.
                  tone: i === d.unpaidAging.buckets.length - 1 ? "loss" : i === 0 ? "neutral" : "cat-3",
                }))}
              layout="stacked"
              format={money}
              size="md"
            />
          </ChartFrame>
        </div>
        {d.unpaidAging.rows.length > 0 && (
          <div className="mt-4 space-y-1">
            {d.unpaidAging.rows.map((r) => (
              <Link key={r.id} href="/record/transactions" className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-sm transition hover:bg-[color:color-mix(in_srgb,var(--pl-orange)_6%,transparent)]">
                <span className="min-w-0 truncate text-[color:var(--pl-ink)]">{r.displayName}</span>
                <span className="shrink-0 tabular-nums text-[color:var(--pl-ink-2)]">{money(r.amountCents)} · {r.days}d old</span>
              </Link>
            ))}
          </div>
        )}
      </LiquidGlassCard>
    </div>
  );
}
