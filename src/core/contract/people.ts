import { z } from "zod";
import { defineEndpoint, moneyCents } from "./shared";
import { transactionSummary } from "./transactions";

export const personKind = z.enum(["customer", "vendor", "employee", "other"]);
export type PersonKindShape = z.infer<typeof personKind>;

/** Derived at query time — never stored (CLAUDE.md/R4). */
export const personMetrics = z.object({
  lifetimeNetRevenueCents: moneyCents,
  lifetimeContributionCents: moneyCents,
  orderCount: z.number().int(),
  firstActivityAt: z.string().nullable(),
  lastActivityAt: z.string().nullable(),
  activeSubscriptions: z.number().int(),
  vendorSpendCents: moneyCents,
});

export const person = z.object({
  id: z.string(),
  kind: personKind,
  displayName: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  company: z.string().nullable(),
  firstTransactionAt: z.string().nullable(),
  needsReview: z.boolean(),
  status: z.enum(["active", "archived"]),
  notes: z.string().nullable(),
  cohortMonth: z.string().nullable(),
  metrics: personMetrics,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PersonShape = z.infer<typeof person>;

export const duplicateGroup = z.object({
  reason: z.string(),
  people: z.array(z.object({ id: z.string(), displayName: z.string(), email: z.string().nullable() })),
});

/**
 * Which people to list. Omitted means ACTIVE ONLY, and that default is load-
 * bearing: every picker in the app calls this endpoint without a status, and
 * archiving someone is supposed to take them out of those pickers. "all" exists
 * so the People screen can show what it has archived — without it, archiving is
 * as permanent as deleting, which is the thing archiving exists to avoid.
 */
export const peopleStatusFilter = z.enum(["active", "archived", "all"]);

export const listPeople = defineEndpoint({
  method: "GET",
  path: "/people",
  query: z.object({ kind: personKind.optional(), status: peopleStatusFilter.optional() }),
  response: z.object({
    items: z.array(person),
    possibleDuplicates: z.array(duplicateGroup),
  }),
});

/**
 * Something that will go on posting money for this person after they are
 * archived. Archiving takes someone out of the pickers; it does not stop the
 * recurring engine, which reads the schedule, not the person.
 *
 * Keyed by SCHEDULE, because a subscription is backed by one — listing both
 * tables would name the same monthly posting twice. `kind` says which face it
 * wears to the owner.
 */
export const personCommitment = z.object({
  scheduleId: z.string(),
  kind: z.enum(["subscription", "recurring"]),
  direction: z.enum(["in", "out"]),
  itemName: z.string(),
  /** Null means "resolve the item's price when it posts". */
  amountCents: moneyCents.nullable(),
  interval: z.enum(["daily", "weekly", "monthly", "quarterly", "yearly"]),
  intervalCount: z.number().int(),
  nextRunAt: z.string(),
});
export type PersonCommitmentShape = z.infer<typeof personCommitment>;

export const getPersonDetail = defineEndpoint({
  method: "GET",
  path: "/people/:id",
  params: z.object({ id: z.string() }),
  response: z.object({
    person,
    transactions: z.array(transactionSummary),
    /** Live schedules and subscriptions — what archiving will NOT stop. */
    commitments: z.array(personCommitment),
  }),
});

export const personInput = z.object({
  displayName: z.string().min(1).max(255),
  kind: personKind.optional(),
  email: z.string().max(255).nullish(),
  phone: z.string().max(50).nullish(),
  company: z.string().max(255).nullish(),
  notes: z.string().max(2000).nullish(),
});

export const createPerson = defineEndpoint({
  method: "POST",
  path: "/people",
  body: personInput,
  response: person,
});

export const updatePerson = defineEndpoint({
  method: "PATCH",
  path: "/people/:id",
  params: z.object({ id: z.string() }),
  body: personInput.partial().extend({ status: z.enum(["active", "archived"]).optional(), needsReview: z.boolean().optional() }),
  response: person,
});

export const mergePeople = defineEndpoint({
  method: "POST",
  path: "/people/:id/merge",
  params: z.object({ id: z.string() }),
  body: z.object({ mergeId: z.string() }),
  response: person,
});
