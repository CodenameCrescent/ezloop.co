import type { Logger } from "pino";
import type { Business } from "@workspace/db";
import { logger } from "../lib/logger";
import { trustedClientIp } from "./clientIp";

/**
 * What a route handler is told about the request.
 *
 * Built once per request from the Web `Request` Next hands us. The fields are
 * the ones the route code and guards actually read; the guards fill in
 * `userId` and `business` as they pass.
 */
export interface ApiRequest {
  method: string;
  /** Path below `/api`, without the query string — e.g. `/sources/abc`. */
  path: string;
  /** Lower-cased header names. */
  headers: Record<string, string | undefined>;
  params: Record<string, string>;
  query: Record<string, string | string[] | undefined>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
  /** The untouched request bytes, for HMAC verification (Shopify webhooks). */
  rawBody?: Buffer;
  ip: string;
  secure: boolean;
  /** `https://host` as the caller reached us — for building absolute callback URLs. */
  origin: string;
  log: Logger;
  get(name: string): string | undefined;
  /** Set by the auth guard. */
  userId?: string;
  /** Set by the business guard. */
  business?: Business;
}

export interface AuthedRequest extends ApiRequest {
  userId: string;
}

export interface BusinessRequest extends AuthedRequest {
  business: Business;
}

/** Every API path lives under this prefix; contract paths are written without it. */
export const API_PREFIX = "/api";

function parseQuery(params: URLSearchParams): ApiRequest["query"] {
  const query: ApiRequest["query"] = {};
  for (const key of new Set(params.keys())) {
    const all = params.getAll(key);
    query[key] = all.length > 1 ? all : all[0];
  }
  return query;
}

export function buildApiRequest(web: Request, params: Record<string, string>): ApiRequest {
  const url = new URL(web.url);
  const path = url.pathname.startsWith(API_PREFIX) ? url.pathname.slice(API_PREFIX.length) || "/" : url.pathname;

  const headers: Record<string, string | undefined> = {};
  web.headers.forEach((value, key) => {
    headers[key] = value;
  });
  const forwardedProto = headers["x-forwarded-proto"]?.split(",")[0]?.trim();
  const secure = (forwardedProto ?? url.protocol.replace(":", "")) === "https";
  const host = headers["x-forwarded-host"]?.split(",")[0]?.trim() ?? headers.host ?? url.host;
  // Only a trusted platform's forwarding headers name the client (clientIp.ts);
  // elsewhere they are the client's own claim, so unauthenticated limits
  // share one "unknown" bucket rather than trusting it.
  const ip = trustedClientIp((name) => headers[name]) ?? "unknown";

  return {
    method: web.method.toUpperCase(),
    path,
    headers,
    params,
    query: parseQuery(url.searchParams),
    body: {},
    ip,
    secure,
    origin: `${secure ? "https" : "http"}://${host}`,
    log: logger.child({ method: web.method, url: path }),
    get(name) {
      return headers[name.toLowerCase()];
    },
  };
}
