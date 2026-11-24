import { useMemo, useState } from "react";
import { useGlobalPeriod } from "@/lib/globalPeriod";
import { useFormatters } from "@/lib/store";
import { toApiRange, useSources, useTransactions } from "@/api/hooks";
import { formatCentsSigned, formatCents } from "@/lib/money";
import { getCurrencySymbol } from "@/lib/currencyUtils";
import { useMediaQuery, LG_UP } from "@/lib/useMediaQuery";
import { type Column } from "@/components/DataTable";
import { type TagTone, Tag } from "@/components/Tag";
import { figureState } from "@/lib/figureState";
import { type QuickAddDraft } from "@/components/QuickAdd";
import { ORIGIN_LABEL } from "@/components/TransactionDetail";
import { resolveSelection } from "../transactionSelection";
import type { EndpointResponse } from "@workspace/api-contract";
import type { listTransactions } from "@workspace/api-contract";

export type Summary = EndpointResponse<typeof listTransactions>["items"][number];
export type GroupKey = "type" | "category" | "source";

/** Money in is positive, money out negative — the sign the server groups by. */
export const signedAmountOf = (t: Summary) => (t.direction === "in" ? t.amountCents : -t.amountCents);

/**
 * A ledger row. `partCents` is non-null when grouping by category splits a
 * mixed sale across the categories its lines belong to.
 */
export type LedgerRow = { t: Summary; partCents: number | null };

/**
 * Status is a LABEL, so it wears tag tones.
 *
 * `partially_refunded` was `bg-orange-500/10 text-orange-600` — raw Tailwind
 * palette, which is neither the app's tokens nor shadcn's, and orange besides.
 * Orange is the brand mark and never encodes data (DESIGN.md rule 2); a
 * half-refund is a shade of refund, so it takes the pink slot next to red
 * rather than borrowing the brand.
 */
export const STATUS_TONE: Record<string, TagTone> = {
  completed: "green",
  pending: "amber",
  refunded: "red",
  partially_refunded: "pink",
  disputed: "violet",
  void: "neutral",
};

