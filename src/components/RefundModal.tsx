import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiErrorMessage, useChargebackTransaction, useRefundTransaction } from "@/api/hooks";
import { formatCents, MoneyInputError, parseMoneyInput, readMoney } from "@/lib/money";
import { formatQuantity, quantityFieldLabel } from "@workspace/domain";
import type { EndpointResponse } from "@workspace/api-contract";
import type { getTransaction } from "@workspace/api-contract";

type Txn = EndpointResponse<typeof getTransaction>["transaction"];

interface LineDraft {
  include: boolean;
  qty: string;
  amountRupees: string;
  restocked: boolean;
  feesRecovered: boolean;
}

/**
 * Line-by-line refund/chargeback. `restocked` defaults ON for product lines
 * (they have cost components) and OFF otherwise; `feesRecovered` defaults OFF.
 */
export function RefundModal({ open, onOpenChange, transaction, chargeback, onDone, symbol }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  transaction: Txn;
  chargeback: boolean;
  onDone: () => void;
  symbol: string;
}) {
  const refundM = useRefundTransaction();
  const chargebackM = useChargebackTransaction();
  const [feeRupees, setFeeRupees] = useState("");
  const [drafts, setDrafts] = useState<Record<string, LineDraft>>(() =>
    Object.fromEntries(
      transaction.lines.map((line) => {
        const hasCost = (line.costSnapshot?.components.some((c) => c.kind === "cost")) ?? false;
        return [
          line.id,
          {
            include: true,
            qty: line.qty,
            amountRupees: String((line.unitPriceCents * Number(line.qty) - line.lineDiscountCents) / 100),
            restocked: hasCost,
            feesRecovered: false,
          } satisfies LineDraft,
        ];
      }),
    ),
  );

  const setDraft = (id: string, patch: Partial<LineDraft>) => setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));

  const included = useMemo(() => transaction.lines.filter((l) => drafts[l.id]?.include), [transaction.lines, drafts]);
  const totalCents = included.reduce((sum, l) => sum + (parseMoneyInput(drafts[l.id].amountRupees || "0") ?? 0), 0);
  const pending = refundM.isPending || chargebackM.isPending;

  function submit() {
    // A money box that is not an amount is named here, by the label printed
    // beside it — the server can only answer "Invalid request".
    try {
      buildAndSubmit();
    } catch (err) {
      if (err instanceof MoneyInputError) { toast.error(err.message); return; }
      throw err;
    }
  }

  function buildAndSubmit() {
    const lines = included.map((l) => ({
      lineId: l.id,
      qtyRefunded: drafts[l.id].qty || "1",
      amountRefundedCents: readMoney(`Refund amount for "${l.itemName ?? l.label ?? "this line"}"`, drafts[l.id].amountRupees || "0"),
      restocked: drafts[l.id].restocked,
      feesRecovered: drafts[l.id].feesRecovered,
    }));
    if (lines.length === 0) {
      toast.error("Pick at least one line to refund");
      return;
    }
    const onSuccess = () => {
      toast.success(chargeback ? "Chargeback recorded" : "Refund recorded");
      onOpenChange(false);
      onDone();
    };
    const onError = (err: unknown) => toast.error(apiErrorMessage(err, "Could not process"));
    if (chargeback) {
      chargebackM.mutate({ id: transaction.id, body: { lines, ...(feeRupees.trim() ? { feeCents: readMoney("Fee", feeRupees) } : {}) } }, { onSuccess, onError });
    } else {
      refundM.mutate({ id: transaction.id, body: { lines } }, { onSuccess, onError });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{chargeback ? "Chargeback" : "Refund"} · {transaction.displayName}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          {transaction.lines.map((line) => {
            const d = drafts[line.id];
            const hasCost = (line.costSnapshot?.components.some((c) => c.kind === "cost")) ?? false;
            const hasFee = (line.costSnapshot?.components.some((c) => c.kind === "fee")) ?? false;
            return (
              <div key={line.id} className={`rounded-lg border p-3 ${d.include ? "border-card-border" : "border-card-border/40 opacity-60"}`}>
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 font-medium">
                    <input type="checkbox" checked={d.include} onChange={(e) => setDraft(line.id, { include: e.target.checked })} />
                    {line.itemName ?? line.label}
                  </label>
                  <span className="text-xs text-muted-foreground">sold {formatQuantity(line.qty, line.unitLabel)} at {formatCents(line.unitPriceCents, symbol)} each</span>
                </div>
                {d.include && (
                  <div className="mt-2 space-y-2">
                    <div className="flex gap-2">
                      <div className="flex-1"><Label className="text-xs text-muted-foreground">{quantityFieldLabel(line.unitLabel)} back</Label><Input value={d.qty} onChange={(e) => setDraft(line.id, { qty: e.target.value })} /></div>
                      <div className="flex-[2]"><Label className="text-xs text-muted-foreground">Amount</Label><Input type="number" value={d.amountRupees} onChange={(e) => setDraft(line.id, { amountRupees: e.target.value })} /></div>
                    </div>
                    <div className="flex flex-wrap gap-4">
                      {hasCost && (
                        <label className="flex items-center gap-2 text-xs"><Switch checked={d.restocked} onCheckedChange={(v) => setDraft(line.id, { restocked: v })} /> Restocked</label>
                      )}
                      {hasFee && (
                        <label className="flex items-center gap-2 text-xs"><Switch checked={d.feesRecovered} onCheckedChange={(v) => setDraft(line.id, { feesRecovered: v })} /> Fees recovered</label>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {chargeback && (
            <div><Label className="text-xs text-muted-foreground">Chargeback fee (optional)</Label><Input type="number" placeholder="0.00" value={feeRupees} onChange={(e) => setFeeRupees(e.target.value)} /></div>
          )}
          <div className="flex justify-between border-t border-card-border pt-2 font-semibold"><span>Total {chargeback ? "charged back" : "refunded"}</span><span className="tabular-nums">{formatCents(totalCents, symbol)}</span></div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={pending}>{pending ? "Processing…" : chargeback ? "Record chargeback" : "Record refund"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
