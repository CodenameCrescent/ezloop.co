import { useMemo } from "react";
import { TrendingUp, Wallet, ReceiptText, BarChart3 } from "lucide-react";
import { TopBar } from "@/components/TopBar";
import { useFormatters } from "@/lib/store";
import { buildPeriodRange } from "@/lib/period";
import { toApiRange, usePnl } from "@/api/hooks";
import { Skeleton } from "@/components/ui/skeleton";
import {
  figureState,
  figureStateSentence,
  FIGURE_STATE_COPY,
  type FigureState,
} from "@/lib/figureState";

function endOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

export default function Forecasts() {
  const f = useFormatters();
  const now = useMemo(() => new Date(), []);
  const range = useMemo(() => buildPeriodRange("this-month", undefined, undefined, now), [now]);

  /*
   * The three figures this page projects from come off the SERVER ladder —
   * the same rungs the P&L page and the Dashboard read. They used to be
   * recomputed here from the browser store with float rupee math, which is
   * how a forecast could quietly disagree with the books it claims to
   * extrapolate.
   */
  const apiRange = useMemo(() => toApiRange(range), [range]);
  const pnlQuery = usePnl(apiRange);
  const ladder = pnlQuery.data?.ladder;

  const daysElapsed = Math.max(1, now.getDate());
  const daysInMonth = endOfMonth(now).getDate();
  const pace = daysInMonth / daysElapsed;

  /*
   * The one piece of money arithmetic this page is allowed to do. Multiplying
   * by `pace` is a hypothesis about a month that has not finished, so there is
   * no ledger fact it can contradict — unlike the totals above, which now come
   * from the server. Integer cents in, rounded integer cents out: a projection
   * is a guess, but it is still money, so it never becomes a float.
   */
  const project = (cents: number) => Math.round(cents * pace);

  // `null` means "no figure yet". A zero during loading would be a claim.
  const currentRevenueCents = ladder?.netRevenue ?? null;
  const currentProfitCents = ladder?.trueProfit ?? null;
  const currentCostsCents = ladder ? ladder.directCosts + ladder.periodExpenses : null;

  /*
   * Why there is no figure, when there is no figure. All three cards read one
   * ladder, so they share one state — and it is decided in `figureState`, not
   * from `isLoading` alone. A request that failed or that stopped dead reports
   * `isLoading: false`, so this page used to answer both of them with the same
   * em dash it uses for a month with no trade. Those are three different
   * things and the owner is entitled to know which one they are looking at.
   */
  const state = figureState(pnlQuery, ladder != null);
  // Said once for the page rather than three times across the cards.
  const stateSentence =
    state === "loading" ? undefined : figureStateSentence(state, "this month's figures");

  return (
    <>
      <TopBar
        title="Forecasts"
        subtitle="Simple end-of-month projections based on the current pace."
      />
      <div className="app-page-shell">
        {stateSentence && (
          <p className="t-secondary text-[color:var(--pl-amber)]">{stateSentence}</p>
        )}
        <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <ForecastCard
            label="Expected net revenue"
            value={currentRevenueCents === null ? null : f.moneyCents(project(currentRevenueCents))}
            current={currentRevenueCents === null ? null : f.moneyCents(currentRevenueCents)}
            icon={<BarChart3 className="h-5 w-5" />}
            state={state}
          />
          <ForecastCard
            label="Expected true profit"
            value={
              currentProfitCents === null
                ? null
                : f.moneyCentsSigned(project(currentProfitCents))
            }
            current={currentProfitCents === null ? null : f.moneyCentsSigned(currentProfitCents)}
            icon={<Wallet className="h-5 w-5" />}
            state={state}
            /* No figure yet means no verdict yet — the card stays neutral
               rather than claiming a profit sign it cannot know. */
            tone={
              currentProfitCents === null
                ? undefined
                : project(currentProfitCents) >= 0
                  ? "good"
                  : "bad"
            }
          />
          <ForecastCard
            label="Expected costs"
            value={currentCostsCents === null ? null : f.moneyCents(project(currentCostsCents))}
            current={currentCostsCents === null ? null : f.moneyCents(currentCostsCents)}
            icon={<ReceiptText className="h-5 w-5" />}
            state={state}
          />
        </section>

        <section className="rounded-2xl border border-card-border bg-card p-5">
          <div className="flex items-start gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[color:var(--pl-orange-tint)] text-primary">
              <TrendingUp className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-foreground">Forecast logic</h2>
              <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
                Profit Loop is projecting this month from the actual revenue, costs, and profit already recorded. This is intentionally simple and explainable, so owners can see risk early without needing an accountant-style forecast model.
              </p>
              <div className="mt-4 rounded-xl border border-border bg-background/70 p-4 text-sm text-muted-foreground">
                {daysElapsed} of {daysInMonth} days have passed. Current results are multiplied by {pace.toFixed(2)} to estimate month-end outcomes.
              </div>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}

/**
 * `value` and `current` are null when the figure is not known yet. The card
 * never invents one, and it now distinguishes the three reasons it might have
 * nothing to show: a skeleton while the figure is in flight, a dash when the
 * request settled and the month really is empty, and the state's own words when
 * the request failed or stopped. A zero here would read as a real month; so, in
 * its quieter way, does a dash on a request that never arrived.
 *
 * Amber, not red: a request that did not land is not money lost, and colour in
 * this app means money (DESIGN.md §2).
 */
function ForecastCard({
  label,
  value,
  current,
  icon,
  tone,
  state,
}: {
  label: string;
  value: string | null;
  current: string | null;
  icon: React.ReactNode;
  tone?: "good" | "bad";
  state: FigureState;
}) {
  const toneClass =
    tone === "good" ? "text-[var(--profit)]" : tone === "bad" ? "text-[var(--expense)]" : "";
  return (
    <div className="rounded-2xl border border-card-border bg-card p-5">
      <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-[color:var(--pl-orange-tint)] text-primary">
        {icon}
      </div>
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      {state === "loading" ? (
        <Skeleton className="mt-2 h-7 w-36" />
      ) : (
        /* The outer div keeps the figure's line height either way, so a card
           that could not load does not sit shorter than the ones beside it. */
        <div className={`mt-1 text-2xl font-bold tracking-tight tabular-nums ${toneClass}`}>
          {state === "settled" ? (
            (value ?? "—")
          ) : (
            <span className="text-base font-semibold text-[color:var(--pl-amber)]">
              {FIGURE_STATE_COPY[state].slot}
            </span>
          )}
        </div>
      )}
      {state === "loading" ? (
        <Skeleton className="mt-2 h-3 w-44" />
      ) : (
        state === "settled" && (
          <div className="mt-1 text-xs text-muted-foreground">
            Current month so far: {current ?? "—"}
          </div>
        )
      )}
    </div>
  );
}
