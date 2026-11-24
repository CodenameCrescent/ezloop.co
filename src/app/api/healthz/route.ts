import type { NextRequest } from "next/server";
import { healthCheck as healthCheckContract } from "@workspace/api-contract";
import { handle } from "@/lib/api/functions/http/handler";

export async function GET(request: NextRequest) {
  return handle(request, healthCheckContract, { auth: false }, () => ({ status: "ok" }));
}
