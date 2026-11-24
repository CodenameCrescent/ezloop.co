import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Surface } from "@/components/Surface";
import { Meter } from "@/components/charts/Meter";
import { InsightFeed } from "@/components/InsightFeed";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useInsightsPeriod } from "@/lib/insightsContext";
import { useFormatters } from "@/lib/store";
import { useInsights, usePqs } from "@/api/hooks";
import { figureState } from "@/lib/figureState";
import { STRONG_ABOVE, WEAK_BELOW } from "@workspace/domain";
import { cn } from "@/lib/utils";
import { type PqsResponse, Hero } from "./Summary.parts/Hero";
type Pillar = PqsResponse["pillars"][number];

/**
 * Summary — "Is my business healthy right now?"
 *
 * The one page in the app with no chart on it. Sub-score bars are the ceiling,
 * and that is deliberate: the moment a chart appears here this becomes a
 * dashboard, which is what competitors already sell.
 *
 * Every figure is server-computed. This page words and arranges them.
 */
export default function Summary() {
  const ctx = useInsightsPeriod();
  const f = useFormatters();
  const range = ctx?.range;
  const [drawerOpen, setDrawerOpen] = useState(false);

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

  const pqs = usePqs(compareRange);
  const feed = useInsights(compareRange, range ? `${range.label} vs the period before` : undefined);

  if (!range) return null;

  return (
    <div className="mx-auto max-w-[900px] space-y-6 px-4 py-5 sm:px-6">
      {/* The ONE element ever allowed above the score, and only for this. */}
      {pqs.data?.crisis && (
        <Surface padding="md" className="bg-[color:var(--pl-red-tint)]">
          <p className="t-body font-semibold text-[color:var(--pl-red)]">
            You spent more than you made this period.
          </p>
        </Surface>
      )}

      <Hero
        data={pqs.data}
        state={figureState(pqs, pqs.data != null)}
        onWhy={() => setDrawerOpen(true)}
      />

      {pqs.data && pqs.data.state === "ok" && <SubScores pillars={pqs.data.pillars} />}

      <InsightFeed
        insights={feed.data?.insights ?? []}
        leaks={feed.data?.leaks ?? []}
        totalLeakCents={feed.data?.totalLeakCents ?? 0}
        symbol={f.symbol}
        state={figureState(feed, feed.data != null)}
      />

      <WhyThisScore open={drawerOpen} onOpenChange={setDrawerOpen} data={pqs.data} />
    </div>
  );
}

/**
 * Four tappable rows — rows, not a 2×2 grid, because rows scan in one motion
 * and do not break on a phone.
 *
 * Tapping a row is the primary navigation path of the whole Insights area.
 * Without the routing these bars are decoration.
 */
function SubScores({ pillars }: { pillars: Pillar[] }) {
  return (
    <Surface padding="none" className="overflow-hidden">
      {pillars.map((p, i) => (
        <PillarRow key={p.id} pillar={p} first={i === 0} />
      ))}
    </Surface>
  );
}

function PillarRow({ pillar, first }: { pillar: Pillar; first: boolean }) {
  const absent = pillar.score === null;

  const body = (
    <div
      className={cn(
        "flex items-center gap-4 px-5 py-3.5",
        !first && "border-t border-[color:var(--pl-hairline)]",
        absent && "opacity-60",
      )}
    >
      <span className="t-body w-32 shrink-0 text-[color:var(--pl-ink)]">{pillar.label}</span>

      {/* Bars are GREY by default. Red only below 40, green only above 80 —
          four coloured bars is four things shouting, and grey-by-default is
          what makes colour mean "look here". */}
      <div className="min-w-0 flex-1">
        {absent ? (
          <div className="h-2 w-full rounded-full bg-[color:var(--pl-chart-track)]" />
        ) : (
          <Meter
            value={pillar.score!}
            tone="threshold"
            thresholds={{ good: STRONG_ABOVE, warn: WEAK_BELOW }}
            inline
          />
        )}
      </div>

      <span className="t-num w-10 shrink-0 text-right text-[color:var(--pl-ink)]">
        {absent ? "—" : pillar.score}
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-[color:var(--pl-ink-3)]" />
    </div>
  );

  // An absent measure is greyed rather than hidden, so its absence is visible
  // and explains the "based on 3 of 4" line above.
  if (absent) return <div title={pillar.range}>{body}</div>;

  return (
    <Link href={pillar.href} className="block transition-colors hover:bg-[color:var(--pl-recessed)]">
      {body}
    </Link>
  );
}

/**
 * "Why this score".
 *
 * PQS is a number we invented. Every skeptic's first question is "based on
 * what?" — answer it completely once and the score is credible for the life of
 * the account; refuse and it reads as astrology. So this shows the formula, the
 * weight and judged range of every pillar, the raw inputs, and what would move
 * it most.
 */
function WhyThisScore({
  open,
  onOpenChange,
  data,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  data: PqsResponse | undefined;
}) {
  if (!data) return null;
  const scored = data.pillars.filter((p) => p.score !== null);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Why this score</SheetTitle>
        </SheetHeader>

        <div className="mt-4 space-y-6">
          <p className="t-body text-[color:var(--pl-ink-2)]">
            Your score is a weighted blend of {scored.length}{" "}
            {scored.length === 1 ? "measure" : "measures"}
            {data.measuresUsed < data.measuresTotal &&
              (() => {
                const missing = data.measuresTotal - data.measuresUsed;
                return ` — ${missing === 1 ? "one more joins" : `${missing} more join`} once there's data behind ${missing === 1 ? "it" : "them"}`;
              })()}
            .
          </p>

          {/* The highest-value line in the drawer: it turns a diagnostic into a goal. */}
          {data.lever && (
            <Surface padding="md" variant="recessed">
              <p className="t-body text-[color:var(--pl-ink)]">
                Getting <strong>{data.lever.label.toLowerCase()}</strong> from {data.lever.from} to{" "}
                {data.lever.to} would raise your score to <strong>{data.lever.wouldScore}</strong>.
              </p>
            </Surface>
          )}

          <div className="space-y-5">
            {data.pillars.map((p) => (
              <div key={p.id}>
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="t-section text-[color:var(--pl-ink)]">{p.label}</h3>
                  <span className="t-num text-sm text-[color:var(--pl-ink-2)]">
                    {p.score === null ? "not counted" : `${p.score} · ${p.weightPct}% of the score`}
                  </span>
                </div>
                <p className="t-secondary mt-0.5">{p.range}</p>

                {p.inputs.length > 0 && (
                  <dl className="mt-2 space-y-1 rounded-lg bg-[color:var(--pl-recessed)] p-3">
                    {p.inputs.map((input) => (
                      <div key={input.label} className="flex items-baseline justify-between gap-3 text-xs">
                        <dt className="text-[color:var(--pl-ink-2)]">{input.label}</dt>
                        <dd className="t-num font-semibold text-[color:var(--pl-ink)]">{input.value}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </div>
            ))}
          </div>

          <p className="t-micro border-t border-[color:var(--pl-hairline)] pt-3">
            Last worked out {new Date(data.calculatedAt).toLocaleString()}
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
