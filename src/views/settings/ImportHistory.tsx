import { useRef, useState, type ReactNode } from "react";
import type { ImportBatchShape, ImportKindShape } from "@workspace/api-contract";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { apiErrorMessage, useImportBatches, useUndoImport } from "@/api/hooks";
import { figureState, figureStateSentence } from "@/lib/figureState";
import { IMPORT_KIND_COPY } from "@/views/imports/ImportDialog";
import { undoneSentence } from "@/views/imports/importModel";

/**
 * What you imported, and the way back out.
 *
 * The four Import buttons are the way in; this is the only place that answers
 * "what did I already bring in, and how do I take it back out?" once the dialog
 * that made it has been shut.
 *
 * ── Two things it does differently from the check screen ──────────────────
 *
 * **It asks first.** On the check screen Undo sits seconds after the import,
 * with the figures still on the page — the owner is undoing something they are
 * looking at. Here it may be days later, they are reading a filename rather than
 * a set of totals, and pressing it voids real money or puts away rows they may
 * be using. So it goes through the same confirm the rest of Settings uses for
 * anything that cannot be walked back.
 *
 * **It keeps the answer.** `keptNames` is a list of rows the undo deliberately
 * left alone, each one a thing the owner may have to deal with by hand — so it
 * stays on the page until they leave it or undo something else, rather than
 * flashing past in a toast. "We took 40 out and left 2 alone" with no names is
 * the dead end this whole feature exists to avoid.
 *
 * It renders a fragment of rows, not a panel: Settings drops it inside its own
 * `Section`, which supplies the panel, the title and the hairlines between rows,
 * so the block looks like the rest of the page rather than a bolt-on. Reaching
 * across for `Section` itself would have made the import circular.
 */

/** What an undo did, held against the batch it did it to. */
type UndoOutcome = { batchId: string; removed: number; kept: number; keptNames: string[] };

