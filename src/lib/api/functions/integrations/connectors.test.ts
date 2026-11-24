/**
 * The screens decide which Connect buttons to show from the contract's
 * LIVE_INTEGRATION_KINDS; Sync decides what it can do from `live` here. If the
 * two drift, the owner is offered a connection that silently does nothing — or
 * cannot find one that works.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { LIVE_INTEGRATION_KINDS } from "@workspace/api-contract";

// The registry file imports the db module, which refuses to load without a URL.
// Nothing here queries it; a pool is only opened on first use.
process.env.DATABASE_URL ??= "postgres://unused@localhost:5432/unused";
const { CONNECTORS } = await import("./connectors");

test("the contract's live list matches the connector registry", () => {
  const registryLive = Object.values(CONNECTORS)
    .filter((c) => c.live)
    .map((c) => c.kind)
    .sort();
  assert.deepEqual([...LIVE_INTEGRATION_KINDS].sort(), registryLive);
});
