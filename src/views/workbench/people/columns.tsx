import type { ReactNode } from "react";
import { type Column } from "@/components/DataTable";
import { Tag } from "@/components/Tag";
import { Button } from "@/components/ui/button";
import { formatCents } from "@/lib/money";
import type { EngagementStatus } from "@workspace/domain";
import type { EndpointResponse, listClients, listPeople, listTeamMembers } from "@workspace/api-contract";

export type PeopleKind = "customer" | "vendor" | "employee";
export type PersonRow = EndpointResponse<typeof listPeople>["items"][number];
export type Engagement = EndpointResponse<typeof listClients>["clients"][number];
export type TeamMemberRow = EndpointResponse<typeof listTeamMembers>["members"][number];

export function fmtDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString() : "—";
}

/** A figure that may not be set yet. A dash says "not set"; a zero would be a claim. */
function centsOrDash(cents: number | null | undefined, symbol: string): string {
  return cents == null ? "—" : formatCents(cents, symbol);
}

function agreedAmountCell(e: Engagement | undefined, symbol: string): string {
  if (!e || e.agreedAmountCents == null) return "—";
  return formatCents(e.agreedAmountCents, symbol) + (e.agreedAmountPeriod === "monthly" ? "/mo" : "");
}

function agreedHoursCell(e: Engagement | undefined): string {
  if (!e || !e.agreedHours) return "—";
  return e.agreedHours + (e.agreedHoursPeriod === "monthly" ? "/mo" : "");
}

/**
 * The chip wording, in one place so the filter and its empty state can never
 * disagree about what a status is called.
 */
export const STATUS_CHIP_LABEL: Record<EngagementStatus, string> = {
  active: "Working with",
  completed: "Finished",
  churned: "Left",
};

/** Not a client yet is a real state, and reads differently from an active one. */
function engagementStatusCell(e: Engagement | undefined): ReactNode {
  if (!e) return <span className="t-secondary text-xs">not a client</span>;
  const label = e.engagementStatus === "completed" ? "finished" : e.engagementStatus;
  const tone = e.engagementStatus === "active" ? "green" : e.engagementStatus === "churned" ? "red" : "neutral";
  return <Tag tone={tone}>{label}</Tag>;
}

