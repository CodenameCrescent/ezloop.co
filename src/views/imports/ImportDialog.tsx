import { useCallback, useState } from "react";
import type { ImportKindShape, ImportMappingShape, ImportPreviewShape } from "@workspace/api-contract";
import type { DateOrder, TotalsMode } from "@workspace/domain";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StepCheck } from "./StepCheck";
import { StepMatch } from "./StepMatch";
import { StepUpload } from "./StepUpload";
import { answersForNewFile, type OwnerAnswers } from "./importModel";

/**
 * Bringing a spreadsheet in.
 *
 * Three steps and one promise: YOU SEE IT BEFORE IT HAPPENS. Choose a file, say
 * which column is which, then read exactly what will be created — and nothing is
 * written until the last button.
 *
 * ── Who decides what ───────────────────────────────────────────────────────
 *
 * This component decides NOTHING about the file. It holds the owner's ANSWERS —
 * which column is which, which way the dates run, which channel, which
 * already-seen rows to bring in anyway — and every time one of them changes it
 * sends the file back to the server and shows the server's new answer. The
 * browser never adds up money, never decides a row is a duplicate, and never
 * parses the file to say what is in it.
 *
 * That is not fussiness. Commit re-reads the same file through the same code the
 * preview ran, so the figure on the check screen and the figure in the ledger
 * are the same figure rather than two that happen to agree today. A browser-side
 * shortcut anywhere in here would break that quietly.
 */

/**
 * What each kind is called on screen.
 *
 * `transactions`, `revenue_items` and the rest are the machine's words. The
 * owner reads "Sales & costs". Exported because the import history in Settings
 * names the same four things and two lists of names would drift.
 */
export const IMPORT_KIND_COPY: Record<
  ImportKindShape,
  { title: string; noun: string; blurb: string }
> = {
  transactions: {
    title: "Import sales & costs",
    noun: "sales & costs",
    blurb: "A bank statement, a marketplace export, or our blank sheet filled in.",
  },
  revenue_items: {
    title: "Import things you sell",
    noun: "things you sell",
    blurb: "Your products, services or plans, with what they cost you to deliver.",
  },
  expense_items: {
    title: "Import your costs",
    noun: "costs",
    blurb: "The costs you carry — rent, software, salaries, materials.",
  },
  people: {
    title: "Import contacts",
    noun: "contacts",
    blurb: "Customers, suppliers and team members from a contacts export.",
  },
};

export type ImportStep = "upload" | "match" | "check";

export interface ImportDialogProps {
  kind: ImportKindShape;
  open: boolean;
  onClose: () => void;
}

