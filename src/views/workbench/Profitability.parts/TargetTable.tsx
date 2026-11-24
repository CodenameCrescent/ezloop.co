import { ChartFrame } from "@/components/charts/ChartFrame";
import { DataTable } from "@/components/DataTable";
import { ShareBar } from "@/components/charts/ShareBar";
import { slotFor } from "@/lib/chartTone";
import { concentrationSentence } from "@workspace/domain";
import type { EndpointResponse, getClientProfitability } from "@workspace/api-contract";

export type Row = EndpointResponse<typeof getClientProfitability>["rows"][number];

export function TargetTable({
  title,
  rows,
  money,
  noHours,
  internal = false,
}: {
  title: string;
  rows: Row[];
  money: (c: number) => string;
  noHours: boolean;
  internal?: boolean;
}) {
  if (rows.length === 0) return null;

  return (
    <div className="pl-glass overflow-x-auto">
      <div className="border-b border-card-border px-3 py-2.5 text-xs font-semibold text-muted-foreground">{title}</div>
      <table className="w-full min-w-[640px] text-sm">
        <thead className="border-b border-card-border text-left text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">Name</th>
            {!internal && <th className="px-3 py-2 text-right font-medium">Revenue</th>}
            <th className="px-3 py-2 text-right font-medium">Hours</th>
            <th className="px-3 py-2 text-right font-medium">Their time cost</th>
            <th className="px-3 py-2 text-right font-medium">{internal ? "Cost" : "Left after costs"}</th>
            {!internal && <th className="px-3 py-2 text-right font-medium">Margin</th>}
            {!internal && <th className="px-3 py-2 text-right font-medium">Per hour</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.targetType}:${r.targetId}`} className="border-b border-card-border/60 last:border-0">
              <td className="px-3 py-2 font-medium">
                {r.label}
                {r.hasEstimates && (
                  <span className="ml-1.5 rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">estimated</span>
                )}
              </td>
              {!internal && <td className="px-3 py-2 text-right tabular-nums">{money(r.revenueCents)}</td>}
              <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                {r.isCosted ? r.hoursLogged : "—"}
              </td>
              {/*
                THE guard, at the last inch. An uncosted row renders a marker in
                every money column — there is no number to show, because showing
                one would mean inventing it.
              */}
              {r.isCosted ? (
                <>
                  <td className="px-3 py-2 text-right tabular-nums">{money(r.labourCostCents!)}</td>
                  <td
                    className={`px-3 py-2 text-right font-semibold tabular-nums ${
                      r.contributionCents! < 0 ? "text-destructive" : ""
                    }`}
                  >
                    {money(r.contributionCents!)}
                  </td>
                  {!internal && (
                    <td className="px-3 py-2 text-right tabular-nums">
                      {r.marginPct == null ? "—" : `${r.marginPct.toFixed(1)}%`}
                    </td>
                  )}
                  {!internal && (
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                      {r.effectiveHourlyRateCents == null ? "—" : money(r.effectiveHourlyRateCents)}
                    </td>
                  )}
                </>
              ) : (
                <td className="px-3 py-2 text-right" colSpan={internal ? 2 : 4}>
                  <span className="rounded-md bg-[color:var(--pl-amber-tint)] px-2 py-0.5 text-xs text-[color:var(--pl-amber)]">
                    No hours logged
                  </span>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {!noHours && rows.some((r) => !r.isCosted) && (
        <p className="border-t border-card-border px-3 py-2 text-xs text-muted-foreground">
          Rows without hours are left out of every total above — including them would count their
          revenue as pure profit.
        </p>
      )}
    </div>
  );
}

/** Clients past the hours they agreed to, with the two rates that pulled apart. */
export type ScopeRow = EndpointResponse<typeof getClientProfitability>["scopeCreep"][number];

export function ScopeCreepSection({
  rows,
  money,
}: {
  rows: EndpointResponse<typeof getClientProfitability>["scopeCreep"];
  money: (c: number) => string;
}) {
  const over = rows.filter((r) => r.isOver);
  if (rows.length === 0) return null;

  return (
    <div className="pl-glass overflow-x-auto">
      <div className="border-b border-card-border px-3 py-2.5 text-xs font-semibold text-muted-foreground">
        Hours against what was agreed
      </div>
      {over.length === 0 ? (
        <p className="px-3 py-4 text-sm text-muted-foreground">
          Every client with agreed hours is still inside them.
        </p>
      ) : (
        <DataTable<ScopeRow>
          columns={[
            { key: "client", header: "Client", render: (r) => <span className="font-medium">{r.label}</span> },
            { key: "agreed", header: "Agreed", align: "right", render: (r) => <span className="t-num t-secondary">{r.agreedHours}</span> },
            {
              key: "actual",
              header: "Actual",
              align: "right",
              // The bar makes the overrun visible before the percentage is read.
              // Hours arrive as a decimal STRING (quantities are decimal strings
              // throughout, so they never touch float math) — parse for the bar,
              // and render the string itself unchanged.
              bar: (r) => {
                const n = Number(r.actualHours);
                return Number.isFinite(n) ? n : null;
              },
              render: (r) => <span className="t-num">{r.actualHours}</span>,
            },
            {
              key: "over",
              header: "Over by",
              align: "right",
              render: (r) => (
                <span className="t-num font-semibold text-[color:var(--pl-amber)]">
                  {r.overPct == null ? "—" : `${r.overPct.toFixed(0)}%`}
                </span>
              ),
            },
            {
              key: "priced",
              header: "Priced at",
              align: "right",
              hideOnMobile: true,
              render: (r) => (
                <span className="t-num t-secondary">
                  {r.agreedHourlyRateCents == null ? "—" : `${money(r.agreedHourlyRateCents)}/hr`}
                </span>
              ),
            },
            {
              key: "earning",
              header: "Really earning",
              align: "right",
              render: (r) => (
                <span className="t-num font-semibold">
                  {r.effectiveHourlyRateCents == null ? "—" : `${money(r.effectiveHourlyRateCents)}/hr`}
                </span>
              ),
            },
          ]}
          rows={over}
          getRowKey={(r) => r.targetId}
        />
      )}
      {over.length > 0 && (
        <p className="border-t border-card-border px-3 py-2 text-xs text-muted-foreground">
          The gap between the last two columns is what overrunning actually costs you — the job was
          priced at one rate and is being delivered at another.
        </p>
      )}
    </div>
  );
}

/** How much of the book rests on one client. */
export function ConcentrationSection({
  concentration,
  money,
}: {
  concentration: EndpointResponse<typeof getClientProfitability>["concentration"];
  money: (c: number) => string;
}) {
  if (concentration.topSharePct == null) return null;
  const tone =
    concentration.risk === "high"
      ? " bg-[color:var(--pl-red-tint)]"
      : concentration.risk === "watch"
        ? " bg-[color:var(--pl-amber-tint)]"
        : "border-card-border bg-muted/10";

  return (
    <div className={`rounded-xl border p-4 ${tone}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          How spread out your income is
        </span>
        <span className="text-2xl font-bold tabular-nums">{concentration.topSharePct.toFixed(0)}%</span>
      </div>
      <p className="mt-1 text-sm">{concentrationSentence(concentration)}</p>
      {/* Client concentration: identity, not money — these are WHICH clients,
          and the categorical slots exist for exactly that. The version this
          replaces drew the biggest client in the brand orange fill and every
          other one in the orange tint, which said "the largest is the brand"
          rather than "these are different clients". It also drew its own
          1px dividers; the 2px surface gap does that job without adding ink. */}
      <ChartFrame
        height={40}
        /* This block only renders under `summary`, which exists only when the
           request settled — so the frame is being told a fact, not guessing. */
        state="settled"
        empty={concentration.slices.length === 0}
        emptyMessage="Record a sale against a client to see who your revenue rests on."
        surface={false}
        className="mt-3"
      >
        <ShareBar
          segments={concentration.slices.slice(0, 8).map((s, i) => ({
            id: s.label,
            label: s.label,
            value: s.revenueCents,
            tone: slotFor(i),
          }))}
          layout="stacked"
          format={money}
          size="sm"
        />
      </ChartFrame>
      <div className="mt-2 space-y-0.5">
        {concentration.slices.slice(0, 5).map((s) => (
          <div key={s.label} className="flex justify-between text-xs">
            <span className="truncate">{s.label}</span>
            <span className="tabular-nums text-muted-foreground">
              {money(s.revenueCents)} · {s.sharePct.toFixed(0)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
