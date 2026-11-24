import { RefreshCw } from "lucide-react";
import { DataTable, EmptyState } from "@/components/DataTable";
import { Button } from "@/components/ui/button";
import { FIGURE_STATE_COPY } from "@/lib/figureState";
import { PERSON_GAP_COPY, type EngagementStatus } from "@workspace/domain";
import { type PersonRow, STATUS_CHIP_LABEL } from "../people/columns";
import { type WorkbenchPeopleState } from "./UseWorkbenchPeopleLogic";

export function PeopleTable({ peopleColumns, rows, setDetailId, peopleState, kind, peopleQuery, activeGap, search, setActiveGap, emptyBecauseOfStatus, clientStatus, otherStatusSentence, showArchived, archivedCount }: Pick<WorkbenchPeopleState, "peopleColumns" | "rows" | "setDetailId" | "peopleState" | "kind" | "peopleQuery" | "activeGap" | "search" | "setActiveGap" | "emptyBecauseOfStatus" | "clientStatus" | "otherStatusSentence" | "showArchived" | "archivedCount">) {
  return (
    <section className="pl-glass">
          <div className="app-scrollbar overflow-x-auto">
            <DataTable<PersonRow>
              columns={peopleColumns}
              rows={rows}
              getRowKey={(p) => p.id}
              onRowClick={(p) => setDetailId(p.id)}
              empty={
                peopleState === "loading" ? undefined : peopleState !== "settled" ? (
                  /* The list never arrived. Every branch below this one is a
                     statement about the business — "no customers yet", "nothing
                     left under this filter" — and not one of them is something
                     this page knows. Say what actually happened instead, and
                     offer the retry only where retrying can work: while the
                     browser reports itself offline the request is paused, not
                     failed, and it resumes by itself the moment it can. */
                  <EmptyState
                    title={
                      peopleState === "offline"
                        ? FIGURE_STATE_COPY.offline.why
                        : `Couldn't load your ${kind}s.`
                    }
                    hint={
                      peopleState === "offline"
                        ? `Your ${kind}s will appear when you're back online.`
                        : FIGURE_STATE_COPY.failed.why
                    }
                    action={
                      peopleState === "failed" ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-2"
                          onClick={() => peopleQuery.refetch()}
                        >
                          <RefreshCw className="h-4 w-4" />
                          Try again
                        </Button>
                      ) : undefined
                    }
                  />
                ) : activeGap ? (
                  /* A table filtered to nothing must say where everyone went,
                     and offer the one click that undoes it. */
                  <EmptyState
                    title={`Nothing left under "${PERSON_GAP_COPY[activeGap].label}".`}
                    hint={search.trim() ? "Your search is also narrowing this list." : undefined}
                    action={
                      <Button variant="outline" size="sm" onClick={() => setActiveGap(null)}>
                        Show everyone again
                      </Button>
                    }
                  />
                ) : emptyBecauseOfStatus ? (
                  /* Filtered to nothing is not the same as having nothing.
                     Say where they went, or the screen reads as data loss. */
                  <EmptyState
                    title={`No clients you've marked "${STATUS_CHIP_LABEL[clientStatus as EngagementStatus]}".`}
                    hint={otherStatusSentence ?? undefined}
                  />
                ) : (
                  <EmptyState
                    title={`No ${kind}s yet.`}
                    hint={showArchived && archivedCount === 0 ? "Nothing archived either." : undefined}
                  />
                )
              }
            />
          </div>
        </section>
  );
}
