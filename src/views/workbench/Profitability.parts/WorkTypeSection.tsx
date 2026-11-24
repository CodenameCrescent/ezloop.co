import { Meter } from "@/components/charts/Meter";
import { WORK_TYPE_LABELS } from "@workspace/domain";
import type { EndpointResponse, getClientProfitability } from "@workspace/api-contract";

/** Where the hours went, with rework called out on its own. */
export function WorkTypeSection({
  workTypes,
  reworkByClient,
}: {
  workTypes: EndpointResponse<typeof getClientProfitability>["workTypes"];
  reworkByClient: EndpointResponse<typeof getClientProfitability>["reworkByClient"];
}) {
  if (workTypes.length === 0) return null;

  return (
    <div className="pl-glass p-4">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        What the hours went on
      </span>
      <div className="mt-2 space-y-1.5">
        {workTypes.map((w) => (
          <div key={w.workType} className="flex items-center gap-3 text-sm">
            <span className="w-40 shrink-0">{WORK_TYPE_LABELS[w.workType]}</span>
            {/* Rework is the one work type that MEANS something bad, so it
                keeps the money-loss tone; the rest are just categories. */}
            <div className="flex-1">
              <Meter
                value={w.sharePct}
                tone={w.workType === "rework" ? "loss" : "cat-4"}
                inline
              />
            </div>
            <span className="w-24 text-right text-xs tabular-nums text-muted-foreground">
              {w.hours}h · {w.sharePct.toFixed(0)}%
            </span>
          </div>
        ))}
      </div>
      {reworkByClient.length > 0 && (
        <div className="mt-3 border-t border-card-border pt-3">
          <p className="text-xs text-muted-foreground">
            Redoing work is the earliest sign of a client who cannot settle on a brief:
          </p>
          <div className="mt-1 space-y-0.5">
            {reworkByClient.map((r) => (
              <div key={r.targetId} className="flex justify-between text-xs">
                <span className="truncate">{r.label}</span>
                <span className="tabular-nums text-destructive">
                  {r.hours}h redone · {r.sharePct.toFixed(0)}% of their time
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
