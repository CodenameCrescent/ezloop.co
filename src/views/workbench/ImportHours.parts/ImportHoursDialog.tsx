import { useState, useRef, useMemo } from "react";
import { toast } from "sonner";
import { FileUp, AlertTriangle, Info, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { usePreviewTimeImport, useCommitTimeImport, apiErrorMessage } from "@/api/hooks";
import { formatCents } from "@/lib/money";
import { type PreviewResult, OUTCOME_LABEL, OUTCOME_STYLE, UnmatchedRow } from "./UnmatchedRow";

export function ImportHoursDialog({
  open,
  onOpenChange,
  members,
  targets,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  members: Array<{ id: string; name: string }>;
  targets: Array<{ targetType: string; targetId: string; label: string; group: string }>;
}) {
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  /** The owner's answers to "who is this?" — file name → id. */
  const [personMap, setPersonMap] = useState<Record<string, string>>({});
  const [targetMap, setTargetMap] = useState<Record<string, string>>({});
  const fileInput = useRef<HTMLInputElement>(null);

  const runPreview = usePreviewTimeImport();
  const commit = useCommitTimeImport();

  function reset() {
    setCsv("");
    setFileName("");
    setPreview(null);
    setPersonMap({});
    setTargetMap({});
  }

  async function load(text: string, name: string, maps?: { personMap?: Record<string, string>; targetMap?: Record<string, string> }) {
    setCsv(text);
    setFileName(name);
    try {
      const result = await runPreview.mutateAsync({
        csv: text,
        personMap: maps?.personMap ?? personMap,
        targetMap: maps?.targetMap ?? targetMap,
      });
      setPreview(result);
    } catch (err) {
      setPreview(null);
      toast.error(apiErrorMessage(err, "Could not read that file"));
    }
  }

  function onFile(file: File | undefined) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => void load(String(reader.result ?? ""), file.name);
    reader.onerror = () => toast.error("Could not read that file");
    reader.readAsText(file);
  }

  /** Answering "who is this?" re-runs the preview, so the numbers stay honest. */
  function resolvePerson(name: string, id: string) {
    const next = { ...personMap, [name]: id };
    setPersonMap(next);
    void load(csv, fileName, { personMap: next });
  }
  function resolveTarget(name: string, key: string) {
    const next = { ...targetMap, [name]: key };
    setTargetMap(next);
    void load(csv, fileName, { targetMap: next });
  }

  async function doImport() {
    try {
      const result = await commit.mutateAsync({ csv, personMap, targetMap });
      const parts: string[] = [];
      if (result.added) parts.push(`${result.added} ${result.added === 1 ? "day" : "days"} added`);
      if (result.updated) parts.push(`${result.updated} updated`);
      if (result.unchanged) parts.push(`${result.unchanged} already there`);
      if (result.skippedConflicts) parts.push(`${result.skippedConflicts} left as you typed them`);
      toast.success(parts.length ? parts.join(", ") : "Nothing to import — it was all already there");
      reset();
      onOpenChange(false);
    } catch (err) {
      toast.error(apiErrorMessage(err, "Could not import those hours"));
    }
  }

  const totalHours = useMemo(() => {
    if (!preview) return "0";
    // Display only; the server did the exact arithmetic that decides cost.
    const sum = preview.entries
      .filter((e) => e.outcome === "new" || e.outcome === "update")
      .reduce((total, e) => total + Number(e.hours), 0);
    return String(Math.round(sum * 100) / 100);
  }, [preview]);

  const totalCost = useMemo(
    () =>
      preview?.entries
        .filter((e) => e.outcome === "new" || e.outcome === "update")
        .reduce((total, e) => total + (e.costAmountCents ?? 0), 0) ?? 0,
    [preview],
  );

  const blocked = preview?.entries.filter((e) => e.outcome === "blocked") ?? [];

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-h-[88vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import hours from a file</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {!preview && (
            <div className="space-y-3">
              <button
                onClick={() => fileInput.current?.click()}
                className="flex w-full flex-col items-center gap-2 rounded-xl border border-dashed border-border p-8 text-center transition-colors hover:border-primary hover:bg-muted/40"
              >
                <FileUp className="h-6 w-6 text-muted-foreground" />
                <span className="text-sm font-medium">Choose a CSV file</span>
                <span className="text-xs text-muted-foreground">
                  Export from Toggl or Clockify and pick the file — we'll work out the columns.
                </span>
              </button>
              <input
                ref={fileInput}
                type="file"
                accept=".csv,text/csv,text/plain"
                className="hidden"
                onChange={(e) => onFile(e.target.files?.[0])}
              />
              <p className="text-xs text-muted-foreground">
                Nothing is saved until you've seen exactly what will go in.
              </p>
            </div>
          )}

          {runPreview.isPending && <p className="text-sm text-muted-foreground">Reading {fileName}…</p>}

          {preview && (
            <>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{fileName}</span>
                {preview.preset !== "custom" && (
                  <span className="rounded-full bg-muted px-2 py-0.5 capitalize">{preview.preset} export</span>
                )}
                <button className="ml-auto underline hover:text-foreground" onClick={reset}>
                  Choose a different file
                </button>
              </div>

              {/* Everything that must be answered before anything can be written. */}
              {preview.unmatchedPeople.map((row) => (
                <UnmatchedRow
                  key={`p-${row.name}`}
                  kind="person"
                  row={row}
                  options={members.map((m) => ({ id: m.id, label: m.name }))}
                  onPick={(id) => resolvePerson(row.name, id)}
                />
              ))}
              {preview.unmatchedTargets.map((row) => (
                <UnmatchedRow
                  key={`t-${row.name}`}
                  kind="target"
                  row={row}
                  options={targets.map((t) => ({
                    id: `${t.targetType}:${t.targetId}`,
                    label: t.label,
                    group: t.group,
                  }))}
                  onPick={(key) => resolveTarget(row.name, key)}
                />
              ))}

              {blocked.length > 0 && (
                <div className="rounded-lg bg-[color:var(--pl-red-tint)] p-3">
                  <div className="mb-1.5 flex items-center gap-2 text-sm font-medium text-destructive">
                    <AlertTriangle className="h-4 w-4" />
                    {blocked.length === 1 ? "One day can't be imported yet" : `${blocked.length} days can't be imported yet`}
                  </div>
                  <ul className="space-y-1 text-xs text-muted-foreground">
                    {blocked.slice(0, 5).map((e, i) => (
                      <li key={i}>{e.issue}</li>
                    ))}
                  </ul>
                </div>
              )}

              {preview.problems.length > 0 && (
                <div className="rounded-lg bg-[color:var(--pl-amber-tint)] p-3">
                  <div className="mb-1.5 flex items-center gap-2 text-sm font-medium text-[color:var(--pl-amber)]">
                    <Info className="h-4 w-4" />
                    {preview.problems.length === 1
                      ? "One line couldn't be read and will be skipped"
                      : `${preview.problems.length} lines couldn't be read and will be skipped`}
                  </div>
                  <ul className="space-y-1 text-xs text-muted-foreground">
                    {preview.problems.slice(0, 5).map((p) => (
                      <li key={p.lineNumber}>
                        {p.lineNumber > 0 ? `Line ${p.lineNumber}: ` : ""}
                        {p.reason}
                      </li>
                    ))}
                    {preview.problems.length > 5 && <li>…and {preview.problems.length - 5} more.</li>}
                  </ul>
                </div>
              )}

              {/* What will actually happen, in one sentence and then in full. */}
              {preview.entries.length > 0 && (
                <div className="rounded-lg border border-card-border p-3">
                  <p className="text-sm">
                    <strong>{totalHours} hours</strong> across{" "}
                    <strong>
                      {preview.totals.new + preview.totals.update}{" "}
                      {preview.totals.new + preview.totals.update === 1 ? "day" : "days"}
                    </strong>
                    {totalCost > 0 && (
                      <>
                        , worth <strong>{formatCents(totalCost)}</strong> of your team's time
                      </>
                    )}
                    .
                  </p>
                  {preview.totals.unchanged > 0 && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {preview.totals.unchanged} {preview.totals.unchanged === 1 ? "day is" : "days are"} already
                      imported and won't be added again.
                    </p>
                  )}
                  {preview.totals.conflict > 0 && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {preview.totals.conflict} {preview.totals.conflict === 1 ? "day was" : "days were"} typed in by
                      hand, so they're being left exactly as they are.
                    </p>
                  )}

                  <div className="mt-3 max-h-64 overflow-y-auto rounded-md border border-card-border/60">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-muted/80 text-muted-foreground">
                        <tr>
                          <th className="px-2 py-1.5 text-left font-medium">Who</th>
                          <th className="px-2 py-1.5 text-left font-medium">On what</th>
                          <th className="px-2 py-1.5 text-left font-medium">Day</th>
                          <th className="px-2 py-1.5 text-right font-medium">Hours</th>
                          <th className="px-2 py-1.5 text-left font-medium">What happens</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.entries.map((e, i) => (
                          <tr key={i} className="border-t border-card-border/40">
                            <td className="px-2 py-1.5">{e.personName}</td>
                            <td className="px-2 py-1.5">
                              {e.targetName}
                              {e.workType !== "delivery" && (
                                <span className="ml-1 text-[10px] text-muted-foreground">({e.workType})</span>
                              )}
                            </td>
                            <td className="px-2 py-1.5 text-muted-foreground">
                              {new Date(`${e.entryDate}T00:00:00Z`).toLocaleDateString("en-GB", {
                                day: "numeric",
                                month: "short",
                                timeZone: "UTC",
                              })}
                            </td>
                            <td className="px-2 py-1.5 text-right tabular-nums">{e.hours}</td>
                            <td className={`px-2 py-1.5 ${OUTCOME_STYLE[e.outcome]}`}>
                              {OUTCOME_LABEL[e.outcome]}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {preview.entries.length === 0 && preview.unmatchedPeople.length === 0 && preview.unmatchedTargets.length === 0 && (
                <p className="rounded-lg border border-card-border p-4 text-sm text-muted-foreground">
                  There are no hours in that file we can import.
                </p>
              )}

              <div className="flex items-center gap-2">
                <Button
                  className="flex-1 gap-2"
                  disabled={!preview.canCommit || commit.isPending || preview.totals.new + preview.totals.update === 0}
                  onClick={doImport}
                >
                  <CheckCircle2 className="h-4 w-4" />
                  {commit.isPending
                    ? "Importing…"
                    : preview.canCommit
                      ? `Import ${preview.totals.new + preview.totals.update} ${
                          preview.totals.new + preview.totals.update === 1 ? "day" : "days"
                        }`
                      : "Sort out the names above first"}
                </Button>
              </div>

              <p className="text-xs text-muted-foreground">
                Importing the same file twice is safe — days already brought in are recognised and left
                alone. These hours decide which client carried each person's cost; they never change
                your Profit &amp; Loss.
              </p>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
