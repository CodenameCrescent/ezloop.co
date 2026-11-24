import { useGlobalPeriod } from "@/lib/globalPeriod";
import { todayInputValue } from "@/lib/period";
import { GLOBAL_PERIOD_PRESETS } from "@/lib/globalPeriodState";

/**
 * The app-wide date filter, as a segmented control: a recessed track with the
 * chosen segment raised to the card colour. Orange is not used here — the
 * period is a view setting, not an action, and spending the brand colour on it
 * would make every screen read orange.
 *
 * Every page mounts this through PageHeader, so it sits in the same spot on
 * every screen and all instances read one shared selection.
 */
export function GlobalPeriodFilter({ className = "" }: { className?: string }) {
  const period = useGlobalPeriod();

  const dateInput =
    "h-8 rounded-[8px] border border-[color:var(--pl-hairline)] bg-[color:var(--pl-surface)] px-2.5 text-xs text-[color:var(--pl-ink)] outline-none focus:border-[color:var(--pl-orange)] focus:ring-2 focus:ring-[color:color-mix(in_srgb,var(--pl-orange)_18%,transparent)]";

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      <div
        role="group"
        aria-label="Period"
        className="flex items-center gap-0.5 rounded-full bg-[color:var(--pl-recessed)] p-1"
      >
        {GLOBAL_PERIOD_PRESETS.map((item) => {
          const selected = period.preset === item.value;
          return (
            <button
              key={item.value}
              type="button"
              aria-pressed={selected}
              onClick={() => period.setPreset(item.value)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:color-mix(in_srgb,var(--pl-orange)_35%,transparent)] ${
                selected
                  ? "bg-[color:var(--pl-surface)] text-[color:var(--pl-ink)]"
                  : "text-[color:var(--pl-ink-2)] hover:text-[color:var(--pl-ink)]"
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </div>

      {period.preset === "custom" && (
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={period.fromDate}
            max={period.toDate < todayInputValue() ? period.toDate : todayInputValue()}
            onChange={(event) => period.setFromDate(event.target.value)}
            aria-label="From date"
            className={dateInput}
          />
          <span className="text-xs text-[color:var(--pl-ink-2)]">to</span>
          <input
            type="date"
            value={period.toDate}
            min={period.fromDate}
            max={todayInputValue()}
            onChange={(event) => period.setToDate(event.target.value)}
            aria-label="To date"
            className={dateInput}
          />
        </div>
      )}
    </div>
  );
}
