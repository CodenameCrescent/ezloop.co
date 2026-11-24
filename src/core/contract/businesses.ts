import { z } from "zod";
import { defineEndpoint } from "./shared";
import { businessType } from "./settings";

/**
 * Businesses — the WORKSPACE layer, above everything else in this contract.
 *
 * Every other endpoint here answers for exactly one business, named by the
 * `x-profit-loop-business-id` header and verified against the caller on the way
 * in. These three endpoints are the only ones that do not: they are how a user
 * finds out which businesses they have, and makes another.
 *
 * Note what is NOT here: no delete. A business owns ledger rows and the ledger
 * is append-only, so archiving is the whole of the retirement story.
 */
export const businessSummary = z.object({
  id: z.string(),
  name: z.string(),
  businessType,
  /** The base currency of this business's books. A label — the server never converts. */
  currency: z.string(),
  currencySymbol: z.string(),
  archivedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type BusinessSummaryShape = z.infer<typeof businessSummary>;

/**
 * May be EMPTY, and that is a real answer rather than a missing one: a brand-new
 * account owns nothing until it says so. The screens read the empty array as
 * "show the welcome page", never as a failed request.
 */
export const listBusinesses = defineEndpoint({
  method: "GET",
  path: "/businesses",
  query: z.object({
    /** Archived businesses are hidden unless asked for. */
    includeArchived: z.enum(["true", "false"]).optional(),
  }),
  response: z.object({ items: z.array(businessSummary) }),
});

export const createBusinessBody = z.object({
  name: z.string().min(1).max(255),
  businessType,
  currency: z.string().min(1).max(8).optional(),
  currencySymbol: z.string().min(1).max(8).optional(),
});

export const createBusiness = defineEndpoint({
  method: "POST",
  path: "/businesses",
  body: createBusinessBody,
  response: businessSummary,
});

/**
 * Rename, re-badge, archive or restore. Everything else about a business — its
 * type and its feature toggles — is patched through `/settings`, which is the
 * one surface the settings screen reads.
 */
export const updateBusiness = defineEndpoint({
  method: "PATCH",
  path: "/businesses/:id",
  params: z.object({ id: z.string() }),
  body: z.object({
    name: z.string().min(1).max(255).optional(),
    currency: z.string().min(1).max(8).optional(),
    currencySymbol: z.string().min(1).max(8).optional(),
    /** true archives, false restores. */
    archived: z.boolean().optional(),
  }),
  response: businessSummary,
});
