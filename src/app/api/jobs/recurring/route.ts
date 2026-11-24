import type { NextRequest } from "next/server";
import { JOB_OPTIONS, runRecurring } from "../functions";
import { handleRaw } from "@/lib/api/functions/http/handler";

/**
 * The same job, over GET, because schedulers ask that way — Vercel's cron
 * issues a plain GET and cannot be told to POST. A GET that changes things is
 * normally a mistake; it is defensible here only because this endpoint is
 * idempotent by construction (the posting table's unique lock makes a repeat
 * a no-op) and is reachable solely with the secret. It stays out of the API
 * contract, so no screen can wander into it.
 */
export async function GET(request: NextRequest) {
  return handleRaw(request, JOB_OPTIONS, runRecurring);
}

export async function POST(request: NextRequest) {
  return handleRaw(request, JOB_OPTIONS, runRecurring);
}

export const maxDuration = 60;
