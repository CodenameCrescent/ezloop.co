import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { NOT_IN_FILE, groupedNote } from "./importModel";
import { type StepMatchProps, useStepMatchLogic } from "./StepMatch.parts/UseStepMatchLogic";
export type { StepMatchProps } from "./StepMatch.parts/UseStepMatchLogic";

export function StepMatch({
  kind,
  filename,
  csv,
  preview,
  headers,
  refusal,
  mapping,
  onMappingChange,
  dateOrder,
  onDateOrderChange,
  totalsAre,
  onTotalsAreChange,
  sourceId,
  onSourceIdChange,
  onPreviewed,
  onBack,
  onContinue,
}: StepMatchProps) {
  const {
    serverSaid,
    columns,
    setField,
    unused,
    problem,
    dateCell,
    dateSays,
    reading,
    changeable,
    channel,
    setAddingChannel,
    sources,
    addingChannel,
    newChannel,
    setNewChannel,
    addChannel,
    createSource,
    runPreview,
    blocked,
  } = useStepMatchLogic({ kind, filename, csv, preview, headers, mapping, onMappingChange, dateOrder, totalsAre, sourceId, onSourceIdChange, onPreviewed });

  return (
    <div className="space-y-5">
      {/*
        Amber, never red. Red means money lost in this app (DESIGN.md §2), and
        neither a file we could not read nor a field nobody has pointed at yet
        is a loss — both are something about the DATA that needs attention,
        which is what amber says everywhere else in this flow.
      */}
      {refusal !== null && preview === null && (
        <p
          role="status"
          className="rounded-lg bg-[color:var(--pl-amber-tint)] p-3 t-secondary text-[color:var(--pl-amber)]"
        >
          {refusal} Your file's columns are below — match them and we'll read it.
        </p>
      )}
      {serverSaid !== null && (
        <p
          role="status"
          className="rounded-lg bg-[color:var(--pl-amber-tint)] p-3 t-secondary text-[color:var(--pl-amber)]"
        >
          {serverSaid}
        </p>
      )}

      {/* ── One row per field we expect ───────────────────────────────────── */}
      <div>
        <p className="t-body font-medium">Which column is which?</p>
        <p className="t-secondary text-muted-foreground">
          We've had a guess from the headings in <span className="text-foreground">{filename}</span>.
          Change anything we got wrong.
        </p>

        <div className="mt-3 space-y-2.5">
          {columns.map((column) => (
            <div key={column.field} className="grid grid-cols-1 gap-1.5 sm:grid-cols-[11rem_1fr] sm:items-start">
              <div className="sm:pt-2">
                <Label htmlFor={`match-${column.field}`} className="t-body">
                  {column.label}
                  {column.required && <span className="ml-1 text-muted-foreground">(needed)</span>}
                </Label>
              </div>
              <div>
                <Select
                  value={mapping[column.field] ?? NOT_IN_FILE}
                  onValueChange={(value) => setField(column.field, value)}
                >
                  <SelectTrigger id={`match-${column.field}`} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NOT_IN_FILE}>— not in my file —</SelectItem>
                    {headers.map((header, position) => (
                      // Positioned key: two columns may genuinely share a name.
                      <SelectItem key={`${header}-${position}`} value={header}>
                        {header}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {column.hint !== undefined && (
                  <p className="mt-1 t-micro text-muted-foreground">{column.hint}</p>
                )}
              </div>
            </div>
          ))}
        </div>

        {/*
          Named, never silently dropped. This is the whole reason the list is on
          screen: a column we do not recognise is only findable by the owner if
          we say we saw it and are leaving it alone.
        */}
        {unused.length > 0 && (
          <p className="mt-3 t-secondary text-muted-foreground">
            Not used: <span className="text-foreground">{unused.join(", ")}</span>.
          </p>
        )}

        {problem !== null && (
          <p
            role="status"
            className="mt-3 rounded-lg bg-[color:var(--pl-amber-tint)] p-3 t-secondary text-[color:var(--pl-amber)]"
          >
            {problem}
          </p>
        )}
      </div>

      {/* ── Which way the dates run ───────────────────────────────────────── */}
      {dateCell !== null && dateSays !== null && (
        <div className="rounded-lg bg-[color:var(--pl-recessed)] p-3">
          <p className="t-body">
            Dates look like {reading === "dmy" ? "day/month/year" : "month/day/year"}, so{" "}
            <strong>{dateCell}</strong> is <strong>{dateSays}</strong>.
          </p>
          {changeable && (
            <div className="mt-2 flex items-center gap-2">
              <p className="t-micro text-muted-foreground">Not how your file writes them?</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onDateOrderChange(reading === "dmy" ? "mdy" : "dmy")}
              >
                Change
              </Button>
            </div>
          )}
        </div>
      )}

      {/* ── Where this money landed ───────────────────────────────────────── */}
      {channel.show && (
        <div className="rounded-lg bg-[color:var(--pl-recessed)] p-3">
          {/*
            A Label rather than a paragraph, because it is the only name this
            <Select> has: every field select above is named by its own Label and
            this one was reaching a screen reader as an unlabelled combo box.

            And NOT `match-channel`, which is already the id of the Channel FIELD
            row above — the field ids are `match-${field}` and `channel` is one
            of them. Sharing it put two buttons and two labels on one id, and the
            browser hands a duplicated `for` to whichever came first, so the
            picker would still have had no name of its own while looking as
            though it did. This control is not a field; it is the answer to a
            question, and it is named as one.
          */}
          <Label htmlFor="channel-for-this-file" className="t-body font-medium">
            Which channel did these come from?
          </Label>
          {/*
            It does not say "your file doesn't say" any more. The picker can be
            on screen while the file DOES say — once a channel is chosen the
            control stays, and the owner may since have pointed a column at their
            own Channel values. What is always true is the override, so that is
            what it states.
          */}
          <p className="t-secondary text-muted-foreground">
            Everything in this file lands in the one you pick — a bank account, a shop, a
            marketplace, or wherever else you keep this money. It overrides your file's own
            Channel column, if it has one.{" "}
            {channel.required
              ? "Nothing in your file says where these landed, so pick one to carry on."
              : "Set it back to “choose a channel” to use what your file says."}
          </p>
          <div className="mt-2.5 space-y-2">
            <Select
              value={sourceId ?? NOT_IN_FILE}
              onValueChange={(value) => {
                if (value === "__add__") {
                  setAddingChannel(true);
                  return;
                }
                setAddingChannel(false);
                onSourceIdChange(value === NOT_IN_FILE ? undefined : value);
              }}
            >
              <SelectTrigger id="channel-for-this-file" className="w-full">
                <SelectValue placeholder="Choose a channel" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NOT_IN_FILE}>— choose a channel —</SelectItem>
                {(sources.data ?? []).map((source) => (
                  <SelectItem key={source.id} value={source.id}>
                    {source.name}
                  </SelectItem>
                ))}
                <SelectItem value="__add__">Add a new one…</SelectItem>
              </SelectContent>
            </Select>

            {addingChannel && (
              <div className="flex flex-wrap gap-2">
                <Input
                  aria-label="New channel name"
                  className="min-w-40 flex-1"
                  value={newChannel}
                  placeholder="What do you call it?"
                  onChange={(event) => setNewChannel(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      addChannel();
                    }
                  }}
                />
                <Button
                  variant="outline"
                  size="sm"
                  disabled={createSource.isPending || newChannel.trim() === ""}
                  onClick={addChannel}
                >
                  {createSource.isPending ? "Adding…" : "Add"}
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Whole order, or each item ─────────────────────────────────────── */}
      {preview !== null && preview.needsTotalsAnswer && (
        <div className="rounded-lg bg-[color:var(--pl-recessed)] p-3">
          <p className="t-body font-medium">
            Your file lists several items per sale, and it also has tax, shipping or discount
            figures.
          </p>
          <p className="t-secondary text-muted-foreground">
            Is each of those figures for the whole sale, or for that one item?
          </p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            <Button
              variant={(totalsAre ?? "whole_order") === "whole_order" ? "default" : "outline"}
              size="sm"
              onClick={() => onTotalsAreChange("whole_order")}
            >
              For the whole sale
            </Button>
            <Button
              variant={totalsAre === "per_item" ? "default" : "outline"}
              size="sm"
              onClick={() => onTotalsAreChange("per_item")}
            >
              For each item
            </Button>
          </div>
        </div>
      )}

      {/* ── What this adds up to, and on ──────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="t-secondary text-muted-foreground">
          {runPreview.isPending
            ? "Reading it again…"
            : preview !== null && preview.grouped
              ? groupedNote(preview.sourceRowCount)
              : preview !== null
                ? `${preview.sourceRowCount.toLocaleString("en-US")} ${preview.sourceRowCount === 1 ? "row" : "rows"} read.`
                : ""}
        </p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onBack}>
            Back
          </Button>
          <Button disabled={blocked} onClick={onContinue}>
            Continue
          </Button>
        </div>
      </div>
    </div>
  );
}
