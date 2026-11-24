import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { useClients, useCreateClient, useUpdateClientEngagement, apiErrorMessage } from "@/api/hooks";
import { readOptionalMoney, MoneyInputError, formatCents } from "@/lib/money";

/**
 * The client and team details that used to be whole screens of their own.
 *
 * They are shown on the PERSON, because that is what they are. The schema says
 * so outright — there is no clients table and no team_members table; a client
 * is a `people` row of kind 'customer' and a team member is one of kind
 * 'employee', with an engagement or a pay rate hanging off it. Two extra list
 * screens meant the same human appeared in three places, and the one place that
 * already knew their revenue could not show what they had agreed to pay.
 */

/** A customer's agreed terms, edited where the customer is. */
export function ClientTerms({ personId, symbol }: { personId: string; symbol: string }) {
  const clients = useClients();
  const createM = useCreateClient();
  const updateM = useUpdateClientEngagement();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    status: "active",
    amount: "",
    amountPeriod: "total",
    hours: "",
    hoursPeriod: "total",
  });

  const row = (clients.data?.clients ?? []).find((c) => c.personId === personId);

  function startEdit() {
    setForm({
      status: row?.engagementStatus ?? "active",
      amount: row?.agreedAmountCents == null ? "" : String(row.agreedAmountCents / 100),
      amountPeriod: row?.agreedAmountPeriod ?? "total",
      hours: row?.agreedHours ?? "",
      hoursPeriod: row?.agreedHoursPeriod ?? "total",
    });
    setEditing(true);
  }

  function save() {
    let engagement;
    try {
      engagement = {
        engagementStatus: form.status as "active" | "completed" | "churned",
        agreedAmountCents: readOptionalMoney("Agreed amount", form.amount),
        agreedAmountPeriod: form.amountPeriod as "total" | "monthly",
        agreedHours: form.hours.trim() || null,
        agreedHoursPeriod: form.hoursPeriod as "total" | "monthly",
      };
    } catch (err) {
      if (err instanceof MoneyInputError) {
        toast.error(err.message);
        return;
      }
      throw err;
    }
    const done = {
      onSuccess: () => {
        toast.success("Agreed terms saved");
        setEditing(false);
      },
      onError: (e: unknown) => toast.error(apiErrorMessage(e, "Could not save those terms")),
    };
    if (row) updateM.mutate({ engagementId: row.engagementId, body: engagement }, done);
    else createM.mutate({ personId, engagement }, done);
  }

  const periodWord = (p: string) => (p === "monthly" ? " a month" : "");

  return (
    <div className="mt-5 rounded-lg border border-card-border p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold text-muted-foreground">Agreed terms</span>
        {!editing && (
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={startEdit}>
            {row ? "Edit" : "Add terms"}
          </Button>
        )}
      </div>

      {!row && !editing && (
        <p className="text-xs text-muted-foreground">
          Nothing agreed on record. Add what they agreed to pay and how long it should take, and this person starts
          appearing in Worth having.
        </p>
      )}

      {row && !editing && (
        <div className="space-y-1 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Status</span>
            <span className="capitalize">{row.engagementStatus === "completed" ? "finished" : row.engagementStatus}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Agreed amount</span>
            <span className="tabular-nums">
              {row.agreedAmountCents == null
                ? "—"
                : formatCents(row.agreedAmountCents, symbol) + periodWord(row.agreedAmountPeriod)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Agreed hours</span>
            <span className="tabular-nums">
              {row.agreedHours ? row.agreedHours + periodWord(row.agreedHoursPeriod) : "—"}
            </span>
          </div>
        </div>
      )}

      {editing && (
        <div className="space-y-2">
          <div>
            <Label className="text-xs">Status</Label>
            <Select value={form.status} onValueChange={(v) => setForm((s) => ({ ...s, status: v }))}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="completed">Finished</SelectItem>
                <SelectItem value="churned">Churned</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Agreed amount ({symbol})</Label>
            <div className="flex gap-1">
              <Input
                className="h-8 text-xs"
                type="number"
                placeholder="Optional"
                value={form.amount}
                onChange={(e) => setForm((s) => ({ ...s, amount: e.target.value }))}
              />
              <Select value={form.amountPeriod} onValueChange={(v) => setForm((s) => ({ ...s, amountPeriod: v }))}>
                <SelectTrigger className="h-8 w-28 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="total">in total</SelectItem>
                  <SelectItem value="monthly">a month</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label className="text-xs">Agreed hours</Label>
            <div className="flex gap-1">
              <Input
                className="h-8 text-xs"
                placeholder="Optional"
                value={form.hours}
                onChange={(e) => setForm((s) => ({ ...s, hours: e.target.value }))}
              />
              <Select value={form.hoursPeriod} onValueChange={(v) => setForm((s) => ({ ...s, hoursPeriod: v }))}>
                <SelectTrigger className="h-8 w-28 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="total">in total</SelectItem>
                  <SelectItem value="monthly">a month</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex justify-end gap-1.5">
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-7 text-xs"
              disabled={createM.isPending || updateM.isPending}
              onClick={save}
            >
              Save
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
