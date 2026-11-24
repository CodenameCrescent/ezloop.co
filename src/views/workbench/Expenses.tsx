import { useMemo, useState } from "react";
import { FileUp, Plus } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { ImportDialog } from "@/views/imports/ImportDialog";
import { CatalogTrendChart } from "@/components/CatalogTrendChart";
import { Tag, type TagTone } from "@/components/Tag";
import { DataTable, EmptyState, type Column } from "@/components/DataTable";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useGlobalPeriod } from "@/lib/globalPeriod";
import { useFormatters } from "@/lib/store";
import { toApiRange, useExpenseItem, useExpenseItems } from "@/api/hooks";
import { figureState, FIGURE_STATE_COPY } from "@/lib/figureState";
import { FigureSlot } from "@/components/FigureSlot";
import { COST_NATURE_LABELS, EXPENSE_PURPOSE_LABELS } from "@workspace/domain";
import { type Item, ExpenseItemDialog } from "./Expenses.parts/ExpenseItemDialog";
type Group = "none" | "type" | "costNature" | "behavior";
/**
 * These are labels, not money, so they are allowed a hue — that is what Tag is
 * for. They used to be raw Tailwind palette classes, which sat outside the
 * token system and could not be checked for contrast.
 */
const BEHAVIOR_TONE: Record<string, TagTone> = {
  recurring: "blue",
  usage_based: "violet",
  one_time: "neutral",
};
const NATURE_TONE: Record<string, TagTone> = {
  fixed: "amber",
  variable: "teal",
  semi_variable: "violet",
};

const purposeLabel = (type: string) => EXPENSE_PURPOSE_LABELS[type as keyof typeof EXPENSE_PURPOSE_LABELS] ?? type;
const natureLabel = (nature: string) => COST_NATURE_LABELS[nature as keyof typeof COST_NATURE_LABELS]?.label ?? nature;

