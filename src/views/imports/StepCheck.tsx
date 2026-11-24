import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { countInUnit, groupedNote, nothingToImportHint, rowLabel, spellDate, undoneSentence } from "./importModel";
import { type StepCheckProps, useStepCheckLogic, Amber, Group } from "./StepCheck.parts/UseStepCheckLogic";
import { ReadyTable, Amount, FailedGroup } from "./StepCheck.parts/FailedGroup";
export type { StepCheckProps } from "./StepCheck.parts/UseStepCheckLogic";

export function StepCheck({
  kind,
  filename,
  csv,
  preview,
  mapping,
  dateOrder,
  totalsAre,
  sourceId,
  includeKeys,
  onToggle,
  onBack,
  onFinish,
}: StepCheckProps) {
  const {
    done,
    undone,
    unit,
    refusal,
    undo,
    runUndo,
    counts,
    canImport,
    f,
    listId,
    included,
    commit,
    runCommit,
    willLand,
  } = useStepCheckLogic({ kind, filename, csv, preview, mapping, dateOrder, totalsAre, sourceId, includeKeys, onToggle });

  // ── The receipt ──────────────────────────────────────────────────────────
  if (done !== null) {
    return (
      <div className="space-y-4">
        <div className="flex items-start gap-2.5 rounded-lg bg-[color:var(--pl-recessed)] p-3">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div>
            <p className="t-body font-medium">{done.sentence}</p>
            <p className="mt-0.5 t-secondary text-muted-foreground">
              From <span className="text-foreground">{filename}</span>.
            </p>
          </div>
        </div>

        {done.failed > 0 && (
          <FailedGroup
            headers={preview.headers}
            failures={done.failures}
            total={done.failed}
            filename={filename}
          />
        )}

        {undone !== null && (
          <div
            role="status"
            className="rounded-lg bg-[color:var(--pl-recessed)] p-3 t-secondary text-muted-foreground"
          >
            {/* The same sentence Settings prints days later — see
                `undoneSentence`. It was written twice and the two had already
                drifted apart. */}
            {undoneSentence({
              removed: undone.removed,
              kept: undone.kept,
              keptNames: undone.keptNames,
              kind,
              unit,
            })}
          </div>
        )}

        {refusal !== null && <Amber>{refusal}</Amber>}

        <div className="flex flex-wrap justify-end gap-2">
          {undone === null && (
            <Button variant="outline" disabled={undo.isPending} onClick={() => runUndo(done.batchId)}>
              {undo.isPending ? "Undoing…" : "Undo this import"}
            </Button>
          )}
          <Button onClick={onFinish}>Done</Button>
        </div>
      </div>
    );
  }

  // ── What will happen ─────────────────────────────────────────────────────
  const readRows = preview.ready.length + preview.skipped.length + preview.failed.length;

  return (
    <div className="space-y-4">
      <div>
        <p className="t-body font-medium">Here's what will happen.</p>
        <p className="t-secondary text-muted-foreground">
          Nothing is saved until you press Import — and you can undo the whole thing afterwards.
        </p>
      </div>

      {/*
        Three counts, all neutral. The number is the foreground ink and the words
        under it are muted; no count is green and none is red, because none of
        them is money. `counts` is the server's EXACT tally — never
        `preview.ready.length`, which stops at 200, so a file with 250 failures
        says 250 here and shows the first 200 below.
      */}
      <div className="grid grid-cols-3 gap-2">
        <Count figure={countInUnit(counts.ready, unit)} label="ready" />
        <Count
          figure={counts.skipped.toLocaleString("en-US")}
          label="look like ones you already have"
        />
        <Count figure={counts.failed.toLocaleString("en-US")} label="couldn't be read" />
      </div>

      {/*
        It explains the grouping and stops there. It used to add "Every count on
        this screen is in orders", which is not true of the third one: a row the
        parser could not read is counted once per ROW while a group the ledger
        refused is counted once per GROUP, so "couldn't be read" mixes the two.
        The ready tile carries its own noun — "282 orders" — and the other two
        are bare numbers under their own words, which claims nothing untrue.
      */}
      {preview.grouped && (
        <p className="t-micro text-muted-foreground">{groupedNote(preview.sourceRowCount)}</p>
      )}

      {/*
        The "nothing will land" hint YIELDS to a failed commit, because the two
        give opposing advice about the same control and only one of them knows
        what just happened.

        They meet whenever a commit fails on a file with nothing ready: the ticks
        that made it importable come off, `canImport` goes false, and this line
        appears saying "Tick anything you want to bring in anyway" — directly
        above the refusal saying "tick it back in ONLY IF it didn't land". That
        pairing can only occur because the ticks were just removed, so the
        refusal is always the one with the newer fact and the right caveat. It
        also sits beside the button it is about, which this line is not.

        Nothing is lost by yielding. Ticking a row back in makes the file
        importable, so this line would have gone anyway; and going Back to change
        how the file is read remounts this screen with no refusal on it, which is
        where the hint belongs.
      */}
      {!canImport && refusal === null && <Amber>{nothingToImportHint(counts)}</Amber>}

      {readRows > 0 && (
        <div className="space-y-2">
          <Group
            title="Ready"
            count={counts.ready}
            shown={preview.ready.length}
            startOpen
            empty="Nothing in this file is ready to go in yet."
          >
            <ReadyTable kind={kind} rows={preview.ready} f={f} grouped={preview.grouped} />
          </Group>

          {/*
            Open when nothing will land, because that is when the amber line
            above names a control — "tick anything you want to bring in anyway",
            "download the rows below" — and both of them live in THESE two
            groups. Ready has `startOpen` and Ready is empty in exactly that
            case, so the hint was pointing at a closed fold. `Group` opens only
            when it has rows, so an empty one still stays shut.
          */}
          <Group
            title="Already have these"
            count={counts.skipped}
            shown={preview.skipped.length}
            startOpen={!canImport}
            empty="Nothing here looks like a repeat."
          >
            <p className="t-micro text-muted-foreground">
              We set these aside because they look like things already in your books. Tick any you
              want brought in anyway.
            </p>
            <ul className="mt-2 space-y-1.5">
              {preview.skipped.map((row, position) => (
                <li key={row.key} className="flex items-start gap-2">
                  {/*
                    The id is the ROW'S POSITION, never its key. A transaction
                    group's key is built out of the file's own Order ID, so a
                    file numbering its orders "INV 2026 01" would put a space in
                    an `id` — invalid, and `htmlFor` then matches nothing, so the
                    whole line stops toggling the box beside it and only the box
                    itself works. `useId` keeps it unique to this dialog.
                  */}
                  <input
                    id={`${listId}-${position}`}
                    type="checkbox"
                    className="mt-1 shrink-0"
                    checked={includeKeys.includes(row.key)}
                    onChange={(event) => onToggle(row.key, event.target.checked)}
                  />
                  <label htmlFor={`${listId}-${position}`} className="min-w-0 flex-1 cursor-pointer">
                    <span className="t-secondary">
                      {row.occurredOn !== null && (
                        <span className="text-muted-foreground">
                          {spellDate(row.occurredOn) ?? row.occurredOn} ·{" "}
                        </span>
                      )}
                      {row.description}
                      {row.detail !== null && (
                        <span className="text-muted-foreground"> · {row.detail}</span>
                      )}
                      {/*
                        The SAME figure as the Ready table two blocks up, drawn
                        the same way. It was `f.moneyCents` — magnitude only, in
                        neutral ink — so a cost read as a bare positive amount on
                        the one list whose rows the owner can tick and land.
                        `direction` is never null for a money row (the contract
                        guarantees it for `transactions`), so there is nothing to
                        withhold.

                        Drawn the same way, but NOT wearing `t-num`. This figure
                        sits inside a running sentence with nothing underneath it
                        to line up with, and `t-num` is a mono face as well as
                        tabular figures — so it swapped typeface mid-sentence to
                        buy an alignment that does not exist here (DESIGN.md §7,
                        the same call `ImportHistory`'s `Figure` makes). The
                        Ready table below keeps it: that is a real column.
                      */}
                      {row.amountCents !== null && (
                        <>
                          {" · "}
                          <Amount cents={row.amountCents} direction={row.direction} f={f} />
                        </>
                      )}
                    </span>
                    {/* The reason beside the row, in the server's own words. */}
                    <span className="block t-micro text-[color:var(--pl-amber)]">
                      {row.skipReason} · {rowLabel(row.rowNumbers)}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </Group>

          <Group
            title="Couldn't read"
            count={counts.failed}
            shown={preview.failed.length}
            startOpen={!canImport}
            empty="We could read every row."
          >
            <FailedGroup
              headers={preview.headers}
              failures={preview.failed}
              total={counts.failed}
              filename={filename}
              bare
            />
          </Group>
        </div>
      )}

      {refusal !== null && <Amber>{refusal}</Amber>}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="t-secondary text-muted-foreground">
          {included.length > 0 && `${included.length} ticked back in.`}
        </p>
        <div className="flex gap-2">
          <Button variant="outline" disabled={commit.isPending} onClick={onBack}>
            Back
          </Button>
          {/*
            Disabled rather than hidden when nothing would land: a button that
            vanishes leaves the owner wondering where it went, and the amber line
            above already says why this one cannot be pressed.
          */}
          <Button disabled={!canImport || commit.isPending} onClick={runCommit}>
            {commit.isPending
              ? "Importing…"
              : canImport
                ? `Import ${countInUnit(willLand, unit)}`
                : "Nothing to import"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** One of the three counts. Neutral ink, because a count is not money. */
function Count({ figure, label }: { figure: string; label: string }) {
  return (
    <div className="rounded-lg bg-[color:var(--pl-recessed)] p-3">
      <p className="t-section font-semibold">{figure}</p>
      <p className="t-micro text-muted-foreground">{label}</p>
    </div>
  );
}
