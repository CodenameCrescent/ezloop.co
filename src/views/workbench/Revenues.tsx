import { useMemo, useState } from "react";
import { ChevronRight, FileUp, Plus } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { ImportDialog } from "@/views/imports/ImportDialog";
import { CatalogTrendChart } from "@/components/CatalogTrendChart";
import { Tag } from "@/components/Tag";
import { DataTable, EmptyState, type Column } from "@/components/DataTable";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useGlobalPeriod } from "@/lib/globalPeriod";
import { useFormatters } from "@/lib/store";
import { toApiRange, useRevenueItems } from "@/api/hooks";
import { HEALTH_DOT_CLASS, marginHealth } from "@/lib/money";
import { figureState, FIGURE_STATE_COPY } from "@/lib/figureState";
import { FigureSlot } from "@/components/FigureSlot";
import { formatQuantity } from "@workspace/domain";
import { RevenueItemDialog } from "@/components/RevenueItemDialog";
import { type Item, RevenueItemDetail } from "./Revenues.parts/CostComponentEditor";
/** An item plus where it sits in the variant tree. */
type Row = Item & { depth: number; descendantCount: number; isCollapsed: boolean; hidden: boolean };
type Group = "none" | "type" | "category";
type SortKey = "netRevenueCents" | "contributionProfitCents" | "marginPct";

