import { z } from "zod";
import { defineEndpoint, moneyCents } from "./shared";

/**
 * Projects — a site, a contract, a production run.
 *
 * The container costs and revenue point at, so the question can be "did I make
 * money on THAT one" rather than only "how was August".
 */
export const projectStatus = z.enum(["quoted", "active", "on_hold", "completed", "cancelled"]);
export type ProjectStatusShape = z.infer<typeof projectStatus>;

/**
 * What a project is worth, what it cost, and what is left.
 *
 * MIRRORS `ProjectProfit` in lib/domain/src/projectProfit.ts. Every figure that
 * cannot honestly be computed is NULL rather than zero — no contract value, no
 * billing yet, no output quantity — and the screens render those as an em dash.
 */
export const projectMoney = z.object({
  billedCents: moneyCents,
  receivedCents: moneyCents,
  stillOwedCents: moneyCents,
  costToDateCents: moneyCents,
  directCostCents: moneyCents,
  labourCostCents: moneyCents,
  /**
   * BEFORE fixed running costs. Head office rent is never sliced into a site
   * (CLAUDE.md), so this is not what landed in the bank — every screen showing
   * it must say so in those words.
   */
  contributionProfitCents: moneyCents,
  marginPct: z.number().nullable(),
  leftToBillCents: moneyCents.nullable(),
  billedPct: z.number().nullable(),
  costPerUnitCents: moneyCents.nullable(),
});

export const project = z.object({
  id: z.string(),
  name: z.string(),
  code: z.string().nullable(),
  status: projectStatus,
  personId: z.string().nullable(),
  personName: z.string().nullable(),
  contractValueCents: moneyCents.nullable(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  expectedEndDate: z.string().nullable(),
  outputQty: z.string().nullable(),
  outputUnitLabel: z.string().nullable(),
  notes: z.string().nullable(),
  createdAt: z.string(),
});
export type ProjectShape = z.infer<typeof project>;

export const listProjects = defineEndpoint({
  method: "GET",
  path: "/projects",
  query: z.object({ status: projectStatus.optional() }),
  response: z.object({
    /** Each carries its money, so the list is worth reading without opening one. */
    items: z.array(project.extend({ money: projectMoney })),
    /** The trade's own word, resolved from the business type. */
    label: z.object({ one: z.string(), many: z.string() }),
  }),
});

export const getProject = defineEndpoint({
  method: "GET",
  path: "/projects/:id",
  params: z.object({ id: z.string() }),
  response: z.object({
    project,
    money: projectMoney,
    label: z.object({ one: z.string(), many: z.string() }),
  }),
});

export const projectBody = z.object({
  name: z.string().min(1).max(255),
  code: z.string().max(100).nullish(),
  status: projectStatus.optional(),
  personId: z.string().nullish(),
  /** Free-typed customer name — resolved to an existing or new person server-side. */
  personName: z.string().max(255).nullish(),
  contractValueCents: moneyCents.nullish(),
  startDate: z.string().nullish(),
  endDate: z.string().nullish(),
  expectedEndDate: z.string().nullish(),
  /** Decimal string, like every other quantity. Never a float. */
  outputQty: z.string().max(40).nullish(),
  outputUnitLabel: z.string().max(40).nullish(),
  notes: z.string().max(2000).nullish(),
});

export const createProject = defineEndpoint({
  method: "POST",
  path: "/projects",
  body: projectBody,
  response: project,
});

export const updateProject = defineEndpoint({
  method: "PATCH",
  path: "/projects/:id",
  params: z.object({ id: z.string() }),
  body: projectBody.partial(),
  response: project,
});

/**
 * Bill a project, holding a percentage back until sign-off.
 *
 * Writes TWO ordinary receivables through the ordinary ledger path — the main
 * amount on normal terms, the held-back amount due on the release date. Not a
 * part-payment: they are two promises made at the same moment with two
 * different dates, and only one of them is owed yet.
 */
export const billProject = defineEndpoint({
  method: "POST",
  path: "/projects/:id/bill",
  params: z.object({ id: z.string() }),
  body: z.object({
    amountCents: moneyCents,
    occurredAt: z.string(),
    /** What the invoice is for, in the owner's words. */
    label: z.string().min(1).max(255),
    dueDate: z.string().nullish(),
    /** Decimal string percentage. Omit for an ordinary invoice with nothing held back. */
    retentionPct: z.string().nullish(),
    /** When the held-back amount falls due. Required when retaining. */
    retentionDueDate: z.string().nullish(),
    referenceNumber: z.string().max(100).nullish(),
  }),
  response: z.object({
    /** One id for a plain invoice, two when a retention was held back. */
    transactionIds: z.array(z.string()),
    dueNowCents: moneyCents,
    heldBackCents: moneyCents,
  }),
});
