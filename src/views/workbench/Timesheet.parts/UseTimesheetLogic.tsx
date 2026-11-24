import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { toast } from "sonner";
import { useTimesheet, useSetTimesheetCell, useClearTimesheetRow, apiErrorMessage } from "@/api/hooks";
import { weekStartOf, shortDaySentence, isPartialHoursEntry, hoursForTotal, addHours } from "@workspace/domain";
import { figureState } from "@/lib/figureState";

export type RowKey = string;
export const rowKeyOf = (personId: string, targetType: string, targetId: string) => `${personId}|${targetType}|${targetId}`;
export const cellKeyOf = (rowKey: RowKey, date: string) => `${rowKey}@${date}`;

export function isoWeekStart(d: Date): string {
  return weekStartOf(d).toISOString().slice(0, 10);
}

/** Timesheet's state and handlers, kept out of its render so each file stays short. */
export function useTimesheetLogic() {
  const [weekStart, setWeekStart] = useState(() => isoWeekStart(new Date()));
  const sheet = useTimesheet(weekStart);
  const setCell = useSetTimesheetCell();
  const clearRow = useClearTimesheetRow();
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [estimateOpen, setEstimateOpen] = useState(false);

  /**
   * What is on screen right now, keyed by cell. Held locally so typing is never
   * interrupted by a refetch — the server is told about each change, but the
   * grid is the source of truth for what the owner is currently editing.
   */
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Set<string>>(new Set());
  /** Rows the owner added this session that have no hours yet. */
  const [extraRows, setExtraRows] = useState<Array<{ personId: string; targetType: string; targetId: string; label: string }>>([]);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  /** What the server last confirmed per cell, so a failed save can be undone. */
  const lastSaved = useRef<Record<string, string>>({});

  const data = sheet.data;
  const days = data?.days ?? [];
  /*
   * "Nothing logged this week" was reached by `!sheet.isLoading` over an empty
   * `rowsByMember`, and a request that failed or stopped leaves `isLoading`
   * false — so a week full of logged hours read as a week nobody worked. On
   * this page that is the claim that costs the most: unlogged hours are
   * exactly what stops a client's cost-to-serve being computed at all.
   */
  const sheetState = figureState(sheet, data != null);

  // Reset local state whenever the week changes — a new week is a new sheet.
  useEffect(() => {
    setDraft({});
    setExtraRows([]);
  }, [weekStart]);

  // Seed the draft from the server once the week loads.
  useEffect(() => {
    if (!data) return;
    const next: Record<string, string> = {};
    for (const cell of data.cells) {
      next[cellKeyOf(rowKeyOf(cell.personId, cell.targetType, cell.targetId), cell.entryDate)] = cell.hours;
    }
    setDraft(next);
    lastSaved.current = { ...next };
  }, [data?.weekStart, data?.cells.length]);

  /**
   * Cells holding estimated hours rather than logged ones.
   *
   * Read from the server, never from the draft: the moment the owner types over
   * an estimate it stops being one, and the save that follows says so. A cell
   * that looks identical to a logged one would be trusted exactly as much as a
   * logged one, which is the whole risk of having estimates at all.
   */
  const estimatedCells = useMemo(() => {
    const set = new Set<string>();
    for (const cell of data?.cells ?? []) {
      if (cell.isEstimated) set.add(cellKeyOf(rowKeyOf(cell.personId, cell.targetType, cell.targetId), cell.entryDate));
    }
    return set;
  }, [data?.cells]);

  /** Server rows plus anything added this session, grouped under each member. */
  const rowsByMember = useMemo(() => {
    if (!data) return [];
    const all = [...data.rows, ...extraRows.filter((e) => !data.rows.some((r) => rowKeyOf(r.personId, r.targetType, r.targetId) === rowKeyOf(e.personId, e.targetType, e.targetId)))];
    return data.members
      .map((member) => ({
        member,
        rows: all.filter((r) => r.personId === member.id),
      }))
      .filter((g) => g.rows.length > 0);
  }, [data, extraRows]);

  const save = useCallback(
    (personId: string, targetType: string, targetId: string, entryDate: string, hours: string, memberName: string) => {
      const key = cellKeyOf(rowKeyOf(personId, targetType, targetId), entryDate);
      setSaving((s) => new Set(s).add(key));
      setCell.mutate(
        { personId, targetType: targetType as "client", targetId, entryDate, hours },
        {
          onSuccess: (res) => {
            setSaving((s) => {
              const next = new Set(s);
              next.delete(key);
              return next;
            });
            lastSaved.current[key] = res.saved?.hours ?? "";
            // The save has ALREADY happened. This is a report, not a gate — and
            // the missing hours are not filled in anywhere.
            if (res.dayCheck.isShort) {
              toast.warning(shortDaySentence(memberName, res.dayCheck), { id: `short-${personId}-${entryDate}` });
            }
          },
          onError: (err) => {
            setSaving((s) => {
              const next = new Set(s);
              next.delete(key);
              return next;
            });
            // Put the cell back. A number that failed to save must not sit
            // there looking saved — the grid would be showing hours the
            // database does not have, which is the one thing it cannot do.
            setDraft((d) => ({ ...d, [key]: lastSaved.current[key] ?? "" }));
            toast.error(apiErrorMessage(err, "Could not save those hours"));
          },
        },
      );
    },
    [setCell],
  );

  /**
   * Types into a cell now, saves shortly after typing stops.
   *
   * What is typed is ALWAYS kept on screen, including nonsense — yanking a
   * character back out from under the cursor is its own bug. What nonsense does
   * not get is a save: the cell marks itself instead, and the save resumes the
   * moment the value could be hours again.
   */
  function onCellChange(
    personId: string,
    targetType: string,
    targetId: string,
    entryDate: string,
    value: string,
    memberName: string,
  ) {
    const key = cellKeyOf(rowKeyOf(personId, targetType, targetId), entryDate);
    setDraft((d) => ({ ...d, [key]: value }));
    clearTimeout(timers.current[key]);
    if (!isPartialHoursEntry(value)) return;
    timers.current[key] = setTimeout(() => {
      save(personId, targetType, targetId, entryDate, value, memberName);
    }, 500);
  }

  /** Arrows and Enter move between cells so a week is filled without the mouse. */
  function onCellKeyDown(e: React.KeyboardEvent<HTMLInputElement>, rowIndex: number, colIndex: number) {
    const move = (dr: number, dc: number) => {
      e.preventDefault();
      const target = document.querySelector<HTMLInputElement>(
        `[data-cell="${rowIndex + dr}-${colIndex + dc}"]`,
      );
      target?.focus();
      target?.select();
    };
    if (e.key === "ArrowDown" || e.key === "Enter") move(1, 0);
    else if (e.key === "ArrowUp") move(-1, 0);
    else if (e.key === "ArrowRight" && e.currentTarget.selectionStart === e.currentTarget.value.length) move(0, 1);
    else if (e.key === "ArrowLeft" && e.currentTarget.selectionStart === 0) move(0, -1);
  }

  function shiftWeek(deltaDays: number) {
    const d = new Date(`${weekStart}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + deltaDays);
    setWeekStart(isoWeekStart(d));
  }

  /**
   * Totals straight from what is on screen, so they move as you type.
   *
   * Every value goes through `hoursForTotal` first. These run during RENDER, so
   * a value decimal.js cannot parse does not produce a bad total — it throws,
   * and with it goes the entire page. A cell that isn't a number yet counts as
   * nothing; the cell itself carries the warning.
   */
  const dayTotalFor = (personId: string, date: string) => {
    const values = Object.entries(draft)
      .filter(([k]) => k.startsWith(`${personId}|`) && k.endsWith(`@${date}`))
      .map(([, v]) => hoursForTotal(v));
    return addHours(...values);
  };
  const rowTotalFor = (rowKey: RowKey) =>
    addHours(...days.map((d) => hoursForTotal(draft[cellKeyOf(rowKey, d)] ?? "")));

  /** Cells holding something that can never be hours — warned about, never saved. */
  const badCells = useMemo(
    () => new Set(Object.entries(draft).filter(([, v]) => !isPartialHoursEntry(v)).map(([k]) => k)),
    [draft],
  );

  const weekLabel = days.length
    ? `${new Date(`${days[0]}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })} – ${new Date(`${days[6]}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}`
    : "";

  return {
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
  };
}
