/**
 * Which failures reach `error`, and which stop dead — measured, not assumed.
 *
 * This file exists because the question was got wrong twice in a row, in
 * opposite directions. One reading was that React Query's default
 * `networkMode: "online"` pauses ANY failed request, so no money screen can
 * ever show an error. Another was that `retry: 1` guarantees every failure
 * reaches `error`. Both are wrong, and the difference decides whether the fix
 * belongs in the QueryClient or on the pages.
 *
 * The answer, measured below against the real library at the app's real
 * settings: **the failure never decides — the browser's state does.** A
 * connection refused, an HTTP 500 and a timeout are indistinguishable to the
 * retryer; all three reach `error` on a visible, online tab, and all three stop
 * dead when the browser reports offline OR when the document is hidden.
 *
 * That last one is not folklore. `createRetryer`'s `canContinue()` is
 * `focusManager.isFocused() && (networkMode === "always" || onlineManager
 * .isOnline()) && canRun()`, and `focusManager.isFocused()` is
 * `document.visibilityState !== "hidden"`. The focus term sits OUTSIDE the
 * networkMode escape hatch, which is why the last case here still pauses with
 * `networkMode: "always"` — and why "just set networkMode: always" is not the
 * fix it looks like.
 *
 * The two paused signatures are told apart by the attempt count: offline pauses
 * BEFORE the first attempt (canStart), a hidden tab pauses between attempt one
 * and the retry (canContinue).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { QueryClient, QueryObserver, focusManager, onlineManager } from "@tanstack/react-query";

/** What apiClient throws for a non-ok HTTP response. */
const httpError = () => Object.assign(new Error("HTTP 500 Internal Server Error"), { status: 500 });
/** What `fetch` rejects with for a refused connection or a timeout: no status. */
const fetchError = () => new TypeError("Failed to fetch");

interface Outcome {
  attempts: number;
  status: string;
  fetchStatus: string;
  isLoading: boolean;
  isError: boolean;
  isPaused: boolean;
}

async function observeFailure(opts: {
  error: () => Error;
  focused: boolean;
  online: boolean;
  networkMode?: "online" | "always";
}): Promise<Outcome> {
  focusManager.setFocused(opts.focused);
  onlineManager.setOnline(opts.online);

  let attempts = 0;
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        // The app's own settings (App.tsx), with the retry delay collapsed —
        // the delay changes how long the pause takes to appear, never whether.
        retry: 1,
        retryDelay: 0,
        refetchOnWindowFocus: false,
        ...(opts.networkMode ? { networkMode: opts.networkMode } : {}),
      },
    },
  });
  const observer = new QueryObserver(client, {
    queryKey: ["failure-mode", Math.random()],
    queryFn: async () => {
      attempts++;
      throw opts.error();
    },
  });
  const unsubscribe = observer.subscribe(() => {});

  // Condition-based, not a fixed sleep: wait until the query has either given
  // up or parked, so a slow machine cannot turn this into a flake.
  const deadline = Date.now() + 5000;
  let r = observer.getCurrentResult();
  while (r.status !== "error" && r.fetchStatus !== "paused" && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    r = observer.getCurrentResult();
  }

  unsubscribe();
  client.clear();
  return {
    attempts,
    status: r.status,
    fetchStatus: r.fetchStatus,
    isLoading: r.isLoading,
    isError: r.isError,
    isPaused: r.isPaused,
  };
}

test.afterEach(() => {
  // Both managers are module singletons. Hand them back.
  focusManager.setFocused(undefined);
  onlineManager.setOnline(true);
});

test("on a visible, online tab all three failures reach error — the pages CAN be told", async () => {
  for (const [name, error] of [
    ["HTTP 500", httpError],
    ["connection refused", fetchError],
    ["timeout", fetchError],
  ] as const) {
    const r = await observeFailure({ error, focused: true, online: true });
    assert.equal(r.status, "error", name);
    assert.equal(r.isError, true, name);
    assert.equal(r.isPaused, false, name);
    // retry: 1 means one retry, so two attempts and then it gives up.
    assert.equal(r.attempts, 2, name);
  }
});

test("a browser that reports itself offline pauses BEFORE the first attempt", async () => {
  const r = await observeFailure({ error: fetchError, focused: true, online: false });
  assert.equal(r.fetchStatus, "paused");
  assert.equal(r.status, "pending");
  assert.equal(r.attempts, 0, "canStart() refuses, so the request is never sent");
});

test("a HIDDEN document pauses AFTER the request has already failed", async () => {
  // The signature the Reports investigator actually saw: the request went out,
  // it failed, and then it parked. That is the focus term in canContinue(), not
  // the network term — an agent-driven or backgrounded tab is `hidden`.
  const r = await observeFailure({ error: fetchError, focused: false, online: true });
  assert.equal(r.fetchStatus, "paused");
  assert.equal(r.status, "pending");
  assert.equal(r.attempts, 1, "it tried once, then paused instead of retrying");
});

test("a paused query reads as NOT loading and NOT errored — the trap", async () => {
  // This is the whole reason figureState.ts exists. `isLoading` is
  // `isPending && isFetching`, and a paused query is not fetching, so every
  // page that branches on isLoading falls through to its "we have nothing"
  // rendering while the request is in fact stopped dead.
  const r = await observeFailure({ error: fetchError, focused: true, online: false });
  assert.equal(r.isLoading, false);
  assert.equal(r.isError, false);
  assert.equal(r.isPaused, true);
});

test('networkMode "always" rescues the offline pause', async () => {
  const r = await observeFailure({
    error: fetchError,
    focused: true,
    online: false,
    networkMode: "always",
  });
  assert.equal(r.status, "error");
  assert.equal(r.attempts, 2);
});

test('networkMode "always" does NOT rescue a hidden tab', async () => {
  // The reason the QueryClient was left alone. `canContinue()` ANDs the focus
  // check outside the networkMode escape hatch, so "always" cannot reach it.
  // A fix in the QueryClient would have closed one of the two pause paths and
  // looked complete.
  const r = await observeFailure({
    error: fetchError,
    focused: false,
    online: true,
    networkMode: "always",
  });
  assert.equal(r.fetchStatus, "paused");
  assert.equal(r.isPaused, true);
});
