import { createContext, useContext } from "react";
import type { PeriodRange } from "./period";

export interface InsightsPeriodValue {
  range: PeriodRange;
}

const InsightsPeriodCtx = createContext<InsightsPeriodValue | null>(null);

export const InsightsPeriodProvider = InsightsPeriodCtx.Provider;

export function useInsightsPeriod(): InsightsPeriodValue | null {
  return useContext(InsightsPeriodCtx);
}
