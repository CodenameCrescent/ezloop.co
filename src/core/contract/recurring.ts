import { z } from "zod";
import { defineEndpoint, moneyCents } from "./shared";

export const recurInterval = z.enum(["daily", "weekly", "monthly", "quarterly", "yearly"]);
export const postingMode = z.enum(["auto_post", "confirm_first"]);
export const scheduleStatus = z.enum(["active", "paused", "canceled", "completed"]);

export const recurringSchedule = z.object({
  id: z.string(),
  direction: z.enum(["in", "out"]),
  itemName: z.string(),
  personName: z.string().nullable(),
  amountCents: moneyCents.nullable(),
  qty: z.string(),
  interval: recurInterval,
  intervalCount: z.number().int(),
  anchorDay: z.number().int().nullable(),
  nextRunAt: z.string(),
  lastPostedAt: z.string().nullable(),
  occurrencesPosted: z.number().int(),
  postingMode,
  status: scheduleStatus,
  createdAt: z.string(),
});
export type RecurringScheduleShape = z.infer<typeof recurringSchedule>;

export const listRecurringSchedules = defineEndpoint({
  method: "GET",
  path: "/recurring",
  response: z.array(recurringSchedule),
});

export const createRecurringSchedule = defineEndpoint({
  method: "POST",
  path: "/recurring",
  body: z.object({
    direction: z.enum(["in", "out"]),
    revenueItemId: z.string().nullish(),
    expenseItemId: z.string().nullish(),
    personId: z.string().nullish(),
    sourceId: z.string().nullish(),
    amountCents: moneyCents.nullish(),
    qty: z.string().optional(),
    interval: recurInterval,
    intervalCount: z.number().int().min(1).optional(),
    anchorDay: z.number().int().min(1).max(31).nullish(),
    startDate: z.string(),
    endDate: z.string().nullish(),
    maxOccurrences: z.number().int().min(1).nullish(),
    postingMode: postingMode.optional(),
  }),
  response: recurringSchedule,
});

export const setRecurringScheduleStatus = defineEndpoint({
  method: "POST",
  path: "/recurring/:id/status",
  params: z.object({ id: z.string() }),
  body: z.object({ status: z.enum(["active", "paused", "canceled"]) }),
  response: recurringSchedule,
});

/** "This and future" amount edit: closes the schedule and clones a new one. */
export const editRecurringScheduleFuture = defineEndpoint({
  method: "POST",
  path: "/recurring/:id/edit-future",
  params: z.object({ id: z.string() }),
  body: z.object({ amountCents: moneyCents.nullish(), qty: z.string().optional() }),
  response: recurringSchedule,
});
