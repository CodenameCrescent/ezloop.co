import { useMemo, useState } from "react";
import { CalendarDays, RotateCcw } from "lucide-react";
import {
  buildPeriodRange,
  buildPeriodRangeFromDates,
  clampToToday,
  dateInputToUtcEnd,
  dateInputToUtcStart,
  dateInputValueUtc,
  todayInputValue,
  type PeriodPresetId,
  type PeriodRange,
} from "@/lib/period";
import { GLOBAL_PERIOD_PRESETS } from "@/lib/globalPeriodState";

export const TODAY_FIRST_RANGE_PRESETS: { value: PeriodPresetId; label: string }[] =
  GLOBAL_PERIOD_PRESETS;

export interface TodayFirstRangeState {
  preset: PeriodPresetId;
  fromDate: string;
  toDate: string;
  range: PeriodRange;
  setPreset: (preset: PeriodPresetId) => void;
  setFromDate: (value: string) => void;
  setToDate: (value: string) => void;
  resetToday: () => void;
}

function presetInputs(preset: PeriodPresetId) {
  const normalizedPreset = preset === "custom" ? "today" : preset;
  const range = buildPeriodRange(normalizedPreset);
  return {
    fromDate: dateInputValueUtc(range.start),
    toDate: dateInputValueUtc(range.end),
  };
}

export function useTodayFirstRange(defaultPreset: PeriodPresetId = "today"): TodayFirstRangeState {
  const initial = presetInputs(defaultPreset);
  const [preset, setPresetState] = useState<PeriodPresetId>(defaultPreset);
  const [fromDate, setFromDateState] = useState(initial.fromDate);
  const [toDate, setToDateState] = useState(initial.toDate);

  const range = useMemo(() => {
    const label = preset === "custom" ? "Custom" : buildPeriodRange(preset).label;
    return buildPeriodRangeFromDates(
      dateInputToUtcStart(fromDate),
      dateInputToUtcEnd(toDate),
      label,
    );
  }, [fromDate, preset, toDate]);

  function setPreset(nextPreset: PeriodPresetId) {
    setPresetState(nextPreset);
    if (nextPreset === "custom") return;
    const next = presetInputs(nextPreset);
    setFromDateState(next.fromDate);
    setToDateState(next.toDate);
  }

  // A window cannot reach past today: there is no money in it yet, so the only
  // thing a future date can do is hide the rows the owner came to look at.
  function setFromDate(raw: string) {
    if (!raw) return;
    const value = clampToToday(raw);
    setPresetState("custom");
    setFromDateState(value);
    if (value > toDate) setToDateState(value);
  }

  function setToDate(raw: string) {
    if (!raw) return;
    const value = clampToToday(raw);
    setPresetState("custom");
    setToDateState(value);
    if (value < fromDate) setFromDateState(value);
  }

  function resetToday() {
    const today = presetInputs("today");
    setPresetState("today");
    setFromDateState(today.fromDate);
    setToDateState(today.toDate);
  }

  return { preset, fromDate, toDate, range, setPreset, setFromDate, setToDate, resetToday };
}

export function TodayFirstDateRangeFilter({
  value,
  title = "Date filter",
  className = "",
  compact = false,
}: {
  value: TodayFirstRangeState;
  title?: string;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border border-card-border bg-card p-5 shadow-sm ${className}`}
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">{title}</h2>
        </div>
        {value.preset !== "today" && (
          <button
            onClick={value.resetToday}
            className="inline-flex items-center gap-1.5 rounded-lg border border-card-border bg-card px-3 py-2 text-xs font-medium text-muted-foreground shadow-xs transition-colors hover:bg-muted/70 hover:text-foreground"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Back to Today
          </button>
        )}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-wrap items-center gap-1 rounded-xl border border-card-border bg-muted/55 p-1">
          {TODAY_FIRST_RANGE_PRESETS.map((item) => (
            <button
              key={item.value}
              onClick={() => value.setPreset(item.value)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                value.preset === item.value
                  ? "bg-card text-primary shadow-xs"
                  : "text-muted-foreground hover:bg-card/80 hover:text-foreground"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-muted-foreground">
            From
          </span>
          <input
            type="date"
            value={value.fromDate}
            max={value.toDate < todayInputValue() ? value.toDate : todayInputValue()}
            onChange={(event) => value.setFromDate(event.target.value)}
            className={`${compact ? "h-9" : ""} rounded-lg border border-input bg-card px-3 py-2 text-sm shadow-xs outline-none focus: focus:ring-2 focus:ring-primary/15`}
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-muted-foreground">
            To
          </span>
          <input
            type="date"
            value={value.toDate}
            min={value.fromDate}
            max={todayInputValue()}
            onChange={(event) => value.setToDate(event.target.value)}
            className={`${compact ? "h-9" : ""} rounded-lg border border-input bg-card px-3 py-2 text-sm shadow-xs outline-none focus: focus:ring-2 focus:ring-primary/15`}
          />
        </label>
      </div>
    </div>
  );
}
