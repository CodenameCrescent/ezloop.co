import type { NextRequest } from "next/server";
import { listTransactions as listTransactionsContract, createTransaction as createTransactionContract } from "@workspace/api-contract";
import { toInput } from "@/lib/api/functions/helpers/transactions";
import { type AuthedRequest, businessOf } from "@/lib/api/functions/http/guards";
import * as ledger from "@/lib/api/functions/services/ledger";
import { listTransactions as listTxns, getTransactionDetail } from "@/lib/api/functions/services/read";
import { handle } from "@/lib/api/functions/http/handler";

export async function GET(request: NextRequest) {
  return handle(request, listTransactionsContract, {}, async ({ req, query }) => {
    const userId = (req as AuthedRequest).userId;
    const business = businessOf(req);
    return listTxns(business.id, userId, query);
  });
}

export async function POST(request: NextRequest) {
  return handle(request, createTransactionContract, { write: true }, async ({ req, body }) => {
    const userId = (req as AuthedRequest).userId;
    const business = businessOf(req);
    const created = await ledger.createTransaction(business.id, await toInput(business.id, userId, body, business.baseCurrency));
    const detail = await getTransactionDetail(business.id, userId, created.transaction.id);
    return detail!.transaction;
  });
}
