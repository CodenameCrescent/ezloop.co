import { type ReactNode } from "react";
import Link from "next/link";
import { SectionHeading } from "@/components/SectionHeading";
import { Surface } from "@/components/Surface";
import { ChartFrame } from "@/components/charts/ChartFrame";
import { type DumbbellRow, Dumbbell } from "@/components/charts/Dumbbell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { type FigureState, figureStateSentence } from "@/lib/figureState";

/* ── 5 · What needs attention ─────────────────────────────────────────────── */

export function NeedsAttention({
  alerts,
  state,
}: {
  alerts: Array<{ title: string; body: string }>;
  state: FigureState;
}) {
  /*
   * The whole block is gated on the state, not just its empty case.
   *
   * Two ways this went wrong, and the second was only found by running the
   * page against a dead server. "Nothing is flagged right now." is an
   * all-clear, and the alerts come from the store's arrays, which fall back to
   * empty — so the page cleared a business it had never looked at. But
   * `getDashboardAlerts` does not return an empty list when it is given
   * nothing: it INVENTS alerts out of the absence, and printed "No spending
   * recorded · Add rent, salaries, ads, software…" to an owner whose expenses
   * simply had not loaded. An all-clear and a fabricated warning are opposite
   * failures with one cause, so one guard covers both.
   */
  if (state !== "settled") {
    return (
      <Surface padding="md">
        <SectionHeading>Needs your attention</SectionHeading>
        <p className="t-secondary text-[color:var(--pl-amber)]">
          {state === "loading" ? "Checking…" : figureStateSentence(state, "anything needing attention")}
        </p>
      </Surface>
    );
  }

  if (alerts.length === 0) {
    return (
      <Surface padding="md">
        <SectionHeading>Needs your attention</SectionHeading>
        <p className="t-secondary">Nothing is flagged right now.</p>
      </Surface>
    );
  }

  return (
    <Surface padding="md">
      <SectionHeading
        action={
          <Link
            href="/plan/action-plan"
            className="text-sm font-medium text-[color:var(--pl-orange-text)] hover:underline"
          >
            View all
          </Link>
        }
      >
        Needs your attention
      </SectionHeading>
      {/* No severity badge: the old one read High / Medium / Low straight off the
          array index, so the third item was always "Low" whatever it said. */}
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {alerts.slice(0, 3).map((item, index) => (
          <li key={`${item.title}-${index}`} className="rounded-lg bg-[color:var(--pl-recessed)] p-4">
            <p className="text-sm font-semibold text-[color:var(--pl-ink)]">{item.title}</p>
            <p className="t-secondary mt-1">{item.body}</p>
          </li>
        ))}
      </ul>
    </Surface>
  );
}

/**
 * What sits where the headline goes when the headline never arrived.
 *
 * Same shell as `HeroSkeleton` on purpose: the block keeps its size, so the
 * page does not reflow under a reading eye when the request resolves either
 * way. It says what happened instead of showing a figure, because every
 * fallback available to it — the legacy client-side summary, a zero, the
 * skeleton left up for ever — is a claim about the business this page cannot
 * support.
 */
export function HeroUnavailable({ state, onRetry }: { state: FigureState; onRetry: () => void }) {
  return (
    <Surface padding="lg">
      {/* Amber, not red: colour means money here, and a request that did not
          land is not money lost (DESIGN.md §2). */}
      <p className="t-verdict text-[color:var(--pl-amber)]">
        {figureStateSentence(state, "this period's figures")}
      </p>
      {/* Only where retrying can work — an offline query is paused, not
          failed, and resumes by itself the moment the network is back. */}
      {state === "failed" && (
        <Button variant="outline" size="sm" className="mt-4" onClick={onRetry}>
          Try again
        </Button>
      )}
    </Surface>
  );
}

/* ── 3 · The position cards ───────────────────────────────────────────────────
   Four cards that turn the headline into decisions: how this period compares
   to the last, what is owed in each direction, what earns and what loses, and
   how long the cash lasts. Every figure is a server rung or a user-entered
   setting — the arithmetic here is display division only (cents to rupees,
   a pace to a months figure), same as the margin percentage above. */

export type Ladder = {
  netRevenue: number;
  directCosts: number;
  periodExpenses: number;
  trueProfit: number;
};

export function CardShell({
  label,
  action,
  children,
}: {
  label: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  /* A plain card, not a bordered grid cell. The four figures above it became
     four separate cards in this pass, and a hairline box under a row of
     borderless ones reads as a different kind of object — which these are not.
     Separation is value, as everywhere else on the page plane (DESIGN.md §1). */
  return (
    <Surface padding="md" className="flex flex-col gap-3.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="t-micro">{label}</span>
        {action}
      </div>
      {children}
    </Surface>
  );
}

export function CardLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="text-xs font-medium text-[color:var(--pl-orange-text)] hover:underline">
      {children}
    </Link>
  );
}

