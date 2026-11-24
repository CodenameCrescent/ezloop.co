/**
 * The page gate behind `src/proxy.ts`: signed-out visitors to any unlisted page
 * land on "/", public pages stay open, and the proxy never touches the API or
 * static files. Real NextAuth cookies (encode with the real secret), no DB.
 */
import test from "node:test";
import assert from "node:assert/strict";

const ENV = process.env as Record<string, string | undefined>;
ENV.NEXTAUTH_SECRET = "page-gate-test-secret-page-gate-test-secret";
delete ENV.NEXTAUTH_URL;
delete ENV.VERCEL;
delete ENV.LOCAL_AUTH_BYPASS;

const { NextRequest } = await import("next/server");
const { encode } = await import("next-auth/jwt");
const { gatePage, isPublicPage, PUBLIC_PAGES } = await import("./pageGate");
const { config } = await import("../../../../proxy");

const COOKIE = "next-auth.session-token";

function request(path: string, init: { cookie?: string; host?: string; headers?: Record<string, string> } = {}) {
  const host = init.host ?? "localhost:3000";
  return new NextRequest(`http://${host}${path}`, {
    headers: { host, ...(init.cookie ? { cookie: init.cookie } : {}), ...init.headers },
  });
}

async function cookieFor(uid: string, opts: { secret?: string; maxAge?: number } = {}) {
  const token = await encode({ token: { uid, sub: uid }, secret: opts.secret ?? ENV.NEXTAUTH_SECRET!, maxAge: opts.maxAge });
  return `${COOKIE}=${token}`;
}

/** Redirect target, or null when the request is let through. */
async function outcome(path: string, init?: Parameters<typeof request>[1]) {
  const res = await gatePage(request(path, init));
  const to = res.headers.get("location");
  return to ? new URL(to).pathname : null;
}

const PROTECTED = ["/dashboard", "/money/invoices", "/settings/account", "/businesses", "/welcome", "/dev/insight-card", "/no-such-page", "/dashboard/"];

test("signed out: every protected page redirects to /", async () => {
  for (const path of PROTECTED) assert.equal(await outcome(path), "/", path);
});

test("signed out: public pages stay open", async () => {
  for (const path of PUBLIC_PAGES) assert.equal(await outcome(path), null, path);
  assert.equal(await outcome("/sign-in/"), null);
  assert.equal(await outcome("/reset-password?code=x"), null);
});

test("public list is exact: lookalikes are protected", () => {
  for (const path of ["/sign-in-now", "/terms/x", "/privacyx", "/sign-up/../dashboard"]) {
    assert.equal(isPublicPage(new URL(path, "http://x").pathname), false, path);
  }
});

test("a valid session cookie is let through", async () => {
  const cookie = await cookieFor("user-1");
  for (const path of PROTECTED) assert.equal(await outcome(path, { cookie }), null, path);
});

test("forged, expired, garbage or uid-less cookies are treated as signed out", async () => {
  const forged = await cookieFor("user-1", { secret: "not-the-secret-not-the-secret-not-the" });
  const expired = await cookieFor("user-1", { maxAge: -60 });
  const noUid = `${COOKIE}=${await encode({ token: { sub: "x" }, secret: ENV.NEXTAUTH_SECRET! })}`;
  for (const cookie of [forged, expired, noUid, `${COOKIE}=garbage`]) {
    assert.equal(await outcome("/dashboard", { cookie }), "/", cookie.slice(0, 60));
  }
});

test("the dev-bypass header means nothing while the bypass is off", async () => {
  assert.equal(await outcome("/dashboard", { headers: { "x-profit-loop-dev-user-id": "local-user" } }), "/");
});

test("matcher: pages run the gate; the API, Next's files and static files do not", () => {
  const source = config.matcher[0];
  const pattern = new RegExp(`^${source.replace(/^\/\(/, "/(?:")}$`);
  for (const path of ["/", "/dashboard", "/money/invoices", "/apiary", "/sign-in", "/[...missing]"]) {
    assert.ok(pattern.test(path), `gated: ${path}`);
  }
  for (const path of ["/api", "/api/auth/session", "/api/businesses", "/_next/static/chunks/a.js", "/_next/image", "/favicon.ico", "/robots.txt", "/manifest.webmanifest", "/fonts/inter.woff2"]) {
    assert.ok(!pattern.test(path), `skipped: ${path}`);
  }
});

// Last: test-harness mode is process-wide and cannot be switched off.
test("dev bypass (fenced): a dev account on localhost passes, a foreign host does not", async () => {
  ENV.LOCAL_AUTH_BYPASS = "true";
  const { enableTestHarnessBypass } = await import("./devBypass");
  enableTestHarnessBypass();
  try {
    assert.equal(await outcome("/dashboard", { headers: { "x-profit-loop-dev-user-id": "local-user" } }), null);
    assert.equal(await outcome("/dashboard", { host: "evil.example", headers: { "x-profit-loop-dev-user-id": "local-user" } }), "/");
    assert.equal(
      await outcome("/dashboard", { headers: { "x-profit-loop-dev-user-id": "00000000-0000-4000-8000-000000000000" } }),
      "/",
      "a real account id is refused",
    );
  } finally {
    delete ENV.LOCAL_AUTH_BYPASS;
  }
});
