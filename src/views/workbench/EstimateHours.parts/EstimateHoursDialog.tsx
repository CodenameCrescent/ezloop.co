import { useMemo, useState, useEffect } from "react";
import { toast } from "sonner";
import { AlertTriangle, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { usePreviewEstimate, useSetTargetEstimate, useClearTargetEstimate, useTargetEstimates, apiErrorMessage } from "@/api/hooks";
import { formatCents } from "@/lib/money";
import { todayInputValue } from "@/lib/period";
import { checkHoursTotal } from "@workspace/domain";
import { monthOf, monthLabel, SelectGroupBlock } from "./MonthOf";

export function EstimateHoursDialog({
  open,
  onOpenChange,
  members,
  targets,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  members: Array<{ id: string; name: string }>;
  targets: Array<{ targetType: string; targetId: string; label: string; group: string }>;
}) {
  const initial = useMemo(() => monthOf(new Date()), []);
  const [personId, setPersonId] = useState("");
  const [targetKey, setTargetKey] = useState("");
  const [periodStart, setPeriodStart] = useState(initial.start);
  const [periodEnd, setPeriodEnd] = useState(initial.end);
  const [hours, setHours] = useState("");

  const preview = usePreviewEstimate();
  const save = useSetTargetEstimate();
  const clear = useClearTargetEstimate();
  const existing = useTargetEstimates();

  const [targetType, targetId] = targetKey ? targetKey.split(":") : ["", ""];
  /**
   * Why the button is not ready, in words.
   *
   * It used to grey out on `Number(hours) > 0` alone, so typing something that
   * is not a number left it disabled saying "Fill in who, what, and how many
   * hours" — with all three filled in. The box that was wrong went unnamed and
   * nothing said why. Same rule as the timesheet grid, from the same place.
   */
  const hoursTyped = hours.trim();
  const HOURS_PROBLEM_TEXT = {
    not_a_number: "That isn't a number of hours. Try something like 80, or 7.5.",
    not_positive: "Hours needs to be more than 0.",
  } as const;
  const hoursIssue = checkHoursTotal(hours);
  const hoursProblem = hoursIssue ? HOURS_PROBLEM_TEXT[hoursIssue] : null;
  const ready = Boolean(personId && targetKey && periodStart && periodEnd && hoursTyped && !hoursProblem);

  useEffect(() => {
    if (!open) return;
    setPersonId(members[0]?.id ?? "");
    setTargetKey("");
    setHours("");
    setPeriodStart(initial.start);
    setPeriodEnd(initial.end);
    preview.reset();
    // Re-seeding on every open keeps a half-finished estimate from a previous
    // visit out of the way; `preview` is a stable mutation handle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, members, initial]);

  /** Re-previews whenever the shape of the estimate changes. */
  useEffect(() => {
    if (!open || !ready) return;
    const timer = setTimeout(() => {
      preview.mutate({ personId, targetType: targetType as "client", targetId, periodStart, periodEnd, hours });
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ready, personId, targetKey, periodStart, periodEnd, hours]);

  const result = ready ? preview.data : undefined;
  const blocked = result?.blockedReason ?? null;

  async function submit() {
    try {
      const done = await save.mutateAsync({
        personId,
        targetType: targetType as "client",
        targetId,
        periodStart,
        periodEnd,
        hours,
      });
      toast.success(
        done.daysReplaced > 0
          ? `${done.totalHours} hours estimated, replacing the previous estimate.`
          : `${done.totalHours} hours estimated across ${done.daysWritten} days.`,
      );
      onOpenChange(false);
    } catch (err) {
      toast.error(apiErrorMessage(err, "Could not save that estimate"));
    }
  }

  const grouped = useMemo(() => {
    const map = new Map<string, typeof targets>();
    for (const t of targets) map.set(t.group, [...(map.get(t.group) ?? []), t]);
    return [...map.entries()];
  }, [targets]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Estimate hours instead</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            No timesheet for this stretch? Say roughly how long it took and we'll spread it across the
            working days. Every figure it produces is marked as an estimate, everywhere it appears.
          </p>

          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label>Who</Label>
              <Select value={personId} onValueChange={setPersonId}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Choose a team member" />
                </SelectTrigger>
                <SelectContent>
                  {members.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {members.length === 0 && (
                <p className="mt-1 text-[11px] text-[color:var(--pl-amber)]">
                  No team members yet — add them on the Team page first, so their hours have a cost.
                </p>
              )}
            </div>

            <div className="col-span-2">
              <Label>On what</Label>
              <Select value={targetKey} onValueChange={setTargetKey}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Choose a client or product" />
                </SelectTrigger>
                <SelectContent>
                  {grouped.map(([group, items]) => (
                    <SelectGroupBlock key={group} group={group} items={items} />
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="est-from">From</Label>
              {/* An estimate writes real hours at a real cost. Days that have
                  not happened yet would be labour nobody has spent. */}
              <Input
                id="est-from"
                type="date"
                className="mt-1"
                max={todayInputValue()}
                value={periodStart}
                onChange={(e) => setPeriodStart(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="est-to">To</Label>
              <Input
                id="est-to"
                type="date"
                className="mt-1"
                max={todayInputValue()}
                value={periodEnd}
                onChange={(e) => setPeriodEnd(e.target.value)}
              />
            </div>

            <div className="col-span-2">
              <Label htmlFor="est-hours">Roughly how many hours, in total</Label>
              <Input
                id="est-hours"
                inputMode="decimal"
                aria-invalid={hoursProblem ? true : undefined}
                className={`mt-1 ${hoursProblem ? "border-destructive text-destructive focus:border-destructive" : ""}`}
                placeholder="80"
                value={hours}
                onChange={(e) => setHours(e.target.value)}
              />
              {/* Say what is wrong with the box. A greyed-out button saying
                  "fill in how many hours" — with hours filled in — said nothing. */}
              {hoursProblem && <p className="mt-1 text-[11px] text-destructive">{hoursProblem}</p>}
            </div>
          </div>

          {/* What will happen, before it happens. */}
          {blocked && (
            <div className="flex items-start gap-2 rounded-lg bg-[color:var(--pl-amber-tint)] p-3 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--pl-amber)]" />
              <p>{blocked}</p>
            </div>
          )}

          {result && !blocked && (
            <div className="rounded-lg border border-card-border p-3 text-sm">
              <p>{result.sentence}</p>
              {result.totalCostCents !== null && (
                <p className="mt-1 text-xs text-muted-foreground">
                  That's <strong>{formatCents(result.totalCostCents)}</strong> of {result.personName}'s time
                  charged to {result.targetLabel}.
                </p>
              )}
              {Number(result.replacesHours) > 0 && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Replaces the existing estimate of {result.replacesHours} hours — estimates are never
                  stacked on top of each other.
                </p>
              )}
              <p className="mt-2 text-xs text-[color:var(--pl-amber)]">{result.note}</p>
            </div>
          )}

          <Button className="w-full" disabled={!ready || Boolean(blocked) || save.isPending} onClick={submit}>
            {save.isPending
              ? "Saving…"
              : hoursProblem
                ? "Check the hours"
                : !personId
                  ? "Pick who worked"
                  : !targetKey
                    ? "Pick what they worked on"
                    : !hoursTyped
                      ? "Say roughly how many hours"
                      : blocked
                        ? "Can't estimate this stretch"
                        : `Estimate ${result?.totalHours ?? hours} hours`}
          </Button>

          {/* What is already estimated, so it can be found and undone. */}
          {(existing.data?.estimates.length ?? 0) > 0 && (
            <div>
              <Label className="text-xs">Already estimated</Label>
              <ul className="mt-1 divide-y divide-card-border/60 rounded-lg border border-card-border">
                {existing.data!.estimates.map((e) => (
                  <li
                    key={`${e.personId}|${e.targetType}|${e.targetId}|${e.firstDate}`}
                    className="flex items-center gap-2 px-3 py-2 text-xs"
                  >
                    <span className="flex-1">
                      <strong>{e.hours} hours</strong> · {e.personName} on {e.targetLabel} ·{" "}
                      {monthLabel(e.firstDate)}
                    </span>
                    <span className="tabular-nums text-muted-foreground">{formatCents(e.costCents)}</span>
                    <button
                      title="Remove this estimate"
                      className="rounded p-1 text-muted-foreground transition-colors hover:bg-[color:var(--pl-red-tint)] hover:text-destructive"
                      onClick={() =>
                        clear.mutate(
                          {
                            personId: e.personId,
                            targetType: e.targetType,
                            targetId: e.targetId,
                            periodStart: e.firstDate,
                            periodEnd: e.lastDate,
                          },
                          {
                            onSuccess: (r) => toast.success(`Removed ${r.hours} estimated hours`),
                            onError: (err) => toast.error(apiErrorMessage(err, "Could not remove that")),
                          },
                        )
                      }
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
