import type { PeriodPresetId } from "./period";

export const GLOBAL_PERIOD_STORAGE_KEY = "profit-loop-period";

export const GLOBAL_PERIOD_PRESETS: { value: PeriodPresetId; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "this-month", label: "This Month" },
  { value: "last-month", label: "Last Month" },
  { value: "ytd", label: "This Year" },
  { value: "custom", label: "Custom" },
];

export interface StoredPeriod {
  preset: PeriodPresetId;
  fromDate: string;
  toDate: string;
}

const VALID_PRESETS = new Set(GLOBAL_PERIOD_PRESETS.map((item) => item.value));
const DATE_INPUT_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function globalPeriodLabel(preset: PeriodPresetId): string {
  return GLOBAL_PERIOD_PRESETS.find((item) => item.value === preset)?.label ?? "Custom";
}

export function parseStoredPeriod(raw: string | null): StoredPeriod | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<StoredPeriod>;
    if (
      typeof value?.preset !== "string" ||
      !VALID_PRESETS.has(value.preset as PeriodPresetId) ||
      typeof value.fromDate !== "string" ||
      typeof value.toDate !== "string" ||
      !DATE_INPUT_PATTERN.test(value.fromDate) ||
      !DATE_INPUT_PATTERN.test(value.toDate) ||
      value.fromDate > value.toDate
    ) {
      return null;
    }
    return { preset: value.preset as PeriodPresetId, fromDate: value.fromDate, toDate: value.toDate };
  } catch {
    return null;
  }
}

export function serializeStoredPeriod(value: StoredPeriod): string {
  return JSON.stringify(value);
}
