/** Thrown by domain services for caller mistakes; routes map these to 4xx (R3). */
export class ServiceError extends Error {
  readonly name = "ServiceError";
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
    this.code = code;
  }
}

export function notFound(what: string): ServiceError {
  return new ServiceError("not_found", `${what} not found`);
}

export function invalid(message: string): ServiceError {
  return new ServiceError("invalid", message);
}

/**
 * The request was fine; WE could not serve it just now, and trying again may
 * work.
 *
 * The only kind of `ServiceError` that is not the caller's mistake, which is why
 * it is the only one `contractError.ts` answers with a 5xx. That distinction is
 * the point of it rather than a detail: "your file has a bad row" and "the
 * database was too busy to finish" are different events, and an owner does
 * different things about them — they edit the file for the first and simply
 * retry the second. Collapsing the two into one 400 tells them to go and fix a
 * spreadsheet that was never wrong.
 */
export function unavailable(message: string): ServiceError {
  return new ServiceError("unavailable", message);
}
