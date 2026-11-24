import { useRef, useState } from "react";
import { Download, FileSpreadsheet, FileUp } from "lucide-react";
import type { ImportKindShape, ImportPreviewShape } from "@workspace/api-contract";
import {
  CSV_TOO_BIG_MESSAGE,
  MAX_CSV_BYTES,
  NOT_A_CSV_MESSAGE,
  looksLikeCsvFilename,
  mappingProblem,
  parseCsvTable,
  templateFilename,
} from "@workspace/domain";
import { Button } from "@/components/ui/button";
import { apiErrorCode, apiErrorMessage, useImportPreview } from "@/api/hooks";
import { downloadImportTemplate } from "@/lib/api-helpers/client";
import { cn } from "@/lib/utils";
import type { ImportStep } from "./ImportDialog";
import { isMappingRefusal } from "./importModel";

/**
 * Step one: the two doors into an import.
 *
 * Either the owner takes our blank sheet, fills it in a spreadsheet and brings
 * it back — in which case the columns already have the right names and the
 * matching step is skipped entirely — or they drop in a bank statement or a
 * marketplace export exactly as it came, and match the columns next.
 *
 * The second door is the one that matters. Every import tool that only offers
 * the first is a tool for people who already knew what shape the file had to be,
 * which is not who this is for.
 */

export interface StepUploadProps {
  kind: ImportKindShape;
  /** The server read the file. The third argument says where to go next. */
  onPreviewed: (
    preview: ImportPreviewShape,
    csv: string,
    filename: string,
    nextStep: ImportStep,
  ) => void;
  /**
   * The server could not guess this file's columns, so there is no preview —
   * only the file, its column names and the reason. See the catch block below.
   */
  onUnguessable: (csv: string, filename: string, headers: string[], reason: string) => void;
}

