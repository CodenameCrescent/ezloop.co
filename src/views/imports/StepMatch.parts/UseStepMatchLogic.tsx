import { useState, useMemo, useRef, useEffect } from "react";
import { toast } from "sonner";
import type { ImportKindShape, ImportPreviewShape, ImportMappingShape } from "@workspace/api-contract";
import { type DateOrder, type TotalsMode, columnsFor, mappingProblem, ignoredHeadersFor, cellsOf, parseCsvTable } from "@workspace/domain";
import { useImportPreview, useSources, useCreateSource, apiErrorMessage } from "@/api/hooks";
import { channelNameFromFilename, answersSignature, isCurrentRequest, NOT_IN_FILE, dateQuestion, ambiguousDateCell, dateReading, channelAnswer, continueBlocked } from "../importModel";

/**
 * Step two: the screen where the owner fixes what we guessed.
 *
 * Their file says "Transaction Date"; we think that means our Date field. This
 * shows the guess and lets them correct it. Nothing here is clever — the value
 * is entirely in being HONEST about three things:
 *
 *   · Every field we expect, with the column we picked for it, changeable.
 *   · Every column we did NOT recognise, named. A column that vanishes without
 *     explanation is how somebody wonders where their data went.
 *   · The questions the file genuinely cannot answer, asked out loud rather
 *     than guessed at — which way the dates run, which channel these landed in,
 *     and whether an order-level figure covers the order or each item.
 *
 * ── This screen decides nothing about the file ────────────────────────────
 *
 * Every control here changes an ANSWER and sends the file back to the server,
 * which re-reads it from scratch and returns the whole picture again. The
 * browser never parses a row to say what is in it, never adds anything up, and
 * never decides a row is ready. Two things it does read out of the file are
 * labels and nothing else: the list of unused columns (so it can update the
 * instant a dropdown moves rather than a request later), and one date cell to
 * quote back in the date question. Both use the SERVER'S OWN functions from the
 * shared domain package, so they are the same code rather than a second reader.
 */

export interface StepMatchProps {
  kind: ImportKindShape;
  filename: string;
  /** The file, exactly as read. Sent whole on every re-preview. */
  csv: string;
  /**
   * The server's last answer, or null when it refused before reading a row —
   * which is the case this screen exists to rescue.
   */
  preview: ImportPreviewShape | null;
  /** The file's columns. From the preview, or recovered when there is none. */
  headers: string[];
  /** Why the server could not get started. Null on the ordinary path. */
  refusal: string | null;

  mapping: ImportMappingShape;
  onMappingChange: (mapping: ImportMappingShape) => void;
  /** The owner's ANSWER, absent until they give one — the file's own reading otherwise. */
  dateOrder: DateOrder | undefined;
  onDateOrderChange: (order: DateOrder) => void;
  totalsAre: TotalsMode | undefined;
  onTotalsAreChange: (mode: TotalsMode) => void;
  sourceId: string | undefined;
  onSourceIdChange: (sourceId: string | undefined) => void;

  /** A fresh answer arrived. Replaces the preview; never touches the answers above. */
  onPreviewed: (preview: ImportPreviewShape) => void;
  onBack: () => void;
  onContinue: () => void;
}

/** Long enough that typing through a list of columns sends one request, not ten. */
export const REPREVIEW_DELAY_MS = 300;

