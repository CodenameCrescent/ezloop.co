import { z } from "zod";
import { defineEndpoint, moneyCents } from "./shared";

/**
 * Money owed, in both directions — what is coming to you, and what you owe.
 *
 * Two sides of one question, served together on purpose: an owner deciding
 * whether they can pay a supplier this week needs both numbers on one screen,
 * and two endpoints would let the screen show one while still waiting for the
 * other.
 */

/**
 * MIRRORS `OwedState` in lib/domain/src/owed.ts. The contract package depends on
 * nothing but zod, so the list is copied rather than imported — the same
 * arrangement `gatedFeature` has, and drift fails response validation in dev.
 */
export const owedState = z.enum(["not_due", "due_soon", "overdue", "no_due_date"]);
export type OwedStateShape = z.infer<typeof owedState>;

export const owedRow = z.object({
  id: z.string(),
  /** What it is, in the owner's own words — the item name, or the line's label. */
  displayName: z.string(),
  occurredAt: z.string(),
  /** Null when nothing was agreed. Such a row is outstanding, never late. */
  dueDate: z.string().nullable(),
  amountCents: moneyCents,
  state: owedState,
  /** Whole days past the agreed date. Always 0 when there is no agreed date. */
  daysOverdue: z.number().int(),
  /** Whole days since it happened — how long it has been waiting. */
  daysOutstanding: z.number().int(),
  personId: z.string().nullable(),
  personName: z.string().nullable(),
  sourceName: z.string(),
  referenceNumber: z.string().nullable(),
});

export const owedBucket = z.object({
  label: z.string(),
  count: z.number().int(),
  cents: moneyCents,
});

export const owedSide = z.object({
  totalCents: moneyCents,
  count: z.number().int(),
  /** The part of the total that is past an agreed date. Never includes undated rows. */
  overdueCents: moneyCents,
  overdueCount: z.number().int(),
  /** The same list partitioned by how long it has been owed. Sums to the total. */
  buckets: z.array(owedBucket),
  rows: z.array(owedRow),
});

export const getOwed = defineEndpoint({
  method: "GET",
  path: "/reports/owed",
  query: z.object({
    /** Measure against this instant instead of now. For tests and fixtures. */
    asOf: z.string().optional(),
  }),
  response: z.object({
    /** Money coming to you: sales and invoices nobody has paid yet. */
    incoming: owedSide,
    /** Money you owe: bills and expenses you have not settled. */
    outgoing: owedSide,
  }),
});