export default function WorkbenchRevenues() {
  const period = useGlobalPeriod();
  const f = useFormatters();
  const range = useMemo(() => toApiRange(period.range), [period.range]);
  const list = useRevenueItems(range);
  const [group, setGroup] = useState<Group>("none");
  const [sort, setSort] = useState<SortKey>("netRevenueCents");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editItem, setEditItem] = useState<Item | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const money = f.moneyCents;

  /*
   * Whether this catalogue is REAL, or just an empty fallback standing in.
   *
   * Same defect as its twin on Expense: the total printed Rs 0 and the table
   * said "Nothing here yet" whenever the request failed or stopped, both
   * because they were gated on `!isLoading` — which those two states leave
   * false. See `lib/figureState.ts`.
   */
  const listState = figureState(list, list.data != null);

  /** Parents whose variants are folded away. Expanded is the default. */
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleCollapsed = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  /**
   * Variants are rows of the same table, so flatten the tree into display order:
   * each root followed by its variants, indented. Sorting applies to roots —
   * a variant always stays under its parent.
   *
   * Folding marks rows HIDDEN rather than dropping them, so the group subtotals
   * below are computed over the whole tree. A total that fell when you folded a
   * product away would be reporting the state of the screen rather than the
   * state of the business.
   */
  const items = useMemo(() => {
    const all = list.data?.items ?? [];
    const childrenOf = new Map<string, Item[]>();
    for (const it of all) {
      if (!it.parentId) continue;
      childrenOf.set(it.parentId, [...(childrenOf.get(it.parentId) ?? []), it]);
    }
    const byStat = (a: Item, b: Item) =>
      sort === "marginPct" ? (b.stats.marginPct ?? -1) - (a.stats.marginPct ?? -1) : b.stats[sort] - a.stats[sort];

    const out: Array<Item & { depth: number; descendantCount: number; isCollapsed: boolean; hidden: boolean }> = [];
    /** Everything below this node, not just its direct children — that is what folding actually hides. */
    const walk = (node: Item, depth: number, hidden: boolean): number => {
      const children = (childrenOf.get(node.id) ?? []).sort(byStat);
      const isCollapsed = collapsed.has(node.id);
      const row = { ...node, depth, descendantCount: 0, isCollapsed, hidden };
      out.push(row);
      let below = 0;
      for (const child of children) below += 1 + walk(child, depth + 1, hidden || isCollapsed);
      row.descendantCount = below;
      return below;
    };
    for (const root of all.filter((i) => !i.parentId).sort(byStat)) walk(root, 0, false);
    return out;
  }, [list.data, sort, collapsed]);

  const groups = useMemo(() => {
    if (group === "none") return [{ key: "", label: "", rows: items }];
    const map = new Map<string, Row[]>();
    for (const it of items) {
      const key = group === "type" ? it.type : it.categoryName ?? "Uncategorized";
      map.set(key, [...(map.get(key) ?? []), it]);
    }
    return [...map.entries()].map(([label, rows]) => ({ key: label, label, rows }));
  }, [items, group]);

  /*
   * Eleven columns of figures, and the four that carry money now carry a bar
   * behind the figure too — so the shape of the catalogue is readable without
   * comparing digits down the column. The renderers are the ones that were
   * already here; this is a shell swap, not a redesign.
   */
  const catalogueColumns: Column<Row>[] = [
    {
      key: "name",
      header: "Name",
      render: (it) => (
        <span className="font-medium" style={{ paddingLeft: it.depth * 18 }}>
          {it.depth > 0 && <span className="mr-1 text-[color:var(--pl-ink-2)]">└</span>}
          {it.descendantCount > 0 && (
            // stopPropagation: folding the variants away must not also open the
            // item's detail panel.
            <button
              onClick={(e) => { e.stopPropagation(); toggleCollapsed(it.id); }}
              aria-expanded={!it.isCollapsed}
              title={it.isCollapsed ? `Show ${it.descendantCount} variants` : "Hide variants"}
              className="mr-1 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded align-middle text-[color:var(--pl-ink-2)] hover:bg-[color:var(--pl-recessed)] hover:text-[color:var(--pl-ink)]"
            >
              <ChevronRight className={`h-3.5 w-3.5 transition-transform ${it.isCollapsed ? "" : "rotate-90"}`} />
            </button>
          )}
          {it.name}
          {/* Say what is folded away: this row's own figures are zero, because
              a grouping row never sells. */}
          {it.isCollapsed && (
            <span className="ml-1.5 text-xs font-normal text-[color:var(--pl-ink-2)]">
              {it.descendantCount} {it.descendantCount === 1 ? "variant" : "variants"} hidden
            </span>
          )}
        </span>
      ),
    },
    { key: "type", header: "Type", hideOnMobile: true, render: (it) => <span className="capitalize t-secondary">{it.depth > 0 ? "variant" : it.type}</span> },
    { key: "category", header: "Category", hideOnMobile: true, render: (it) => <span className="t-secondary">{it.categoryName ?? "—"}</span> },
    {
      key: "sources",
      header: "Sources",
      hideOnMobile: true,
      render: (it) =>
        it.sources.length ? (
          <span className="flex flex-wrap gap-1">
            {it.sources.map((s) => <Tag key={s.sourceId}>{s.sourceName}</Tag>)}
          </span>
        ) : (
          <span className="t-secondary">—</span>
        ),
    },
    {
      key: "price",
      header: "Price",
      align: "right",
      hideOnMobile: true,
      render: (it) =>
        it.hasVariants ? <span className="t-secondary text-xs">per variant</span>
          : it.unitPriceCents == null ? <span className="t-secondary text-xs">variable</span>
          : <span className="t-num">{money(it.unitPriceCents)}</span>,
    },
    {
      key: "sold",
      header: "Sold",
      align: "right",
      bar: (it) => it.stats.unitsSold,
      render: (it) => <span className="t-num">{it.stats.unitsSold === 0 ? "—" : formatQuantity(String(it.stats.unitsSold), it.unitLabel)}</span>,
    },
    {
      key: "netRevenue",
      header: "Net revenue",
      align: "right",
      bar: (it) => it.stats.netRevenueCents,
      render: (it) => <span className="t-num">{money(it.stats.netRevenueCents)}</span>,
    },
    {
      key: "contribution",
      header: "Contribution",
      align: "right",
      bar: (it) => it.stats.contributionProfitCents,
      render: (it) => <span className="t-num">{money(it.stats.contributionProfitCents)}</span>,
    },
    {
      key: "margin",
      header: "Margin",
      align: "right",
      render: (it) => (
        <span className="t-num inline-flex items-center gap-1.5">
          <span className={`h-2 w-2 rounded-full ${HEALTH_DOT_CLASS[marginHealth(it.stats.marginPct)]}`} />
          {it.stats.marginPct == null ? "—" : `${it.stats.marginPct.toFixed(0)}%`}
        </span>
      ),
    },
    { key: "refund", header: "Refund %", align: "right", hideOnMobile: true, render: (it) => <span className="t-num t-secondary">{it.stats.refundRatePct.toFixed(0)}%</span> },
    { key: "status", header: "Status", render: (it) => <Tag tone={it.status === "active" ? "green" : "neutral"}>{it.status}</Tag> },
  ];

  return (
    <>
      <div className="app-page-shell">
        <PageHeader
          title="Revenue"
          subtitle="Everything your business earns money from, and what each one costs you."
          actions={
            <>
              <Button onClick={() => { setEditItem(null); setDialogOpen(true); }}>
                <Plus className="h-4 w-4" /> Add revenue
              </Button>
              {/* Secondary, and second: adding one stays the main way in, and a
                  spreadsheet is the other one. */}
              <Button variant="outline" onClick={() => setImportOpen(true)}>
                <FileUp className="h-4 w-4" /> Import
              </Button>
            </>
          }
        />
        <div className="space-y-4">
        <CatalogTrendChart metric="revenue" />

        <div className="flex flex-wrap items-center gap-2">
          <Select value={group} onValueChange={(v) => setGroup(v as Group)}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="none">No grouping</SelectItem><SelectItem value="type">By type</SelectItem><SelectItem value="category">By category</SelectItem></SelectContent>
          </Select>
          <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
            <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="netRevenueCents">Sort: Net revenue</SelectItem><SelectItem value="contributionProfitCents">Sort: Contribution</SelectItem><SelectItem value="marginPct">Sort: Margin</SelectItem></SelectContent>
          </Select>
          <span className="ml-auto text-sm text-muted-foreground">
            Total net revenue:{" "}
            <FigureSlot state={listState}>
              <span className="font-semibold text-foreground tabular-nums">
                {money(list.data?.totalNetRevenueCents ?? 0)}
              </span>
            </FigureSlot>
          </span>
        </div>

        <DataTable<Row>
          columns={catalogueColumns}
          sections={groups.map((g) => ({
            key: g.key || "all",
            label: g.label || undefined,
            rows: g.rows.filter((r) => !r.hidden),
            summary: g.label
              ? {
                  netRevenue: money(g.rows.reduce((s, r) => s + r.stats.netRevenueCents, 0)),
                  contribution: money(g.rows.reduce((s, r) => s + r.stats.contributionProfitCents, 0)),
                }
              : undefined,
          }))}
          getRowKey={(row) => row.id}
          onRowClick={(row) => setDetailId(row.id)}
          empty={
            listState === "loading" ? undefined : listState !== "settled" ? (
              <EmptyState
                title={
                  listState === "offline"
                    ? FIGURE_STATE_COPY.offline.why
                    : "Couldn't load what you sell."
                }
                hint={
                  listState === "offline"
                    ? "Your revenue items will appear when you're back online."
                    : FIGURE_STATE_COPY.failed.why
                }
                action={
                  listState === "failed" ? (
                    <Button variant="outline" size="sm" onClick={() => list.refetch()}>
                      Try again
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <EmptyState
                title="Nothing here yet"
                hint="Add the first thing you sell to start tracking its profit."
              />
            )
          }
        />
        </div>
      </div>

      <RevenueItemDialog open={dialogOpen} onOpenChange={setDialogOpen} editItem={editItem} symbol={f.symbol} />
      <RevenueItemDetail id={detailId} onClose={() => setDetailId(null)} onEdit={(it) => { setEditItem(it); setDetailId(null); setDialogOpen(true); }} money={money} symbol={f.symbol} range={range} />
      <ImportDialog kind="revenue_items" open={importOpen} onClose={() => setImportOpen(false)} />
    </>
  );
}
