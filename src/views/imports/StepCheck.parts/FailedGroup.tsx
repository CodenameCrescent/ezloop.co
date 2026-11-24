import { Download } from "lucide-react";
import type { ImportKindShape, ImportPreviewShape, ImportFailedRowShape } from "@workspace/api-contract";
import { Button } from "@/components/ui/button";
import { useFormatters } from "@/lib/store";
import { spellDate, failuresCsv, failuresFilename, rowLabel } from "../importModel";

/**
 * One row's own figure — never a sum, and never `formatCents(x, f.symbol)`,
 * which is how a settings symbol once got paired with an unconverted number.
 *
 * `direction` is what makes this money rather than a price. When it is there the
 * figure carries a SIGN as well as a colour, because green and red separate by
 * ΔE 4.9 under deuteranopia and money may never be colour alone (DESIGN.md §3a).
 * When it is null — a catalog item's price, which is a fact about the business
 * and not a money event — the figure is plain neutral ink, uncoloured.
 */
export function Amount({
  cents,
  direction,
  f,
}: {
  cents: number | null;
  direction: "in" | "out" | null;
  f: ReturnType<typeof useFormatters>;
}) {
  if (cents === null) return <span className="text-muted-foreground">—</span>;
  if (direction === null) return <>{f.moneyCents(cents)}</>;
  /*
   * Zero is neutral, whichever way the row points. `formatCentsSigned` emits no
   * prefix for 0 — there is no such thing as `-0.00` to a reader — so an
   * outgoing zero came out as a RED "Rs 0.00": colour with nothing beside it,
   * which is the one thing money may never be (DESIGN.md §3a). Grey is also
   * what it means: nothing was gained and nothing was lost.
   */
  if (cents === 0) return <>{f.moneyCents(0)}</>;
  const signed = direction === "in" ? cents : -cents;
  return (
    <span style={{ color: direction === "in" ? "var(--pl-green)" : "var(--pl-red)" }}>
      {f.moneyCentsSigned(signed)}
    </span>
  );
}

/**
 * What will land, read-only.
 *
 * Four of the row's fields are `null` for the kinds that genuinely have no such
 * thing — a contact has no date, a catalog item has no direction — so the
 * columns are chosen by KIND rather than filled with `0` and `in`, which would
 * paint money treatment across a list of customers.
 */
export function ReadyTable({
  kind,
  rows,
  f,
  grouped,
}: {
  kind: ImportKindShape;
  rows: ImportPreviewShape["ready"];
  f: ReturnType<typeof useFormatters>;
  grouped: boolean;
}) {
  const money = kind !== "people";
  const dated = kind === "transactions";
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left">
        <thead>
          <tr className="t-micro text-muted-foreground">
            {dated && <th className="pb-1.5 pr-3 font-medium">Date</th>}
            <th className="pb-1.5 pr-3 font-medium">{kind === "transactions" ? "What" : "Name"}</th>
            {!dated && <th className="pb-1.5 pr-3 font-medium">Detail</th>}
            {grouped && <th className="pb-1.5 pr-3 font-medium">Items</th>}
            {money && <th className="pb-1.5 text-right font-medium">Amount</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-t border-[color:var(--pl-hairline)]">
              {dated && (
                <td className="py-1.5 pr-3 align-top t-secondary text-muted-foreground whitespace-nowrap">
                  {/* Spelled out, never `new Date(iso).toLocaleDateString()` —
                      that reads the ISO day as UTC midnight and prints the day
                      before it west of Greenwich, on the one screen whose job is
                      to confirm the date. */}
                  {row.occurredOn === null ? "—" : (spellDate(row.occurredOn) ?? row.occurredOn)}
                </td>
              )}
              <td className="py-1.5 pr-3 align-top t-secondary">{row.description}</td>
              {!dated && (
                <td className="py-1.5 pr-3 align-top t-secondary text-muted-foreground">
                  {row.detail ?? "—"}
                </td>
              )}
              {grouped && (
                <td className="py-1.5 pr-3 align-top t-secondary text-muted-foreground">
                  {row.lineCount ?? "—"}
                </td>
              )}
              {money && (
                <td className="py-1.5 text-right align-top t-num whitespace-nowrap">
                  <Amount cents={row.amountCents} direction={row.direction} f={f} />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Everything we could not read, and the button that hands it back.
 *
 * Used twice with the same code: on the check screen from `preview.failed`, and
 * on the receipt from the COMMIT'S failures, which are not the same list. One
 * component so the two can never describe the same fact differently.
 */
export function FailedGroup({
  headers,
  failures,
  total,
  filename,
  bare = false,
}: {
  headers: string[];
  failures: ImportFailedRowShape[];
  total: number;
  filename: string;
  /** Inside a `Group`, which already carries the heading and the exact count. */
  bare?: boolean;
}) {
  function download() {
    /*
     * Built here in the browser, on purpose. This is presentation — every cell
     * is echoed back exactly as the server read it and the only thing added is
     * the reason it already wrote — so there is nothing to derive and no round
     * trip to make.
     *
     * The BOM is for Excel, which reads a BOM-less UTF-8 CSV as ANSI and mangles
     * every accented name in it. Safe for the round trip back: the server's
     * parser strips a leading BOM before it reads a byte.
     */
    const blob = new Blob([`﻿${failuresCsv(headers, failures)}`], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = failuresFilename(filename);
    link.click();
    URL.revokeObjectURL(url);
  }

  const body = (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="t-micro text-muted-foreground">
          Fix these in your spreadsheet and bring them back — nothing else needs re-uploading.
        </p>
        {/*
          The button counts the list, NOT `total`. On a long file the list is
          cut to 200 and the file this writes has 200 rows in it, so promising
          250 would hand back a file that is short by fifty. The group heading
          above already carries the true number.
        */}
        <Button variant="outline" size="sm" className="gap-2" onClick={download}>
          <Download className="h-4 w-4" />
          Download these {failures.length.toLocaleString("en-US")}
        </Button>
      </div>
      <ul className="mt-2 space-y-1.5">
        {failures.map((failure, position) => (
          // Positioned key: two failed rows can carry identical cells.
          <li key={`${failure.rowNumbers.join("-")}-${position}`}>
            <p className="t-secondary text-muted-foreground">
              <span className="text-foreground">{rowLabel(failure.rowNumbers)}</span>
              {failure.cells.length > 0 && ` · ${failure.cells.join(" · ")}`}
            </p>
            <p className="t-micro text-[color:var(--pl-amber)]">{failure.reason}</p>
          </li>
        ))}
      </ul>
    </>
  );

  // Inside a `Group`, the heading and the "showing the first 200" line are drawn
  // once already. Standing on its own — on the receipt — this carries both.
  //
  // The heading does NOT repeat the count: the receipt's own sentence, one block
  // up, has just said how many couldn't be read, and saying it twice invites the
  // two to disagree the day one of them learns about grouped files.
  if (bare) return body;
  return (
    <div>
      <p className="t-body font-medium">What we couldn't read</p>
      {body}
      {failures.length < total && (
        <p className="mt-2 t-micro text-muted-foreground">
          Showing the first {failures.length.toLocaleString("en-US")} of{" "}
          {total.toLocaleString("en-US")}.
        </p>
      )}
    </div>
  );
}
