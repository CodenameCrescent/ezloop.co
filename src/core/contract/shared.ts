import { z } from "zod";

/**
 * Money is always integers in minor units (cents/paisa). Floats are banned
 * from money math everywhere in the app — see CLAUDE.md.
 */
export const moneyCents = z.number().int();

export const pagination = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const dateRange = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

/** Standard error envelope every contract endpoint uses for failures. */
export const errorEnvelope = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ErrorEnvelope = z.infer<typeof errorEnvelope>;

export type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export interface EndpointShape {
  method: HttpMethod;
  /** Express-style path relative to the `/api` mount, e.g. "/client-customers/:id". */
  path: string;
  params?: z.ZodTypeAny;
  query?: z.ZodTypeAny;
  body?: z.ZodTypeAny;
  response: z.ZodTypeAny;
}

/**
 * Identity helper that preserves the literal types of an endpoint definition,
 * so `endpoint.method` / `endpoint.path` stay narrow and the request/response
 * schemas stay inferable on both server and client.
 */
export function defineEndpoint<const E extends EndpointShape>(endpoint: E): E {
  return endpoint;
}

type InferOrUndefined<T> = T extends z.ZodTypeAny ? z.infer<T> : undefined;

export type EndpointResponse<E extends EndpointShape> = z.infer<E["response"]>;
export type EndpointParams<E extends EndpointShape> = InferOrUndefined<E["params"]>;
export type EndpointQuery<E extends EndpointShape> = InferOrUndefined<E["query"]>;
export type EndpointBody<E extends EndpointShape> = InferOrUndefined<E["body"]>;

/**
 * What a cost or an hour can be booked AGAINST.
 *
 * Lives here rather than beside either use because both need it and neither
 * owns it: an expense line targeting "Acme" and a timesheet row targeting
 * "Acme" have to mean the same Acme, or client profitability silently adds up
 * two different businesses. One definition is what enforces that.
 */
export const splitTargetType = z.enum(["client", "revenue_item", "internal", "project"]);
export type SplitTargetTypeShape = z.infer<typeof splitTargetType>;