export function ImportDialog({ kind, open, onClose }: ImportDialogProps) {
  const [step, setStep] = useState<ImportStep>("upload");

  // The file, exactly as it was read. Sent whole on every preview and again on
  // commit — never trimmed, never re-serialised from parsed rows.
  const [csv, setCsv] = useState("");
  const [filename, setFilename] = useState("");

  // The server's last answer, or null when it refused the file outright.
  const [preview, setPreview] = useState<ImportPreviewShape | null>(null);

  /**
   * The file's column names.
   *
   * Held APART from `preview` because there is one case where we have these and
   * no preview at all: the server refuses a mapping it cannot make sense of
   * before it reads a single row, and that refusal carries no headers. Without
   * somewhere to keep them, the matching step would have nothing to build its
   * dropdowns from and the owner would be told "we can't read this" with no way
   * to correct it. See `StepUpload` for how they are recovered.
   */
  const [headers, setHeaders] = useState<string[]>([]);

  /**
   * Why the server could not get started, shown at the top of the matching step.
   * Null on the ordinary path, where there was nothing to refuse.
   */
  const [refusal, setRefusal] = useState<string | null>(null);

  /*
   * ── The owner's answers ──────────────────────────────────────────────────
   *
   * Held here rather than inside a step, because they outlive the step that
   * asks them: the matching screen sends all of them on every re-preview, and
   * the check screen sends the same set again on commit. A step that owned its
   * own answer would lose it on the way back.
   *
   * The matching and check screens are what read and write these. They outlive a
   * STEP, and deliberately — but they must not outlive the FILE, which is what
   * `answersForNewFile` below is for.
   */
  const [mapping, setMapping] = useState<ImportMappingShape>({});
  /**
   * The owner's ANSWER to the date question, and `undefined` until they give
   * one — which is not the same as "day-first until told otherwise".
   *
   * Seeded from the server's guess, it would have become an answer nobody gave:
   * a file whose columns we could not match starts with nothing mapped, and the
   * moment the owner pointed at a month-first date column we would have sent
   * "day-first" back and overruled what the file plainly said, failing every row
   * with "That date can't exist". Absent, the server infers — which is its job,
   * and it re-infers on every change. The check step sends `preview.dateOrder`
   * when this is still unanswered.
   */
  const [dateOrder, setDateOrder] = useState<DateOrder | undefined>(undefined);
  const [totalsAre, setTotalsAre] = useState<TotalsMode | undefined>(undefined);
  const [sourceId, setSourceId] = useState<string | undefined>(undefined);
  /** Rows the server set aside that the owner ticked back in. Decisions, not figures. */
  const [includeKeys, setIncludeKeys] = useState<string[]>([]);

  /**
   * Start over on a file: the server's guessed mapping, and no answer to
   * anything else.
   *
   * ONE place, used by every route in and out of a file, so "a new file starts
   * with nothing carried over" cannot be true of three of them and forgotten on
   * the fourth. `answersForNewFile` carries the reasoning.
   */
  const startFile = useCallback((answers: OwnerAnswers) => {
    setMapping(answers.mapping);
    setDateOrder(answers.dateOrder);
    setTotalsAre(answers.totalsAre);
    setSourceId(answers.sourceId);
    setIncludeKeys(answers.includeKeys);
  }, []);

  const reset = useCallback(() => {
    setStep("upload");
    setCsv("");
    setFilename("");
    setPreview(null);
    setHeaders([]);
    setRefusal(null);
    startFile(answersForNewFile({}));
  }, [startFile]);

  /**
   * The server read the file. Take its guesses as the starting answers — and
   * ONLY its guesses.
   *
   * The upload step asked with no answers attached, so this preview is a picture
   * of the guessed mapping and of nothing else. Anything the owner told us about
   * the file before this one is about a file that is no longer on screen, and
   * leaving it standing is how a channel they picked for file A ends up
   * overriding file B's own Channel column on a screen that says the figures in
   * front of them are the figures that will land.
   */
  const onPreviewed = useCallback(
    (next: ImportPreviewShape, text: string, name: string, nextStep: ImportStep) => {
      setCsv(text);
      setFilename(name);
      setPreview(next);
      setHeaders(next.headers);
      setRefusal(null);
      startFile(answersForNewFile(next.mapping));
      setStep(nextStep);
    },
    [startFile],
  );

  /**
   * A fresh answer from the matching step. Replaces the server's picture and
   * NOTHING else: the mapping, the date order and the rest are the owner's, and
   * feeding the response back into them would undo the change that caused it.
   */
  const onRepreviewed = useCallback((next: ImportPreviewShape) => {
    setPreview(next);
    setHeaders(next.headers);
    setRefusal(null);
  }, []);

  /**
   * The server could not guess this file's columns. Go to the matching step
   * anyway, with everything unmapped and the reason stated — the owner has the
   * one thing that fixes it, and it is a dropdown away.
   */
  const onUnguessable = useCallback(
    (text: string, name: string, fileHeaders: string[], reason: string) => {
      setCsv(text);
      setFilename(name);
      setPreview(null);
      setHeaders(fileHeaders);
      setRefusal(reason);
      // Nothing was guessed, so there is not even a mapping to start from — and
      // the previous file's answers go for the same reason they do above.
      startFile(answersForNewFile({}));
      setStep("match");
    },
    [startFile],
  );

  /**
   * One skipped row ticked back in, or unticked again.
   *
   * A list of DECISIONS, which is the one thing the browser is trusted with on
   * commit. Never a list of rows and never a list of figures.
   */
  const toggleInclude = useCallback((key: string, include: boolean) => {
    setIncludeKeys((keys) => {
      if (include) return keys.includes(key) ? keys : [...keys, key];
      return keys.filter((held) => held !== key);
    });
  }, []);

  /** Shut the whole thing and forget it, from the inside or from the corner X. */
  const finish = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  const copy = IMPORT_KIND_COPY[kind];

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) finish();
      }}
    >
      <DialogContent className="max-h-[88vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.blurb}</DialogDescription>
        </DialogHeader>

        {step === "upload" && (
          <StepUpload kind={kind} onPreviewed={onPreviewed} onUnguessable={onUnguessable} />
        )}

        {/*
          The matching step, and ALSO the check step with nothing to check.
          Neither route into "check" can get there without a preview — the upload
          step only skips ahead when the server answered, and Continue is blocked
          while there is none — but if one ever did, the screen that can go and
          fetch one is the right place to land. An empty panel is the dead end
          this whole flow is built against.
        */}
        {(step === "match" || (step === "check" && preview === null)) && (
          <StepMatch
            kind={kind}
            filename={filename}
            csv={csv}
            preview={preview}
            headers={headers}
            refusal={refusal}
            mapping={mapping}
            onMappingChange={setMapping}
            dateOrder={dateOrder}
            onDateOrderChange={setDateOrder}
            totalsAre={totalsAre}
            onTotalsAreChange={setTotalsAre}
            sourceId={sourceId}
            onSourceIdChange={setSourceId}
            onPreviewed={onRepreviewed}
            onBack={() => setStep("upload")}
            onContinue={() => setStep("check")}
          />
        )}

        {step === "check" && preview !== null && (
          <StepCheck
            kind={kind}
            filename={filename}
            csv={csv}
            preview={preview}
            mapping={mapping}
            dateOrder={dateOrder}
            totalsAre={totalsAre}
            sourceId={sourceId}
            includeKeys={includeKeys}
            onToggle={toggleInclude}
            onBack={() => setStep("match")}
            onFinish={finish}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
