import test from "node:test";
import assert from "node:assert/strict";
import {
  figureState,
  combineFigureStates,
  figureStateSentence,
  FIGURE_STATE_COPY,
} from "./figureState";

/** A query result with everything false — override the one flag under test. */
const idle = { isLoading: false, isPaused: false, isError: false };

test("a figure already in hand beats every other state", () => {
  // The last good figure holds while a refetch fails or is paused, which is
  // the same rule ChartFrame follows on refetch. Replacing a real number with
  // "Couldn't load" would be losing information, not gaining honesty.
  assert.equal(figureState({ ...idle, isError: true }, true), "settled");
  assert.equal(figureState({ ...idle, isPaused: true }, true), "settled");
  assert.equal(figureState({ ...idle, isLoading: true }, true), "settled");
});

test("a paused request with no figure is offline, not loading", () => {
  // This is the case the whole module exists for. React Query reports a paused
  // query as isPending with isFetching false, so `isLoading` is FALSE and the
  // page falls straight through to its "settled with nothing" rendering — an
  // em dash, or worse, an empty-state sentence. It is neither.
  assert.equal(figureState({ ...idle, isPaused: true }, false), "offline");
});

test("offline wins even when the query also reports loading", () => {
  // Order independence: never rely on React Query's flags being mutually
  // exclusive, because the pause bug came from assuming exactly that.
  assert.equal(figureState({ isLoading: true, isPaused: true, isError: false }, false), "offline");
});

test("a request in flight is loading, and a failed one is failed", () => {
  assert.equal(figureState({ ...idle, isLoading: true }, false), "loading");
  assert.equal(figureState({ ...idle, isError: true }, false), "failed");
});

test("a request that settled with nothing in it is settled — the em dash case", () => {
  // A period with no trade really did answer, and it answered "nothing".
  assert.equal(figureState(idle, false), "settled");
});

test("combining takes the state that best explains the absence", () => {
  // Offline explains every other failure on the page, so it outranks them.
  assert.equal(combineFigureStates(["failed", "offline", "loading"]), "offline");
  assert.equal(combineFigureStates(["settled", "failed", "loading"]), "failed");
  assert.equal(combineFigureStates(["settled", "loading"]), "loading");
  assert.equal(combineFigureStates(["settled", "settled"]), "settled");
});

test("combining nothing is settled, never a phantom failure", () => {
  assert.equal(combineFigureStates([]), "settled");
});

test("the sentence names the subject it was given, mid-sentence", () => {
  const subject = "this period's figures";
  assert.equal(figureStateSentence("loading", subject), "Waiting for this period's figures.");
  assert.match(figureStateSentence("offline", subject)!, /you're offline/i);
  assert.match(figureStateSentence("offline", subject)!, /this period's figures/);
  assert.match(figureStateSentence("failed", subject)!, /this period's figures/);
  assert.match(figureStateSentence("failed", subject)!, /didn't answer/);
});

test("every sentence reads as one — no clause starting in lower case", () => {
  // Caught in the browser, not here: joining a phrase that already ended in a
  // full stop onto the subject produced "You're offline. this period's figures
  // will appear…". It read as a typo to the one person who matters.
  for (const state of ["loading", "offline", "failed"] as const) {
    const sentence = figureStateSentence(state, "this period's figures")!;
    assert.match(sentence, /^[A-Z]/, state);
    assert.doesNotMatch(sentence, /\.\s+[a-z]/, state);
    assert.match(sentence, /\.$/, state);
  }
});

test("a settled figure has no sentence — there is nothing to explain", () => {
  assert.equal(figureStateSentence("settled", "this period's figures"), undefined);
});

test("the slot text is short enough to sit where a number would", () => {
  // It replaces a figure inside a stat pill, so it cannot be a sentence.
  for (const state of ["offline", "failed"] as const) {
    assert.ok(FIGURE_STATE_COPY[state].slot.length <= 14, state);
  }
});

test("no slot text or sentence can be mistaken for a figure", () => {
  // The invariant this module defends: never put something in a money slot
  // that reads as an amount. No digits, anywhere in the copy.
  for (const state of ["offline", "failed"] as const) {
    const copy = FIGURE_STATE_COPY[state];
    assert.doesNotMatch(copy.slot, /\d/, state);
    assert.doesNotMatch(copy.why, /\d/, state);
  }
});
