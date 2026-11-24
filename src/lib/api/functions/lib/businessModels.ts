import { z } from "zod";

export const BUSINESS_MODEL_VALUES = [
  "products",
  "services",
  "subscriptions",
  "freelance_projects",
  "digital_products",
  "mixed",
] as const;

export const businessModelsSchema = z
  .array(z.enum(BUSINESS_MODEL_VALUES))
  .max(BUSINESS_MODEL_VALUES.length)
  .transform((models) => Array.from(new Set(models)));

export type BusinessModel = (typeof BUSINESS_MODEL_VALUES)[number];

export function parseBusinessModels(raw: unknown): BusinessModel[] {
  if (Array.isArray(raw)) {
    const parsed = businessModelsSchema.safeParse(raw);
    return parsed.success ? parsed.data : [];
  }
  if (typeof raw !== "string" || raw.trim() === "") return [];
  try {
    const parsedJson = JSON.parse(raw);
    const parsed = businessModelsSchema.safeParse(parsedJson);
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

export function serializeBusinessModels(models: unknown): string {
  return JSON.stringify(parseBusinessModels(models));
}