export function ImportHistory() {
  const batches = useImportBatches();
  const undo = useUndoImport();

  /**
   * The batch the confirm is asking about, and whether it is showing.
   *
   * Two pieces of state rather than one nullable, because the dialog fades out
   * over 200ms: clearing the batch on close would blank the sentence explaining
   * what Undo does while the owner is still looking at it. The batch is left
   * standing after close and simply not read again until the next one replaces
   * it.
   */
  const [confirming, setConfirming] = useState<ImportBatchShape | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [outcome, setOutcome] = useState<UndoOutcome | null>(null);
  const [refusal, setRefusal] = useState<{ batchId: string; message: string } | null>(null);

  /**
   * One undo in flight, held where a second click can see it IMMEDIATELY.
   *
   * A ref and not `undo.isPending`, because pending is state: it is true only
   * after React has re-rendered, and the whole problem is the pair of clicks
   * that land before that. The dialog is still mounted and still clickable
   * through its 200ms fade, so both of them arrive.
   *
   * The money survived either way — both halves of the undo skip what is
   * already void or archived — but the SENTENCE did not. The second request
   * finds nothing left to undo and comes back `removed: 0`, and whichever
   * answer lands last is the one written down, so an owner could be told
   * "0 rows taken back out" about an undo that took two out and go looking for
   * rows that are already gone.
   *
   * `StepCheck.tsx` carries the same guard for the same reason. Two copies on
   * purpose: a ref and two callbacks do not belong in `importModel.ts`, which is
   * plain functions over plain values with no React in it.
   */
  const undoing = useRef(false);

  const rows = batches.data ?? [];
  const state = figureState(batches, rows.length > 0);

  function runUndo(batch: ImportBatchShape) {
    if (undoing.current) return;
    undoing.current = true;
    // Whatever the last undo said was about a different import. Clearing both
    // first means a failure cannot leave the previous success sitting under it
    // reading as this one's result.
    setOutcome(null);
    setRefusal(null);
    undo.mutate(batch.id, {
      onSuccess: (result) =>
        setOutcome({
          batchId: batch.id,
          removed: result.removed,
          kept: result.kept,
          keptNames: result.keptNames,
        }),
      onError: (err) =>
        setRefusal({
          batchId: batch.id,
          message: apiErrorMessage(err, "We couldn't undo that import."),
        }),
      // Released on the answer, not on success: a refused undo is one the owner
      // may reasonably try again.
      onSettled: () => {
        undoing.current = false;
      },
    });
  }

  if (state === "loading") {
    return <p className="px-5 py-4 t-secondary text-muted-foreground">Looking up what you've imported…</p>;
  }

  // Amber, never red: a list that did not arrive is not money lost (DESIGN.md §9).
  if (state === "offline" || state === "failed") {
    return (
      <div className="px-5 py-4">
        <Amber>{figureStateSentence(state, "your past imports")}</Amber>
        {state === "failed" && (
          <Button variant="secondary" size="sm" className="mt-3" onClick={() => batches.refetch()}>
            Try again
          </Button>
        )}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <p className="px-5 py-4 t-secondary text-muted-foreground">
        You haven't imported a spreadsheet yet. When you do, it will be listed here — and you can
        take the whole thing back out from this page.
      </p>
    );
  }

  return (
    <>
      {rows.map((batch) => {
        /*
         * Undone the moment THIS SCREEN was told so, not when the list catches
         * up. `status` only flips when the `["import-batches"]` refetch lands —
         * a whole extra round trip after the answer — and on a slow connection
         * that gap is long enough for the owner to read the success sentence,
         * press Undo again on a row that still looks applied, and be told it
         * has already been undone.
         */
        const undone = batch.status === "undone" || outcome?.batchId === batch.id;
        const pending = undo.isPending && undo.variables === batch.id;
        return (
          <div key={batch.id} className="px-5 py-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p
                  className={
                    undone
                      ? "t-body truncate text-muted-foreground line-through"
                      : "t-body truncate text-foreground"
                  }
                >
                  {batch.filename}
                </p>
                <p className="mt-0.5 t-micro text-muted-foreground">
                  {sentenceCase(IMPORT_KIND_COPY[batch.kind].noun)} · {when(batch.createdAt)}
                </p>
                {/* Counts, not money — neutral ink, no sign, no green or red. */}
                <p className="mt-1 t-micro text-muted-foreground">
                  <Figure n={batch.createdCount} /> imported · <Figure n={batch.skippedCount} />{" "}
                  skipped · <Figure n={batch.failedCount} /> couldn't be read
                </p>
              </div>

              <div className="shrink-0">
                {undone ? (
                  <span className="t-micro text-muted-foreground">
                    Undone{batch.undoneAt ? ` ${when(batch.undoneAt)}` : ""}
                  </span>
                ) : (
                  /*
                   * `secondary`, not `outline`. The outline variant fills with
                   * `--pl-surface`, which is exactly what a card is made of —
                   * on the page plane that reads as a raised pill, but INSIDE a
                   * panel it resolves to the panel's own colour and the control
                   * vanishes into plain text. Measured, not guessed: both came
                   * back `--pl-surface`'s dark value. `secondary` is the
                   * recessed fill, which separates from a card in both themes.
                   */
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={undo.isPending}
                    onClick={() => {
                      setConfirming(batch);
                      setConfirmOpen(true);
                    }}
                  >
                    {pending ? "Undoing…" : "Undo"}
                  </Button>
                )}
              </div>
            </div>

            {outcome?.batchId === batch.id && (
              <p
                role="status"
                className="mt-3 rounded-lg bg-[color:var(--pl-recessed)] p-3 t-secondary text-muted-foreground"
              >
                {undoneSentence({
                  removed: outcome.removed,
                  kept: outcome.kept,
                  keptNames: outcome.keptNames,
                  kind: batch.kind,
                  // Rows, always. A history row carries no unit — the file that
                  // made it is long gone — and "rows" is the word the import
                  // flow used on the way in.
                  unit: "rows",
                })}
              </p>
            )}

            {refusal?.batchId === batch.id && (
              <div className="mt-3">
                <Amber>{refusal.message}</Amber>
              </div>
            )}
          </div>
        );
      })}

      {/* Same confirm shape as Load Demo and Erase Everything, for the same
          reason: it changes the books and there is no button that changes them
          back. */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Undo this import?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirming && <>{undoWarning(confirming.kind)} This can't be reversed from here.</>}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              // Belt and braces, and the belt is in `runUndo`. This disables on
              // the next render; the guard there is what catches the second
              // click that lands before it.
              disabled={undo.isPending}
              onClick={() => {
                if (confirming) runUndo(confirming);
                setConfirmOpen(false);
              }}
            >
              Undo the import
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ---------------------------------------------------------------------------

/** Amber, never red — a thing about the DATA, not money lost (DESIGN.md §9). */
function Amber({ children }: { children: ReactNode }) {
  return (
    <p
      role="status"
      className="rounded-lg bg-[color:var(--pl-amber-tint)] p-3 t-secondary text-[color:var(--pl-amber)]"
    >
      {children}
    </p>
  );
}

/**
 * One of the three counts. Darker than the words around it so it can be scanned,
 * and deliberately NOT `tabular-nums`: these sit inside a sentence, not in a
 * column, and nothing below them has to line up (DESIGN.md §7).
 */
function Figure({ n }: { n: number }) {
  return <span className="text-foreground">{n.toLocaleString("en-US")}</span>;
}

/** "14 Sep 2026, 10:32" — in the reader's own locale, not the server's. */
function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function sentenceCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * What pressing Undo will actually do, in the owner's terms — and the two halves
 * really are different. A transaction import is VOIDED (the rows stay, out of
 * every total); a catalogue import is ARCHIVED, and only the rows nothing has
 * used yet. Saying "it will be removed" for either one would be wrong.
 */
function undoWarning(kind: ImportKindShape): string {
  return kind === "transactions"
    ? "The money this file brought in comes back out of every total. Nothing is deleted — those rows stay in your books so you can still see what happened."
    : "What this file added gets put away, out of your lists and pickers. Anything you've already used is left alone.";
}
