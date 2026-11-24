import { useMemo } from "react";
import Link from "next/link";
import { Surface } from "@/components/Surface";
import { SectionHeading } from "@/components/SectionHeading";
import { StatStrip, StatTile } from "@/components/StatTile";
import { InsightFeed } from "@/components/InsightFeed";
import { ChartFrame } from "@/components/charts/ChartFrame";
import { ShareBar } from "@/components/charts/ShareBar";
import { Meter } from "@/components/charts/Meter";
import { slotFor } from "@/lib/chartTone";
import { useInsightsPeriod } from "@/lib/insightsContext";
import { useFormatters } from "@/lib/store";
import { useInsights, useMarketing } from "@/api/hooks";
import { figureState, figureStateSentence } from "@/lib/figureState";
import { formatCents } from "@/lib/money";
import { cn } from "@/lib/utils";

/**
 * Marketing — "Is my ad spend making money?"
 *
 * The one page allowed to be analytical, and the one that has to be most
 * careful about what it claims. Nothing links a sale to the advert that caused
 * it, so every figure here is BLENDED and the page says so in its own sentence
 * rather than a footnote — silent omission destroys trust faster here than
 * anywhere else in the app.
 *
 * What it can say with total confidence is the break-even multiple, because
 * that comes from real margin rather than attribution. That is the number
 * almost no competitor computes.
 */
