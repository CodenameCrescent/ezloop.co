import { useQueryClient, useMutation, useQuery, type QueryClient } from "@tanstack/react-query";
import { type EndpointBody, createTeamMember, updateTeamMember, setTeamMemberRate, createClient, updateClientEngagement, setTimesheetCell, clearTimesheetRow, previewTimeImport, commitTimeImport } from "@workspace/api-contract";
import * as api from "@/lib/api-helpers/client";
import { invalidateMoney } from "./MONEY_DERIVED_KEYS";

export function useRecurringMutation<TVars, TData>(fn: (v: TVars) => Promise<TData>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["recurring"] });
      qc.invalidateQueries({ queryKey: ["subscriptions"] });
    },
  });
}
export function useSubMutation<TVars, TData>(fn: (v: TVars) => Promise<TData>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["subscriptions"] });
      qc.invalidateQueries({ queryKey: ["subscription-summary"] });
      qc.invalidateQueries({ queryKey: ["recurring"] });
      invalidateMoney(qc);
    },
  });
}

export type CompareRange = { startDate: string; endDate: string; priorStartDate: string; priorEndDate: string };

/** WHY true profit moved — named buckets, current vs prior window (Insights Block 2). */
export function useDrivers(range: CompareRange | null) {
  return useQuery({
    queryKey: ["drivers", range?.startDate, range?.endDate, range?.priorStartDate, range?.priorEndDate],
    queryFn: () => api.getDrivers({ query: range! }),
    enabled: !!range,
  });
}

/** Where profit drains — refunds, discounts, fees, unpaid aging, margin erosion (Insights Block 3). */
export function useLeaks(range: CompareRange | null) {
  return useQuery({
    queryKey: ["leaks", range?.startDate, range?.endDate, range?.priorStartDate, range?.priorEndDate],
    queryFn: () => api.getLeaks({ query: range! }),
    enabled: !!range,
  });
}

/** What's gaining/stalling + frequently-bought-together (Insights Block 4). */
export function useMomentum(range: CompareRange | null) {
  return useQuery({
    queryKey: ["momentum", range?.startDate, range?.endDate, range?.priorStartDate, range?.priorEndDate],
    queryFn: () => api.getMomentum({ query: range! }),
    enabled: !!range,
  });
}

/**
 * Computed nudge signals. No range → this month vs last month (the app-wide
 * health chip). Cached a minute so it doesn't re-fire on every navigation.
 */
export function useSignals(range?: CompareRange) {
  return useQuery({
    queryKey: ["signals", range?.startDate ?? "month", range?.endDate ?? "", range?.priorStartDate ?? "", range?.priorEndDate ?? ""],
    queryFn: () => api.getSignals({ query: range ?? {} }),
    staleTime: 60_000,
  });
}

/**
 * The MACHINE half of the same envelope: `error.code`, or null when the failure
 * never reached the server (offline, DNS, a parse error).
 *
 * For the handful of places that must BRANCH on a failure rather than show it.
 * The message is prose written for the owner — it gets reworded, and
 * `ApiError`'s own `.message` already arrives prefixed with "HTTP 400 Bad
 * Request" — so a branch that reads the sentence is a branch that stops working
 * quietly. Read the code; show the message.
 */
export function apiErrorCode(error: unknown): string | null {
  const data = (error as { data?: { error?: { code?: string } } } | null)?.data;
  return data?.error?.code ?? null;
}

/**
 * The HTTP status a failure came back with, or null when the request never got
 * an answer — offline, DNS, a connection cut mid-flight.
 *
 * `ApiError` and `ResponseParseError` both carry it (`api/apiClient.ts`); a
 * `TypeError` from a dead network carries nothing, and NULL IS NOT ZERO here.
 * "The server refused this" and "we never heard back" are different facts and a
 * caller branching on them has to be able to tell which it has — see
 * `refusedBeforeWriting` in the import flow, where the second is the dangerous
 * one.
 */
export function apiErrorStatus(error: unknown): number | null {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number" ? status : null;
}

// ── Team members (client profitability) ─────────────────────────────────────
// Gated server-side: these 403 unless the business has client profitability on.

export const invalidateTeam = (qc: QueryClient) => {
  qc.invalidateQueries({ queryKey: ["team-members"] });
  qc.invalidateQueries({ queryKey: ["overhead-default"] });
};

/** `enabled: false` keeps this quiet for businesses without the module — it 403s there. */
export function useTeamMembers(status?: "active" | "archived", opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ["team-members", status ?? "all"],
    queryFn: () => api.listTeamMembers({ query: { status } }),
    enabled: opts?.enabled ?? true,
  });
}

/**
 * The overhead share worked out from the ledger. The screen pre-fills it so the
 * owner never has to work it out — a blank left at zero would understate every
 * cost rate in the system with nothing on screen to show for it.
 */
export function useOverheadDefault(opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ["overhead-default"],
    queryFn: () => api.getOverheadDefault(),
    enabled: opts?.enabled ?? true,
  });
}

export function useTeamRateHistory(id: string | null) {
  return useQuery({
    queryKey: ["team-members", "rate-history", id],
    queryFn: () => api.getTeamMemberRateHistory({ params: { id: id! } }),
    enabled: !!id,
  });
}

export const useCreateTeamMember = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: EndpointBody<typeof createTeamMember>) => api.createTeamMember({ body }),
    onSuccess: () => invalidateTeam(qc),
  });
};

