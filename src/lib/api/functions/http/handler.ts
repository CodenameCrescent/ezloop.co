import { ZodError } from "zod";
import type { GatedFeature } from "@workspace/domain";
import type {
  EndpointBody,
  EndpointParams,
  EndpointQuery,
  EndpointResponse,
  EndpointShape,
} from "@workspace/api-contract";
import { logger } from "../lib/logger";
import { globalRateLimit, mutationRateLimit } from "../lib/rateLimits";
import { runWithRequestCache } from "../lib/requestCache";
import { assertEncryptionKeyInProduction } from "../lib/tokenCrypto";
import { ServiceError } from "../services/errors";
import { crossSiteRefusal } from "./csrf";
import { authenticate, checkFeature, resolveBusiness } from "./guards";
import { buildApiRequest, type ApiRequest } from "./request";

export interface RouteOptions {
  /** Requires a signed-in user. Default true. */
  auth?: boolean;
  /** Resolves and checks the business this request is about. Default true when `auth` is. */
  business?: boolean;
  /** Refuses with 403 when the business has this feature switched off. */
  feature?: GatedFeature;
  /** Counts against the per-user write budget. */
  write?: boolean;
  /**
   * `json` (default) parses the body; `raw` hands the handler the bytes as a
   * Buffer whatever the content type (attachment uploads).
   */
  body?: "json" | "raw";
  /** Largest body accepted, in bytes. Default 100 kB — body-parser's, which every Express route had. */
  bodyLimit?: number;
  /** The route's dynamic segments, exactly as Next passed them (`[id]` → `{ id }`). */
  params?: Promise<Record<string, string | string[] | undefined>>;
}

export const DEFAULT_BODY_LIMIT = 100 * 1024;

class PayloadTooLarge extends Error {}

/**
 * Checked on the first request rather than at import: `next build` loads every
 * route module to collect its config, and the build has no production secrets.
 */
let keyChecked = false;

/**
 * The last line of defence on a request that fails its schema.
 *
 * "Invalid request" named no field and helped nobody — it was what an owner saw
 * when a money box held something that was not a number. The screens guard
 * their own boxes and can say WHICH one by the name printed beside it, which
 * this layer cannot: it knows the field as `unitPriceCents`, and backend
 * vocabulary never reaches the owner (CLAUDE.md). So this says how many figures
 * are wrong and what kind of wrong, and the full issue list rides along in
 * `details` for whoever is debugging.
 */
function invalidRequestMessage(err: ZodError, input: unknown): string {
  const issues = err.issues;
  if (issues.length === 0) return "Something in that request wasn't right";

  // Zod 4 issues do not say what was received, so "left out" means: nothing at that path.
  // A missing enum is `invalid_value` in zod 4 (it was `invalid_type` in zod 3).
  const missing = issues.filter(
    (i) => (i.code === "invalid_type" || i.code === "invalid_value") && valueAt(input, i.path) === undefined,
  );
  if (missing.length === issues.length) {
    return missing.length === 1 ? "Something required was left out" : `${missing.length} required things were left out`;
  }
  const notNumbers = issues.filter((i) => i.code === "invalid_type" && "expected" in i && i.expected === "number");
  if (notNumbers.length > 0) {
    return notNumbers.length === 1
      ? "One of those figures isn't a number — check the amounts you typed"
      : `${notNumbers.length} of those figures aren't numbers — check the amounts you typed`;
  }
  return issues.length === 1 ? "Something in that request wasn't right" : `${issues.length} things in that request weren't right`;
}

/** The value at an issue's path in the input that was parsed (undefined when any step is absent). */
function valueAt(input: unknown, path: ReadonlyArray<PropertyKey>): unknown {
  let at: unknown = input;
  for (const key of path) {
    if (at === null || typeof at !== "object") return undefined;
    at = (at as Record<PropertyKey, unknown>)[key];
  }
  return at;
}

/**
 * The HTTP answer for one `ServiceError` code. Almost every one says the caller
 * asked for something that cannot be done (400). `not_found` is 404, and
 * `unavailable` is 503: the request was fine and we could not serve it, so
 * sending the same thing again is exactly what the caller should do.
 */
function statusFor(code: string): number {
  if (code === "not_found") return 404;
  if (code === "unavailable") return 503;
  return 400;
}

/** Maps domain/service errors to the contract's error envelope `{ error: { code, message } }`. */
function errorResponse(err: unknown, req: ApiRequest | null): Response {
  if (err instanceof ServiceError) {
    return Response.json({ error: { code: err.code, message: err.message } }, { status: statusFor(err.code) });
  }
  if (err instanceof RangeError || err instanceof TypeError) {
    return Response.json({ error: { code: "invalid", message: err.message } }, { status: 400 });
  }
  (req?.log ?? logger).error({ err }, "unhandled route error");
  return Response.json({ error: { code: "internal", message: "Something went wrong" } }, { status: 500 });
}

async function readBody(web: Request, req: ApiRequest, options: RouteOptions): Promise<void> {
  if (req.method === "GET" || req.method === "HEAD" || !web.body) {
    req.body = {};
    return;
  }
  const limit = options.bodyLimit ?? DEFAULT_BODY_LIMIT;
  if (Number(web.headers.get("content-length") ?? "0") > limit) throw new PayloadTooLarge();
  const raw = Buffer.from(await web.arrayBuffer());
  if (raw.length > limit) throw new PayloadTooLarge();
  req.rawBody = raw;

  if (options.body === "raw") {
    req.body = raw;
    return;
  }
  if (raw.length === 0) {
    req.body = {};
    return;
  }
  const type = web.headers.get("content-type") ?? "";
  if (type.includes("application/json")) req.body = JSON.parse(raw.toString("utf8"));
  else if (type.includes("application/x-www-form-urlencoded")) req.body = Object.fromEntries(new URLSearchParams(raw.toString("utf8")));
  else req.body = {};
}