/** StepMatch's state and handlers, kept out of its render so each file stays short. */
export function useStepMatchLogic({
  kind,
  filename,
  csv,
  preview,
  headers,
  mapping,
  onMappingChange,
  dateOrder,
  totalsAre,
  sourceId,
  onSourceIdChange,
  onPreviewed,
}: Pick<StepMatchProps, "kind" | "filename" | "csv" | "preview" | "headers" | "mapping" | "onMappingChange" | "dateOrder" | "totalsAre" | "sourceId" | "onSourceIdChange" | "onPreviewed">) {
  const runPreview = useImportPreview();
  const sources = useSources();
  const createSource = useCreateSource();

  /** Set when the server refused the answers as they now stand. */
  const [serverSaid, setServerSaid] = useState<string | null>(null);
  const [addingChannel, setAddingChannel] = useState(false);
  const [newChannel, setNewChannel] = useState(() => channelNameFromFilename(filename));

  const columns = columnsFor(kind);

  /**
   * Why these answers cannot read the file, asked locally before anything is
   * sent. `mappingProblem` is the SAME function the server refuses with, so the
   * owner reads one sentence rather than two that nearly agree — and a mapping
   * we already know will be refused never costs a round trip to find out.
   */
  const problem = mappingProblem(kind, mapping);
  const unused = useMemo(() => ignoredHeadersFor(headers, mapping), [headers, mapping]);

  // ── Every change re-previews; the server is the only thing that parses ────
  //
  // Keyed on the ANSWERS, never on the preview, or taking the answer would
  // schedule the request that replaces the answer that schedules the request.
  // The signature the incoming preview already represents is remembered on
  // mount, so arriving here does not immediately re-ask what was just asked.
  const answers = answersSignature({ mapping, dateOrder, totalsAre, sourceId });
  const lastSent = useRef<string | null>(preview === null ? null : answers);
  /**
   * The answers the preview ON SCREEN was produced from — which is not the same
   * fact as `lastSent`, the answers the last request went out with. This is what
   * Continue is judged against; see `continueBlocked` for why the difference
   * matters. Arriving here, the preview in hand is the one these answers made.
   */
  const [shownFor, setShownFor] = useState<string | null>(() =>
    preview === null ? null : answers,
  );

  useEffect(() => {
    if (answers === lastSent.current) return;
    // Nothing to send while the mapping cannot read the file: the server would
    // only refuse it, and the sentence is already on screen above the dropdowns.
    if (problem !== null) return;

    const timer = setTimeout(() => {
      // What this request is the answer TO, fixed at the moment it goes out.
      // `lastSent` moves on the instant a newer one is fired, so comparing
      // against it below is how a slow answer that has been overtaken is
      // recognised and dropped rather than painted over a newer picture.
      const sent = answers;
      lastSent.current = sent;
      runPreview.mutate(
        {
          kind,
          filename,
          csv,
          mapping,
          // Always sent, and the SERVER decides whether it counts: it ignores a
          // date order whenever the file has settled the question itself. It
          // has to be that way round — only the server, having just re-read the
          // column, knows whether this mapping settles it, and a browser-side
          // guard could only ever consult the previous file's answer.
          dateOrder,
          totalsAre,
          sourceId,
        },
        {
          onSuccess: (next) => {
            if (!isCurrentRequest(sent, lastSent.current)) return;
            setServerSaid(null);
            // What is now on screen, and what it is a picture OF, set together.
            // This is the only place a preview reaches this screen after mount,
            // so it is the only place Continue can be released from.
            setShownFor(sent);
            onPreviewed(next);
          },
          // Kept as a sentence rather than thrown away: the owner changed
          // something and has to know it did not take. Dropped on the same
          // terms — a refusal of answers they have already moved past would
          // block Continue over a mapping that is no longer on screen.
          onError: (err) => {
            if (!isCurrentRequest(sent, lastSent.current)) return;
            setServerSaid(apiErrorMessage(err, "We couldn't read that file."));
          },
        },
      );
    }, REPREVIEW_DELAY_MS);
    return () => clearTimeout(timer);
    // `runPreview` and the callbacks are stable enough for this to key off the
    // answers alone; re-running on a new mutation object would fire on every
    // render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answers, problem]);

  function setField(field: string, header: string) {
    const next = { ...mapping };
    if (header === NOT_IN_FILE) delete next[field];
    else next[field] = header;
    onMappingChange(next);
  }

  // ── The date question ────────────────────────────────────────────────────
  //
  // Only worth putting at all when a cell in their own date column reads two
  // different ways. An all-ISO column cannot be misread, so there is nothing to
  // confirm and nothing to change.
  //
  // `changeable` is the same question the server answers with `dateOrderCertain`:
  // the control is there while the owner's answer is what is holding the reading
  // up, and gone once the file has proved it. The reading follows their answer
  // the instant they give it rather than waiting for the round trip.
  const { reading, changeable } = dateQuestion(preview, dateOrder);
  const dateCell = useMemo(() => {
    const dateField = columns.find((column) => column.kind === "date" && mapping[column.field]);
    if (dateField === undefined) return null;
    return ambiguousDateCell(cellsOf(parseCsvTable(csv), mapping[dateField.field]));
  }, [csv, columns, mapping]);
  const dateSays = dateCell === null ? null : dateReading(dateCell, reading);

  // ── The channel question ─────────────────────────────────────────────────
  const channel = channelAnswer({
    kind,
    mapping,
    counts: preview?.counts ?? null,
    // The server's exact tally, not a count off `preview.failed` — that list
    // stops at 200 rows and these are the first entries a long file loses.
    noChannelFailures: preview?.noChannelFailures ?? 0,
    chosenSourceId: sourceId,
  });

  function addChannel() {
    const named = newChannel.trim();
    if (named === "") return;
    const already = (sources.data ?? []).find(
      (source) => source.name.toLowerCase() === named.toLowerCase(),
    );
    if (already !== undefined) {
      onSourceIdChange(already.id);
      setAddingChannel(false);
      return;
    }
    createSource.mutate(
      { name: named, kind: "manual" },
      {
        onSuccess: (created) => {
          onSourceIdChange(created.id);
          setAddingChannel(false);
        },
        onError: (err) => toast.error(apiErrorMessage(err, "Could not add that channel")),
      },
    );
  }

  /*
   * Continue is closed while anything on this screen would make the next one
   * useless — or, worse, make it lie. A file with no channel chosen imports
   * NOTHING, and a picture that is not of these answers is the one thing the
   * check screen cannot catch for itself. Both live in `continueBlocked`, with
   * the reasoning, because the second is a money bug and it is pinned by tests.
   */
  const blocked = continueBlocked({
    problem,
    serverSaid,
    hasPreview: preview !== null,
    requestInFlight: runPreview.isPending,
    answers,
    shownFor,
    channelRequired: channel.required,
  });

  return {
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
  };
}
