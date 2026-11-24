import * as c from "@workspace/api-contract";
import type { EndpointShape, EndpointParams, EndpointQuery, EndpointBody, EndpointResponse, ImportKindShape } from "@workspace/api-contract";
import { apiRequest } from "../transport";

// ── Plumbing ────────────────────────────────────────────────────────────────

/** Contract paths are relative to the `/api` mount. */
export const API_PREFIX = "/api";

/** What a call may carry. Which parts an endpoint needs is in its contract. */
export interface Args<E extends EndpointShape> {
  params?: EndpointParams<E>;
  query?: EndpointQuery<E>;
  body?: EndpointBody<E>;
  request?: RequestInit;
}

/** Builds the concrete URL for an endpoint: path params substituted, query string appended. */
export function endpointUrl<E extends EndpointShape>(endpoint: E, args?: Args<E>): string {
  const path = endpoint.path.replace(/:([A-Za-z0-9_]+)/g, (_match, name: string) => {
    const value = (args?.params as Record<string, unknown> | undefined)?.[name];
    if (value === undefined || value === null) {
      throw new Error(`api: missing path param ":${name}" for ${endpoint.path}`);
    }
    return encodeURIComponent(String(value));
  });
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries((args?.query as Record<string, unknown> | undefined) ?? {})) {
    if (value !== undefined) search.append(key, String(value));
  }
  const qs = search.toString();
  return `${API_PREFIX}${path}${qs ? `?${qs}` : ""}`;
}

/**
 * One contract endpoint over the shared transport (auth header, business
 * header, dev-account header, error parsing), typed from the contract.
 */
export async function typedFetch<E extends EndpointShape>(endpoint: E, args?: Args<E>): Promise<EndpointResponse<E>> {
  // Every contract endpoint answers JSON. Asking for it explicitly means a reply
  // that is not JSON (an HTML page from a URL that matched no API route) fails
  // as an error the screens already handle, instead of arriving as a string
  // that a screen then reads `.ladder` off.
  const init: RequestInit & { responseType: "json" } = { ...args?.request, method: endpoint.method, responseType: "json" };
  if (args?.body !== undefined) {
    init.headers = {
      "Content-Type": "application/json",
      ...(args.request?.headers as Record<string, string> | undefined),
    };
    init.body = JSON.stringify(args.body);
  }
  return apiRequest<EndpointResponse<E>>(endpointUrl(endpoint, args), init);
}

/** Hands a downloaded file to the browser's save dialog. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Health ────────────────────────────────────────────────────────────────────

/** GET /api/healthz */
export const healthCheck = (args?: Args<typeof c.healthCheck>) => typedFetch(c.healthCheck, args);

// ── Businesses ────────────────────────────────────────────────────────────────

/** GET /api/businesses */
export const listBusinesses = (args?: Args<typeof c.listBusinesses>) => typedFetch(c.listBusinesses, args);

// ── Clients & customers (legacy list) ─────────────────────────────────────────

/** GET /api/client-customers */
export const listClientCustomers = (args?: Args<typeof c.listClientCustomers>) => typedFetch(c.listClientCustomers, args);

// ── Settings ──────────────────────────────────────────────────────────────────

/** GET /api/settings */
export const getSettings = (args?: Args<typeof c.getSettings>) => typedFetch(c.getSettings, args);

// ── Sources — where money flows through ───────────────────────────────────────

/** GET /api/sources */
export const listSources = (args?: Args<typeof c.listSources>) => typedFetch(c.listSources, args);

// ── Categories ────────────────────────────────────────────────────────────────

/** GET /api/categories */
export const listCategories = (args?: Args<typeof c.listCategories>) => typedFetch(c.listCategories, args);

// ── Revenue items (catalogue) ─────────────────────────────────────────────────

/** GET /api/revenue-items */
export const listRevenueItems = (args?: Args<typeof c.listRevenueItems>) => typedFetch(c.listRevenueItems, args);

// ── Files (not JSON, so not contract endpoints) ─────────────────────────────
//
// These still go through `apiRequest` rather than an `<a href>`: every one is
// business-scoped, and the business rides a HEADER (`x-profit-loop-business-id`)
// that a link navigation cannot carry. A link would appear to work right up
// until an owner with TWO businesses clicked it and saved a file containing
// `{"error":{"code":"business_required"}}`.

/** POST /api/transactions/:id/attachments — raw file body; the server enforces MIME, size and scoping. */
export function uploadAttachment(transactionId: string, file: File) {
  return apiRequest(`${API_PREFIX}/transactions/${encodeURIComponent(transactionId)}/attachments`, {
    method: "POST",
    body: file,
    headers: { "content-type": file.type || "application/octet-stream", "x-filename": encodeURIComponent(file.name) },
  });
}

/**
 * GET /api/imports/template?kind= — the blank CSV for one import kind.
 *
 * Its contents do not depend on the business (it is generated from the column
 * table), but the route is scoped like every other import route on purpose,
 * and making an exception to that for a convenience is the wrong trade.
 */
export async function downloadImportTemplate(kind: ImportKindShape, filename: string) {
  saveBlob(
    await apiRequest<Blob>(`${API_PREFIX}/imports/template?kind=${encodeURIComponent(kind)}`, { responseType: "blob" }),
    filename,
  );
}
