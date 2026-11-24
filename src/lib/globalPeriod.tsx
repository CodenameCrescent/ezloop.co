import { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  buildPeriodRange,
  buildPeriodRangeFromDates,
  clampToToday,
  dateInputToUtcEnd,
  dateInputToUtcStart,
  dateInputValueUtc,
  type PeriodPresetId,
} from "./period";
import type { TodayFirstRangeState } from "@/components/TodayFirstDateRangeFilter";
import {
  GLOBAL_PERIOD_STORAGE_KEY,
  globalPeriodLabel,
  parseStoredPeriod,
  serializeStoredPeriod,
} from "./globalPeriodState";

const GlobalPeriodCtx = createContext<TodayFirstRangeState | null>(null);

function presetInputs(preset: PeriodPresetId) {
  const normalizedPreset = preset === "custom" ? "today" : preset;
  const range = buildPeriodRange(normalizedPreset);
  return {
    fromDate: dateInputValueUtc(range.start),
    toDate: dateInputValueUtc(range.end),
  };
}

function initialState(): { preset: PeriodPresetId; fromDate: string; toDate: string } {
  let stored = null;
  try {
    stored = parseStoredPeriod(window.localStorage.getItem(GLOBAL_PERIOD_STORAGE_KEY));
  } catch {
    stored = null;
  }
  if (!stored) return { preset: "today", ...presetInputs("today") };
  // Non-custom presets are relative to "now": recompute their dates fresh so a
  // selection saved yesterday doesn't pin the app to yesterday's calendar window.
  if (stored.preset !== "custom") return { preset: stored.preset, ...presetInputs(stored.preset) };
  // A custom window saved before dates were bounded — or saved yesterday and
  // reopened today — must still not reach past today.
  return {
    preset: stored.preset,
    fromDate: clampToToday(stored.fromDate),
    toDate: clampToToday(stored.toDate),
  };
}

export function GlobalPeriodProvider({ children }: { children: React.ReactNode }) {
  const [initial] = useState(initialState);
  const [preset, setPresetState] = useState<PeriodPresetId>(initial.preset);
  const [fromDate, setFromDateState] = useState(initial.fromDate);
  const [toDate, setToDateState] = useState(initial.toDate);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        GLOBAL_PERIOD_STORAGE_KEY,
        serializeStoredPeriod({ preset, fromDate, toDate }),
      );
    } catch {
      // Storage unavailable (private mode etc.) — selection just won't persist.
    }
  }, [preset, fromDate, toDate]);

  const value = useMemo<TodayFirstRangeState>(() => {
    const range = buildPeriodRangeFromDates(
      dateInputToUtcStart(fromDate),
      dateInputToUtcEnd(toDate),
      globalPeriodLabel(preset),
    );

    return {
      preset,
      fromDate,
      toDate,
      range,
      setPreset: (nextPreset: PeriodPresetId) => {
        setPresetState(nextPreset);
        if (nextPreset === "custom") return;
        const next = presetInputs(nextPreset);
        setFromDateState(next.fromDate);
        setToDateState(next.toDate);
      },
      // The window never reaches past today — there is no money out there, and
      // a future end date only hides the rows the owner opened the page to see.
      setFromDate: (raw: string) => {
        if (!raw) return;
        const value = clampToToday(raw);
        setPresetState("custom");
        setFromDateState(value);
        if (value > toDate) setToDateState(value);
      },
      setToDate: (raw: string) => {
        if (!raw) return;
        const value = clampToToday(raw);
        setPresetState("custom");
        setToDateState(value);
        if (value < fromDate) setFromDateState(value);
      },
      resetToday: () => {
        const today = presetInputs("today");
        setPresetState("today");
        setFromDateState(today.fromDate);
        setToDateState(today.toDate);
      },
    };
  }, [preset, fromDate, toDate]);

  return <GlobalPeriodCtx.Provider value={value}>{children}</GlobalPeriodCtx.Provider>;
}

export function useGlobalPeriod(): TodayFirstRangeState {
  const ctx = useContext(GlobalPeriodCtx);
  if (!ctx) throw new Error("useGlobalPeriod must be used within GlobalPeriodProvider");
  return ctx;
}
