import test, { after, afterEach, before } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import type { AddressInfo } from "node:net";

/**
 * The development bypass against the shared database: every fence in
 * devBypass.ts, one at a time, with REAL loopback sockets standing in for the
 * launcher and the dev server. Environment is set in-process only.
 */
const ENV_KEYS = ["LOCAL_AUTH_BYPASS", "PROFIT_LOOP_DEV_LAUNCHER", "LOCAL_AUTH_USER_ID", "NODE_ENV", "PORT"];
const saved: Record<string, string | undefined> = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

const { resolveDevBypass, isLoopbackAddress, verifyLauncher, boundToLoopbackOnly, resetDevBypassTrustForTests } = await import(
  "./devBypass"
);

/** A stand-in for scripts/dev.mjs: signs challenges with `key`. */
function fakeLauncher(key: Buffer): Promise<{ port: number; close: () => void }> {
  const server = net.createServer((socket) => {
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      const end = buffer.indexOf("\n");
      if (end < 0) return;
      socket.end(crypto.createHmac("sha256", key).update(buffer.slice(0, end).trim()).digest("hex") + "\n");
    });
    socket.on("error", () => {});
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve({ port: (server.address() as AddressInfo).port, close: () => server.close() })),
  );
}

function httpServer(host: string): Promise<{ port: number; close: () => void }> {
  const server = http.createServer((_req, res) => res.end("ok"));
  return new Promise((resolve) =>
    server.listen(0, host, () => resolve({ port: (server.address() as AddressInfo).port, close: () => server.close() })),
  );
}

const KEY = crypto.randomBytes(32);
let launcher: { port: number; close: () => void };
let devServer: { port: number; close: () => void };

before(async () => {
  launcher = await fakeLauncher(KEY);
  devServer = await httpServer("127.0.0.1");
});
after(() => {
  launcher.close();
  devServer.close();
});
afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  resetDevBypassTrustForTests();
});

const headers = (h: Record<string, string>) => (name: string) => h[name.toLowerCase()];
const REAL = "e486de75-aca2-487b-ad0c-b35b700df9f7";

/** Everything a genuine `npm run dev` session has. */
function on() {
  (process.env as Record<string, string>).NODE_ENV = "development";
  process.env.LOCAL_AUTH_BYPASS = "true";
  process.env.PROFIT_LOOP_DEV_LAUNCHER = `${launcher.port}.${KEY.toString("hex")}`;
  process.env.PORT = String(devServer.port);
}

test("off unless LOCAL_AUTH_BYPASS=true", async () => {
  delete process.env.LOCAL_AUTH_BYPASS;
  assert.deepEqual(await resolveDevBypass(headers({ host: "localhost:3000" })), { kind: "off" });
});

test("off in production whatever else is set", async () => {
  on();
  (process.env as Record<string, string>).NODE_ENV = "production";
  assert.deepEqual(await resolveDevBypass(headers({ host: "localhost:3000" })), { kind: "off" });
});

test("a genuine launcher + loopback-only server + dev account on localhost is allowed", async () => {
  on();
  assert.deepEqual(await resolveDevBypass(headers({ host: "localhost:3000" })), { kind: "user", userId: "local-user" });
  assert.deepEqual(
    await resolveDevBypass(headers({ host: "127.0.0.1:3000", "x-profit-loop-dev-user-id": "test-fashion" })),
    { kind: "user", userId: "test-fashion" },
  );
});

test("the env var alone cannot switch it on: no launcher listening → off", async () => {
  on();
  const dead = await fakeLauncher(KEY);
  dead.close();
  await new Promise((r) => setTimeout(r, 50));
  process.env.PROFIT_LOOP_DEV_LAUNCHER = `${dead.port}.${KEY.toString("hex")}`;
  assert.deepEqual(await resolveDevBypass(headers({ host: "localhost:3000" })), { kind: "off" });
});

test("a stale or guessed key (a different run's) → off", async () => {
  on();
  process.env.PROFIT_LOOP_DEV_LAUNCHER = `${launcher.port}.${crypto.randomBytes(32).toString("hex")}`;
  assert.deepEqual(await resolveDevBypass(headers({ host: "localhost:3000" })), { kind: "off" });
});

test("a malformed launcher value → off", async () => {
  on();
  process.env.PROFIT_LOOP_DEV_LAUNCHER = "1";
  assert.deepEqual(await resolveDevBypass(headers({ host: "localhost:3000" })), { kind: "off" });
  assert.equal(await verifyLauncher(undefined), false);
});

test("no PORT (cannot verify the bind) → off", async () => {
  on();
  delete process.env.PORT;
  assert.deepEqual(await resolveDevBypass(headers({ host: "localhost:3000" })), { kind: "off" });
});

const lanAddress = Object.values(os.networkInterfaces())
  .flat()
  .find((nic) => nic && !nic.internal && nic.family === "IPv4")?.address;

test("a server reachable on a network address is detected", { skip: !lanAddress && "no network interface on this machine" }, async () => {
  const exposed = await httpServer("0.0.0.0");
  try {
    assert.equal(await boundToLoopbackOnly(exposed.port), false);
    assert.equal(await boundToLoopbackOnly(devServer.port), true);
  } finally {
    exposed.close();
  }
});

test("a real Supabase account can never be impersonated", async () => {
  on();
  const r = await resolveDevBypass(headers({ host: "localhost:3000", "x-profit-loop-dev-user-id": REAL }));
  assert.equal(r.kind, "refused");
  process.env.LOCAL_AUTH_USER_ID = REAL;
  assert.equal((await resolveDevBypass(headers({ host: "localhost:3000" }))).kind, "refused");
});

test("an id outside the development list is refused", async () => {
  on();
  assert.equal((await resolveDevBypass(headers({ host: "localhost:3000", "x-profit-loop-dev-user-id": "someone" }))).kind, "refused");
});

test("a non-loopback Host is refused (DNS rebinding)", async () => {
  on();
  assert.equal((await resolveDevBypass(headers({ host: "evil.example:3000" }))).kind, "refused");
  assert.equal((await resolveDevBypass(headers({ host: "192.168.1.5:3000" }))).kind, "refused");
});

test("a non-loopback x-forwarded-for is refused", async () => {
  on();
  assert.equal((await resolveDevBypass(headers({ host: "localhost:3000", "x-forwarded-for": "203.0.113.9" }))).kind, "refused");
  assert.equal((await resolveDevBypass(headers({ host: "localhost:3000", "x-forwarded-for": "127.0.0.1" }))).kind, "user");
});

test("loopback addresses", () => {
  assert.equal(isLoopbackAddress("127.0.0.1"), true);
  assert.equal(isLoopbackAddress("::1"), true);
  assert.equal(isLoopbackAddress("::ffff:127.0.0.1"), true);
  assert.equal(isLoopbackAddress("192.168.100.81"), false);
  assert.equal(isLoopbackAddress(undefined), false);
});
