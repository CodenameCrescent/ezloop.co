import { FileUp, Plus, RefreshCw, Search, Users2, Store, Briefcase, GitMerge, AlertTriangle } from "lucide-react";
import { TopBar } from "@/components/TopBar";
import { ImportDialog } from "@/views/imports/ImportDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { STATUS_CHIP_LABEL, type PeopleKind } from "./people/columns";
import { GapStrip } from "./people/GapStrip";
import { PersonDetailSheet } from "./people/PersonDetailSheet";
import { MergeDialog } from "./people/MergeDialog";
import { PersonDialog } from "./people/PersonDialog";
import { type WorkbenchPeopleState, useWorkbenchPeopleLogic } from "./People.parts/UseWorkbenchPeopleLogic";
import { PeopleTable } from "./People.parts/PeopleTable";

const TABS: Array<{ id: PeopleKind; label: string; icon: typeof Users2 }> = [
  { id: "customer", label: "Customers", icon: Users2 },
  { id: "vendor", label: "Vendors", icon: Store },
  { id: "employee", label: "Employees", icon: Briefcase },
];

export default function WorkbenchPeople() {
  const {
    setEditing,
    setAddOpen,
    kind,
    setImportOpen,
    peopleQuery,
    setKind,
    setSearch,
    setActiveGap,
    activePeople,
    peopleState,
    gapResults,
    activeGap,
    showsSetUpFilter,
    onlySetUp,
    setOnlySetUp,
    showsStatusFilter,
    clientStatusCounts,
    clientStatus,
    setClientStatus,
    showArchived,
    setShowArchived,
    rows,
    items,
    archivedCount,
    duplicates,
    setMerge,
    search,
    peopleColumns,
    setDetailId,
    emptyBecauseOfStatus,
    otherStatusSentence,
    addOpen,
    editing,
    moduleOn,
    symbol,
    createM,
    updateM,
    createClientM,
    setRateM,
    savePerson,
    merge,
    detailId,
    importOpen,
  } = useWorkbenchPeopleLogic();

  return (
    <>
      <TopBar
        title="People"
        subtitle="Customers, vendors, and employees — with lifetime value derived from the ledger."
        primaryAction={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              className="gap-2"
              onClick={() => {
                setEditing(null);
                setAddOpen(true);
              }}
            >
              <Plus className="h-4 w-4" />
              Add {kind}
            </Button>
            {/* Secondary, and second: adding one stays the main way in, and a
                spreadsheet is the other one. */}
            <Button variant="outline" size="sm" className="gap-2" onClick={() => setImportOpen(true)}>
              <FileUp className="h-4 w-4" />
              Import
            </Button>
            <Button variant="outline" size="sm" className="gap-2" onClick={() => peopleQuery.refetch()}>
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
          </div>
        }
      />

      <div className="app-page-shell">
        {/* Tabs */}
        <div className="flex flex-wrap gap-2">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const active = tab.id === kind;
            return (
              <Button
                key={tab.id}
                variant={active ? "default" : "outline"}
                size="sm"
                className="gap-2 rounded-full"
                onClick={() => {
                  setKind(tab.id);
                  setSearch("");
                  setActiveGap(null);
                }}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </Button>
            );
          })}
        </div>

        {/* What is wrong with this list, before anything else — People opens
            with the fix-it strip, not the table. Two guards, matching the
            table's own `peopleState` one below: unless the list actually
            SETTLED, `items` is the `?? []` stand-in, which would otherwise read
            as "checked, found nothing" — a moment early while it loads, and
            permanently wrong if the request failed or stopped. And with nobody
            active on this tab there is nothing to check, so an all-clear line
            here would just repeat the table's own empty state in different
            words. Either guard alone is enough today; both are kept because
            "I checked" is a claim, and it should take two mistakes to make it
            falsely. */}
        {activePeople.length > 0 && (
          <GapStrip
            results={peopleState === "settled" ? gapResults : []}
            active={activeGap}
            onToggle={(gap) => setActiveGap((cur) => (cur === gap ? null : gap))}
          />
        )}

        {/* Everyone of this kind, or only the ones actually set up. People lists
            every customer; the retired Clients table listed only those with an
            engagement. Both views are useful — this is the switch between them. */}
        <KindFilter showsSetUpFilter={showsSetUpFilter} kind={kind} onlySetUp={onlySetUp} setOnlySetUp={setOnlySetUp} showsStatusFilter={showsStatusFilter} clientStatusCounts={clientStatusCounts} clientStatus={clientStatus} setClientStatus={setClientStatus} showArchived={showArchived} setShowArchived={setShowArchived} rows={rows} items={items} archivedCount={archivedCount} />

        {/* Possible duplicates banner (customers/vendors).
            The strip says HOW MANY; this says WHICH records and why they look alike,
            which is what merging actually needs. Both count from the same list, so
            they cannot disagree. */}
        {duplicates.length > 0 && (
          <div className="rounded-xl bg-[color:var(--pl-amber-tint)] p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-[color:var(--pl-amber)]" />
              <div className="flex-1">
                <div className="font-semibold text-foreground">
                  {duplicates.length} possible duplicate {duplicates.length === 1 ? "group" : "groups"}
                </div>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  These records look like the same person. Merge them so lifetime value and history stay accurate.
                </p>
                <div className="mt-3 space-y-2">
                  {duplicates.map((group, i) => (
                    <div key={i} className="flex flex-wrap items-center justify-between gap-2 pl-glass rounded-xl px-3 py-2">
                      <div className="min-w-0 text-sm">
                        <span className="font-medium text-foreground">{group.people.map((p) => p.displayName).join(", ")}</span>
                        <span className="ml-2 text-xs text-muted-foreground">{group.reason}</span>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5"
                        onClick={() =>
                          setMerge({
                            keepId: group.people[0].id,
                            candidates: group.people.map((p) => ({ id: p.id, displayName: p.displayName })),
                          })
                        }
                      >
                        <GitMerge className="h-3.5 w-3.5" />
                        Merge
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Search */}
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`Search ${kind}s by name, email, phone, or company…`}
            className="h-9 border-card-border bg-background pl-9 shadow-none"
          />
        </div>

        {/* Table */}
        <PeopleTable peopleColumns={peopleColumns} rows={rows} setDetailId={setDetailId} peopleState={peopleState} kind={kind} peopleQuery={peopleQuery} activeGap={activeGap} search={search} setActiveGap={setActiveGap} emptyBecauseOfStatus={emptyBecauseOfStatus} clientStatus={clientStatus} otherStatusSentence={otherStatusSentence} showArchived={showArchived} archivedCount={archivedCount} />
      </div>

      <PersonDialog
        open={addOpen}
        editing={editing}
        kind={kind}
        candidates={activePeople}
        moduleOn={moduleOn}
        symbol={symbol}
        onOpenExisting={(id) => { setAddOpen(false); setEditing(null); setDetailId(id); }}
        saving={createM.isPending || updateM.isPending || createClientM.isPending || setRateM.isPending}
        onOpenChange={(o) => {
          setAddOpen(o);
          if (!o) setEditing(null);
        }}
        onSubmit={savePerson}
      />

      {merge && (
        <MergeDialog
          group={merge}
          onClose={() => setMerge(null)}
          onDone={() => {
            setMerge(null);
            peopleQuery.refetch();
          }}
        />
      )}

      <PersonDetailSheet
        id={detailId}
        onClose={() => setDetailId(null)}
        onEdit={(person) => {
          setDetailId(null);
          setEditing(person);
          setAddOpen(true);
        }}
      />

      <ImportDialog kind="people" open={importOpen} onClose={() => setImportOpen(false)} />
    </>
  );
}

function KindFilter({ showsSetUpFilter, kind, onlySetUp, setOnlySetUp, showsStatusFilter, clientStatusCounts, clientStatus, setClientStatus, showArchived, setShowArchived, rows, items, archivedCount }: Pick<WorkbenchPeopleState, "showsSetUpFilter" | "kind" | "onlySetUp" | "setOnlySetUp" | "showsStatusFilter" | "clientStatusCounts" | "clientStatus" | "setClientStatus" | "showArchived" | "setShowArchived" | "rows" | "items" | "archivedCount">) {
  return (
    <div className="flex flex-wrap items-center gap-2">
          {showsSetUpFilter &&
            [
              { on: false, label: kind === "customer" ? "All customers" : "All employees" },
              { on: true, label: kind === "customer" ? "Clients only" : "With a rate" },
            ].map((opt) => (
              <button
                key={String(opt.on)}
                type="button"
                aria-pressed={onlySetUp === opt.on}
                onClick={() => setOnlySetUp(opt.on)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  onlySetUp === opt.on
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:text-foreground"
                }`}
              >
                {opt.label}
              </button>
            ))}
          {/* Which kind of client, once "Clients only" has narrowed to clients.
              Counts orient before you click: "3 live, 12 finished" is the answer
              to half the question on its own. */}
          {showsStatusFilter && (
            <>
              <span className="mx-1 h-4 w-px bg-card-border" aria-hidden />
              {(
                [
                  ["any", "Any", null],
                  ["active", STATUS_CHIP_LABEL.active, clientStatusCounts.active],
                  ["completed", STATUS_CHIP_LABEL.completed, clientStatusCounts.completed],
                  ["churned", STATUS_CHIP_LABEL.churned, clientStatusCounts.churned],
                ] as const
              ).map(([value, label, count]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={clientStatus === value}
                  onClick={() => setClientStatus(value)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    clientStatus === value
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {label}
                  {count !== null && <span className="ml-1 tabular-nums opacity-70">{count}</span>}
                </button>
              ))}
            </>
          )}
          {/* Available on every kind and whether or not the module is on: anyone
              can be archived, so anyone has to be findable again. */}
          <label className="flex cursor-pointer items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground hover:text-foreground">
            <input
              type="checkbox"
              className="h-3 w-3"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
            />
            Show archived
          </label>
          <span className="text-xs text-muted-foreground">
            {rows.length === items.length ? `${items.length}` : `${rows.length} of ${items.length}`}
            {showArchived && (archivedCount > 0 ? ` · ${archivedCount} archived` : " · none archived")}
          </span>
        </div>
  );
}
