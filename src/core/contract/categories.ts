import { z } from "zod";
import { defineEndpoint } from "./shared";

/**
 * Which side of the business a category labels.
 *
 * `time` arrived with the internal time buckets (Admin, Sales & pitching, and
 * so on) and was seeded into the categories table without being added here —
 * so `GET /categories` failed its own response schema and returned 500 for
 * every business that had them. The db's `categoryAppliesToValues` is the
 * source of truth; this list must match it, and the test in
 * `services.integration.test.ts` now says so.
 */
export const categoryAppliesTo = z.enum(["revenue", "expense", "both", "time"]);

export const category = z.object({
  id: z.string(),
  name: z.string(),
  parentId: z.string().nullable(),
  appliesTo: categoryAppliesTo,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type CategoryShape = z.infer<typeof category>;

/**
 * Which picker is asking.
 *
 * The `time` buckets are ordinary category rows tagged so they stay OUT of the
 * money pickers — that is the entire reason the tag exists. Nothing enforced it,
 * so "Admin" and "Sales & pitching" were being offered as categories to file a
 * sale under. Omit this and you get every category, which is what a report
 * resolving a name needs.
 */
export const categoryPicker = z.enum(["revenue", "expense", "money"]);

export const listCategories = defineEndpoint({
  method: "GET",
  path: "/categories",
  query: z.object({ usableFor: categoryPicker.optional() }),
  response: z.array(category),
});

export const createCategory = defineEndpoint({
  method: "POST",
  path: "/categories",
  body: z.object({
    name: z.string().min(1).max(255),
    parentId: z.string().nullish(),
    appliesTo: categoryAppliesTo.optional(),
  }),
  response: category,
});
