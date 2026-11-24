import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";
import { enableTestHarnessBypass, isLoopbackAddress } from "./http/devBypass";

/**
 * The API as a plain Node `(req, res)` handler, for the integration tests.
 *
 * Next serves the API from `src/app/api/**\/route.ts`. This walks the same
 * folders and routes into the same files — static segments before dynamic
 * ones, as Next does — so a test that does `http.createServer(app)` exercises
 * exactly what production serves, without booting Next.
 */

const API_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "app", "api");

/** A route file's GET/POST/… export, called the way Next calls it. */
type Handler = (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response>;
type RouteFile = { segments: string[]; file: string };

function findRouteFiles(dir: string, segments: string[] = []): RouteFile[] {
  const found: RouteFile[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) found.push(...findRouteFiles(path.join(dir, entry.name), [...segments, entry.name]));
    else if (entry.name === "route.ts") found.push({ segments, file: path.join(dir, entry.name) });
  }
  return found;
}

const routes = findRouteFiles(API_DIR)
  // More static segments first, so `/transactions/summary` beats `/transactions/[id]`.
  .sort((a, b) => {
    const staticCount = (r: RouteFile) => r.segments.filter((s) => !s.startsWith("[")).length;
    return staticCount(b) - staticCount(a);
  });

function match(pathname: string): { route: RouteFile; params: Record<string, string> } | null {
  const parts = pathname.split("/").filter(Boolean);
  for (const route of routes) {
    if (route.segments.length !== parts.length) continue;
    const params: Record<string, string> = {};
    const ok = route.segments.every((seg, i) => {
      if (seg.startsWith("[")) {
        params[seg.slice(1, -1)] = decodeURIComponent(parts[i]);
        return true;
      }
      return seg === parts[i];
    });
    if (ok) return { route, params };
  }
  return null;
}

const modules = new Map<string, Promise<Record<string, Handler | unknown>>>();

// The test harness may act as its suites' fixture users. In-process only.
enableTestHarnessBypass();

export default async function app(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // The harness reads the real socket, which Next never shows route code:
  // anything not from this machine is refused before it reaches a route.
  if (!isLoopbackAddress(req.socket.remoteAddress)) {
    res.statusCode = 403;
    res.end();
    return;
  }

  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const body = Buffer.concat(chunks);

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    headers.set(key, Array.isArray(value) ? value.join(", ") : value);
  }
  if (!headers.has("x-forwarded-for") && req.socket.remoteAddress) {
    headers.set("x-forwarded-for", req.socket.remoteAddress);
  }

  const method = req.method ?? "GET";
  const url = new URL(`http://${req.headers.host ?? "localhost"}${req.url ?? "/"}`);
  const web = new Request(url, {
    method,
    headers,
    body: method === "GET" || method === "HEAD" || body.length === 0 ? undefined : body,
  });

  const pathname = url.pathname.replace(/^\/api(?=\/|$)/, "");
  const found = match(pathname);
  let out: Response;
  if (!found) {
    out = Response.json({ error: { code: "not_found", message: "No such endpoint" } }, { status: 404 });
  } else {
    if (!modules.has(found.route.file)) modules.set(found.route.file, import(pathToFileURL(found.route.file).href));
    const handler = (await modules.get(found.route.file)!)[method] as Handler | undefined;
    out = handler
      ? await handler(web, { params: Promise.resolve(found.params) })
      : Response.json({ error: { code: "not_found", message: "No such endpoint" } }, { status: 404 });
  }

  res.statusCode = out.status;
  out.headers.forEach((value, key) => res.setHeader(key, value));
  res.end(Buffer.from(await out.arrayBuffer()));
}
