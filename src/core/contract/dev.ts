import { z } from "zod";
import { defineEndpoint } from "./shared";

/** Dev/demo data controls (Settings page). These drive the NEW money core. */
export const seedDemoData = defineEndpoint({
  method: "POST",
  path: "/data/seed",
  response: z.object({ ok: z.boolean() }),
});

export const resetData = defineEndpoint({
  method: "POST",
  path: "/data/reset",
  response: z.object({ ok: z.boolean() }),
});