export default function WorkbenchExpenses() {
  const period = useGlobalPeriod();
  const f = useFormatters();
  const range = useMemo(() => toApiRange(period.range), [period.range]);
  const list = useExpenseItems(range);
  const [group, setGroup] = useState<Group>("none");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editItem, setEditItem] = useState<Item | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const money = f.moneyCents;

  const items = list.data?.items ?? [];
  /*
   * Whether this catalogue is REAL, or just the `?? []` above standing in.
   *
   * Two claims hung off that fallback: the total, which printed a confident
   * Rs 0, and the table's "Nothing here yet", which told an owner with a full
   * expense list that they had never recorded a cost. Both were gated on
   * `!isLoading`, which is false for a failed AND for a paused request.
   */
  const listState = figureState(list, list.data != null);
  const groups = useMemo(() => {
    if (group === "none") return [{ label: "", rows: items }];
    const map = new Map<string, Item[]>();
    for (const it of items) {
      const key = group === "type" ? purposeLabel(it.type) : group === "costNature" ? natureLabel(it.costNature) : it.behavior;
      map.set(key, [...(map.get(key) ?? []), it]);
    }
    return [...map.entries()].map(([label, rows]) => ({ label, rows }));
  }, [items, group]);

  const expenseColumns: Column<Item>[] = [
    { key: "name", header: "Name", render: (it) => <span className="font-medium">{it.name}</span> },
    { key: "purpose", header: "What it's for", hideOnMobile: true, render: (it) => <span className="t-secondary">{purposeLabel(it.type)}</span> },
    {
      key: "nature",
      header: "Fixed or variable",
      hideOnMobile: true,
      render: (it) => (
        <span title={COST_NATURE_LABELS[it.costNature]?.help}>
          <Tag tone={NATURE_TONE[it.costNature] ?? "neutral"}>{natureLabel(it.costNature)}</Tag>
        </span>
      ),
    },
    { key: "vendor", header: "Vendor", hideOnMobile: true, render: (it) => <span className="t-secondary">{it.vendorName ?? "—"}</span> },
    { key: "behavior", header: "Behavior", hideOnMobile: true, render: (it) => <Tag tone={BEHAVIOR_TONE[it.behavior] ?? "neutral"}>{it.behavior.replace(/_/g, " ")}</Tag> },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      // The bar is what turns "which of these is eating the money?" from a
      // scan of eight figures into a glance.
      bar: (it) => it.stats.spentCents,
      render: (it) => <span className="t-num">{money(it.stats.spentCents)}</span>,
    },
    { key: "share", header: "% of total", align: "right", hideOnMobile: true, render: (it) => <span className="t-num t-secondary">{it.stats.shareOfExpensesPct.toFixed(0)}%</span> },
    { key: "status", header: "Status", render: (it) => <Tag tone={it.status === "active" ? "green" : "neutral"}>{it.status}</Tag> },
  ];

  return (
    <>
      <div className="app-page-shell">
        <PageHeader
          title="Expense"
          subtitle="The kinds of spending your business has — not the individual payments."
          actions={
            <>
              <Button onClick={() => { setEditItem(null); setDialogOpen(true); }}>
                <Plus className="h-4 w-4" /> Add expense
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
        <CatalogTrendChart metric="expense" />

        <div className="flex items-center gap-2">
          <Select value={group} onValueChange={(v) => setGroup(v as Group)}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="none">No grouping</SelectItem><SelectItem value="type">By what it's for</SelectItem><SelectItem value="costNature">By fixed or variable</SelectItem><SelectItem value="behavior">By behavior</SelectItem></SelectContent>
          </Select>
          <span className="ml-auto text-sm text-muted-foreground">
            Total:{" "}
            <FigureSlot state={listState}>
              <span className="font-semibold text-foreground tabular-nums">
                {money(list.data?.totalExpensesCents ?? 0)}
              </span>
            </FigureSlot>
          </span>
        </div>

        <div className="pl-glass overflow-x-auto">
          <DataTable<Item>
            columns={expenseColumns}
            sections={groups.map((g) => ({
              key: g.label || "all",
              label: g.label ? g.label.replace(/_/g, " ") : undefined,
              rows: g.rows,
              summary: g.label
                ? { amount: money(g.rows.reduce((s, r) => s + r.stats.spentCents, 0)) }
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
                      : "Couldn't load your expenses."
                  }
                  hint={
                    listState === "offline"
                      ? "Your expenses will appear when you're back online."
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
                  hint="Add rent, salaries, ads or software to see your true profit."
                />
              )
            }
          />
        </div>
        </div>
      </div>

      <ExpenseItemDialog open={dialogOpen} onOpenChange={setDialogOpen} editItem={editItem} symbol={f.symbol} />
      <ExpenseItemDetail
        id={detailId}
        onClose={() => setDetailId(null)}
        onEdit={(it) => { setEditItem(it); setDetailId(null); setDialogOpen(true); }}
        money={money}
        range={range}
      />
      <ImportDialog kind="expense_items" open={importOpen} onClose={() => setImportOpen(false)} />
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-card-border p-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function ExpenseItemDetail({ id, onClose, onEdit, money, range }: {
  id: string | null; onClose: () => void; onEdit: (it: Item) => void; money: (c: number) => string; range: { startDate?: string; endDate?: string };
}) {
  const detail = useExpenseItem(id, range);
  const d = detail.data;
  const item = d?.item;

  return (
    <Sheet open={!!id} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader><SheetTitle>{item?.name ?? "Expense item"}</SheetTitle></SheetHeader>
        {item && d && (
          <div className="mt-4 space-y-5 text-sm">
            <Button size="sm" variant="outline" onClick={() => onEdit(item as unknown as Item)}>Edit</Button>

            <div className="space-y-1 rounded-lg border border-card-border p-3">
              <div className="flex justify-between"><span className="text-muted-foreground">What it's for</span><span>{purposeLabel(item.type)}</span></div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Fixed or variable</span>
                <span className="text-right">{natureLabel(item.costNature)}</span>
              </div>
              <p className="pb-1 text-xs text-muted-foreground">{COST_NATURE_LABELS[item.costNature]?.help}</p>
              <div className="flex justify-between"><span className="text-muted-foreground">Behavior</span><span className="capitalize">{item.behavior.replace(/_/g, " ")}</span></div>
              {item.vendorName && <div className="flex justify-between"><span className="text-muted-foreground">Vendor</span><span>{item.vendorName}</span></div>}
              {item.categoryName && <div className="flex justify-between"><span className="text-muted-foreground">Category</span><span>{item.categoryName}</span></div>}
              <div className="flex justify-between"><span className="text-muted-foreground">Default amount</span><span className="tabular-nums">{item.defaultAmountCents == null ? "—" : money(item.defaultAmountCents)}</span></div>
              {item.notes && <div className="pt-1 text-xs text-muted-foreground">{item.notes}</div>}
            </div>

            <div className="grid grid-cols-3 gap-2">
              <Stat label="Spent" value={money(d.stats.spentCents)} />
              <Stat label="% of spend" value={`${d.stats.shareOfExpensesPct.toFixed(0)}%`} />
              <Stat label="Transactions" value={String(d.stats.transactionCount)} />
            </div>

            {d.perSource.length > 0 && (
              <div>
                <div className="mb-1 text-xs font-semibold text-muted-foreground">Per source</div>
                {d.perSource.map((s) => (
                  <div key={s.sourceId} className="flex justify-between"><span>{s.sourceName}</span><span className="tabular-nums">{money(s.spentCents)} · {s.transactionCount} txn</span></div>
                ))}
              </div>
            )}

            <div>
              <div className="mb-1 text-xs font-semibold text-muted-foreground">Recent transactions</div>
              {d.recentTransactions.map((t) => (
                <div key={t.id} className="flex justify-between text-xs">
                  <span>{new Date(t.occurredAt).toLocaleDateString()} · {t.sourceName}</span>
                  <span className="tabular-nums text-muted-foreground">{money(t.amountCents)}</span>
                </div>
              ))}
              {d.recentTransactions.length === 0 && <p className="text-xs text-muted-foreground">No transactions in this period.</p>}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