/** This period against the one before it, one rung per row. */
export function PeriodCompareCard({
  now,
  prior,
  periodLabel,
  money,
}: {
  now: Ladder | undefined;
  prior: Ladder | undefined;
  periodLabel: string;
  money: (v: number) => string;
}) {
  if (!now || !prior) {
    return (
      <CardShell label={`${periodLabel} vs before`}>
        <div className="space-y-2 py-1">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-4 w-full" />
          ))}
        </div>
      </CardShell>
    );
  }

  /*
   * A Dumbbell rather than sixteen numbers in a grid. Each row was a pair —
   * prior and now — and a pair is a DISTANCE, which is the one thing a row of
   * figures conveys worst: the reader had to subtract two numbers in their head
   * to find out whether they should care. The connector's length is the change
   * and its direction is the sign, both before any reading happens.
   *
   * "Money in" is on one shared scale with "True profit" deliberately: seeing
   * how much smaller the profit dumbbell is than the revenue one IS the point of
   * the card.
   */
  const rows: DumbbellRow[] = [
    { id: "in", label: "Money in", from: prior.netRevenue / 100, to: now.netRevenue / 100 },
    // Costs rising is not good news, and the colour has to say so.
    { id: "cogs", label: "Cost of goods", from: prior.directCosts / 100, to: now.directCosts / 100, goodDirection: "down-is-good" },
    { id: "bills", label: "Bills & running costs", from: prior.periodExpenses / 100, to: now.periodExpenses / 100, goodDirection: "down-is-good" },
    { id: "profit", label: "True profit", from: prior.trueProfit / 100, to: now.trueProfit / 100 },
  ];

  return (
    <CardShell label={`${periodLabel} vs before`} action={<CardLink href="/money/profit-loss">Full report</CardLink>}>
      {/* Reached only past the `!now || !prior` guard above, so both ladders
          are in hand — the frame is being told a fact, not guessing. */}
      <ChartFrame height={150} state="settled" surface={false}>
        <Dumbbell rows={rows} format={money} fromLabel="was" toLabel="now" />
      </ChartFrame>
    </CardShell>
  );
}

/** Unpaid, in both directions. A balance as of now, so it ignores the period. */
export function MoneyOwedCard({
  leaks,
  state,
  money,
}: {
  leaks:
    | {
        unpaidAging: { totalCents: number; buckets: Array<{ label: string; count: number; cents: number }> };
        /** Optional in the type on purpose: a server one deploy behind simply
            has no payables figure yet, and a missing rung must degrade to
            zero-with-caveat, never crash the screen. */
        unpaidPayables?: { totalCents: number; count: number };
      }
    | undefined;
  state: FigureState;
  money: (v: number) => string;
}) {
  const receivable = leaks ? leaks.unpaidAging.totalCents / 100 : 0;
  const payables = leaks?.unpaidPayables;
  const payable = payables ? payables.totalCents / 100 : 0;
  const owedCount = leaks ? leaks.unpaidAging.buckets.reduce((s, b) => s + b.count, 0) : 0;
  const aged = leaks?.unpaidAging.buckets.at(-1);

  /*
   * This card made the most expensive false claim on the page.
   *
   * Every `leaks ? … : 0` above falls to zero when the request does not
   * arrive, and the card was gated on `isLoading` — false for a failed and for
   * a paused request. So it printed "Owed to you: Rs 0" under the caption
   * "Every sale is paid for." to an owner who was owed money, on the one card
   * whose whole job is to get them to chase it. A quiet zero, a confident
   * sentence, and a "Chase it" link with nothing behind it.
   */
  return (
    <CardShell label="Unpaid · as of today" action={<CardLink href="/insights/leaks">Chase it</CardLink>}>
      {!leaks ? (
        state === "loading" ? (
          <div className="space-y-2 py-1">
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-4 w-40" />
          </div>
        ) : (
          <p className="t-secondary py-1 text-[color:var(--pl-amber)]">
            {figureStateSentence(state, "what you're owed")}
          </p>
        )
      ) : (
        <div className="grid grid-cols-2 divide-x divide-[color:var(--pl-grid-line)]">
          <div className="pr-4">
            <p className="t-micro">Owed to you</p>
            {/* Ink, not green: this money has not been gained yet, and colouring
                it as gained is exactly the overstatement an owed figure invites. */}
            <p className="t-num mt-1 text-lg font-semibold text-[color:var(--pl-ink)]">{money(receivable)}</p>
            <p className="t-micro mt-0.5">
              {receivable <= 0
                ? "Every sale is paid for."
                : aged && aged.cents > 0
                  ? `${owedCount} unpaid · ${money(aged.cents / 100)} is ${aged.label.replace("days", "days old")}`
                  : `${owedCount} sale${owedCount === 1 ? "" : "s"} not paid yet`}
            </p>
          </div>
          <div className="pl-4">
            <p className="t-micro">You owe</p>
            <p className="t-num mt-1 text-lg font-semibold text-[color:var(--pl-ink)]">{money(payable)}</p>
            <p className="t-micro mt-0.5">
              {!payables
                ? "Not available yet."
                : payable <= 0
                  ? "No unpaid bills recorded."
                  : `${payables.count} bill${payables.count === 1 ? "" : "s"} not paid yet`}
            </p>
          </div>
        </div>
      )}
    </CardShell>
  );
}
