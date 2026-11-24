import { useMemo, useState } from "react";
import { InsightCard } from "@/components/InsightCard";
import { Surface } from "@/components/Surface";
import { formatCents } from "@/lib/money";
import { shouldResurface } from "@/lib/insightTone";
import { figureStateSentence, type FigureState } from "@/lib/figureState";
import { cn } from "@/lib/utils";
import type { InsightCardShape } from "@workspace/api-contract";

/**
 * "What needs your attention" — the ranked card feed.
 *
 * Named that rather than "Insights", because "Insights" is a category and this
 * is a promise: it says what the list is FOR, and implies it is short and
 * finite. The ranking, the five-card cap and the leak total all arrive
 * server-computed; this component only words and arranges them.
 */

/**
 * How many show before "Show more". Five is what a person reads; ten is a
 * to-do list, and to-do lists get abandoned.
 *
 * The All view arrives already capped at five by the rule engine, so this only
 * ever bites in the Leaks view, which is deliberately uncapped because that
 * toggle exists to show the full bill.
 */
const VISIBLE = 5;

const DISMISS_KEY = "pl.insights.dismissed.v1";

type DismissedMap = Record<string, number>;

function readDismissed(): DismissedMap {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    return raw ? (JSON.parse(raw) as DismissedMap) : {};
  } catch {
    return {};
  }
}

function writeDismissed(map: DismissedMap) {
  try {
    localStorage.setItem(DISMISS_KEY, JSON.stringify(map));
  } catch {
    // A full or blocked storage must never take the feed down with it.
  }
}

export function InsightFeed({
  insights,
  leaks,
  totalLeakCents,
  symbol = "Rs",
  state,
  className,
}: {
  insights: InsightCardShape[];
  leaks: InsightCardShape[];
  totalLeakCents: number;
  symbol?: string;
  /**
   * Why the feed is empty, when it is empty.
   *
   * Was `isLoading`, which could not tell "we looked and you are fine" from
   * "we never got an answer" — and this component's empty state is the most
   * reassuring sentence in the product. A failed request used to render
   * "Nothing needs your attention this period." above a leaks tab reading
   * "Leaks · none", which is the app clearing a business it had not looked at.
   */
  state: FigureState;
  className?: string;
}) {
  const [view, setView] = useState<"all" | "leaks">("all");
  const [expanded, setExpanded] = useState(false);
  const [dismissed, setDismissed] = useState<DismissedMap>(() => readDismissed());

  /**
   * A dismissed card stays gone only while the condition it described holds.
   * Once the money behind it moves 15% either way it comes back — permanent
   * dismissal would mean the app quietly stopped warning about a real leak.
   */
  const isHidden = (card: InsightCardShape) => {
    const dismissedAt = dismissed[card.id];
    if (dismissedAt === undefined) return false;
    return !shouldResurface(dismissedAt, card.impactCents);
  };

  const dismiss = (card: InsightCardShape) => {
    const next = { ...dismissed, [card.id]: card.impactCents };
    setDismissed(next);
    writeDismissed(next);
  };

  const source = view === "all" ? insights : leaks;
  const shown = useMemo(() => source.filter((c) => !isHidden(c)), [source, dismissed]);
  const visible = expanded ? shown : shown.slice(0, VISIBLE);
  const hiddenCount = shown.length - visible.length;

  if (state === "loading") {
    return (
      <Surface padding="md" className={className}>
        <p className="t-secondary">Working out what needs your attention…</p>
      </Surface>
    );
  }

  /*
   * The list never arrived, so there is nothing to rank and nothing to clear.
   *
   * The whole header goes with it, not just the cards: "All 0" and
   * "Leaks · none" are counts of a list nobody has, and the tab strip reads as
   * an answer even when the panel under it does not. Amber, because a request
   * that did not land is not money lost (DESIGN.md §2).
   */
  if (state !== "settled") {
    return (
      <Surface padding="md" className={className}>
        <h2 className="t-section text-[color:var(--pl-ink)]">What needs your attention</h2>
        <p className="t-body mt-1 text-[color:var(--pl-amber)]">
          {figureStateSentence(state, "what needs your attention")}
        </p>
      </Surface>
    );
  }

  return (
    <section className={className}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="t-section text-[color:var(--pl-ink)]">What needs your attention</h2>

        {/* Two segments, not a filter panel — a panel implies many dimensions,
            and there are exactly two views. The leak TOTAL rides inside the
            button's own label because it is the most persuasive figure in the
            product and must be readable without tapping anything. */}
        <div
          role="tablist"
          aria-label="Insight view"
          className="flex items-center gap-1 rounded-full bg-[color:var(--pl-recessed)] p-1"
        >
          <FeedTab active={view === "all"} onClick={() => setView("all")}>
            All {insights.length}
          </FeedTab>
          <FeedTab
            active={view === "leaks"}
            disabled={leaks.length === 0}
            onClick={() => setView("leaks")}
          >
            {leaks.length === 0 ? "Leaks · none" : `Leaks · ${formatCents(totalLeakCents, symbol)}`}
          </FeedTab>
        </div>
      </div>

      {view === "leaks" && leaks.length > 0 && (
        <p className="t-body mb-3 text-[color:var(--pl-ink-2)]">
          You are losing {formatCents(totalLeakCents, symbol)} across {leaks.length}{" "}
          {leaks.length === 1 ? "issue" : "issues"}.
        </p>
      )}

      {shown.length === 0 ? (
        <Surface padding="md">
          {/* A quiet screen is a valid output — this does not manufacture a problem. */}
          <p className="t-body text-[color:var(--pl-ink)]">
            {view === "leaks"
              ? "Nothing is leaking money this period."
              : "Nothing needs your attention this period."}
          </p>
          <p className="t-secondary mt-1">
            {insights.length > 0 && view === "all"
              ? "You have marked everything here as seen. It comes back if the numbers move."
              : "Keep recording as you go and this fills itself in."}
          </p>
        </Surface>
      ) : (
        <div className="flex flex-col gap-3">
          {visible.map((card) => (
            <InsightCard
              key={card.id}
              id={card.id}
              impactCents={card.impactCents}
              impactSuffix={card.impactSuffix}
              headline={card.headline}
              cause={card.cause}
              action={card.action}
              explain={card.explain}
              trend={card.trend}
              urgent={card.urgent}
              related={card.related}
              symbol={symbol}
              onDismiss={() => dismiss(card)}
            />
          ))}

          {hiddenCount > 0 && (
            /* Expands in place rather than navigating — the list is finite and
               short, and a page change would lose the reader's place. */
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="self-start rounded-full px-3 py-1.5 text-xs font-semibold text-[color:var(--pl-ink-2)] transition hover:text-[color:var(--pl-ink)]"
            >
              Show {hiddenCount} more
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function FeedTab({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "rounded-full px-3 py-1 text-xs font-medium transition-colors",
        active
          ? "bg-[color:var(--pl-surface)] text-[color:var(--pl-ink)]"
          : "text-[color:var(--pl-ink-2)] hover:text-[color:var(--pl-ink)]",
        disabled && "cursor-not-allowed opacity-60 hover:text-[color:var(--pl-ink-2)]",
      )}
    >
      {children}
    </button>
  );
}
