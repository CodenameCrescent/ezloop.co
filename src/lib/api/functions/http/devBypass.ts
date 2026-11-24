import crypto from "node:crypto";
import net from "node:net";
import os from "node:os";
import { isDevAccountId, looksLikeRealUserId } from "@/lib/devAccounts";
import { logger } from "../lib/logger";

/**
 * The local development sign-in bypass, and every condition it must meet.
 *
 * The database behind development is SHARED with real accounts, so the bypass
 * is fenced on every side, and fails closed — any check it cannot complete
 * means real sign-in:
 *
 *   1. Never in production (`NODE_ENV`), and only when LOCAL_AUTH_BYPASS=true.
 *   2. A LIVE trusted launcher. `npm run dev` (scripts/dev.mjs) holds a random
 *      per-run key in memory and answers a challenge on a loopback port. This
 *      process sends a fresh random challenge and checks the HMAC. A value
 *      typed into .env.local, or left over from an earlier run, proves nothing
 *      without that process alive and answering — an environment variable can
 *      no longer switch the bypass on.
 *   3. The server's ACTUAL bind is loopback only. Route code cannot see its
 *      socket, so it probes: it tries to connect to its own port (Next sets
 *      `PORT`) on every network-facing address of this machine. If any answers,
 *      the dev server is reachable from the network and the bypass is off.
 *   4. The Host header must be loopback — a page on another site that rebinds
 *      its DNS to 127.0.0.1 still arrives with its own host name.
 *   5. `x-forwarded-for`, when present, must be loopback too.
 *   6. Only the explicit dev accounts in `src/lib/devAccounts.ts`. A real
 *      account (a Supabase UUID) is refused outright, whatever else is true.
 *
 * Checks 2 and 3 are re-run at most every 15 seconds, so stopping the launcher
 * or rebinding the server turns the bypass off within that window.
 *
 * The integration-test harness (`app.ts`) is the one other caller. It reads
 * the real socket address itself, refuses anything not on loopback, and turns
 * on test mode here IN-PROCESS — there is no environment variable for it — so
 * its suites can use their own fixture ids (still never a UUID). Checks 2 and
 * 3 do not apply to it: it is not a Next server and has no launcher.
 */

export const DEV_USER_HEADER = "x-profit-loop-dev-user-id";
const SAFE_ID = /^[a-zA-Z0-9_-]{1,64}$/;
const RECHECK_MS = 15_000;

let testHarness = false;

/** Called by the integration-test harness only. Not reachable from Next. */
export function enableTestHarnessBypass(): void {
  testHarness = true;
}

/** LOCAL_AUTH_BYPASS is switched on in a non-production process. Not by itself enough. */
export function bypassRequested(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.LOCAL_AUTH_BYPASS === "true";
}

export type DevBypass =
  | { kind: "off" }
  | { kind: "user"; userId: string }
  | { kind: "refused"; reason: string };

function hostOf(hostHeader: string | undefined): string {
  if (!hostHeader) return "";
  const host = hostHeader.trim().toLowerCase();
  if (host.startsWith("[")) return host.slice(0, host.indexOf("]") + 1);
  return host.split(":")[0];
}

function isLoopbackHost(hostHeader: string | undefined): boolean {
  return ["localhost", "127.0.0.1", "[::1]"].includes(hostOf(hostHeader));
}

export function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return false;
  const a = address.trim().toLowerCase();
  return a === "::1" || a.startsWith("127.") || a.startsWith("::ffff:127.");
}

// ── Check 2: the launcher is alive and holds the key ───────────────────────

/** Asks the launcher on 127.0.0.1:port to sign a fresh challenge. */
export function verifyLauncher(spec: string | undefined, timeoutMs = 1_000): Promise<boolean> {
  const match = /^(\d{1,5})\.([0-9a-f]{64})$/.exec(spec ?? "");
  if (!match) return Promise.resolve(false);
  const port = Number(match[1]);
  const key = Buffer.from(match[2], "hex");
  const challenge = crypto.randomBytes(32).toString("hex");
  const expected = crypto.createHmac("sha256", key).update(challenge).digest();

  return new Promise((resolve) => {
    let reply = "";
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ok);
    };
    const socket = net.connect({ host: "127.0.0.1", port });
    socket.setTimeout(timeoutMs, () => done(false));
    socket.on("error", () => done(false));
    socket.on("connect", () => socket.write(challenge + "\n"));
    socket.on("data", (chunk) => {
      reply += chunk.toString("utf8");
      if (reply.length > 256) return done(false);
      const end = reply.indexOf("\n");
      if (end < 0) return;
      const got = Buffer.from(reply.slice(0, end).trim(), "hex");
      done(got.length === expected.length && crypto.timingSafeEqual(got, expected));
    });
    socket.on("end", () => done(false));
  });
}

