import type { NextRequest } from "next/server";
import { resetData as resetDataContract } from "@workspace/api-contract";
import { businessOf } from "@/lib/api/functions/http/guards";
import { wipeBusinessById } from "@/lib/api/functions/services/business";
import { handle } from "@/lib/api/functions/http/handler";

export async function POST(request: NextRequest) {
  return handle(request, resetDataContract, { write: true }, async ({ req }) => {
    await wipeBusinessById(businessOf(req).id, { keepBusiness: true });
    return { ok: true };
  });
}
