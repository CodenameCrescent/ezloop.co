import { useState, useMemo } from "react";
import { toast } from "sonner";
import { useStore } from "@/lib/store";
import { figureState } from "@/lib/figureState";
import { type EngagementStatus, type PersonGap, findPersonGaps } from "@workspace/domain";
import { usePeople, useCreatePerson, useUpdatePerson, useCreateClient, useSetTeamMemberRate, useClients, useTeamMembers, apiErrorMessage } from "@/api/hooks";
import type { EndpointResponse, listPeople, PersonShape } from "@workspace/api-contract";
import { type PeopleKind, buildPeopleColumns, STATUS_CHIP_LABEL } from "../people/columns";
import { type PersonCreateBody, type SetupPayload } from "../people/PersonDialog";

export type PeopleResp = EndpointResponse<typeof listPeople>;
export type DuplicateGroup = PeopleResp["possibleDuplicates"][number];

/** WorkbenchPeople's state and handlers, kept out of its render so each file stays short. */
export function useWorkbenchPeopleLogic() {
  const [kind, setKind] = useState<PeopleKind>("customer");
  const [search, setSearch] = useState("");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editing, setEditing] = useState<PersonShape | null>(null);
  const [merge, setMerge] = useState<{ keepId: string; candidates: { id: string; displayName: string }[] } | null>(null);

  /**
   * Archiving is only reversible if what was archived can be SEEN.
   *
   * Without this the door is one-way and archive is just delete with a nicer
   * name — and it already bites: merging two people archives the loser, so
   * every record merged away before this existed was unreachable.
   */
  const [showArchived, setShowArchived] = useState(false);
  const peopleQuery = usePeople(kind, showArchived ? "all" : undefined);
  const createM = useCreatePerson();
  const updateM = useUpdatePerson();
  const createClientM = useCreateClient();
  const setRateM = useSetTeamMemberRate();

  /**
   * The client and team columns.
   *
   * A detail panel answers "what about this person"; only a table answers
   * "which of these is worth having". Both lists are single queries the panels
   * already load, joined here by person id — no new endpoint, and no second
   * entity: these are columns on People, not a list of their own.
   */
  const { settings } = useStore();
  const moduleOn = settings.features?.client_profitability ?? false;
  const symbol = settings.currencySymbol ?? "Rs";
  const clientsQuery = useClients(undefined, { enabled: moduleOn && kind === "customer" });
  const teamQuery = useTeamMembers(undefined, { enabled: moduleOn && kind === "employee" });
  const engagementByPerson = useMemo(
    () => new Map((clientsQuery.data?.clients ?? []).map((c) => [c.personId, c])),
    [clientsQuery.data],
  );
  const rateByPerson = useMemo(
    () => new Map((teamQuery.data?.members ?? []).map((m) => [m.id, m])),
    [teamQuery.data],
  );
  /** "Everyone of this kind" vs "only the ones actually set up". */
  const [onlySetUp, setOnlySetUp] = useState(false);
  const showsSetUpFilter = moduleOn && (kind === "customer" || kind === "employee");

  /**
   * Which KIND of client, once you have narrowed to clients.
   *
   * The switch above answers "is this a client at all"; this answers "are we
   * still working with them". Without it the live ones and the finished ones sit
   * in one list — every row shows its own status, but answering "who am I
   * working with right now" still means reading all of them.
   *
   * Only offered on Customers, and only inside "Clients only", because that is
   * the only list where the question means anything.
   */
  const [clientStatus, setClientStatus] = useState<EngagementStatus | "any">("any");
  const showsStatusFilter = showsSetUpFilter && kind === "customer" && onlySetUp;

  const items = peopleQuery.data?.items ?? [];
  /*
   * Whether this list is REAL, or just the `?? []` above standing in for one.
   *
   * The table's empty state used to be reached by `!isLoading && rows.length
   * === 0`, and a request that failed or that stopped dead reports
   * `isLoading: false` — so a server that never answered printed "No customers
   * yet." That is not an understatement, it is a false statement about the
   * business, and the owner has no way to tell it from the true one.
   */
  const peopleState = figureState(peopleQuery, peopleQuery.data != null);
  const duplicates: DuplicateGroup[] = peopleQuery.data?.possibleDuplicates ?? [];
  const archivedCount = items.filter((p) => p.status === "archived").length;
  /** Never offer an archived person as a duplicate to reuse — step 4's job, not this list's. */
  const activePeople = useMemo(() => items.filter((p) => p.status === "active"), [items]);

  const [activeGap, setActiveGap] = useState<PersonGap | null>(null);

  /**
   * The gaps in THIS tab's records.
   *
   * `null` for a list the app did not load is deliberate and is carried all the
   * way into the strip: with the client-profitability feature off, "0 without a
   * pay rate" would be a claim the app never checked. TWO gates are needed, not
   * one: `moduleOn` alone would read a query still IN FLIGHT as "checked, found
   * nothing" (its `data` is `undefined`, not `[]`, until the fetch resolves) —
   * but `?? null` alone is not enough either, because `enabled: false` stops a
   * disabled query from fetching again without clearing what it fetched LAST
   * time. Toggle the module off after it was already on and `clientsQuery.data`
   * is still the stale array from before — `?? null` alone would let a gap that
   * depends on it run against data for a feature that is no longer checked.
   * `moduleOn` is the authoritative gate against that cache; `?? null` is what
   * makes "still loading" honest. Neither one substitutes for the other.
   */
  const gapResults = useMemo(
    () =>
      findPersonGaps(kind, {
        people: items,
        duplicateIds: duplicates.flatMap((g) => g.people.map((p) => p.id)),
        engagements: moduleOn ? (clientsQuery.data?.clients ?? null) : null,
        teamMembers: moduleOn ? (teamQuery.data?.members ?? null) : null,
      }),
    [kind, items, duplicates, moduleOn, clientsQuery.data, teamQuery.data],
  );

  const gapIds = useMemo(
    () => new Set(gapResults.find((r) => r.gap === activeGap)?.personIds ?? []),
    [gapResults, activeGap],
  );

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    let out = items;
    if (activeGap) out = out.filter((p) => gapIds.has(p.id));
    if (showsSetUpFilter && onlySetUp) {
      out = out.filter((p) => (kind === "customer" ? engagementByPerson.has(p.id) : rateByPerson.get(p.id)?.effectiveHourlyCostCents != null));
    }
    if (showsStatusFilter && clientStatus !== "any") {
      out = out.filter((p) => engagementByPerson.get(p.id)?.engagementStatus === clientStatus);
    }
    if (!q) return out;
    return out.filter((p) =>
      [p.displayName, p.email ?? "", p.phone ?? "", p.company ?? ""].join(" ").toLowerCase().includes(q),
    );
  }, [items, search, activeGap, gapIds, showsSetUpFilter, onlySetUp, showsStatusFilter, clientStatus, kind, engagementByPerson, rateByPerson]);

  const peopleColumns = buildPeopleColumns({
    kind,
    moduleOn,
    symbol,
    engagementByPerson,
    rateByPerson,
    onRestore: restorePerson,
    restoring: updateM.isPending,
  });

  /**
   * How many clients sit behind each status, counted from the SAME list the
   * table draws from — so an archived customer hidden from the table is not
   * counted in a chip that would then find nothing when clicked.
   *
   * Free to compute: the client list is already loaded in full for the columns.
   */
  const clientStatusCounts = useMemo(() => {
    const counts: Record<EngagementStatus, number> = { active: 0, completed: 0, churned: 0 };
    for (const p of items) {
      const status = engagementByPerson.get(p.id)?.engagementStatus;
      if (status) counts[status] += 1;
    }
    return counts;
  }, [items, engagementByPerson]);

  /** An empty table because of the status chip, not because there is nobody. */
  const emptyBecauseOfStatus = showsStatusFilter && clientStatus !== "any" && !search.trim();
  /** Where the others are, so a blank screen never reads as data loss. */
  const otherStatusSentence = useMemo(() => {
    const elsewhere = (Object.keys(clientStatusCounts) as EngagementStatus[])
      .filter((s) => s !== clientStatus && clientStatusCounts[s] > 0)
      .map((s) => `${clientStatusCounts[s]} ${STATUS_CHIP_LABEL[s].toLowerCase()}`);
    return elsewhere.length ? `You have ${elsewhere.join(" and ")}.` : null;
  }, [clientStatusCounts, clientStatus]);

  function restorePerson(p: PersonShape) {
    updateM.mutate(
      { id: p.id, body: { status: "active" } },
      {
        onSuccess: () => toast.success(`${p.displayName} is back in your lists`),
        onError: (e) => toast.error(apiErrorMessage(e, "Could not restore that person")),
      },
    );
  }

  /**
   * Adding a person, and optionally setting them up as a client or a team
   * member in the same breath.
   *
   * Two calls, deliberately: the person is created through People's own path
   * rather than a side door that would force the kind and skip the duplicate
   * check. If the second call fails the person still legitimately exists, so
   * nothing is rolled back — the message says exactly what landed and where to
   * finish the job.
   */
  function savePerson(input: PersonCreateBody, setup?: SetupPayload) {
    if (editing) {
      updateM.mutate(
        { id: editing.id, body: input },
        {
          onSuccess: () => {
            toast.success("Person updated");
            setAddOpen(false);
            setEditing(null);
          },
          onError: (e) => toast.error(apiErrorMessage(e, "Could not update person")),
        },
      );
      return;
    }
    createM.mutate(
      { ...input, kind },
      {
        onSuccess: (person) => {
          setAddOpen(false);
          if (!setup) {
            toast.success("Person added");
            return;
          }
          const partial = (what: string) => (e: unknown) =>
            toast.error(
              `${person.displayName} was added, but ${what} wasn't saved — open their record to finish it. ` +
                apiErrorMessage(e, ""),
            );
          if (setup.kind === "client") {
            createClientM.mutate(
              { personId: person.id, engagement: setup.engagement },
              {
                onSuccess: () => toast.success(`${person.displayName} added, with their agreed terms`),
                onError: partial("their agreed terms"),
              },
            );
          } else {
            setRateM.mutate(
              { id: person.id, body: setup.rate },
              {
                onSuccess: () => toast.success(`${person.displayName} added, with their pay recorded`),
                onError: partial("their pay"),
              },
            );
          }
        },
        onError: (e) => toast.error(apiErrorMessage(e, "Could not add person")),
      },
    );
  }

  return {
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
  };
}

export type WorkbenchPeopleState = ReturnType<typeof useWorkbenchPeopleLogic>;
