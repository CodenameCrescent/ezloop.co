import { z } from "zod";
import { defineEndpoint } from "./shared";

export const healthStatus = z.object({
  status: z.string(),
});
export type HealthStatus = z.infer<typeof healthStatus>;

export const healthCheck = defineEndpoint({
  method: "GET",
  path: "/healthz",
  response: healthStatus,
});
