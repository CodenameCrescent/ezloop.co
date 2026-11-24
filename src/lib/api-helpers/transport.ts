import { getMediaType, isJsonMediaType, isTextMediaType, hasNoBody, stripBom, parseSuccessBody } from "./transport.parts/ResponseParseError";
export { ResponseParseError } from "./transport.parts/ResponseParseError";

export type ApiRequestOptions = RequestInit & {
  responseType?: "json" | "text" | "blob" | "auto";
};

export type ErrorType<T = unknown> = ApiError<T>;

export type BodyType<T> = T;

export type AuthTokenGetter = () => Promise<string | null> | string | null;
const DEFAULT_JSON_ACCEPT = "application/json, application/problem+json";
const DEV_ACCOUNT_STORAGE_KEY = "profit_loop_dev_account_id";
const DEV_ACCOUNT_HEADER = "x-profit-loop-dev-user-id";

/**
 * WHICH SET OF BOOKS every request is about.
 *
 * One user may own several businesses, so the server can no longer infer this
 * from the session — it has to be told, and it verifies ownership on the way in
 * (`resolveBusiness` in `src/lib/api/functions/http/guards.ts`). Sent on every request from one place, for
 * the same reason the auth token is: a screen that had to remember would
 * eventually forget, and the request would be answered for the wrong business.
 *
 * A request MAY override it per call, which is how the businesses page asks
 * each business for its own figure without switching to it.
 */
export const BUSINESS_STORAGE_KEY = "profit_loop_business_id";
export const BUSINESS_HEADER = "x-profit-loop-business-id";

// ---------------------------------------------------------------------------
// Module-level configuration
// ---------------------------------------------------------------------------

let _baseUrl: string | null = null;
let _authTokenGetter: AuthTokenGetter | null = null;

function readStored(key: string): string | null {
  try {
    const value = globalThis.localStorage?.getItem(key)?.trim();
    return value || null;
  } catch {
    return null;
  }
}

function getLocalDevAccountId(): string | null {
  return readStored(DEV_ACCOUNT_STORAGE_KEY);
}

/** The business every request is scoped to, or null before one is chosen. */
export function getCurrentBusinessId(): string | null {
  return readStored(BUSINESS_STORAGE_KEY);
}

/**
 * Remembers the chosen business. Does NOT reload or clear caches on its own —
 * `switchBusiness` in `lib/currentBusiness.ts` owns that, so the decision to
 * throw away in-memory data is made in one place rather than wherever this
 * happens to be called.
 */
export function setCurrentBusinessId(businessId: string | null): void {
  try {
    if (businessId) globalThis.localStorage?.setItem(BUSINESS_STORAGE_KEY, businessId);
    else globalThis.localStorage?.removeItem(BUSINESS_STORAGE_KEY);
  } catch {
    /* storage unavailable — the header is simply omitted */
  }
}

/**
 * Set a base URL that is prepended to every relative request URL
 * (i.e. paths that start with `/`).
 *
 * Useful for Expo bundles that need to call a remote API server.
 * Pass `null` to clear the base URL.
 */
export function setBaseUrl(url: string | null): void {
  _baseUrl = url ? url.replace(/\/+$/, "") : null;
}

/**
 * Register a getter that supplies a bearer auth token.  Before every fetch
 * the getter is invoked; when it returns a non-null string, an
 * `Authorization: Bearer <token>` header is attached to the request.
 *
 * Useful for Expo bundles making token-gated API calls.
 * Pass `null` to clear the getter.
 *
 * NOTE: This function should never be used in web applications where session
 * token cookies are automatically associated with API calls by the browser.
 */
export function setAuthTokenGetter(getter: AuthTokenGetter | null): void {
  _authTokenGetter = getter;
}

function isRequest(input: RequestInfo | URL): input is Request {
  return typeof Request !== "undefined" && input instanceof Request;
}

function resolveMethod(input: RequestInfo | URL, explicitMethod?: string): string {
  if (explicitMethod) return explicitMethod.toUpperCase();
  if (isRequest(input)) return input.method.toUpperCase();
  return "GET";
}

// Use loose check for URL — some runtimes (e.g. React Native) polyfill URL
// differently, so `instanceof URL` can fail.
function isUrl(input: RequestInfo | URL): input is URL {
  return typeof URL !== "undefined" && input instanceof URL;
}

function applyBaseUrl(input: RequestInfo | URL): RequestInfo | URL {
  if (!_baseUrl) return input;
  const url = resolveUrl(input);
  // Only prepend to relative paths (starting with /)
  if (!url.startsWith("/")) return input;

  const absolute = `${_baseUrl}${url}`;
  if (typeof input === "string") return absolute;
  if (isUrl(input)) return new URL(absolute);
  return new Request(absolute, input as Request);
}

function resolveUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (isUrl(input)) return input.toString();
  return input.url;
}