export const useUpdateTeamMember = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; body: EndpointBody<typeof updateTeamMember> }) =>
      api.updateTeamMember({ params: { id: v.id }, body: v.body }),
    onSuccess: () => invalidateTeam(qc),
  });
};

export const useSetTeamMemberRate = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; body: EndpointBody<typeof setTeamMemberRate> }) =>
      api.setTeamMemberRate({ params: { id: v.id }, body: v.body }),
    onSuccess: () => invalidateTeam(qc),
  });
};

// ── Clients and engagements (client profitability) ──────────────────────────

export const invalidateClients = (qc: QueryClient) => {
  qc.invalidateQueries({ queryKey: ["clients"] });
  qc.invalidateQueries({ queryKey: ["client-matches"] });
};

/** `enabled: false` keeps this quiet for businesses without the module — it 403s there. */
export function useClients(status?: "active" | "completed" | "churned", opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ["clients", status ?? "all"],
    queryFn: () => api.listClients({ query: { status } }),
    enabled: opts?.enabled ?? true,
  });
}

/**
 * Who might already BE this client. Checked while the owner types, so an agency
 * that already invoiced Acme attaches to that Acme instead of creating a second
 * one that splits their revenue in half.
 */
export function useClientMatches(name: string, opts?: { enabled?: boolean }) {
  const trimmed = name.trim();
  return useQuery({
    queryKey: ["client-matches", trimmed],
    queryFn: () => api.findClientMatches({ query: { name: trimmed } }),
    enabled: (opts?.enabled ?? true) && trimmed.length >= 2,
  });
}

export const useCreateClient = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: EndpointBody<typeof createClient>) => api.createClient({ body }),
    onSuccess: () => invalidateClients(qc),
  });
};

export const useUpdateClientEngagement = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { engagementId: string; body: EndpointBody<typeof updateClientEngagement> }) =>
      api.updateClientEngagement({ params: { engagementId: v.engagementId }, body: v.body }),
    onSuccess: () => invalidateClients(qc),
  });
};

// ── Timesheet (client profitability) ────────────────────────────────────────

export function useTimesheet(weekStart: string) {
  return useQuery({
    queryKey: ["timesheet", weekStart],
    queryFn: () => api.getTimesheet({ query: { weekStart } }),
  });
}

/**
 * Writes one cell. Deliberately NOT invalidating the timesheet query on
 * success: the grid holds what you typed, and refetching mid-typing would yank
 * the value out from under the cursor. The week is refetched when it changes.
 */
export const useSetTimesheetCell = () =>
  useMutation({
    mutationFn: (body: EndpointBody<typeof setTimesheetCell>) => api.setTimesheetCell({ body }),
  });

export const useClearTimesheetRow = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: EndpointBody<typeof clearTimesheetRow>) => api.clearTimesheetRow({ body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["timesheet"] }),
  });
};

// ── CSV import ──────────────────────────────────────────────────────────────

/**
 * Shows what an import WOULD do. Writes nothing, so it can be re-run freely as
 * the owner maps a name or picks a different column.
 */
export const usePreviewTimeImport = () =>
  useMutation({
    mutationFn: (body: EndpointBody<typeof previewTimeImport>) => api.previewTimeImport({ body }),
  });

/**
 * Writes the import, or refuses the whole file. Invalidates the grid AND the
 * profitability read: hours landing is exactly what changes both.
 */
export const useCommitTimeImport = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: EndpointBody<typeof commitTimeImport>) => api.commitTimeImport({ body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["timesheet"] });
      qc.invalidateQueries({ queryKey: ["client-profitability"] });
    },
  });
};

// ── Spreadsheet import ──────────────────────────────────────────────────────
//
// Bringing in a file of sales and costs, of catalog items, or of contacts. A
// different thing from the timesheet import above, which reads hours and never
// touches the ledger: this one WRITES MONEY, so committing and undoing both
// refresh every money-derived screen.

/** The history list's key, named once so the four writers below cannot mistype it. */
export const IMPORT_BATCHES_KEY = "import-batches";

/**
 * The definition-shaped things an import can MINT on its way through: a category
 * it labelled a row with, a channel the owner added at the matching step.
 *
 * Neither belongs in `MONEY_DERIVED_KEYS` — money moving does not change what a
 * category IS — so without this, a list would show the owner no sign of the
 * label they just used and they would type it again next time, ending up with
 * two categories splitting one lot of revenue between them.
 *
 * `people` and `person` are DELIBERATELY not here, although an import mints
 * contacts too: `invalidateMoney` already covers both, because a person's card
 * carries lifetime value and a last-purchase date. Listing them again is not a
 * harmless belt-and-braces. `invalidateQueries` defaults to
 * `cancelRefetch: true`, so the second call cancels the refetch the first one
 * started and fires a fresh request for every active people query — two round
 * trips per query on every commit and every undo, for one answer.
 */
export const IMPORT_MINTS_KEYS = ["categories", "sources"] as const;

export function invalidateImport(qc: QueryClient) {
  invalidateMoney(qc);
  qc.invalidateQueries({ queryKey: [IMPORT_BATCHES_KEY] });
  for (const key of IMPORT_MINTS_KEYS) qc.invalidateQueries({ queryKey: [key] });
}