export default function Marketing() {
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

  const marketing = useMarketing(compareRange);
  const feed = useInsights(compareRange, range ? `${range.label} vs the period before` : undefined);

  if (!range) return null;
  const money = f.moneyCents;
  const data = marketing.data;
  /* See Money.tsx — "Working out…" that never ends, on a request that failed
     or stopped and reports `isLoading: false` either way. */
  const marketingState = figureState(marketing, data != null);

  return (
    <div className="mx-auto max-w-[1000px] space-y-6 px-4 py-5 sm:px-6">
      {/* `!data` first, so the two reasons for having none are told apart
          before either gets a sentence. */}
      {!data ? (
        <Surface padding="lg">
          {marketingState === "loading" ? (
            <p className="t-secondary">Working out whether your ads paid off…</p>
          ) : (
            <p className="t-body text-[color:var(--pl-amber)]">
              {figureStateSentence(marketingState, "whether your ads paid off")}
            </p>
          )}
        </Surface>
      ) : (
        <>
          <Surface padding="lg">
            <p
              className={cn(
                "t-verdict",
                data.definitelyLostMoney
                  ? "text-[color:var(--pl-red)]"
                  : "text-[color:var(--pl-ink)]",
              )}
            >
              {data.verdict}
            </p>

            {data.state === "no_spend" && (
              <Link
                href="/record/ad-spend"
                className="mt-4 inline-flex items-center rounded-full bg-[color:var(--pl-orange-fill)] px-4 py-2 text-xs font-semibold text-[color:var(--pl-on-orange)] transition-colors hover:bg-[color:var(--pl-orange-hover)]"
              >
                Log what you spent on ads
              </Link>
            )}
          </Surface>

          {/*
            The differentiator, and the only figure on this page that needs no
            attribution at all. A 3× return is healthy for one business and a
            loss for another — this says which yours is.
          */}
          {data.breakEvenRoas !== null && (
            <Surface padding="lg">
              <SectionHeading hint="Worked out from what you actually keep, not a rule of thumb">
                What your ads have to earn
              </SectionHeading>

              <p className="t-num text-[56px] font-semibold leading-none text-[color:var(--pl-ink)]">
                {data.breakEvenRoas.toFixed(1)}×
              </p>
              <p className="t-body mt-3 text-[color:var(--pl-ink-2)]">
                You keep {data.contributionMarginPct!.toFixed(0)}% of each sale, so every{" "}
                {money(100_00)} of ads needs to bring in{" "}
                <strong className="text-[color:var(--pl-ink)]">
                  {money(Math.round(100_00 * data.breakEvenRoas))}
                </strong>{" "}
                of sales just to pay for itself.
              </p>
              <p className="t-secondary mt-2">
                The "3× is healthy" rule most ad tools repeat is a guess about someone else's
                business.
              </p>
            </Surface>
          )}

          {data.state !== "no_spend" && (
            <>
              <StatStrip columns={4}>
                <StatTile
                  label="Spent on ads"
                  value={money(data.adSpendCents)}
                  goodDirection="neutral"
                  hint={
                    data.shareOfRevenueBps === null
                      ? "No sales to compare against"
                      : `${(data.shareOfRevenueBps / 100).toFixed(1)}% of your sales`
                  }
                />
                <StatTile
                  label="Kept before ads"
                  value={money(data.profitBeforeAdsCents)}
                  goodDirection="up-is-good"
                  hint="Everything you kept, with the ads added back"
                />
                <StatTile
                  label="Kept after ads"
                  value={money(data.profitAfterAdsCents)}
                  goodDirection="up-is-good"
                  hint="What was actually left"
                />
                <StatTile
                  label="Per new customer"
                  value={
                    data.costPerNewCustomerCents === null
                      ? "—"
                      : money(data.costPerNewCustomerCents)
                  }
                  goodDirection="down-is-good"
                  hint={
                    data.newCustomerCount === 0
                      ? "Nobody new bought this period"
                      : `${data.newCustomerCount} first-time customers, if ads brought them all`
                  }
                />
              </StatStrip>

              <Surface padding="md" variant="recessed">
                {/* Its own sentence, not a footnote. */}
                <p className="t-body text-[color:var(--pl-ink-2)]">{data.blendedCaveat}</p>
              </Surface>

              {data.byPlatform.length > 0 && (
                <section>
                  <SectionHeading hint="Where the money went — revenue cannot be traced back to a platform yet">
                    Spend by platform
                  </SectionHeading>
                  {/* Platforms are identities, not amounts of badness — the
                      version this replaces painted every one in the money-loss
                      red, which said "ads are a loss" rather than "here is the
                      split". The categorical slots say the true thing. */}
                  <ChartFrame
                    height={Math.max(60, data.byPlatform.length * 44)}
                    state="settled"
                    empty={data.byPlatform.length === 0}
                    emptyMessage="Log ad spend against a platform to see the split."
                  >
                    <ShareBar
                      segments={data.byPlatform.map((p, i) => ({
                        id: p.platform,
                        label: p.platform,
                        value: p.amountCents,
                        tone: slotFor(i),
                      }))}
                      layout="rows"
                      format={money}
                      size="sm"
                    />
                  </ChartFrame>
                </section>
              )}

              <section>
                <SectionHeading hint="Comparing your ad spend against ALL your sales, not just ad-driven ones">
                  What came alongside the spend
                </SectionHeading>
                <Surface padding="md">
                  {/* Three multiples on ONE axis, which is what they always
                      were — a definition list made the reader hold two numbers
                      in their head to answer the only question that matters:
                      are you above the line or below it? The tick IS the line. */}
                  {data.blendedRoas !== null && data.breakEvenRoas !== null ? (
                    <ChartFrame height={72} state="settled" surface={false}>
                      <div className="space-y-3">
                        <div>
                          <div className="mb-1.5 flex items-baseline justify-between gap-4">
                            <span className="t-body text-[color:var(--pl-ink)]">
                              Sales alongside each unit spent
                            </span>
                            <span
                              className={cn(
                                "t-num font-semibold",
                                data.blendedRoas >= data.breakEvenRoas
                                  ? "text-[color:var(--pl-green)]"
                                  : "text-[color:var(--pl-red)]",
                              )}
                            >
                              {data.blendedRoas.toFixed(2)}× / {data.breakEvenRoas.toFixed(2)}× needed
                            </span>
                          </div>
                          <Meter
                            value={data.blendedRoas}
                            max={Math.max(data.blendedRoas, data.breakEvenRoas) * 1.25}
                            target={data.breakEvenRoas}
                            tone={data.blendedRoas >= data.breakEvenRoas ? "gain" : "loss"}
                          />
                        </div>
                        {data.blendedMarginReturn !== null && (
                          <div>
                            <div className="mb-1.5 flex items-baseline justify-between gap-4">
                              <span className="t-body text-[color:var(--pl-ink)]">
                                Margin alongside each unit spent
                              </span>
                              <span
                                className={cn(
                                  "t-num font-semibold",
                                  data.blendedMarginReturn < 1
                                    ? "text-[color:var(--pl-red)]"
                                    : "text-[color:var(--pl-green)]",
                                )}
                              >
                                {data.blendedMarginReturn.toFixed(2)}×
                              </span>
                            </div>
                            {/* 1.0 is the line here: below it the ads cost more
                                margin than they brought. */}
                            <Meter
                              value={data.blendedMarginReturn}
                              max={Math.max(data.blendedMarginReturn, 1) * 1.25}
                              target={1}
                              tone={data.blendedMarginReturn < 1 ? "loss" : "gain"}
                            />
                          </div>
                        )}
                      </div>
                    </ChartFrame>
                  ) : (
                    <p className="t-secondary">Not enough sales or spend to work these out yet.</p>
                  )}

                  {data.definitelyLostMoney ? (
                    <p className="t-body mt-4 rounded-lg bg-[color:var(--pl-red-tint)] p-3 text-[color:var(--pl-ink)]">
                      Everything you sold left {money(data.contributionProfitCents)} of margin, and the
                      ads cost {money(data.adSpendCents)}. Even if every single sale came from an
                      advert, they did not pay for themselves.
                    </p>
                  ) : (
                    <p className="t-secondary mt-4">
                      Your margin more than covers the ad spend — but because nothing records which
                      sales came from ads, that is not proof the ads earned it.
                    </p>
                  )}
                </Surface>
              </section>
            </>
          )}

          <InsightFeed
            insights={feed.data?.insights ?? []}
            leaks={feed.data?.leaks ?? []}
            totalLeakCents={feed.data?.totalLeakCents ?? 0}
            symbol={f.symbol}
            state={figureState(feed, feed.data != null)}
          />
        </>
      )}
    </div>
  );
}

function Row({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "good" | "bad";
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-[color:var(--pl-hairline)] pb-2 last:border-0 last:pb-0">
      <dt className="t-body text-[color:var(--pl-ink-2)]">{label}</dt>
      <dd
        className="t-num font-semibold"
        style={{
          color:
            tone === "bad"
              ? "var(--pl-red)"
              : tone === "good"
                ? "var(--pl-green)"
                : "var(--pl-ink)",
        }}
      >
        {value}
      </dd>
    </div>
  );
}
