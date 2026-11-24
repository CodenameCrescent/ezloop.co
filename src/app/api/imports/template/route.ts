import type { NextRequest } from "next/server";
import { IMPORT_KINDS, type ImportKind, templateCsv, templateFilename } from "@workspace/domain";
import { invalid } from "@/lib/api/functions/services/errors";
import { handleRaw } from "@/lib/api/functions/http/handler";

// ---------------------------------------------------------------------------
// The blank file
// ---------------------------------------------------------------------------

/**
 * Binary/non-JSON, like the attachment download in `transactions.ts` — so it is
 * a plain route rather than a contract endpoint. The contract is for JSON.
 *
 * Generated from the same column list the matcher reads (`templateCsv`), so the
 * file an owner downloads and the headers the importer looks for cannot drift
 * apart. There is no `mutationRateLimit`: it writes nothing.
 */
export async function GET(request: NextRequest) {
  return handleRaw(request, {}, (req) => {
    const kind = String(req.query.kind ?? "");
    if (!IMPORT_KINDS.includes(kind as ImportKind)) throw invalid("Unknown template");
    return new Response(templateCsv(kind as ImportKind), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${templateFilename(kind as ImportKind)}"`,
      },
    });
  });
}
