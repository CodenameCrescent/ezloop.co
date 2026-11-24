import { z } from "zod";
import { defineEndpoint, moneyCents } from "./shared";

/**
 * Advances — money that moved before the work did.
 *
 * An advance to a subcontractor, a deposit to a supplier, a deposit taken from
 * a customer. Real cash, not yet earned or consumed: it spends nothing in
 * profit until it is settled against a real bill.
 */
export const openAdvance = z.object({
  id: z.string(),
  /** "out" is money you paid ahead; "in" is money you are holding. */
  direction: z.enum(["in", "out"]),
  displayName: z.string(),
  occurredAt: z.string(),
  personId: z.string().nullable(),
  personName: z.string().nullable(),
  amountCents: moneyCents,
  usedCents: moneyCents,
  remainingCents: moneyCents,
});

/**
 * Advances with something still on them. Fully-used ones drop off: they have
 * become an ordinary cost of the month the work happened in, and keeping them
 * here would show the owner money that is no longer theirs to spend.
 */
export const listOpenAdvances = defineEndpoint({
  method: "GET",
  path: "/advances",
  response: z.object({
    items: z.array(openAdvance),
    /** What is still paid ahead, by direction. */
    totalPaidAheadCents: moneyCents,
    totalHeldCents: moneyCents,
  }),
});

/**
 * Draw an advance down against a real bill.
 *
 * Append-only: this writes an application and, when the bill is fully covered,
 * stamps its `paid_at`. It never edits a row and never changes an amount — the
 * bill is still for what it was always for.
 */
export const settleFromAdvance = defineEndpoint({
  method: "POST",
  path: "/transactions/:id/settle-from-advance",
  params: z.object({ id: z.string() }),
  body: z.object({
    advanceTransactionId: z.string(),
    /** Omit to apply as much as both the bill and the advance allow. */
    amountCents: moneyCents.optional(),
    appliedOn: z.string().optional(),
  }),
  response: z.object({
    appliedCents: moneyCents,
    billStillOwesCents: moneyCents,
    advanceRemainingCents: moneyCents,
    billSettled: z.boolean(),
  }),
});