function mergeHeaders(...sources: Array<HeadersInit | undefined>): Headers {
  const headers = new Headers();

  for (const source of sources) {
    if (!source) continue;
    new Headers(source).forEach((value, key) => {
      headers.set(key, value);
    });
  }

  return headers;
}

function looksLikeJson(text: string): boolean {
  const trimmed = text.trimStart();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

function getStringField(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object") return undefined;

  const candidate = (value as Record<string, unknown>)[key];
  if (typeof candidate !== "string") return undefined;

  const trimmed = candidate.trim();
  return trimmed === "" ? undefined : trimmed;
}

function truncate(text: string, maxLength = 300): string {
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function buildErrorMessage(response: Response, data: unknown): string {
  const prefix = `HTTP ${response.status} ${response.statusText}`;

  if (typeof data === "string") {
    const text = data.trim();
    return text ? `${prefix}: ${truncate(text)}` : prefix;
  }

  const title = getStringField(data, "title");
  const detail = getStringField(data, "detail");
  const message =
    getStringField(data, "message") ??
    getStringField(data, "error_description") ??
    getStringField(data, "error");

  if (title && detail) return `${prefix}: ${title} — ${detail}`;
  if (detail) return `${prefix}: ${detail}`;
  if (message) return `${prefix}: ${message}`;
  if (title) return `${prefix}: ${title}`;

  return prefix;
}

export class ApiError<T = unknown> extends Error {
  readonly name = "ApiError";
  readonly status: number;
  readonly statusText: string;
  readonly data: T | null;
  readonly headers: Headers;
  readonly response: Response;
  readonly method: string;
  readonly url: string;

  constructor(
    response: Response,
    data: T | null,
    requestInfo: { method: string; url: string },
  ) {
    super(buildErrorMessage(response, data));
    Object.setPrototypeOf(this, new.target.prototype);

    this.status = response.status;
    this.statusText = response.statusText;
    this.data = data;
    this.headers = response.headers;
    this.response = response;
    this.method = requestInfo.method;
    this.url = response.url || requestInfo.url;
  }
}

async function parseErrorBody(response: Response, method: string): Promise<unknown> {
  if (hasNoBody(response, method)) {
    return null;
  }

  const mediaType = getMediaType(response.headers);

  // Fall back to text when blob() is unavailable (e.g. some React Native builds).
  if (mediaType && !isJsonMediaType(mediaType) && !isTextMediaType(mediaType)) {
    return typeof response.blob === "function" ? response.blob() : response.text();
  }

  const raw = await response.text();
  const normalized = stripBom(raw);
  const trimmed = normalized.trim();

  if (trimmed === "") {
    return null;
  }

  if (isJsonMediaType(mediaType) || looksLikeJson(normalized)) {
    try {
      return JSON.parse(normalized);
    } catch {
      return raw;
    }
  }

  return raw;
}

export async function apiRequest<T = unknown>(
  input: RequestInfo | URL,
  options: ApiRequestOptions = {},
): Promise<T> {
  input = applyBaseUrl(input);
  const { responseType = "auto", headers: headersInit, ...init } = options;

  const method = resolveMethod(input, init.method);

  if (init.body != null && (method === "GET" || method === "HEAD")) {
    throw new TypeError(`apiRequest: ${method} requests cannot have a body.`);
  }

  const headers = mergeHeaders(isRequest(input) ? input.headers : undefined, headersInit);

  if (
    typeof init.body === "string" &&
    !headers.has("content-type") &&
    looksLikeJson(init.body)
  ) {
    headers.set("content-type", "application/json");
  }

  if (responseType === "json" && !headers.has("accept")) {
    headers.set("accept", DEFAULT_JSON_ACCEPT);
  }

  // Attach bearer token when an auth getter is configured and no
  // Authorization header has been explicitly provided.
  if (_authTokenGetter && !headers.has("authorization")) {
    const token = await _authTokenGetter();
    if (token) {
      headers.set("authorization", `Bearer ${token}`);
    }
  }

  const devAccountId = getLocalDevAccountId();
  if (devAccountId && !headers.has(DEV_ACCOUNT_HEADER)) {
    headers.set(DEV_ACCOUNT_HEADER, devAccountId);
  }

  // `!headers.has` on purpose: a caller that set it explicitly is asking about a
  // specific business, and must not be overruled by the current selection.
  const businessId = getCurrentBusinessId();
  if (businessId && !headers.has(BUSINESS_HEADER)) {
    headers.set(BUSINESS_HEADER, businessId);
  }

  const requestInfo = { method, url: resolveUrl(input) };

  const credentials: RequestCredentials = init.credentials ?? "include";
  const response = await fetch(input, { ...init, method, headers, credentials });

  if (!response.ok) {
    const errorData = await parseErrorBody(response, method);
    throw new ApiError(response, errorData, requestInfo);
  }

  return (await parseSuccessBody(response, responseType, requestInfo)) as T;
}
