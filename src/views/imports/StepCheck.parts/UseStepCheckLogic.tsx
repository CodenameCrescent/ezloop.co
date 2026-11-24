import { useId, useState, useRef, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { ImportKindShape, ImportPreviewShape, ImportMappingShape, ImportFailedRowShape } from "@workspace/api-contract";
import type { DateOrder, TotalsMode } from "@workspace/domain";
import { useCommitImport, useUndoImport, apiErrorMessage, apiErrorStatus } from "@/api/hooks";
import { useFormatters } from "@/lib/store";
import { whatLands, commitDateOrder, importedSentence, commitFailedSentence, refusedBeforeWriting } from "../importModel";

/**
 * Step three: what will happen, and the one button that makes it happen.
 *
 * Everything the two screens before this were protecting arrives here. Three
 * honest counts — what is ready, what looks like a repeat, what we could not
 * read — then the rows behind each one, then Import.
 *
 * ── The figure on this screen is the figure that lands ────────────────────
 *
 * Not because they are checked against each other, but because they are the
 * same computation. Commit posts the FILE again, not the rows below, and the
 * server re-reads it through the identical function that produced this preview.
 * The only thing the browser is trusted with is `includeKeys`: a list of
 * decisions the owner made, never a list of figures.
 *
 * So nothing on this screen is added up. There is deliberately no total: the
 * lists are cut to 200 rows for display, so a browser-side sum would be wrong
 * on any long file — and summing money in the UI is forbidden anyway
 * (CLAUDE.md). Every figure shown is one row's own, straight from the server,
 * through `f.moneyCents`.
 *
 * ── Nothing is red ─────────────────────────────────────────────────────────
 *
 * A skipped row is not a loss and an unreadable row is not a loss. Red means
 * money lost in this app (DESIGN.md §2), so the counts are neutral and the two
 * things needing attention wear the amber pair — the same signal the upload and
 * matching steps already use for "something about this DATA needs a look".
 */

export interface StepCheckProps {
  kind: ImportKindShape;
  filename: string;
  /** The file, exactly as read. Sent AGAIN on commit — the rows below are not. */
  csv: string;
  /** The server's picture of what this file would do. Never null on this step. */
  preview: ImportPreviewShape;

  mapping: ImportMappingShape;
  /** The owner's ANSWER, absent until they gave one. See `commitDateOrder`. */
  dateOrder: DateOrder | undefined;
  totalsAre: TotalsMode | undefined;
  sourceId: string | undefined;

  /** Keys off `preview.skipped` the owner ticked back in. */
  includeKeys: string[];
  onToggle: (key: string, include: boolean) => void;

  onBack: () => void;
  /** Done with the whole thing — closes the dialog and clears it. */
  onFinish: () => void;
}

/** StepCheck's state and handlers, kept out of its render so each file stays short. */
export function useStepCheckLogic({
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
}: Pick<StepCheckProps, "kind" | "filename" | "csv" | "preview" | "mapping" | "dateOrder" | "totalsAre" | "sourceId" | "includeKeys" | "onToggle">) {
  const f = useFormatters();
  const commit = useCommitImport();
  const undo = useUndoImport();
  /** Prefix for the tick boxes' ids — see the list below for why not the key. */
  const listId = useId();

  /** What the server said it did. Set once, and this screen becomes the receipt. */
  const [done, setDone] = useState<
    { batchId: string; sentence: string; failures: ImportFailedRowShape[]; failed: number } | null
  >(null);
  /** What the server said when it took it back out. */
  const [undone, setUndone] = useState<{
    removed: number;
    kept: number;
    keptNames: string[];
  } | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);

  /**
   * One undo in flight, held where a second click can see it IMMEDIATELY.
   *
   * A ref and not `undo.isPending`: pending is state, true only after a render,
   * and the pair of clicks this is about both land before that one happens.
   *
   * The money is safe — `voidTransaction` returns untouched on a row that is
   * already void, and the catalogue half skips what is already archived — but
   * the sentence is not. The second request re-reads the ledger AFTER the first
   * voided it, finds nothing left and answers `removed: 0`, and the answer that
   * lands last is the one written down. So a double-clicked receipt could read
   * "Undone — 0 rows taken back out." directly under "2 rows imported." If the
   * batch's own status lands first instead, the second is refused and the amber
   * "already been undone" renders under the success line.
   *
   * The same guard sits in `ImportHistory.tsx`, deliberately copied rather than
   * shared: it is a ref and two callbacks, and `importModel.ts` — where the two
   * screens' shared sentence lives — is plain functions over plain values with
   * no React in it, tested under node:test. This does not go there.
   */
  const undoing = useRef(false);

  const { counts, unit } = preview;
  const { included, willLand, canImport } = whatLands({
    readyCount: counts.ready,
    skippedShown: preview.skipped,
    includeKeys,
  });

  function runCommit() {
    setRefusal(null);
    commit.mutate(
      {
        kind,
        filename,
        csv,
        mapping,
        // The owner's answer, or the reading they were actually shown.
        dateOrder: commitDateOrder(dateOrder, preview),
        totalsAre,
        sourceId,
        includeKeys: included,
      },
      {
        onSuccess: (result) =>
          setDone({
            batchId: result.batch.id,
            sentence: importedSentence(result.counts, unit),
            /*
             * The COMMIT'S failures, not the preview's. Commit re-read the file,
             * so a row that failed here is not guaranteed to be one that failed
             * there — and a group the ledger refused at the moment money was
             * written never appeared on the check screen at all. "18 didn't
             * import" with nothing about which or why is a dead end for someone
             * who cannot read a log.
             */
            failures: result.failures,
            failed: result.counts.failed,
          }),
        /*
         * The ticks come off, and the sentence says both halves of why.
         *
         * The write is not atomic — see `commitFailedSentence`, which carries
         * the whole reasoning — so a failure can leave real money behind it, and
         * a ticked-back-in row is the one thing a second attempt would write
         * AGAIN rather than re-detect as a duplicate. Unticking them here is
         * what makes the retry safe; `included` is the exact list that was
         * posted, so the count in the sentence is the count that came off.
         *
         * The ordinary path is untouched: a commit that succeeds never reaches
         * here, and the screen becomes a receipt.
         *
         * The "may already have been saved" half of that sentence is dropped
         * when the server turned the commit away before writing anything — the
         * import lock already held, a file it will not take — because on those
         * the warning is simply false. `refusedBeforeWriting` reads the STATUS
         * for that, never the message or the code; it carries why.
         */
        onError: (err) => {
          const forced = included;
          for (const key of forced) onToggle(key, false);
          setRefusal(
            commitFailedSentence(
              apiErrorMessage(err, "We couldn't finish that import."),
              forced.length,
              unit,
              refusedBeforeWriting(apiErrorStatus(err)),
            ),
          );
        },
      },
    );
  }

  function runUndo(batchId: string) {
    if (undoing.current) return;
    undoing.current = true;
    setRefusal(null);
    undo.mutate(batchId, {
      onSuccess: (result) =>
        setUndone({ removed: result.removed, kept: result.kept, keptNames: result.keptNames }),
      onError: (err) => setRefusal(apiErrorMessage(err, "We couldn't undo that import.")),
      // Released on the answer, not on success: a refused undo is one the owner
      // may reasonably try again, and the button is still there to try it with.
      onSettled: () => {
        undoing.current = false;
      },
    });
  }

  return {
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
  };
}