export function buildPeopleColumns(args: {
  kind: PeopleKind;
  moduleOn: boolean;
  symbol: string;
  engagementByPerson: Map<string, Engagement>;
  rateByPerson: Map<string, TeamMemberRow>;
  onRestore: (p: PersonRow) => void;
  restoring: boolean;
}): Column<PersonRow>[] {
  const { kind, moduleOn, symbol, engagementByPerson, rateByPerson, onRestore, restoring } = args;

  /*
   * One table, three column sets — customers, vendors and team each answer a
   * different question, and the client-profitability module swaps several
   * columns again when it is on. The set was already conditional in the markup;
   * expressing it as data makes the branches readable and lets the money
   * columns carry bars.
   *
   * The name column keeps everything that is not comparative — review flags,
   * the archived badge and its Restore button — because a column for a button
   * that only some rows have is a column that is empty for everyone else.
   */
  const nameColumn: Column<PersonRow> = {
    key: "name",
    header: "Name",
    render: (p) => (
      <span>
        <span className="flex items-center gap-2 font-semibold text-[color:var(--pl-ink)]">
          {p.displayName}
          {p.needsReview && <Tag tone="amber">review</Tag>}
          {p.status === "archived" && (
            <>
              <Tag>archived</Tag>
              <Button
                size="sm"
                variant="outline"
                className="h-6 px-2 text-[11px]"
                disabled={restoring}
                onClick={(e) => {
                  e.stopPropagation();
                  onRestore(p);
                }}
              >
                Restore
              </Button>
            </>
          )}
        </span>
        {p.company && <span className="t-micro block">{p.company}</span>}
      </span>
    ),
  };

  const peopleColumns: Column<PersonRow>[] =
    kind === "customer"
      ? [
          nameColumn,
          ...(moduleOn
            ? ([
                { key: "status", header: "Status", render: (p) => engagementStatusCell(engagementByPerson.get(p.id)) },
                { key: "agreed", header: "Agreed", align: "right", hideOnMobile: true, render: (p) => <span className="t-num t-secondary">{agreedAmountCell(engagementByPerson.get(p.id), symbol)}</span> },
                { key: "agreedHours", header: "Agreed hours", align: "right", hideOnMobile: true, render: (p) => <span className="t-num t-secondary">{agreedHoursCell(engagementByPerson.get(p.id))}</span> },
              ] as Column<PersonRow>[])
            : []),
          { key: "orders", header: "Orders", align: "right", bar: (p) => p.metrics.orderCount, render: (p) => <span className="t-num">{p.metrics.orderCount}</span> },
          { key: "revenue", header: "Lifetime revenue", align: "right", bar: (p) => p.metrics.lifetimeNetRevenueCents, render: (p) => <span className="t-num font-semibold">{formatCents(p.metrics.lifetimeNetRevenueCents)}</span> },
          { key: "contribution", header: "Lifetime contribution", align: "right", bar: (p) => p.metrics.lifetimeContributionCents, render: (p) => <span className="t-num font-semibold">{formatCents(p.metrics.lifetimeContributionCents)}</span> },
          ...(!moduleOn
            ? ([{ key: "last", header: "Last activity", align: "right", hideOnMobile: true, render: (p) => <span className="t-secondary">{fmtDate(p.metrics.lastActivityAt)}</span> }] as Column<PersonRow>[])
            : []),
        ]
      : kind === "vendor"
        ? [
            nameColumn,
            { key: "company", header: "Company", hideOnMobile: true, render: (p) => <span className="t-secondary">{p.company ?? "—"}</span> },
            { key: "bills", header: "Bills", align: "right", bar: (p) => p.metrics.orderCount, render: (p) => <span className="t-num">{p.metrics.orderCount}</span> },
            { key: "spend", header: "Total spend", align: "right", bar: (p) => p.metrics.vendorSpendCents, render: (p) => <span className="t-num font-semibold">{formatCents(p.metrics.vendorSpendCents)}</span> },
            { key: "last", header: "Last activity", align: "right", hideOnMobile: true, render: (p) => <span className="t-secondary">{fmtDate(p.metrics.lastActivityAt)}</span> },
          ]
        : moduleOn
          ? [
              nameColumn,
              { key: "role", header: "Role", hideOnMobile: true, render: (p) => <span className="t-secondary">{rateByPerson.get(p.id)?.roleLabel ?? "—"}</span> },
              { key: "paidAs", header: "Paid as", hideOnMobile: true, render: (p) => <span className="capitalize t-secondary">{rateByPerson.get(p.id)?.costType ?? "—"}</span> },
              { key: "billable", header: "Billable hrs/month", align: "right", hideOnMobile: true, render: (p) => <span className="t-num t-secondary">{rateByPerson.get(p.id)?.billableTargetHours ?? "—"}</span> },
              { key: "payRate", header: "Cost per hour", align: "right", render: (p) => <span className="t-num t-secondary">{centsOrDash(rateByPerson.get(p.id)?.payHourlyCents, symbol)}</span> },
              { key: "withOverhead", header: "With overhead", align: "right", bar: (p) => rateByPerson.get(p.id)?.effectiveHourlyCostCents ?? null, render: (p) => <span className="t-num font-semibold">{centsOrDash(rateByPerson.get(p.id)?.effectiveHourlyCostCents, symbol)}</span> },
            ]
          : [
              nameColumn,
              { key: "email", header: "Email", hideOnMobile: true, render: (p) => <span className="t-secondary">{p.email ?? "—"}</span> },
              { key: "phone", header: "Phone", hideOnMobile: true, render: (p) => <span className="t-secondary">{p.phone ?? "—"}</span> },
              { key: "payments", header: "Payments", align: "right", bar: (p) => p.metrics.orderCount, render: (p) => <span className="t-num">{p.metrics.orderCount}</span> },
              { key: "paid", header: "Total paid", align: "right", bar: (p) => p.metrics.vendorSpendCents, render: (p) => <span className="t-num font-semibold">{formatCents(p.metrics.vendorSpendCents)}</span> },
            ];

  return peopleColumns;
}
