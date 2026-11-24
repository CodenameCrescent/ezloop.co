import type { NextRequest } from "next/server";
import { seedDemoData as seedDemoDataContract } from "@workspace/api-contract";
import { type AuthedRequest, businessOf } from "@/lib/api/functions/http/guards";
import { runSeed } from "@/lib/api/functions/scripts/seedCore";
import { handle } from "@/lib/api/functions/http/handler";
import { prepareBusinessForSeed } from "../functions";

/**
 * Seed and reset act on THE CURRENT BUSINESS, never on the account.
 *
 * They used to take a user id, back when a user had exactly one business. Left
 * that way, an owner with three sets of books who pressed "seed sample data"
 * would have lost all three. Both now empty one business and keep its id, so
 * the browser holding that id is still pointing at something real.
 */
export async function POST(request: NextRequest) {
  return handle(request, seedDemoDataContract, { write: true }, async ({ req }) => {
    // Check-and-empty is one locked transaction: a business holding anything an
    // owner made is refused, and nothing can be written into it mid-check.
    // The seed then only inserts.
    await prepareBusinessForSeed(businessOf(req).id);
    await runSeed((req as AuthedRequest).userId, businessOf(req).id, { alreadyEmptied: true });
    return { ok: true };
  });
}
