import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { lookupFxRate, setFxFetcherForTests } from "@/app/api/fx-rate/functions";

let calls = 0;
function provider(body: unknown, ok = true) {
  setFxFetcherForTests(async () => {
    calls += 1;
    return { ok, json: async () => body } as Response;
  });
}

beforeEach(() => {
  calls = 0;
  setFxFetcherForTests(null);
});

test("today's rate comes back as a decimal string, base per one unit", async () => {
  provider({ result: "success", time_last_update_utc: "Sat, 26 Sep 2026 00:02:31 +0000", rates: { PKR: 280.53, USD: 1 } });
  const got = await lookupFxRate("USD", "PKR", { fresh: true });
  assert.equal(got.rate, "280.53");
  assert.equal(got.asOf, new Date("2026-09-26T00:02:31Z").toISOString());
});

test("a second ask the same day does not call the provider again", async () => {
  provider({ result: "success", time_last_update_utc: "Sat, 26 Sep 2026 00:02:31 +0000", rates: { PKR: 280.53 } });
  await lookupFxRate("USD", "PKR", { fresh: true });
  await lookupFxRate("USD", "PKR");
  assert.equal(calls, 1);
});

test("a provider that is down, refuses, or lacks the currency gives no rate rather than an error", async () => {
  provider({}, false);
  assert.equal((await lookupFxRate("USD", "PKR", { fresh: true })).rate, null);
  provider({ result: "error" });
  assert.equal((await lookupFxRate("USD", "PKR", { fresh: true })).rate, null);
  provider({ result: "success", rates: { EUR: 0.9 } });
  assert.equal((await lookupFxRate("USD", "PKR", { fresh: true })).rate, null);
  setFxFetcherForTests(async () => {
    throw new Error("offline");
  });
  assert.equal((await lookupFxRate("USD", "PKR", { fresh: true })).rate, null);
});

test("a failed lookup is not remembered, so the next ask tries again", async () => {
  provider({}, false);
  await lookupFxRate("USD", "PKR", { fresh: true });
  provider({ result: "success", rates: { PKR: 281 } });
  assert.equal((await lookupFxRate("USD", "PKR")).rate, "281");
});

test("rates are rounded the way a bank quotes them, without losing a small one", async () => {
  provider({ result: "success", rates: { PKR: 276.956128, JPY: 0.003611 } });
  assert.equal((await lookupFxRate("USD", "PKR", { fresh: true })).rate, "276.96");
  assert.equal((await lookupFxRate("USD", "JPY")).rate, "0.003611");
});

test("a code that is not three capital letters never reaches the provider", async () => {
  provider({ result: "success", rates: { PKR: 280 } });
  assert.equal((await lookupFxRate("us/../x", "PKR", { fresh: true })).rate, null);
  assert.equal(calls, 0);
});