// ── Check 3: nothing but loopback reaches this server ──────────────────────

/** Every address of this machine another device could connect to. */
function networkFacingAddresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const nic of list ?? []) {
      if (nic.internal) continue;
      if (nic.family === "IPv6" && nic.address.toLowerCase().startsWith("fe80")) continue; // link-local needs a scope id
      out.push(nic.address);
    }
  }
  return out;
}

function answers(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.on("connect", () => done(true));
    socket.on("error", () => done(false));
  });
}

/** True only when this server's port answers on loopback and on NO network-facing address. */
export async function boundToLoopbackOnly(
  port = Number(process.env.PORT),
  addresses = networkFacingAddresses(),
  timeoutMs = 400,
): Promise<boolean> {
  if (!Number.isInteger(port) || port <= 0) return false;
  const exposed = await Promise.all(addresses.map((address) => answers(address, port, timeoutMs)));
  return !exposed.some(Boolean);
}

let trust: { ok: boolean; at: number; pending?: Promise<boolean> } | null = null;
let warned = false;

async function trustedLocalServer(): Promise<boolean> {
  const now = Date.now();
  if (trust && !trust.pending && now - trust.at < RECHECK_MS) return trust.ok;
  if (trust?.pending) return trust.pending;
  const pending = (async () => {
    const launcher = await verifyLauncher(process.env.PROFIT_LOOP_DEV_LAUNCHER);
    const loopback = launcher && (await boundToLoopbackOnly());
    const ok = launcher && loopback;
    if (!ok && !warned) {
      warned = true;
      logger.warn(
        !launcher
          ? "LOCAL_AUTH_BYPASS is set but no live `npm run dev` launcher answered — the bypass is OFF and real sign-in applies."
          : "LOCAL_AUTH_BYPASS is set but this dev server is reachable from the network — the bypass is OFF and real sign-in applies.",
      );
    }
    if (ok) warned = false;
    trust = { ok, at: Date.now() };
    return ok;
  })();
  trust = { ok: trust?.ok ?? false, at: trust?.at ?? 0, pending };
  return pending;
}

/** Test seam: forget the cached launcher/bind verdict. */
export function resetDevBypassTrustForTests(): void {
  trust = null;
  warned = false;
}

/**
 * What the bypass says about one request. `off` means use real sign-in;
 * `refused` means the bypass is on but this request may not use it.
 */
export async function resolveDevBypass(header: (name: string) => string | undefined): Promise<DevBypass> {
  if (!bypassRequested()) return { kind: "off" };
  if (!testHarness && !(await trustedLocalServer())) return { kind: "off" };

  if (!isLoopbackHost(header("host"))) return { kind: "refused", reason: "The development bypass only answers requests addressed to localhost." };
  const forwarded = header("x-forwarded-for");
  if (forwarded && !forwarded.split(",").every((part) => isLoopbackAddress(part))) {
    return { kind: "refused", reason: "The development bypass only answers requests from this machine." };
  }

  const requested = header(DEV_USER_HEADER)?.trim();
  const fallback = process.env.LOCAL_AUTH_USER_ID?.trim() || "local-user";

  if (testHarness) {
    const userId = requested && SAFE_ID.test(requested) ? requested : fallback;
    if (looksLikeRealUserId(userId)) return { kind: "refused", reason: "The development bypass never acts as a real account." };
    return { kind: "user", userId };
  }

  const userId = requested || fallback;
  if (!isDevAccountId(userId)) {
    return { kind: "refused", reason: "The development bypass only acts as the listed development accounts." };
  }
  return { kind: "user", userId };
}
