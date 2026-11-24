import { Skeleton } from "@/components/ui/skeleton";
import { type FigureState, figureStateSentence } from "@/lib/figureState";
import { type Ladder, CardShell, CardLink } from "./MoneyOwedCard";

/** Best and worst earners, and the flip when the best seller is not the best earner. */
export function PerformersCard({
  data,
  state,
  money,
}: {
  data:
    | {
        flip: { revenueLeader: { id: string; name: string; netRevenueCents: number }; profitLeader: { id: string; name: string; contributionProfitCents: number } } | null;
        offers: Array<{ id: string; name: string; contributionProfitCents: number }>;
      }
    | undefined;
  state: FigureState;
  money: (v: number) => string;
}) {
  const ranked = data ? [...data.offers].sort((a, b) => b.contributionProfitCents - a.contributionProfitCents) : [];
  const best = ranked[0];
  const worst = ranked.at(-1);
  const hasLoser = worst && worst.contributionProfitCents < 0;
  const flipped = data?.flip && data.flip.revenueLeader.id !== data.flip.profitLeader.id ? data.flip : null;

  return (
    <CardShell label="Best & worst this period" action={<CardLink href="/insights/offers">All offers</CardLink>}>
      {/* "Record a sale and this will name what earns" is an instruction, and
          an instruction asserts the thing is not there. It was reached
          whenever `best` was undefined, which includes every request that
          failed or stopped — so a business with a full catalogue was told to
          go and record its first sale. */}
      {state === "loading" ? (
        <div className="space-y-2 py-1">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      ) : state !== "settled" ? (
        <p className="t-secondary py-1 text-[color:var(--pl-amber)]">
          {figureStateSentence(state, "your best and worst")}
        </p>
      ) : !best ? (
        <p className="t-secondary py-1">Record a sale and this will name what earns.</p>
      ) : (
        <div className="space-y-2.5">
          <div className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate text-sm text-[color:var(--pl-ink)]">
              <span className="t-micro block">Earned you the most</span>
              {best.name}
            </span>
            <span className="t-num shrink-0 text-sm font-semibold text-[color:var(--pl-green)]">
              {money(best.contributionProfitCents / 100)}
            </span>
          </div>
          {hasLoser ? (
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate text-sm text-[color:var(--pl-ink)]">
                <span className="t-micro block">Lost you money</span>
                {worst!.name}
              </span>
              <span className="t-num shrink-0 text-sm font-semibold text-[color:var(--pl-red)]">
                {money(worst!.contributionProfitCents / 100)}
              </span>
            </div>
          ) : (
            <p className="t-secondary">Nothing you sold lost money this period.</p>
          )}
          {flipped && (
            /* The fact revenue-ranked reports structurally cannot show. */
            <p className="t-secondary border-t border-[color:var(--pl-hairline)] pt-2">
              {flipped.revenueLeader.name} brings in the most money, but {flipped.profitLeader.name} keeps
              the most.
            </p>
          )}
        </div>
      )}
    </CardShell>
  );
}

/**
 * The cash card, labelled with what the number actually is.
 *
 * There is no bank connection: this is the buffer the owner TYPED into
 * Settings, plus nothing. So the card says "as you set it" — a figure
 * pretending to be a live balance would be the most expensive lie on the
 * page. The one thing the app can honestly add is pace: at this period's
 * rate of profit or burn, how long that buffer lasts.
 */
export function CashCard({
  cashBuffer,
  ladder,
  rangeDays,
  money,
}: {
  cashBuffer: number;
  ladder: Ladder | undefined;
  rangeDays: number;
  money: (v: number) => string;
}) {
  const hasBuffer = cashBuffer > 0;
  const monthlyProfit = ladder ? ((ladder.trueProfit / 100) / rangeDays) * 30 : 0;
  const monthlyExpenses = ladder ? ((ladder.periodExpenses / 100) / rangeDays) * 30 : 0;
  const burning = monthlyProfit < 0;
  const monthlyBurn = burning ? -monthlyProfit : 0;

  const months = burning
    ? hasBuffer
      ? cashBuffer / monthlyBurn
      : 0
    : monthlyExpenses > 0 && hasBuffer
      ? cashBuffer / monthlyExpenses
      : null;
  const monthsLabel =
    months === null ? null : months >= 24 ? "over two years" : `about ${Math.max(0, months).toFixed(months < 3 ? 1 : 0)} months`;

  return (
    <CardShell label="Cash buffer · as you set it" action={<CardLink href="/settings">Update</CardLink>}>
      {!hasBuffer ? (
        <p className="t-secondary py-1">
          Tell Settings how much cash you keep aside, and this card will say how long it lasts at your
          current pace.
        </p>
      ) : (
        <div>
          <p className="t-num text-lg font-semibold text-[color:var(--pl-ink)]">{money(cashBuffer)}</p>
          {burning ? (
            <p className="t-secondary mt-1">
              You are spending{" "}
              <span className="t-num font-semibold text-[color:var(--pl-red)]">{money(monthlyBurn)}</span> a
              month more than you make at this period&rsquo;s pace — this buffer covers {monthsLabel}.
            </p>
          ) : monthsLabel ? (
            <p className="t-secondary mt-1">
              Covers {monthsLabel} of bills if money stopped coming in. You are not spending it down —
              this period made a profit.
            </p>
          ) : (
            <p className="t-secondary mt-1">Nothing recorded this period to measure it against.</p>
          )}
        </div>
      )}
    </CardShell>
  );
}
