/**
 * Why a figure is not on screen — decided in ONE place, from a query's flags.
 *
 * The bug this module exists to close: pages read `isLoading` and treat
 * everything else as "settled". React Query has four outcomes, not two, and
 * three of them make `isLoading` false:
 *
 *   | outcome                  | isLoading | isPaused | isError |
 *   |--------------------------|-----------|----------|---------|
 *   | in flight                | true      | false    | false   |
 *   | settled, nothing in it   | false     | false    | false   |
 *   | request failed           | false     | false    | true    |
 *   | paused (browser offline) | false     | true     | false   |
 *
 * A paused query is the trap. It reports `status: "pending"` with
 * `fetchStatus: "paused"`, and `isLoading` is `isPending && isFetching` — so a
 * query that has stopped dead reads as NOT loading, and the page renders its
 * "we have nothing" branch. On Reports and Forecasts that branch is an em dash;
 * on People it was the sentence "No customers yet.", which is a claim about the
 * business made from a request that never arrived.
 *
 * `settled` is the honest empty: the server answered, and the answer was
 * nothing. That one keeps the em dash (DECISIONS.md, 2026-08-27). The other two
 * get their own words, because "your business recorded nothing" and "we could
 * not reach the books" are different sentences and only one of them is true.
 *
 * Pure, and deliberately structural: it takes the three flags, not a
 * `UseQueryResult`, so it unit-tests without React and without a query client.
 */

export type FigureState = "loading" | "settled" | "offline" | "failed";

/** The three flags this decision needs. `UseQueryResult` satisfies it as-is. */
export interface FigureQueryFlags {
  isLoading: boolean;
  isPaused: boolean;
  isError: boolean;
}

/**
 * What to show in a figure's place.
 *
 * `hasFigure` is the caller's own answer to "do I have a number to print?" —
 * usually `data?.something != null`. It comes first because a figure already in
 * hand outranks every failure: a refetch that fails or pauses must not blank
 * out the last good number, which is the same rule ChartFrame follows
 * (DESIGN.md §8).
 */
export function figureState(q: FigureQueryFlags, hasFigure: boolean): FigureState {
  if (hasFigure) return "settled";
  // Paused is checked BEFORE loading on purpose. The two are not mutually
  // exclusive by contract, and if they ever overlap, "stopped" is the more
  // truthful of the two — "loading" would promise an arrival that is not coming.
  if (q.isPaused) return "offline";
  if (q.isLoading) return "loading";
  if (q.isError) return "failed";
  return "settled";
}

/**
 * One state for a screen fed by several requests.
 *
 * Ranked by how much each one explains. Offline explains every other failure on
 * the page at once, so it outranks a specific failure; a failure outranks a
 * request still in flight, because waiting for a screen that has already broken
 * is the wait that never ends.
 */
const RANK: Record<FigureState, number> = { offline: 3, failed: 2, loading: 1, settled: 0 };

export function combineFigureStates(states: readonly FigureState[]): FigureState {
  return states.reduce<FigureState>(
    (worst, s) => (RANK[s] > RANK[worst] ? s : worst),
    "settled",
  );
}

/**
 * The words, in one place so no two screens describe the same state differently.
 *
 * "Offline" is the honest word for a paused query even though TWO things pause
 * one — the browser reporting itself offline, and the document being hidden.
 * The second is unobservable to a person: a hidden tab is one nobody is looking
 * at, and the moment they look, `visibilitychange` fires, React Query resumes
 * the paused retry (`Query.onFocus` calls `retryer.continue()` regardless of
 * `refetchOnWindowFocus`), and the query settles before it can be read. So
 * every pause a human eye can actually catch is the offline one. Proven in
 * `api/queryFailureModes.test.ts`, which measures both.
 *
 * `slot` goes where the number would have been, so it must be short and must
 * contain no digits — anything numeric in a money slot can be read as an amount.
 * `why` is the one-line reason, for a hint or a sentence.
 *
 * Rendered in AMBER, never red or green. Colour in this app means money
 * (DESIGN.md §2), and a request that did not arrive is not money lost. Amber is
 * already the established signal for "something about this data needs
 * attention" — see the People gap strip, which reasons its way to the same
 * colour for the same reason.
 */
export const FIGURE_STATE_COPY: Record<"offline" | "failed", { slot: string; why: string }> = {
  offline: {
    slot: "Offline",
    why: "You're offline.",
  },
  failed: {
    slot: "Couldn't load",
    why: "The server didn't answer.",
  },
};

/**
 * The state as a full sentence about a named thing.
 *
 * `subject` always lands mid-sentence, so a caller can pass "this period's
 * figures" or "your customers" without having to think about capitalisation.
 * `settled` returns undefined: a figure that settled needs no explanation, and
 * printing one would turn a quiet empty period into an alarm.
 */
export function figureStateSentence(
  state: FigureState,
  subject: string,
): string | undefined {
  switch (state) {
    case "loading":
      return `Waiting for ${subject}.`;
    case "offline":
      // A dash, not the full stop `why` ends with: the subject follows in the
      // same sentence, and joining them with a stop reads as a typo.
      return `${trimEnd(FIGURE_STATE_COPY.offline.why)} — ${subject} will appear when you're back online.`;
    case "failed":
      return `Couldn't load ${subject} — ${lowerFirst(FIGURE_STATE_COPY.failed.why)}`;
    case "settled":
      return undefined;
  }
}

function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

/** Drop a trailing full stop, for a phrase being joined into a longer sentence. */
function trimEnd(s: string): string {
  return s.replace(/\.$/, "");
}
