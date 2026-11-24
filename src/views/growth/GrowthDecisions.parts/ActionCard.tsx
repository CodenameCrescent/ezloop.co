import type { ComponentType } from "react";
import { Clock3, CircleDot, CheckCircle2, CircleSlash, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { type GrowthActionPriority, type GrowthActionStatus, type GrowthAction } from "@/lib/growthActions";

export const PRIORITY_CLASSES: Record<GrowthActionPriority, string> = {
  high: " bg-[color:var(--pl-red-tint)] text-[color:var(--pl-red)]",
  medium: " bg-[color:var(--pl-amber-tint)] text-[color:var(--pl-amber)]",
  low: " bg-[color:var(--pl-teal-tint)] text-[color:var(--pl-teal)]",
};

export const STATUS_LABELS: Record<GrowthActionStatus, string> = {
  pending: "Pending",
  in_progress: "In progress",
  done: "Done",
  ignored: "Ignored",
};

export const STATUS_ICONS: Record<GrowthActionStatus, ComponentType<{ className?: string }>> = {
  pending: Clock3,
  in_progress: CircleDot,
  done: CheckCircle2,
  ignored: CircleSlash,
};

export function statusTone(status: GrowthActionStatus) {
  if (status === "done") return " bg-[color:var(--pl-green-tint)] text-[color:var(--pl-green)]";
  if (status === "ignored") return "border-muted bg-muted/30 text-muted-foreground";
  if (status === "in_progress") return " bg-[color:var(--pl-orange-tint)] text-primary";
  return " bg-[color:var(--pl-amber-tint)] text-[color:var(--pl-amber)]";
}

export function ActionCard({
  action,
  onStatusChange,
}: {
  action: GrowthAction;
  onStatusChange: (action: GrowthAction, status: GrowthActionStatus) => void;
}) {
  const StatusIcon = STATUS_ICONS[action.status];
  return (
    <div className="flex min-h-[270px] flex-col rounded-2xl border border-card-border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${PRIORITY_CLASSES[action.priority]}`}
            >
              {action.priority} priority
            </span>
            <span
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${statusTone(action.status)}`}
            >
              <StatusIcon className="h-3 w-3" />
              {STATUS_LABELS[action.status]}
            </span>
          </div>
          <h3 className="mt-3 text-base font-semibold leading-snug">{action.title}</h3>
        </div>
      </div>

      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{action.description}</p>
      <div className="mt-4 rounded-xl border border-card-border bg-muted/20 p-3">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5" />
          Linked insight
        </div>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{action.reason}</p>
      </div>

      <div className="mt-4 flex flex-wrap gap-2 text-xs text-muted-foreground">
        {action.relatedCategory && (
          <span className="rounded-md border border-card-border bg-background px-2 py-1">
            Category: {action.relatedCategory}
          </span>
        )}
        {action.relatedOfferId && (
          <span className="rounded-md border border-card-border bg-background px-2 py-1">
            Offer linked
          </span>
        )}
        {action.relatedClientId && (
          <span className="rounded-md border border-card-border bg-background px-2 py-1">
            Client/customer linked
          </span>
        )}
        {action.expectedImpact && (
          <span className="rounded-md border border-card-border bg-background px-2 py-1">
            {action.expectedImpact}
          </span>
        )}
      </div>

      <div className="mt-auto pt-5">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(["pending", "in_progress", "done", "ignored"] as GrowthActionStatus[]).map((status) => (
            <Button
              key={status}
              type="button"
              size="sm"
              variant={action.status === status ? "default" : "outline"}
              className="h-8 text-xs"
              onClick={() => onStatusChange(action, status)}
            >
              {STATUS_LABELS[status]}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
