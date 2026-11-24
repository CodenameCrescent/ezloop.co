import { useMemo } from "react";
import Link from "next/link";
import { Surface } from "@/components/Surface";
import { SectionHeading } from "@/components/SectionHeading";
import { StatStrip, StatTile } from "@/components/StatTile";
import { ChartFrame } from "@/components/charts/ChartFrame";
import { Ladder } from "@/components/charts/Ladder";
import { InsightFeed } from "@/components/InsightFeed";
import { useInsightsPeriod } from "@/lib/insightsContext";
import { useFormatters } from "@/lib/store";
import { useInsights, useWaterfall } from "@/api/hooks";
import { figureState, figureStateSentence } from "@/lib/figureState";
import { formatCents } from "@/lib/money";

/**
 * Money — "Where did the money go this period?"
 *
 * The waterfall is the hero and the verdict sits above it. Everything else on
 * the page is evidence for that one sentence.
 *
 * Deliberately absent: per-offer breakdowns (that is Offers), per-customer
 * breakdowns (People), and channel performance (Marketing). This page is about
 * the aggregate SHAPE of the money, not its subdivisions.
 */
export default function Money() {
  const ctx = useInsightsPeriod();
  const f = useFormatters();
  const range = ctx?.range;

  const compareRange = useMemo(
    () =>
      range
        ? {
            startDate: range.start.toISOString(),
            endDate: range.end.toISOString(),
            priorStartDate: range.priorStart.toISOString(),
            priorEndDate: range.priorEnd.toISOString(),
          }
        : null,
    [range],
  );

  const waterfall = useWaterfall(compareRange);
  const feed = useInsights(compareRange, range ? `${range.label} vs the period before` : undefined);

  if (!range) return null;
  const money = f.moneyCents;
  const data = waterfall.data;
  /*
   * "Following the money…" was the answer to `isLoading || !data`, and a
   * request that failed or stopped dead leaves `isLoading` false — so the page
   * sat there telling the owner it was still working on something that had
   * already given up. Same shape as the Reports download's "Waiting for this
   * period's figures", which DECISIONS.md called out on 2026-08-28: a wait
   * that is not a wait is worse than an em dash, because it asks the reader to
   * keep waiting for an arrival that is not coming.
   */
  const waterfallState = figureState(waterfall, data != null);

  /**
   * A percentage change is only informative while the base is comparable.
   *
   * Against a near-empty prior period the seed produced "+71318.8% vs last
   * period", which is arithmetically correct and tells the reader nothing —
   * exactly the field that looks meaningful and is not. Past this point the
   * tile drops the percentage and states the prior figure instead, which is
   * the fact the reader actually wanted.
   */
  const ABSURD_PCT = 999;

  const pctDelta = (now: number, before: number): number | null => {
    if (before === 0) return null;
    const pct = ((now - before) / Math.abs(before)) * 100;
    return Math.abs(pct) > ABSURD_PCT ? null : pct;
  };

  /** Shown in place of a suppressed or missing percentage. */
  const priorHint = (before: number) =>
    before === 0 ? "Nothing recorded last period" : `Was ${money(before)} last period`;

  return (
    <div className="mx-auto max-w-[1000px] space-y-6 px-4 py-5 sm:px-6">
      <section>
        {!data ? (
          <Surface padding="lg">
            {waterfallState === "loading" ? (
              <p className="t-secondary">Following the money…</p>
            ) : (
              <p className="t-body text-[color:var(--pl-amber)]">
                {figureStateSentence(waterfallState, "where your money went")}
              </p>
            )}
          </Surface>
        ) : data.startCents === 0 ? (
          /* Empty is an instruction, never an apology. */
          <Surface padding="lg" className="text-center">
            <p className="t-verdict text-[color:var(--pl-ink)]">
              Record your first sale to see where your money goes.
            </p>
            <Link
              href="/record/transactions"
              className="mt-4 inline-flex items-center rounded-full bg-[color:var(--pl-orange-fill)] px-4 py-2 text-xs font-semibold text-[color:var(--pl-on-orange)] transition-colors hover:bg-[color:var(--pl-orange-hover)]"
            >
              Record a sale
            </Link>
          </Surface>
        ) : (
          <Surface padding="lg">
            {/* The verdict is the hero of the page. The chart is evidence for it. */}
            <p className="t-verdict mb-5 text-[color:var(--pl-ink)]">{data.verdict}</p>

            {/*
              Trust-critical: a waterfall with no costs in it does not look
              broken, it looks like a wildly profitable business. Say it inline
              rather than drawing it silently.
            */}
            {data.missingCosts && (
              <div className="mb-5 rounded-lg bg-[color:var(--pl-amber-tint)] p-3">
                <p className="t-body text-[color:var(--pl-ink)]">
                  Nothing you sell has a cost recorded against it yet, so this shows every rupee
                  that came in as profit.
                </p>
                <Link
                  href="/setup/revenue"
                  className="t-body mt-1 inline-block font-semibold text-[color:var(--pl-orange-text)] hover:underline"
                >
                  Add costs to what you sell →
                </Link>
              </div>
            )}

            {/* Ladder rather than Waterfall: identical render, but the
                primitive takes plain steps instead of one endpoint's response
                type, so the mapping lives here where the endpoint is known. */}
            <ChartFrame
              height={Math.max(120, data.steps.length * 40)}
              state="settled"
              surface={false}
            >
              <Ladder
                steps={data.steps.map((step) => ({
                  id: step.id,
                  label: step.label,
                  value: step.amountCents,
                  kind: step.kind,
                  rungLabel: step.rungLabel ?? undefined,
                  runningTotal: step.runningTotalCents,
                  href: step.href ?? undefined,
                }))}
                format={money}
              />
            </ChartFrame>
          </Surface>
        )}
      </section>

      {data && data.startCents > 0 && (
        <StatStrip columns={4}>
          <StatTile
            label="Money in"
            value={money(data.tiles.revenueCents)}
            delta={pctDelta(data.tiles.revenueCents, data.tiles.priorRevenueCents)}
            deltaLabel="vs last period"
            hint={priorHint(data.tiles.priorRevenueCents)}
          />
          {/* Margin moves in POINTS, not percent-of-a-percent, so this one is
              already the right unit — it just needs saying. */}
          <StatTile
            label="Kept from each sale"
            value={data.tiles.netMarginPct === null ? "—" : `${data.tiles.netMarginPct.toFixed(1)}%`}
            delta={
              data.tiles.netMarginPct !== null && data.tiles.priorNetMarginPct !== null
                ? data.tiles.netMarginPct - data.tiles.priorNetMarginPct
                : null
            }
            deltaLabel="points vs last period"
            hint="Nothing to compare against last period"
          />
          <StatTile
            label="What you kept"
            value={money(data.tiles.trueProfitCents)}
            delta={pctDelta(data.tiles.trueProfitCents, data.tiles.priorTrueProfitCents)}
            deltaLabel="vs last period"
            hint={priorHint(data.tiles.priorTrueProfitCents)}
          />
          {/*
            NOT "cash on hand". A balance needs an opening figure the app does
            not hold, and inventing one would be the invented-number failure on
            the most checkable number a business owner has. This is what
            actually moved through the bank in the period, which we do know.
          */}
          <StatTile
            label="Cash that moved"
            value={money(data.tiles.cashMovedCents)}
            delta={pctDelta(data.tiles.cashMovedCents, data.tiles.priorCashMovedCents)}
            deltaLabel="vs last period"
            hint="Money paid in and out, not a bank balance"
          />
        </StatStrip>
      )}

      <InsightFeed
        insights={feed.data?.insights ?? []}
        leaks={feed.data?.leaks ?? []}
        totalLeakCents={feed.data?.totalLeakCents ?? 0}
        symbol={f.symbol}
        state={figureState(feed, feed.data != null)}
      />

      <section>
        <SectionHeading hint="The same figures, rung by rung">Full profit ladder</SectionHeading>
        <Surface padding="md">
          <Link
            href="/money/profit-loss"
            className="t-body font-semibold text-[color:var(--pl-orange-text)] hover:underline"
          >
            Open the profit and loss →
          </Link>
        </Surface>
      </section>
    </div>
  );
}
