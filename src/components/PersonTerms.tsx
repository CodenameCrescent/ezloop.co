import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiErrorMessage, useSetTeamMemberRate, useTeamMembers, useTeamRateHistory } from "@/api/hooks";
import { formatCents, MoneyInputError, readMoney } from "@/lib/money";
import { DEFAULT_BILLABLE_TARGET_HOURS } from "@workspace/domain";
export { ClientTerms } from "./PersonTerms.parts/ClientTerms";

/** What a team member's time costs, edited where the team member is. */
export function PayRate({ personId, symbol }: { personId: string; symbol: string }) {
  const team = useTeamMembers();
  const history = useTeamRateHistory(personId);
  const setRateM = useSetTeamMemberRate();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    costType: "salaried",
    monthly: "",
    hourly: "",
    overhead: "",
    target: DEFAULT_BILLABLE_TARGET_HOURS,
  });

  const member = (team.data?.members ?? []).find((m) => m.id === personId);

  function startEdit() {
    setForm({
      costType: member?.costType ?? "salaried",
      monthly: "",
      hourly: member?.payHourlyCents ? String(member.payHourlyCents / 100) : "",
      overhead: "",
      target: member?.billableTargetHours ?? DEFAULT_BILLABLE_TARGET_HOURS,
    });
    setEditing(true);
  }

  function save() {
    let body;
    try {
      body = {
        costType: form.costType as "salaried" | "hourly" | "contractor",
        monthlyCostCents: form.monthly.trim() ? readMoney("Monthly cost", form.monthly) : 0,
        hourlyRateCents: form.hourly.trim() ? readMoney("Hourly rate", form.hourly) : null,
        overheadShareCents: form.overhead.trim() ? readMoney("Overhead share", form.overhead) : 0,
        billableTargetHours: form.target,
      };
    } catch (err) {
      if (err instanceof MoneyInputError) {
        toast.error(err.message);
        return;
      }
      throw err;
    }
    setRateM.mutate(
      { id: personId, body },
      {
        onSuccess: () => {
          toast.success("Pay recorded from today — work already costed keeps its old rate");
          setEditing(false);
        },
        onError: (e) => toast.error(apiErrorMessage(e, "Could not save that rate")),
      },
    );
  }

  return (
    <div className="mt-5 rounded-lg border border-card-border p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold text-muted-foreground">What their time costs</span>
        {!editing && (
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={startEdit}>
            {member?.effectiveHourlyCostCents == null ? "Set pay" : "Change"}
          </Button>
        )}
      </div>

      {member?.effectiveHourlyCostCents == null && !editing && (
        <p className="text-xs text-muted-foreground">
          No pay recorded, so their hours cost nothing — and every client they work on looks more profitable than it is.
        </p>
      )}

      {member?.effectiveHourlyCostCents != null && !editing && (
        <div className="space-y-1 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Paid as</span>
            <span className="capitalize">{member.costType}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Cost per hour</span>
            <span className="font-semibold tabular-nums">{formatCents(member.effectiveHourlyCostCents, symbol)}</span>
          </div>
          <p className="pt-1 text-[11px] text-muted-foreground">
            Their pay plus overhead, over {member.billableTargetHours} billable hours a month.
          </p>
        </div>
      )}

      {editing && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Paid as</Label>
              <Select value={form.costType} onValueChange={(v) => setForm((s) => ({ ...s, costType: v }))}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="salaried">Salaried</SelectItem>
                  <SelectItem value="hourly">Hourly</SelectItem>
                  <SelectItem value="contractor">Contractor</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">
                {form.costType === "salaried" ? `Monthly pay (${symbol})` : `Hourly rate (${symbol})`}
              </Label>
              {form.costType === "salaried" ? (
                <Input
                  className="h-8 text-xs"
                  type="number"
                  value={form.monthly}
                  onChange={(e) => setForm((s) => ({ ...s, monthly: e.target.value }))}
                />
              ) : (
                <Input
                  className="h-8 text-xs"
                  type="number"
                  value={form.hourly}
                  onChange={(e) => setForm((s) => ({ ...s, hourly: e.target.value }))}
                />
              )}
            </div>
            <div>
              <Label className="text-xs">Overhead share ({symbol}/month)</Label>
              <Input
                className="h-8 text-xs"
                type="number"
                value={form.overhead}
                onChange={(e) => setForm((s) => ({ ...s, overhead: e.target.value }))}
              />
            </div>
            <div>
              <Label className="text-xs">Billable hours a month</Label>
              <Input
                className="h-8 text-xs"
                value={form.target}
                onChange={(e) => setForm((s) => ({ ...s, target: e.target.value }))}
              />
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Recorded from today. Work already costed keeps the rate it was costed at.
          </p>
          <div className="flex justify-end gap-1.5">
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button size="sm" className="h-7 text-xs" disabled={setRateM.isPending} onClick={save}>
              Save
            </Button>
          </div>
        </div>
      )}

      {(history.data?.history.length ?? 0) > 1 && (
        <div className="mt-2 border-t border-card-border pt-2">
          <div className="mb-1 text-[11px] font-semibold text-muted-foreground">Pay history</div>
          {history.data!.history.map((r) => (
            <div key={r.id} className="flex justify-between text-[11px] text-muted-foreground">
              <span>
                {new Date(r.effectiveFrom).toLocaleDateString()}
                {r.effectiveTo ? `–${new Date(r.effectiveTo).toLocaleDateString()}` : " (now)"}
              </span>
              <span className="tabular-nums">{formatCents(r.effectiveHourlyCostCents, symbol)}/hr</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