async function flatParams(params: RouteOptions["params"]): Promise<Record<string, string>> {
  const raw = (await params) ?? {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") out[key] = value;
    else if (Array.isArray(value)) out[key] = value.join("/");
  }
  return out;
}

/**
 * The pipeline every API request runs, in the order the Express app ran it:
 * rate limit before the body is buffered, then the body, then who is asking,
 * which books, whether the feature is on, and the write budget. GETs get a
 * read cache that lives exactly as long as the request.
 */
async function pipeline(
  web: Request,
  options: RouteOptions,
  run: (req: ApiRequest) => Promise<Response>,
): Promise<Response> {
  const auth = options.auth ?? true;
  const business = options.business ?? auth;

  if (!keyChecked) {
    assertEncryptionKeyInProduction();
    keyChecked = true;
  }
  let req: ApiRequest | null = null;
  try {
    req = buildApiRequest(web, await flatParams(options.params));
    const r = req;
    const work = async (): Promise<Response> => {
      const limited = globalRateLimit(r);
      if (limited) return limited;

      // Signed-in writes must come from this site (csrf.ts). Routes that
      // authenticate on their own (`auth: false`) are not session-based.
      if (auth) {
        const forged = crossSiteRefusal(r);
        if (forged) return forged;
      }

      try {
        await readBody(web, r, options);
      } catch (err) {
        if (err instanceof PayloadTooLarge) {
          return Response.json({ error: { code: "payload_too_large", message: "That request is too large." } }, { status: 413 });
        }
        return Response.json({ error: { code: "invalid_request", message: "That request body isn't valid JSON." } }, { status: 400 });
      }

      if (auth) {
        const refused = await authenticate(r);
        if (refused) return refused;
      }
      if (business) {
        const refused = await resolveBusiness(r);
        if (refused) return refused;
      }
      if (options.feature) {
        const refused = checkFeature(r, options.feature);
        if (refused) return refused;
      }
      if (options.write) {
        const refused = mutationRateLimit(r);
        if (refused) return refused;
      }
      return run(r);
    };
    return await (r.method === "GET" ? runWithRequestCache(work) : work());
  } catch (err) {
    return errorResponse(err, req);
  }
}

export interface ContractContext<E extends EndpointShape> {
  req: ApiRequest;
  params: EndpointParams<E>;
  query: EndpointQuery<E>;
  body: EndpointBody<E>;
}

/**
 * Answers one contract endpoint (`src/core/contract`). Called from a route
 * file's `GET`/`POST`/… function:
 *
 *   export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
 *     return handle(request, updateSourceContract, { write: true, params }, async ({ req, params, body }) => …);
 *   }
 *
 * Params, query and body are zod-validated (400 with the standard error
 * envelope on failure), the return value is typed against the response
 * schema, and outside production the RESPONSE is validated too — drift between
 * what a route returns and what the contract promises throws instead of
 * silently reaching the client.
 */
export function handle<E extends EndpointShape>(
  request: Request,
  endpoint: E,
  options: RouteOptions,
  fn: (ctx: ContractContext<E>) => Promise<EndpointResponse<E>> | EndpointResponse<E>,
): Promise<Response> {
  const validateResponse = process.env.NODE_ENV !== "production";
  return pipeline(request, options, async (req) => {
    let params: EndpointParams<E>;
    let query: EndpointQuery<E>;
    let body: EndpointBody<E>;
    let parsing: unknown;
    try {
      parsing = req.params;
      params = (endpoint.params ? endpoint.params.parse(req.params) : undefined) as EndpointParams<E>;
      parsing = req.query;
      query = (endpoint.query ? endpoint.query.parse(req.query) : undefined) as EndpointQuery<E>;
      parsing = req.body;
      body = (endpoint.body ? endpoint.body.parse(req.body) : undefined) as EndpointBody<E>;
    } catch (err) {
      if (err instanceof ZodError) {
        return Response.json(
          { error: { code: "invalid_request", message: invalidRequestMessage(err, parsing), details: err.flatten() } },
          { status: 400 },
        );
      }
      throw err;
    }

    const data = await fn({ req, params, query, body });

    if (validateResponse) {
      const checked = endpoint.response.safeParse(data);
      if (!checked.success) {
        req.log.error({ method: endpoint.method, path: endpoint.path, issues: checked.error.issues }, "contract response drift");
        throw new Error(`Response for ${endpoint.method} ${endpoint.path} does not match its contract schema`);
      }
      return Response.json(checked.data ?? null);
    }
    return Response.json(data ?? null);
  });
}

/**
 * Answers a request that is not a JSON contract endpoint: a file download, a
 * redirect, a webhook. Same guards; `fn` builds its own `Response`.
 */
export function handleRaw(
  request: Request,
  options: RouteOptions,
  fn: (req: ApiRequest) => Promise<Response> | Response,
): Promise<Response> {
  return pipeline(request, options, async (req) => fn(req));
}
