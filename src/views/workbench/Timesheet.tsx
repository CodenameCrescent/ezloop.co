import { Fragment } from "react";
import { ChevronLeft, ChevronRight, FileUp, Plus, Trash2, Wand2 } from "lucide-react";
import { TopBar } from "@/components/TopBar";
import { Button } from "@/components/ui/button";
import { addHours, checkDay, isWeekend } from "@workspace/domain";
import { figureStateSentence } from "@/lib/figureState";
import { ImportHoursDialog } from "./ImportHours";
import { EstimateHoursDialog } from "./EstimateHours";
import { rowKeyOf, cellKeyOf, isoWeekStart, useTimesheetLogic } from "./Timesheet.parts/UseTimesheetLogic";
import { AddRowDialog } from "./Timesheet.parts/AddRowDialog";

/**
 * The weekly grid.
 *
 * Adoption lives or dies here: if filling a week is slow, nobody does it and
 * every number this module produces is missing its cost side. Three things are
 * therefore load-bearing, not polish:
 *
 *   1. SAVE AS YOU GO — no Save button, nothing to forget, nothing to lose.
 *   2. KEYBOARD — arrows and Enter move between cells so a week is typed
 *      without touching the mouse.
 *   3. NOTHING INVENTED — a short day warns and saves. It never blocks, and it
 *      never fills the gap with Admin hours nobody entered.
 */

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function Timesheet() {
  const {
    setEstimateOpen,
    data,
    setImportOpen,
    setAddOpen,
    shiftWeek,
    weekLabel,
    setWeekStart,
    rowsByMember,
    sheetState,
    sheet,
    days,
    dayTotalFor,
    estimatedCells,
    badCells,
    draft,
    onCellChange,
    onCellKeyDown,
    saving,
    rowTotalFor,
    clearRow,
    weekStart,
    setDraft,
    setExtraRows,
    addOpen,
    extraRows,
    importOpen,
    estimateOpen,
  } = useTimesheetLogic();

  let rowCounter = -1;

  return (
    <>
      <TopBar
        title="Hours"
        subtitle="Where everyone's time went this week."
        primaryAction={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" className="gap-2" onClick={() => setEstimateOpen(true)} disabled={!data}>
              <Wand2 className="h-4 w-4" /> Estimate
            </Button>
            <Button size="sm" variant="outline" className="gap-2" onClick={() => setImportOpen(true)} disabled={!data}>
              <FileUp className="h-4 w-4" /> Import
            </Button>
            <Button size="sm" className="gap-2" onClick={() => setAddOpen(true)} disabled={!data}>
              <Plus className="h-4 w-4" /> Add a row
            </Button>
          </div>
        }
      />
      <div className="app-page-shell space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => shiftWeek(-7)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-[9rem] text-center text-sm font-medium">{weekLabel}</span>
          <Button size="sm" variant="outline" onClick={() => shiftWeek(7)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setWeekStart(isoWeekStart(new Date()))}>
            This week
          </Button>
          <span className="ml-auto text-xs text-muted-foreground">
            Saves as you type · arrows and Enter move between boxes
          </span>
        </div>

        {rowsByMember.length === 0 && sheetState === "settled" && (
          <div className="pl-glass p-10 text-center text-sm text-muted-foreground">
            Nothing logged this week. Use <strong>Add a row</strong> to pick who worked on what.
          </div>
        )}

        {rowsByMember.length === 0 && sheetState !== "settled" && sheetState !== "loading" && (
          <div className="pl-glass p-10 text-center text-sm">
            <p className="text-[color:var(--pl-amber)]">
              {figureStateSentence(sheetState, "this week's hours")}
            </p>
            {sheetState === "failed" && (
              <Button size="sm" variant="outline" className="mt-3" onClick={() => sheet.refetch()}>
                Try again
              </Button>
            )}
          </div>
        )}

        {rowsByMember.length > 0 && (
          <div className="pl-glass overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="border-b border-card-border text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2.5 text-left font-medium">Who / what</th>
                  {days.map((d, i) => (
                    <th
                      key={d}
                      className={`px-2 py-2.5 text-center font-medium ${isWeekend(d) ? "text-muted-foreground/60" : ""}`}
                    >
                      {DAY_LABELS[i]}
                      <span className="block text-[10px] font-normal opacity-60">
                        {new Date(`${d}T00:00:00Z`).getUTCDate()}
                      </span>
                    </th>
                  ))}
                  <th className="px-3 py-2.5 text-right font-medium">Week</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {rowsByMember.map(({ member, rows }) => (
                  <Fragment key={member.id}>
                    <tr className="bg-muted/40">
                      <td className="px-3 py-1.5 text-xs font-semibold">{member.name}</td>
                      {days.map((d) => {
                        const total = dayTotalFor(member.id, d);
                        const check = checkDay(total, data?.expectedDailyHours);
                        return (
                          <td
                            key={d}
                            className={`px-2 py-1.5 text-center text-xs tabular-nums ${
                              check.isShort ? "text-[color:var(--pl-amber)]" : "text-muted-foreground"
                            }`}
                            title={check.isShort ? `${check.missingHours}h unaccounted for` : undefined}
                          >
                            {Number(total) > 0 ? total : ""}
                          </td>
                        );
                      })}
                      <td className="px-3 py-1.5 text-right text-xs font-semibold tabular-nums">
                        {addHours(...days.map((d) => dayTotalFor(member.id, d)))}
                      </td>
                      <td />
                    </tr>
                    {rows.map((row) => {
                      rowCounter += 1;
                      const rIndex = rowCounter;
                      const rKey = rowKeyOf(row.personId, row.targetType, row.targetId);
                      return (
                        <tr key={rKey} className="border-b border-card-border/60 last:border-0">
                          <td className="px-3 py-1.5 pl-6 text-muted-foreground">{row.label}</td>
                          {days.map((d, cIndex) => {
                            const key = cellKeyOf(rKey, d);
                            const estimated = estimatedCells.has(key);
                            const bad = badCells.has(key);
                            return (
                              <td key={d} className={`px-1 py-1 ${isWeekend(d) ? "bg-muted/20" : ""}`}>
                                <input
                                  data-cell={`${rIndex}-${cIndex}`}
                                  data-estimated={estimated ? "true" : undefined}
                                  data-invalid={bad ? "true" : undefined}
                                  aria-invalid={bad || undefined}
                                  inputMode="decimal"
                                  value={draft[key] ?? ""}
                                  onFocus={(e) => e.currentTarget.select()}
                                  onChange={(e) =>
                                    onCellChange(row.personId, row.targetType, row.targetId, d, e.target.value, member.name)
                                  }
                                  onKeyDown={(e) => onCellKeyDown(e, rIndex, cIndex)}
                                  title={
                                    bad
                                      ? "That isn't a number of hours. Type something like 7 or 7.5 — up to 24."
                                      : estimated
                                        ? "Estimated, not logged. Type over it to say what the day really was."
                                        : undefined
                                  }
                                  className={`h-8 w-full rounded-md border bg-background px-1 text-center text-sm tabular-nums outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary/40 ${
                                    bad
                                      ? // Not saved, and saying so. The number stays exactly as
                                        // typed — this marks it, it does not correct it.
                                        "border-destructive text-destructive focus:border-destructive focus:ring-destructive/40"
                                      : saving.has(key)
                                        ? ""
                                        : estimated
                                          ? // Dashed and dimmed: an estimate must never look like a
                                            // number somebody actually entered.
                                            "border-dashed italic text-[color:var(--pl-amber)]"
                                          : "border-transparent hover:border-border"
                                  }`}
                                  placeholder="·"
                                />
                              </td>
                            );
                          })}
                          <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                            {Number(rowTotalFor(rKey)) > 0 ? rowTotalFor(rKey) : ""}
                          </td>
                          <td className="px-1">
                            <button
                              title="Remove this row for the week"
                              onClick={() => {
                                clearRow.mutate(
                                  { personId: row.personId, targetType: row.targetType as "client", targetId: row.targetId, weekStart },
                                  {
                                    onSuccess: () => {
                                      setDraft((d) => {
                                        const next = { ...d };
                                        for (const day of days) delete next[cellKeyOf(rKey, day)];
                                        return next;
                                      });
                                      setExtraRows((rs) =>
                                        rs.filter((r) => rowKeyOf(r.personId, r.targetType, r.targetId) !== rKey),
                                      );
                                    },
                                  },
                                );
                              }}
                              className="rounded p-1 text-muted-foreground transition-colors hover:bg-[color:var(--pl-red-tint)] hover:text-destructive"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          A short day is flagged in amber, and saved exactly as you typed it — nothing is ever filled
          in for you. These hours decide which client or product carried each person's cost; they
          never change your Profit &amp; Loss.
        </p>

        {badCells.size > 0 && (
          <p className="text-xs text-destructive">
            {badCells.size === 1 ? "One box doesn't" : `${badCells.size} boxes don't`} hold a number of
            hours, so {badCells.size === 1 ? "it hasn't" : "they haven't"} been saved. Hours look like{" "}
            <strong>7</strong> or <strong>7.5</strong>, up to 24 in a day.
          </p>
        )}

        {estimatedCells.size > 0 && (
          <p className="text-xs text-[color:var(--pl-amber)]">
            Boxes with a dashed edge are <strong>estimates</strong>, not hours anyone logged. Type over one
            to say what the day really was — every figure they feed is marked as an estimate too.
          </p>
        )}
      </div>

      {data && (
        <AddRowDialog
          open={addOpen}
          onOpenChange={setAddOpen}
          members={data.members}
          targets={data.targets}
          existing={[...data.rows, ...extraRows]}
          onAdd={(rows) => setExtraRows((rs) => [...rs, ...rows])}
        />
      )}

      {data && (
        <ImportHoursDialog
          open={importOpen}
          onOpenChange={setImportOpen}
          members={data.members}
          targets={data.targets}
        />
      )}

      {data && (
        <EstimateHoursDialog
          open={estimateOpen}
          onOpenChange={setEstimateOpen}
          members={data.members}
          targets={data.targets}
        />
      )}
    </>
  );
}
