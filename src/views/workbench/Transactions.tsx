import { FileUp, Plus } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { ImportDialog } from "@/views/imports/ImportDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatCentsSigned } from "@/lib/money";
import { PendingRecurringQueue } from "@/components/PendingRecurringQueue";
import { DataTable, EmptyState } from "@/components/DataTable";
import { Surface } from "@/components/Surface";
import { ChartFrame } from "@/components/charts/ChartFrame";
import { figureStateSentence, FIGURE_STATE_COPY } from "@/lib/figureState";
import { InOutColumns } from "@/components/charts/InOutColumns";
import { QuickAdd } from "@/components/QuickAdd";
import { TransactionDetail } from "@/components/TransactionDetail";
import { type GroupKey, type LedgerRow, useWorkbenchTransactionsLogic } from "./Transactions.parts/UseWorkbenchTransactionsLogic";

const BUCKET_NOUN: Record<string, string> = { day: "day", week: "week", month: "month", year: "year" };

export default function WorkbenchTransactions() {
  const {
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
  } = useWorkbenchTransactionsLogic();

  return (
    <div className="app-page-shell">
      <PageHeader
        title="Transactions"
        subtitle="Every money movement — one unified ledger."
        actions={
          <>
            <Button onClick={() => setQuickAddOpen(true)}>
              <Plus className="h-4 w-4" />
              Quick Add
            </Button>
            {/* Secondary, and second: one at a time stays the main way in, and a
                spreadsheet is the other one. */}
            <Button variant="outline" onClick={() => setImportOpen(true)}>
              <FileUp className="h-4 w-4" />
              Import
            </Button>
          </>
        }
      />

      <PendingRecurringQueue />

      {/* The ledger and its card. The card is a column of the grid rather than
          an overlay, so nothing it says is ever hiding a row behind it. */}
      <div className="mt-4 grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-4">
          <ChartFrame
            title="Money in and out"
            hint={`${period.range.label} · by ${BUCKET_NOUN[txns.data?.bucket ?? "day"]}`}
            height={148}
            state={txnsState}
            empty={!hasShape}
            emptyMessage="Nothing moved in this period. Record a sale or a bill, or widen the dates."
            legend={[
              { label: "Money in", tone: "gain", shape: "square" },
              { label: "Money out", tone: "neutral", shape: "square" },
            ]}
            tableView={{
              columns: [
                { key: "label", header: "When", render: (c) => c.label },
                { key: "in", header: "Money in", align: "right", render: (c) => <span className="t-num">{money(c.inCents)}</span> },
                { key: "out", header: "Money out", align: "right", render: (c) => <span className="t-num">{money(c.outCents)}</span> },
              ],
              rows: columns,
              getRowKey: (c) => c.key,
            }}
          >
            <InOutColumns columns={columns} format={money} />
          </ChartFrame>

          <div className="flex flex-wrap items-center gap-2">
            <Input placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} className="w-48" />
            <FilterSelect value={direction} onChange={setDirection} placeholder="Direction" options={[["all", "All"], ["in", "Money in"], ["out", "Money out"]]} />
            <FilterSelect value={status} onChange={setStatus} placeholder="Status"
              options={[["all", "All"], ["completed", "Completed"], ["pending", "Pending"], ["refunded", "Refunded"], ["partially_refunded", "Partially refunded"]]} />
            <FilterSelect value={sourceId} onChange={setSourceId} placeholder="Source"
              options={[["all", "All sources"], ...(sources.data ?? []).map((s) => [s.id, s.name] as [string, string])]} />
            <FilterSelect value={groupBy} onChange={(v) => setGroupBy(v as GroupKey | "none")} placeholder="Group by"
              options={[["none", "No grouping"], ["type", "By type"], ["category", "By category"], ["source", "By source"]]} />
          </div>

          <DataTable<LedgerRow>
            columns={ledgerColumns}
            sections={sections.map((section) => ({
              key: section.key,
              label: section.heading
                ? `${section.heading} · ${section.count} ${section.count === 1 ? "transaction" : "transactions"}`
                : undefined,
              rows: section.rows,
              summary: section.heading
                ? {
                    amount: (
                      <span
                        className="t-num"
                        style={{ color: section.amountCents < 0 ? "var(--pl-red)" : "var(--pl-green)" }}
                      >
                        {formatCentsSigned(section.amountCents, f.symbol)}
                      </span>
                    ),
                  }
                : undefined,
            }))}
            getRowKey={(row, i) => `${row.t.id}:${i}`}
            onRowClick={(row) => setPicked(row.t.id)}
            isRowActive={(row) => row.t.id === pinnedId}
            empty={
              txnsState === "loading" ? undefined : txnsState !== "settled" ? (
                <EmptyState
                  title={
                    txnsState === "offline"
                      ? FIGURE_STATE_COPY.offline.why
                      : "Couldn't load your transactions."
                  }
                  hint={
                    txnsState === "offline"
                      ? "Your transactions will appear when you're back online."
                      : FIGURE_STATE_COPY.failed.why
                  }
                  action={
                    /* Offered only where retrying can work: an offline query is
                       paused, not failed, and resumes by itself on reconnect. */
                    txnsState === "failed" ? (
                      <Button variant="outline" size="sm" onClick={() => txns.refetch()}>
                        Try again
                      </Button>
                    ) : undefined
                  }
                />
              ) : (
                <EmptyState
                  title="No transactions in this period"
                  hint="Record a sale or a bill, or widen the date range."
                />
              )
            }
          />
          {/* A count is a figure, so it obeys the same rule as the money above
              it: "0 transactions" is a statement about the business, and this
              page only gets to make it when the server actually said so. */}
          <p className="t-micro text-[color:var(--pl-ink-3)]">
            {txnsState === "settled" ? (
              `${txns.data?.totalCount ?? 0} transactions`
            ) : txnsState === "loading" ? (
              "Counting…"
            ) : (
              <span className="text-[color:var(--pl-amber)]">
                {figureStateSentence(txnsState, "your transactions")}
              </span>
            )}
          </p>
        </div>

        {/* Sticky, so scrolling a long ledger never scrolls the details away
            from the rows they belong to. */}
        {wide && (
          <Surface padding="md" className="sticky top-24 max-h-[calc(100vh-8rem)] overflow-y-auto">
            <TransactionDetail
              id={pinnedId}
              onDone={() => setPicked(null)}
              onDuplicate={(draft) => setDupDraft(draft)}
              money={money}
              symbol={f.symbol}
            />
          </Surface>
        )}
      </div>

      {/* Narrow screens get the same card in a slide-over — one design, two
          containers, so the phone cannot drift into being a second one. */}
      {!wide && (
        <Sheet open={picked !== null} onOpenChange={(v) => !v && setPicked(null)}>
          <SheetContent className="w-full overflow-y-auto sm:max-w-md">
            <SheetHeader><SheetTitle>Transaction</SheetTitle></SheetHeader>
            <div className="mt-4">
              <TransactionDetail
                id={picked}
                onDone={() => setPicked(null)}
                onDuplicate={(draft) => { setPicked(null); setDupDraft(draft); }}
                money={money}
                symbol={f.symbol}
                showTitle={false}
              />
            </div>
          </SheetContent>
        </Sheet>
      )}

      <QuickAdd open={quickAddOpen} onOpenChange={setQuickAddOpen} />
      {/* Duplicate opens Quick Add prefilled; saving posts a NEW transaction. */}
      <QuickAdd open={!!dupDraft} onOpenChange={(v) => !v && setDupDraft(null)} initial={dupDraft} />

      <ImportDialog kind="transactions" open={importOpen} onClose={() => setImportOpen(false)} />
    </div>
  );
}

function FilterSelect({ value, onChange, placeholder, options }: { value: string; onChange: (v: string) => void; placeholder: string; options: [string, string][] }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-40"><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent>{options.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
    </Select>
  );
}
