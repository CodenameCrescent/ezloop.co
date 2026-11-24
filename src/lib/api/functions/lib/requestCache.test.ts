import test from "node:test";
import assert from "node:assert/strict";
import { cachedRead, runWithRequestCache } from "./requestCache";

test("a repeated read inside one request loads once", async () => {
  let loads = 0;
  const load = async () => {
    loads++;
    return "rows";
  };

  await runWithRequestCache(async () => {
    const a = await cachedRead("k", load);
    const b = await cachedRead("k", load);
    assert.equal(a, "rows");
    assert.equal(b, "rows");
  });

  assert.equal(loads, 1, "the second ask reused the first load");
});

test("concurrent identical reads share ONE load", async () => {
  // The shape that actually matters: six callers inside a Promise.all starting
  // the same load in the same tick. Caching the value rather than the promise
  // would let all six through.
  let loads = 0;
  const load = async () => {
    loads++;
    await new Promise((r) => setTimeout(r, 5));
    return loads;
  };

  await runWithRequestCache(async () => {
    const results = await Promise.all(Array.from({ length: 6 }, () => cachedRead("k", load)));
    assert.deepEqual(results, [1, 1, 1, 1, 1, 1], "all six saw the same load");
  });

  assert.equal(loads, 1);
});

test("different keys stay separate", async () => {
  let loads = 0;
  const load = async () => `load-${++loads}`;

  await runWithRequestCache(async () => {
    assert.equal(await cachedRead("a", load), "load-1");
    assert.equal(await cachedRead("b", load), "load-2");
    assert.equal(await cachedRead("a", load), "load-1", "and the first key kept its own answer");
  });
  assert.equal(loads, 2);
});

test("one request never sees another request's rows", async () => {
  let loads = 0;
  const load = async () => `load-${++loads}`;

  const first = await runWithRequestCache(async () => cachedRead("k", load));
  const second = await runWithRequestCache(async () => cachedRead("k", load));

  assert.equal(first, "load-1");
  assert.equal(second, "load-2", "a new request starts from an empty cache");
});

test("outside a request nothing is cached", async () => {
  let loads = 0;
  const load = async () => `load-${++loads}`;

  await cachedRead("k", load);
  await cachedRead("k", load);

  assert.equal(loads, 2, "scripts and jobs are unaffected by the cache");
});

test("a failed load is not remembered", async () => {
  let attempts = 0;
  const flaky = async () => {
    attempts++;
    if (attempts === 1) throw new Error("connection lost");
    return "rows";
  };

  await runWithRequestCache(async () => {
    await assert.rejects(() => cachedRead("k", flaky));
    // Caching the rejected promise would make every later caller in this
    // request fail too, turning one blip into a dead page.
    assert.equal(await cachedRead("k", flaky), "rows");
  });

  assert.equal(attempts, 2);
});