export function StepUpload({ kind, onPreviewed, onUnguessable }: StepUploadProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [chosen, setChosen] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const runPreview = useImportPreview();

  async function takeTemplate() {
    setDownloading(true);
    try {
      await downloadImportTemplate(kind, templateFilename(kind));
    } catch (err) {
      setProblem(apiErrorMessage(err, "We couldn't fetch the blank sheet just now."));
    } finally {
      setDownloading(false);
    }
  }

  async function take(file: File | undefined) {
    if (!file) return;
    setProblem(null);
    setChosen(file.name);

    /*
     * ── Refused here, before a byte goes up ──────────────────────────────
     *
     * Both rules and both sentences come from the SERVER'S OWN constants, not
     * from numbers typed in again on this side. The cap moved twice during the
     * server work — once because the hosting platform refuses a body smaller
     * than the figure we were advertising, and once because counting characters
     * instead of bytes refused ordinary marketplace exports — and each time, a
     * copy of it in the browser would have started either rejecting files the
     * server would happily take or waving through files it would not.
     *
     * `file.size` is already a byte count, which is the same unit
     * `Buffer.byteLength` gives the server, so the two sides compare the same
     * thing without either converting anything.
     *
     * The server checks both again regardless. This is a courtesy that saves a
     * minute of uploading, never the thing that decides.
     */
    if (!looksLikeCsvFilename(file.name)) {
      setProblem(`${NOT_A_CSV_MESSAGE} Save your sheet as CSV and try again.`);
      return;
    }
    if (file.size > MAX_CSV_BYTES) {
      setProblem(CSV_TOO_BIG_MESSAGE);
      return;
    }

    /*
     * ── Reading the file is caught, not left to escape ───────────────────
     *
     * `file.text()` rejects when the file moved, was renamed, or had its
     * permission revoked between being picked and being read. Uncaught, that
     * rejection escaped a `void`-ed call as an unhandled promise rejection —
     * nothing caught it, nothing was shown, and the owner was left looking at
     * "Chosen: sales.csv" with no explanation and no next step.
     *
     * Its own catch rather than the big one below, because the browser's own
     * sentence for this ("typically due to permission problems that have
     * occurred after a reference to a file was acquired") is not one to show
     * anybody, and because the thing to do about it is different: pick the file
     * again.
     */
    let csv: string;
    try {
      csv = await file.text();
    } catch {
      setProblem(
        "We couldn't open that file — it may have been moved or renamed since you picked it. Try choosing it again.",
      );
      return;
    }

    try {
      // No mapping: this is the ask that lets the SERVER guess the columns. The
      // browser has not looked inside the file at this point and does not need to.
      const preview = await runPreview.mutateAsync({ kind, filename: file.name, csv });

      /*
       * ── The template path's whole advantage ────────────────────────────
       *
       * When the file came from our own blank sheet, its headers are our own
       * labels, so the guess is exact: every column is claimed, nothing was
       * ignored, the dates are unambiguous and there is no totals question to
       * put. There is then nothing on the matching screen for the owner to
       * decide — every dropdown would already be right — so asking them to
       * press Continue through it buys nothing and costs the one thing the
       * blank sheet was meant to save.
       *
       * All five conditions have to hold. An ignored column is a column we did
       * NOT recognise, and skipping past it would drop it silently; an unmapped
       * required field means the file cannot be read at all; an uncertain date
       * order means every day-of-month is 12 or under, so 03/04 could be either
       * March or April and only the owner knows which; and `needsTotalsAnswer`
       * means the file carries an order-level tax, shipping or discount figure
       * that could be per-order or per-line, which changes what lands.
       *
       * ── The date question is transactions-only, so its clause is too ────
       *
       * `dateOrderCertain` is false unless a date column is PRESENT and its own
       * cells settle the reading. Only `transactions` declares a date column at
       * all (`columnsFor` gives revenue_items, expense_items and people none),
       * so on those three kinds `mapping.date` is always undefined, the server's
       * `headerIsPresent` is always false, and the flag is hard-false forever.
       * Unguarded, this clause alone sent three of the four kinds to a matching
       * screen with every dropdown already right and one pointless Continue to
       * press — thirty seconds after the blurb below promised the opposite.
       *
       * Asked on the kind rather than fixed on the server: the server is right
       * to refuse to call an absent column certain, and says so at length
       * (`csvImport.ts` above `dateOrderCertain`). The screen is where the
       * question "is there a date question to put?" belongs, and it is the same
       * answer `StepMatch` already reaches — it looks for a `kind === "date"`
       * column and finds none, so the control never renders on those kinds.
       * There is no question to skip past, so nothing is skipped past.
       *
       * ── And nothing failed ─────────────────────────────────────────────
       *
       * The fifth is not about the mapping, and it is the one that stops this
       * shortcut becoming the dead end the fall-through below exists to
       * prevent. Our own blank sheet has a Channel column, so a template the
       * owner filled in and left that column EMPTY maps perfectly — every
       * header claimed, dates certain, no totals question — and every row still
       * fails with "No channel for this row", because a transaction has to land
       * somewhere. Skipping on the first four alone sent that owner straight to
       * the check step to read "0 ready · 300 we couldn't read" on a screen
       * whose only controls are a tick box and Import. The one control that
       * fixes it — the channel picker — is on the matching step.
       *
       * So: a file with failures goes to the matching step, where every control
       * that can fix a failure lives. A file that read cleanly skips, which is
       * the case the blank sheet was for. Rows SET ASIDE as already-imported are
       * not failures and do not block the skip — "you already have these" is an
       * answer, and the check step is exactly where it is given.
       */
      const readyToSkip =
        preview.ignoredHeaders.length === 0 &&
        mappingProblem(kind, preview.mapping) === null &&
        (kind !== "transactions" || preview.dateOrderCertain) &&
        !preview.needsTotalsAnswer &&
        preview.counts.failed === 0;

      onPreviewed(preview, csv, file.name, readyToSkip ? "check" : "match");
    } catch (err) {
      const said = apiErrorMessage(err, "We couldn't read that file.");

      /*
       * ── A file we cannot match must still reach the matching screen ─────
       *
       * The server refuses a mapping it cannot read the file with BEFORE it
       * parses a row — one sentence instead of three hundred identical row
       * failures, which is right. But that refusal carries no column names, and
       * the matching screen is built out of column names. Left alone, an owner
       * whose bank calls its columns things we have never seen would be told
       * "Tell us which column holds the date" by a screen offering no way to
       * tell us anything. That dead end is the thing this whole flow exists to
       * avoid.
       *
       * So we recover the column names and go to the matching screen with
       * everything unmapped and the reason at the top.
       *
       * Reading the header row here is NOT the browser deciding what the file
       * says. `parseCsvTable` is the SERVER'S OWN function, imported from the
       * domain package both sides share — the same code, not a second reader —
       * and what it produces is used for one thing: labelling dropdowns. The
       * moment the owner picks a column the file goes back to the server and the
       * server's answer is the only one anybody sees.
       *
       * ── Asked of the CODE, not of the sentence ─────────────────────────
       *
       * "Is this that refusal?" used to be answered by comparing the message
       * against the sentence `mappingProblem` writes locally. That was sound
       * only while both sides quoted that one function verbatim — and nothing
       * guarded it. Wrap the message, prefix it, or reword the refusal, and the
       * comparison fails silently: no error, no warning, just the dead end
       * quietly back. `ApiError` already prefixes its own `.message` with "HTTP
       * 400 Bad Request", so the exact match survived only because
       * `apiErrorMessage` happens to prefer the envelope's inner message.
       *
       * The server now marks this one refusal with `IMPORT_MAPPING_UNUSABLE`.
       * Every other way a preview can be refused (too big, too many rows, no
       * rows at all, a channel that is not yours) is a thing no dropdown can
       * fix, carries a different code, and stays here where the owner can pick a
       * different file.
       */
      if (isMappingRefusal(apiErrorCode(err))) {
        onUnguessable(csv, file.name, parseCsvTable(csv).headers, said);
        return;
      }

      setProblem(said);
    }
  }

  return (
    <div className="space-y-4">
      {/* Door one: take the blank sheet. */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-[color:var(--pl-recessed)] p-3">
        <div className="flex items-start gap-2.5">
          <FileSpreadsheet className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div>
            <p className="t-body font-medium">Don't have a file yet?</p>
            <p className="t-secondary text-muted-foreground">
              Start from our blank sheet — fill it in, bring it back, and we'll skip straight to the
              check.
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" className="gap-2" disabled={downloading} onClick={takeTemplate}>
          <Download className="h-4 w-4" />
          {downloading ? "Getting it…" : "Download template"}
        </Button>
      </div>

      {/* Door two: whatever file they already have. */}
      <button
        type="button"
        onClick={() => fileInput.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void take(e.dataTransfer.files?.[0]);
        }}
        disabled={runPreview.isPending}
        className={cn(
          "flex w-full flex-col items-center gap-2 rounded-lg border border-dashed p-8 text-center transition-colors",
          dragging
            ? "border-primary bg-[color:var(--pl-orange-tint)]"
            : "border-border hover:border-primary hover:bg-muted/40",
        )}
      >
        <FileUp className="h-6 w-6 text-muted-foreground" />
        <span className="t-body font-medium">
          {runPreview.isPending ? `Reading ${chosen}…` : "Drop a CSV here, or choose a file"}
        </span>
        <span className="t-secondary text-muted-foreground">
          A bank statement, a Shopify or marketplace export, or anything you've saved as CSV.
        </span>
      </button>
      <input
        ref={fileInput}
        type="file"
        accept=".csv,.txt,text/csv,text/plain"
        className="hidden"
        onChange={(e) => {
          void take(e.target.files?.[0]);
          // Cleared so choosing the SAME file again still fires a change event —
          // otherwise a file corrected in a spreadsheet and re-picked does nothing.
          e.target.value = "";
        }}
      />

      {chosen !== null && !runPreview.isPending && (
        <p className="t-secondary text-muted-foreground">
          Chosen: <span className="text-foreground">{chosen}</span>
        </p>
      )}

      {/*
        Amber, never red. Red means money lost in this app (DESIGN.md §2), and a
        file we could not read is not a loss — it is something about the DATA
        that needs attention, which is exactly what amber already says on the
        People gap strip and on every unloadable figure.
      */}
      {problem !== null && (
        <p
          role="status"
          className="rounded-lg bg-[color:var(--pl-amber-tint)] p-3 t-secondary text-[color:var(--pl-amber)]"
        >
          {problem}
        </p>
      )}

      <p className="t-micro text-muted-foreground">
        Nothing is saved until you've seen exactly what will go in — and you can undo a whole import
        afterwards.
      </p>
    </div>
  );
}