// ---------------------------------------------------------------------------

/** Amber, never red — a thing about the DATA, not money lost. */
export function Amber({ children }: { children: ReactNode }) {
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
 * A foldable group.
 *
 * `<details>` rather than a hand-rolled panel: the browser gives the open/close
 * state, the keyboard and the screen-reader announcement for free, and it
 * animates nothing — so there is no motion for `prefers-reduced-motion` to have
 * to switch off (DESIGN.md §6).
 *
 * `count` is the server's exact figure and `shown` is how many rows are in
 * hand. When they differ, the group says so rather than letting a capped list
 * read as the whole story.
 *
 * Drawn with no frame, which is DESIGN.md §1 — surfaces separate by VALUE, not
 * by a line — so the spacing between the three does the separating. It had a
 * `border-card-border` until this was checked: that token is `transparent` in
 * both themes, so the class was a line that never appeared anywhere, and a
 * decorative class nobody can see is worse than none at all.
 */
export function Group({
  title,
  count,
  shown,
  startOpen = false,
  empty,
  children,
}: {
  title: string;
  count: number;
  shown: number;
  startOpen?: boolean;
  empty: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(startOpen && count > 0);
  return (
    <details
      open={open}
      onToggle={(event) => setOpen((event.currentTarget as HTMLDetailsElement).open)}
      className="rounded-lg"
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg p-3 hover:bg-[color:var(--pl-recessed)]">
        {open ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        <span className="t-body font-medium">{title}</span>
        <span className="t-secondary text-muted-foreground">{count.toLocaleString("en-US")}</span>
      </summary>
      <div className="px-3 pb-3">
        {count === 0 ? (
          <p className="t-secondary text-muted-foreground">{empty}</p>
        ) : (
          <>
            {children}
            {shown < count && (
              <p className="mt-2 t-micro text-muted-foreground">
                Showing the first {shown.toLocaleString("en-US")} of {count.toLocaleString("en-US")}.
              </p>
            )}
          </>
        )}
      </div>
    </details>
  );
}