/** WorkbenchTransactions's state and handlers, kept out of its render so each file stays short. */
export function useWorkbenchTransactionsLogic() {
  const period = useGlobalPeriod();
  const f = useFormatters();
  const range = useMemo(() => toApiRange(period.range), [period.range]);
  const [search, setSearch] = useState("");
  const [direction, setDirection] = useState<string>("all");
  const [sourceId, setSourceId] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");
  const [groupBy, setGroupBy] = useState<GroupKey | "none">("none");
  /** What the owner clicked. Null means "nothing chosen yet", which is not the
   *  same as "nothing to show" — see `pinnedId` below. */
  const [picked, setPicked] = useState<string | null>(null);
  const [dupDraft, setDupDraft] = useState<QuickAddDraft | null>(null);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const wide = useMediaQuery(LG_UP);
  const sources = useSources();
  const query = {
    ...range,
    limit: 200,
    ...(search.trim() ? { search: search.trim() } : {}),
    ...(direction !== "all" ? { direction } : {}),
    ...(sourceId !== "all" ? { sourceId } : {}),
    ...(status !== "all" ? { status } : {}),
    ...(groupBy !== "none" ? { groupBy } : {}),
  };
  const txns = useTransactions(query);
  const money = f.moneyCents;
  const items = txns.data?.items ?? [];
  /*
   * Whether this ledger is REAL, or just the `?? []` above standing in for one.
   *
   * Three things on this page were claims made off that fallback: the chart's
   * "Nothing moved in this period", the table's "No transactions in this
   * period", and the count line, which printed a flat "0 transactions". All
   * three were reached by `!isLoading`, and a request that failed or that
   * stopped dead reports `isLoading: false` — so a ledger that never arrived
   * read as a business that did nothing.
   */
  const txnsState = figureState(txns, txns.data != null);

  /**
   * The card beside the table always has something in it: whatever was clicked,
   * or the newest transaction if nothing was. The sheet on a narrow screen only
   * opens on a real click, which is why `picked` and `pinnedId` are separate.
   */
  const pinnedId = resolveSelection(picked, items.map((t) => t.id));

  /**
   * The graph's bars come from the SERVER, over the full filtered set — not
   * added up here from the 200 rows this page happens to be holding. The UI
   * never computes money.
   */
  const columns = useMemo(
    () => (txns.data?.buckets ?? []).map((b) => ({ key: b.start, label: b.label, inCents: b.inCents, outCents: b.outCents })),
    [txns.data?.buckets],
  );
  const hasShape = columns.some((c) => c.inCents > 0 || c.outCents > 0);

  /**
   * The rows to draw, in the order to draw them.
   *
   * Picking a grouping used to change nothing about the list — it added a strip
   * of summary cards above an identical flat table, so the control looked
   * broken. The rows are now laid out under headings built from the SAME server
   * buckets the subtotals come from, so the two can never drift apart.
   */
  const sections = useMemo(() => {
    const byId = new Map(items.map((t) => [t.id, t]));
    const groups = txns.data?.groups;
    if (groupBy === "none" || !groups) {
      return [{ key: "all", heading: null as string | null, count: items.length, amountCents: 0, rows: items.map((t) => ({ t, partCents: null as number | null })) }];
    }
    return groups
      .map((g) => ({
        key: g.key,
        heading: g.label,
        count: g.count,
        amountCents: g.amountCents,
        // A member can be off the current page; only draw what we actually have.
        rows: g.members.flatMap((m) => {
          const t = byId.get(m.id);
          return t ? [{ t, partCents: m.amountCents as number | null }] : [];
        }),
      }))
      .filter((s) => s.rows.length > 0);
  }, [items, txns.data?.groups, groupBy]);

  const ledgerColumns: Column<LedgerRow>[] = [
    {
      key: "item",
      header: "Item(s)",
      render: ({ t }) => (
        <span className="font-medium">
          {t.displayName}
          <span className="t-secondary"> · {t.personName ?? "All customers"}</span>
        </span>
      ),
    },
    { key: "source", header: "Source", hideOnMobile: true, render: ({ t }) => <span className="t-secondary">{t.sourceName}</span> },
    { key: "origin", header: "Origin", hideOnMobile: true, render: ({ t }) => <Tag>{ORIGIN_LABEL[t.origin]}</Tag> },
    {
      key: "date",
      header: "Date",
      hideOnMobile: true,
      render: ({ t }) => (
        <span className="t-secondary">
          {new Date(t.occurredAt).toLocaleDateString()}
          {/* Money owed is the thing an owner most wants to spot in a list. */}
          {t.paymentState === "unpaid" && <Tag tone="amber" className="ml-1.5">Not paid</Tag>}
        </span>
      ),
    },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      bar: ({ t, partCents }) => Math.abs(partCents ?? signedAmountOf(t)),
      render: ({ t, partCents }) => {
        // Grouping by category splits a mixed sale across the categories its
        // lines belong to, so under a heading a row shows the part that belongs
        // there — never the whole amount twice.
        const isPart = partCents !== null && partCents !== signedAmountOf(t);
        const shown = partCents ?? signedAmountOf(t);
        return (
          <span
            className="t-num font-medium"
            style={{ color: shown < 0 ? "var(--pl-red)" : "var(--pl-green)" }}
          >
            {formatCentsSigned(shown, f.symbol)}
            {isPart && <span className="t-micro block font-normal">part of {money(t.amountCents)}</span>}
            {/* Typed in another currency: the figure above is already converted. */}
            {t.entered && !isPart && (
              <span className="t-micro block font-normal text-[color:var(--pl-ink-3)]">
                typed as {formatCents(t.entered.amountCents, getCurrencySymbol(t.entered.currency))}
              </span>
            )}
          </span>
        );
      },
    },
    {
      key: "contribution",
      header: "Contribution",
      align: "right",
      hideOnMobile: true,
      render: ({ t }) => (
        <span className="t-num t-secondary">
          {t.adjustmentType
            ? formatCentsSigned(t.contributionProfitCents ?? 0, f.symbol)
            : t.contributionProfitCents != null
              ? money(t.contributionProfitCents)
              : "—"}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: ({ t }) => (
        <Tag tone={STATUS_TONE[t.status] ?? "neutral"}>{t.status.replace(/_/g, " ")}</Tag>
      ),
    },
  ];

  return {
    setQuickAddOpen,
    setImportOpen,
    period,
    txns,
    txnsState,
    hasShape,
    money,
    columns,
    search,
    setSearch,
    direction,
    setDirection,
    status,
    setStatus,
    sourceId,
    setSourceId,
    sources,
    groupBy,
    setGroupBy,
    ledgerColumns,
    sections,
    f,
    setPicked,
    pinnedId,
    wide,
    setDupDraft,
    picked,
    quickAddOpen,
    dupDraft,
    importOpen,
  };
}
