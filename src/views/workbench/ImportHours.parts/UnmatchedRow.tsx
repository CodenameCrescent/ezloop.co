import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { usePreviewTimeImport } from "@/api/hooks";

/**
 * Bringing a week of hours in from Toggl, Clockify, or a spreadsheet.
 *
 * The screen is built around one promise: YOU SEE IT BEFORE IT HAPPENS. The
 * file is read, every name is matched against real people and real clients, and
 * the result is shown as plain sentences — including everything that could not
 * be placed. Nothing is written until the owner presses the button, and the
 * button is disabled while any name is still unknown.
 *
 * The alternative — import what matches and mention the rest in small text —
 * is the failure this is designed against. A timesheet that is quietly missing
 * one person's hours looks complete, and every client that person touched then
 * looks cheaper than they are.
 */

export type PreviewResult = Awaited<ReturnType<ReturnType<typeof usePreviewTimeImport>["mutateAsync"]>>;

export const OUTCOME_LABEL: Record<string, string> = {
  new: "Will be added",
  update: "Will be updated",
  unchanged: "Already there",
  conflict: "Left alone",
  blocked: "Can't import",
};

export const OUTCOME_STYLE: Record<string, string> = {
  new: "text-[color:var(--pl-green)]",
  update: "text-[color:var(--pl-teal)]",
  unchanged: "text-muted-foreground",
  conflict: "text-muted-foreground",
  blocked: "text-destructive",
};

/**
 * One name the file uses that this business doesn't recognise.
 *
 * Shown as a question with the closest existing records offered as answers, and
 * never resolved automatically. "Acme Ltd" is probably "Acme Corp" — but it is
 * sometimes a genuinely different company, and hours filed against the wrong
 * client are invisible once they land.
 */
export function UnmatchedRow({
  kind,
  row,
  options,
  onPick,
}: {
  kind: "person" | "target";
  row: {
    name: string;
    rowCount: number;
    hours: string;
    suggestions: Array<{ id: string; label: string; reason: string }>;
  };
  options: Array<{ id: string; label: string; group?: string }>;
  onPick: (id: string) => void;
}) {
  const noun = kind === "person" ? "team member" : "client or product";
  return (
    <div className="rounded-lg bg-[color:var(--pl-amber-tint)] p-3">
      <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
        <strong>{row.name}</strong>
        <span className="text-xs text-muted-foreground">
          {row.hours} hours in the file, but no {noun} of that name here.
        </span>
      </div>

      {row.suggestions.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Did you mean</span>
          {row.suggestions.map((s) => (
            <button
              key={s.id}
              onClick={() => onPick(s.id)}
              title={s.reason}
              className="rounded-lg border border-border bg-background px-2.5 py-1 text-xs transition-colors hover:border-primary hover:bg-[color:var(--pl-orange-tint)]"
            >
              {s.label}
            </button>
          ))}
        </div>
      )}

      <div className="mt-2">
        <Label className="text-xs">Or pick from the list</Label>
        <Select onValueChange={onPick}>
          <SelectTrigger className="mt-1 h-8 text-xs">
            <SelectValue placeholder={`Choose a ${noun}`} />
          </SelectTrigger>
          <SelectContent>
            {options.map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {o.group ? `${o.group} · ${o.label}` : o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
