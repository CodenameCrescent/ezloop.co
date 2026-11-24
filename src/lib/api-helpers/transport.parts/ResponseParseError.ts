
export const NO_BODY_STATUS = new Set([204, 205, 304]);

export function getMediaType(headers: Headers): string | null {
  const value = headers.get("content-type");
  return value ? value.split(";", 1)[0].trim().toLowerCase() : null;
}

export function isJsonMediaType(mediaType: string | null): boolean {
  return mediaType === "application/json" || Boolean(mediaType?.endsWith("+json"));
}

export function isTextMediaType(mediaType: string | null): boolean {
  return Boolean(
    mediaType &&
      (mediaType.startsWith("text/") ||
        mediaType === "application/xml" ||
        mediaType === "text/xml" ||
        mediaType.endsWith("+xml") ||
        mediaType === "application/x-www-form-urlencoded"),
  );
}

// Use strict equality: in browsers, `response.body` is `null` when the
// response genuinely has no content.  In React Native, `response.body` is
// always `undefined` because the ReadableStream API is not implemented —
// even when the response carries a full payload readable via `.text()` or
// `.json()`.  Loose equality (`== null`) matches both `null` and `undefined`,
// which causes every React Native response to be treated as empty.
export function hasNoBody(response: Response, method: string): boolean {
  if (method === "HEAD") return true;
  if (NO_BODY_STATUS.has(response.status)) return true;
  if (response.headers.get("content-length") === "0") return true;
  if (response.body === null) return true;
  return false;
}

export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export class ResponseParseError extends Error {
  readonly name = "ResponseParseError";
  readonly status: number;
  readonly statusText: string;
  readonly headers: Headers;
  readonly response: Response;
  readonly method: string;
  readonly url: string;
  readonly rawBody: string;
  readonly cause: unknown;

  constructor(
    response: Response,
    rawBody: string,
    cause: unknown,
    requestInfo: { method: string; url: string },
  ) {
    super(
      `Failed to parse response from ${requestInfo.method} ${response.url || requestInfo.url} ` +
        `(${response.status} ${response.statusText}) as JSON`,
    );
    Object.setPrototypeOf(this, new.target.prototype);

    this.status = response.status;
    this.statusText = response.statusText;
    this.headers = response.headers;
    this.response = response;
    this.method = requestInfo.method;
    this.url = response.url || requestInfo.url;
    this.rawBody = rawBody;
    this.cause = cause;
  }
}

export async function parseJsonBody(
  response: Response,
  requestInfo: { method: string; url: string },
): Promise<unknown> {
  const raw = await response.text();
  const normalized = stripBom(raw);

  if (normalized.trim() === "") {
    return null;
  }

  try {
    return JSON.parse(normalized);
  } catch (cause) {
    throw new ResponseParseError(response, raw, cause, requestInfo);
  }
}

export function inferResponseType(response: Response): "json" | "text" | "blob" {
  const mediaType = getMediaType(response.headers);

  if (isJsonMediaType(mediaType)) return "json";
  if (isTextMediaType(mediaType) || mediaType == null) return "text";
  return "blob";
}

export async function parseSuccessBody(
  response: Response,
  responseType: "json" | "text" | "blob" | "auto",
  requestInfo: { method: string; url: string },
): Promise<unknown> {
  if (hasNoBody(response, requestInfo.method)) {
    return null;
  }

  const effectiveType =
    responseType === "auto" ? inferResponseType(response) : responseType;

  switch (effectiveType) {
    case "json":
      return parseJsonBody(response, requestInfo);

    case "text": {
      const text = await response.text();
      return text === "" ? null : text;
    }

    case "blob":
      if (typeof response.blob !== "function") {
        throw new TypeError(
          "Blob responses are not supported in this runtime. " +
            "Use responseType \"json\" or \"text\" instead.",
        );
      }
      return response.blob();
  }
}
