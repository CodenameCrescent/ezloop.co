import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { apiErrorMessage, usePeople, useTransaction, useUpdateTransaction, useVoidTransaction } from "@/api/hooks";
import { formatCents } from "@/lib/money";
import { getCurrencySymbol } from "@/lib/currencyUtils";
import { dateInputToInstant, todayInputValue } from "@/lib/period";
import { formatQuantity, PAYMENT_STATE_LABELS } from "@workspace/domain";
import { RefundModal } from "@/components/RefundModal";
import { draftFromTransaction, type QuickAddDraft } from "@/components/QuickAdd";
import { ORIGIN_LABEL, AttachmentsSection, Row } from "./TransactionDetail.parts/AttachmentsSection";
export { ORIGIN_LABEL } from "./TransactionDetail.parts/AttachmentsSection";

export function TransactionDetail({
  id,
  onDone,
  onDuplicate,
  money,
  symbol,
  showTitle = true,
}: {
  id: string | null;
  /** Voided, refunded, or otherwise finished with — the caller decides what to show next. */
  onDone: () => void;
  onDuplicate: (draft: QuickAddDraft) => void;
  money: (c: number) => string;
  symbol: string;
  /** Off in the sheet, which supplies its own title for the dialog's label. */
  showTitle?: boolean;
}) {
  const detail = useTransaction(id);
  const voidM = useVoidTransaction();
  const updateM = useUpdateTransaction();
  const people = usePeople("customer");
  const [refundOpen, setRefundOpen] = useState(false);
  const [chargeback, setChargeback] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ date: "", paidDate: "", dueDate: "", customer: "", notes: "", reference: "", paid: true });
  const t = detail.data?.transaction;

  // Only real (non-adjustment) postings that aren't voided can be edited; money
  // fields stay append-only — refund/void handle those.
  const canEdit = !!t && !t.adjustmentType && t.status !== "void";
  // An unconfirmed recurring post hasn't happened yet as far as the owner is
  // concerned, so there is nothing to mark paid until they confirm it.
  const canTogglePaid = !!t && t.status !== "pending" && t.status !== "void";

  function startEdit() {
    if (!t) return;
    setForm({
      date: new Date(t.occurredAt).toISOString().slice(0, 10),
      // Default the paid date to the day it happened — the ordinary case.
      paidDate: new Date(t.paidAt ?? t.occurredAt).toISOString().slice(0, 10),
      // Empty means no date was agreed, which is a real answer — not a
      // default of today. See lib/domain/owed.ts.
      dueDate: t.dueDate ?? "",
      customer: t.personName ?? "",
      notes: t.notes ?? "",
      reference: t.referenceNumber ?? "",
      paid: t.paidAt !== null,
    });
    setEditing(true);
  }

  function saveEdit() {
    if (!t) return;
    const body: Record<string, unknown> = {};
    const origDate = new Date(t.occurredAt).toISOString().slice(0, 10);
    // Same local-day reading as Quick Add and the filters.
    if (form.date && form.date !== origDate) body.occurredAt = dateInputToInstant(form.date).toISOString();
    if (form.customer.trim() !== (t.personName ?? "")) body.personName = form.customer.trim() || null;
    if (form.notes.trim() !== (t.notes ?? "")) body.notes = form.notes.trim() || null;
    if (form.reference.trim() !== (t.referenceNumber ?? "")) body.referenceNumber = form.reference.trim() || null;
    if (canTogglePaid) {
      // Unpaid is a missing date, not a status: clearing it puts the row back
      // on the money-owed list without touching what it earned.
      const nextPaidAt = form.paid
        ? dateInputToInstant(form.paidDate || form.date || t.occurredAt).toISOString()
        : null;
      const origPaidAt = t.paidAt ? new Date(t.paidAt).toISOString() : null;
      if (nextPaidAt !== origPaidAt) body.paidAt = nextPaidAt;
    }
    // Sent as the plain day the owner typed. A due date is a calendar day, not
    // an instant — converting it through a timezone would move some deadlines
    // by one.
    const nextDueDate = form.dueDate.trim() || null;
    if (nextDueDate !== (t.dueDate ?? null)) body.dueDate = nextDueDate;
    if (Object.keys(body).length === 0) {
      setEditing(false);
      return;
    }
    updateM.mutate(
      { id: t.id, body: body as never },
      {
        onSuccess: () => { toast.success("Transaction updated"); setEditing(false); },
        onError: (err) => toast.error(apiErrorMessage(err, "Could not update")),
      },
    );
  }

  function doVoid() {
    if (!t) return;
    voidM.mutate(t.id, {
      onSuccess: () => { toast.success("Transaction voided"); onDone(); },
      onError: (err) => toast.error(apiErrorMessage(err, "Could not void")),
    });
  }

  if (!t) {
    return (
      <p className="t-secondary">
        {id ? "Opening…" : "Nothing to show — record a transaction and it will appear here."}
      </p>
    );
  }

  return (
    <div className="t-body space-y-4">
      {showTitle && (
        <div>
          <h3 className="t-section text-[color:var(--pl-ink)]">{t.displayName}</h3>
          <p className="t-secondary">{new Date(t.occurredAt).toLocaleDateString()} · {t.sourceName}</p>
        </div>
      )}

      <Row label="Amount">
        <span
          className="t-num font-semibold"
          style={{ color: t.direction === "in" ? "var(--pl-green)" : "var(--pl-ink)" }}
        >
          {t.direction === "in" ? "+" : "−"}{money(t.amountCents)}
        </span>
      </Row>
      <Row label="Source · Origin">{t.sourceName} · {ORIGIN_LABEL[t.origin]}</Row>
      {t.personName && <Row label="Customer">{t.personName}</Row>}
      <Row label="Happened">{new Date(t.occurredAt).toLocaleDateString()}</Row>
      <Row label="Paid">
        <span className={t.paymentState === "unpaid" ? "font-medium text-[color:var(--pl-amber)]" : ""}>
          {t.paidAt ? new Date(t.paidAt).toLocaleDateString() : PAYMENT_STATE_LABELS[t.paymentState]}
        </span>
      </Row>
      {t.taxPaidCents > 0 && (
        <Row label="Tax paid">
          <span className="t-num">{money(t.taxPaidCents)}</span>
          <span className="t-micro ml-1 text-[color:var(--pl-ink-3)]">
            {t.taxReclaimable ? "· claimed back, not a cost" : "· part of the cost"}
          </span>
        </Row>
      )}
      {t.entered && (
        <Row label="Typed in">
          <span className="t-num">{formatCents(t.entered.amountCents, getCurrencySymbol(t.entered.currency))}</span>
          <span className="t-micro ml-1 text-[color:var(--pl-ink-3)]">
            · at {symbol} {t.entered.fxRate} per {getCurrencySymbol(t.entered.currency)}1, fixed on this entry
          </span>
        </Row>
      )}
      {t.fxRateToBase !== "1" && (
        <Row label="Currency">
          {t.currency}
          <span className="t-micro ml-1 text-[color:var(--pl-ink-3)]">· converted at {t.fxRateToBase}, fixed on this date</span>
        </Row>
      )}
      <Row label="Status"><span className="capitalize">{t.status.replace(/_/g, " ")}</span></Row>
      {t.referenceNumber && <Row label="Reference #"><span className="t-num">{t.referenceNumber}</span></Row>}
      {t.notes && !editing && (
        <div className="t-micro rounded-lg bg-[color:var(--pl-recessed)] p-2">
          <span className="text-[color:var(--pl-ink-2)]">Notes: </span>{t.notes}
        </div>
      )}

      <div className="rounded-lg border border-[color:var(--pl-hairline)]">
        {t.lines.map((line) => {
          const isCostLine = t.direction === "in" && line.direction === "out";
          return (
            <div key={line.id} className="border-b border-[color:var(--pl-hairline)] p-3 last:border-0">
              <div className="flex justify-between gap-2 font-medium">
                <span>
                  {line.itemName ?? line.label}
                  {Number(line.qty) !== 1 && (
                    // The unit was frozen onto the line when it was sold, so
                    // six hours of design work never reads as six logos.
                    <span className="font-normal text-[color:var(--pl-ink-2)]"> · {formatQuantity(line.qty, line.unitLabel)}</span>
                  )}
                  {isCostLine && <span className="t-micro ml-1 font-normal text-[color:var(--pl-red)]">· cost</span>}
                  {/*
                    A split bill arrives as several lines that are otherwise
                    identical — same item, same date, different amounts.
                    Without the name beside each one, the card looks like the
                    same cost entered three times by mistake.
                  */}
                  {line.targetLabel && (
                    <span className="font-normal text-[color:var(--pl-ink-2)]"> · for {line.targetLabel}</span>
                  )}
                </span>
                <span className={`t-num shrink-0 ${isCostLine ? "text-[color:var(--pl-red)]" : ""}`}>
                  {isCostLine ? "−" : ""}{money(line.unitPriceCents)}
                </span>
              </div>
              {line.lineDiscountCents > 0 && (
                <div className="t-micro flex justify-between text-[color:var(--pl-ink-2)]">
                  <span>Line discount</span><span>−{money(line.lineDiscountCents)}</span>
                </div>
              )}
              {/*
                Without this, the row says Rs 95,000 and the month's costs say
                Rs 3,958, and the owner has no way to tell that the two are the
                same purchase. Same reason origin is shown.
              */}
              {line.spreadMonths && line.spreadMonths > 1 && (
                <div className="t-micro mt-1 text-[color:var(--pl-ink-2)]">
                  Charged across {line.spreadMonths} months — about{" "}
                  {money(Math.ceil((line.unitPriceCents * Number(line.qty) - line.lineDiscountCents) / line.spreadMonths))} a month.
                  The full amount left your bank on the day you paid it.
                </div>
              )}
              {line.costSnapshot && line.costSnapshot.components.length > 0 && (
                <div className="t-micro mt-1 text-[color:var(--pl-ink-2)]">
                  {line.costSnapshot.components.map((c) => `${c.name} ${formatCents(c.per_unit_cents, symbol)}`).join(" · ")}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {t.orderDiscountCents > 0 && (
        <div className="t-secondary flex justify-between"><span>Order discount</span><span>−{money(t.orderDiscountCents)}</span></div>
      )}
      {t.shippingChargedCents > 0 && (
        <div className="t-secondary flex justify-between"><span>Shipping</span><span>{money(t.shippingChargedCents)}</span></div>
      )}
      {t.taxCollectedCents > 0 && (
        <div className="t-micro rounded-lg bg-[color:var(--pl-recessed)] p-2 text-[color:var(--pl-ink-2)]">
          Tax collected {money(t.taxCollectedCents)} — held for the government, not counted in your revenue.
        </div>
      )}

      <AttachmentsSection transactionId={t.id} />

      {detail.data && detail.data.refunds.length > 0 && (
        <div>
          <div className="t-micro mb-1 font-semibold text-[color:var(--pl-ink-2)]">Refund history</div>
          {detail.data.refunds.map((r) => (
            <div key={r.id} className="flex justify-between">
              <span className="capitalize">{r.adjustmentType} · {new Date(r.occurredAt).toLocaleDateString()}</span>
              <span className="t-num text-[color:var(--pl-red)]">−{money(r.amountCents)}</span>
            </div>
          ))}
        </div>
      )}

      {editing ? (
        <div className="space-y-3 rounded-lg border border-[color:var(--pl-hairline)] p-3">
          <div className="t-micro font-semibold text-[color:var(--pl-ink-2)]">Edit details</div>
          <p className="t-micro text-[color:var(--pl-ink-2)]">Amounts and items can't be edited — use Refund or Void to change money.</p>
          <div>
            <Label className="t-micro text-[color:var(--pl-ink-2)]">Date it happened</Label>
            <Input type="date" max={todayInputValue()} value={form.date} onChange={(e) => setForm((s) => ({ ...s, date: e.target.value }))} />
            <p className="t-micro mt-1 text-[color:var(--pl-ink-3)]">This is the date your profit counts it under.</p>
          </div>
          {t.direction === "in" && (
            <div>
              <Label className="t-micro text-[color:var(--pl-ink-2)]">Customer</Label>
              <Input list="txn-people" value={form.customer} onChange={(e) => setForm((s) => ({ ...s, customer: e.target.value }))} />
              <datalist id="txn-people">{(people.data?.items ?? []).map((p) => <option key={p.id} value={p.displayName} />)}</datalist>
            </div>
          )}
          <div>
            <Label className="t-micro text-[color:var(--pl-ink-2)]">Reference #</Label>
            <Input placeholder="Invoice or receipt no." value={form.reference} onChange={(e) => setForm((s) => ({ ...s, reference: e.target.value }))} />
          </div>
          <div>
            <Label className="t-micro text-[color:var(--pl-ink-2)]">Notes</Label>
            <Textarea rows={2} value={form.notes} onChange={(e) => setForm((s) => ({ ...s, notes: e.target.value }))} />
          </div>
          {canTogglePaid && (
            <>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <Label className="t-micro text-[color:var(--pl-ink-2)]">Has it been paid?</Label>
                  <p className="t-micro text-[color:var(--pl-ink-3)]">
                    Unpaid still counts toward profit — it just hasn't reached your cash yet.
                  </p>
                </div>
                <Switch checked={form.paid} onCheckedChange={(v) => setForm((s) => ({ ...s, paid: v }))} />
              </div>
              {!form.paid && (
                <div>
                  <Label className="t-micro text-[color:var(--pl-ink-2)]">When is it due?</Label>
                  <Input
                    type="date"
                    value={form.dueDate}
                    onChange={(e) => setForm((s) => ({ ...s, dueDate: e.target.value }))}
                  />
                  <p className="t-micro mt-1 text-[color:var(--pl-ink-3)]">
                    Optional. With a date it can be reported as late; without one it is
                    simply outstanding, which is the honest answer when nothing was agreed.
                  </p>
                </div>
              )}
              {form.paid && (
                <div>
                  <Label className="t-micro text-[color:var(--pl-ink-2)]">Date it was paid</Label>
                  <Input
                    type="date"
                    max={todayInputValue()}
                    value={form.paidDate}
                    onChange={(e) => setForm((s) => ({ ...s, paidDate: e.target.value }))}
                  />
                  <p className="t-micro mt-1 text-[color:var(--pl-ink-3)]">
                    Leave it matching the date above unless the money moved on a different day.
                  </p>
                </div>
              )}
            </>
          )}
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
            <Button size="sm" onClick={saveEdit} disabled={updateM.isPending}>{updateM.isPending ? "Saving…" : "Save"}</Button>
          </div>
        </div>
      ) : (() => {
        const refundVisible = t.direction === "in" && !t.adjustmentType && t.status !== "void" && t.status !== "refunded";
        const voidVisible = refundVisible || ((!!t.adjustmentType || t.direction === "out") && t.status !== "void");
        if (!refundVisible && !voidVisible && !canEdit) return null;
        return (
          <div className="flex flex-wrap gap-2 pt-2">
            {refundVisible && <Button size="sm" onClick={() => { setChargeback(false); setRefundOpen(true); }}>Refund…</Button>}
            {refundVisible && <Button size="sm" variant="outline" onClick={() => { setChargeback(true); setRefundOpen(true); }}>Chargeback…</Button>}
            {canEdit && <Button size="sm" variant="outline" onClick={startEdit}>Edit details</Button>}
            {!t.adjustmentType && <Button size="sm" variant="outline" onClick={() => onDuplicate(draftFromTransaction(t))}>Duplicate</Button>}
            {voidVisible && <Button size="sm" variant="ghost" className="text-[color:var(--pl-red)]" onClick={doVoid} disabled={voidM.isPending}>Void</Button>}
          </div>
        );
      })()}

      <RefundModal open={refundOpen} onOpenChange={setRefundOpen} transaction={t} chargeback={chargeback} onDone={onDone} symbol={symbol} />
    </div>
  );
}
