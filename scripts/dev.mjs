// `npm run dev` — the Next dev server bound to loopback ONLY (127.0.0.1), and
// the one thing the development sign-in bypass trusts.
//
// Development talks to the shared Supabase database, so:
//
//   1. The server binds 127.0.0.1: nothing but this machine can connect.
//   2. This launcher makes a fresh random key for every run and keeps it in
//      memory, then answers a challenge on a loopback port:
//      `HMAC-SHA256(key, challenge)`. The dev server gets the port and key in
//      PROFIT_LOOP_DEV_LAUNCHER, and the bypass (devBypass.ts) proves this
//      launcher is ALIVE before honouring anything. An environment variable on
//      its own — typed into .env.local, copied from an old run — proves
//      nothing: without this process answering, the bypass stays off.
//
// Need the dev server on your network (testing on a phone)? `npm run dev:lan`
// — real sign-in only, no bypass.
import crypto from "node:crypto";
import net from "node:net";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const nextBin = require.resolve("next/dist/bin/next");

const key = crypto.randomBytes(32);
const CHALLENGE = /^[0-9a-f]{64}$/;

const responder = net.createServer((socket) => {
  socket.setTimeout(2_000);
  let buffer = "";
  socket.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    if (buffer.length > 256) return socket.destroy();
    const end = buffer.indexOf("\n");
    if (end < 0) return;
    const challenge = buffer.slice(0, end).trim();
    if (!CHALLENGE.test(challenge)) return socket.destroy();
    socket.end(crypto.createHmac("sha256", key).update(challenge).digest("hex") + "\n");
  });
  socket.on("timeout", () => socket.destroy());
  socket.on("error", () => {});
});

const passthrough = process.argv.slice(2).filter((arg, i, all) => {
  // The bind is not negotiable here; drop any attempt to override it.
  if (arg === "-H" || arg === "--hostname") return false;
  if (all[i - 1] === "-H" || all[i - 1] === "--hostname") return false;
  return !arg.startsWith("--hostname=");
});

responder.listen(0, "127.0.0.1", () => {
  const { port } = responder.address();
  const child = spawn(process.execPath, [nextBin, "dev", "--hostname", "127.0.0.1", ...passthrough], {
    stdio: "inherit",
    env: { ...process.env, PROFIT_LOOP_DEV_LAUNCHER: `${port}.${key.toString("hex")}` },
  });
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
  child.on("exit", (code, signal) => {
    responder.close();
    process.exit(signal ? 1 : (code ?? 0));
  });
});
