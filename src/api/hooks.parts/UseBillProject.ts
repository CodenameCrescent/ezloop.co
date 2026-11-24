import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { type EndpointQuery, listProjects, type EndpointBody, createProject, updateProject, billProject, createBudget, updateBudget, settleFromAdvance } from "@workspace/api-contract";
import * as api from "@/lib/api-helpers/client";
import { type Range, rangeKey, invalidateMoney } from "./MONEY_DERIVED_KEYS";

// ── Money owed ──────────────────────────────────────────────────────────────

/**
 * Who owes you and who you owe. Deliberately takes NO date range: an unpaid
 * bill from March is exactly as outstanding today as one from last week, and
 * scoping it to the header's period would hide the oldest debts — the only ones
 * that really matter.
 */
export function useOwed() {
  return useQuery({ queryKey: ["owed"], queryFn: () => api.getOwed() });
}

/**
 * Settle a row from the owed list. Marks it paid TODAY, which is what the
 * button says: an owner ticking a bill off is recording that the money moved
 * now, not backdating it.
 */
export const useMarkPaid = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.updateTransaction({ params: { id }, body: { paidAt: new Date().toISOString() } }),
    // Paying a bill moves cash, so every cash-basis figure in the app is now
    // stale — not just this list.
    onSuccess: () => invalidateMoney(qc),
  });
};

// ── Projects (sites, contracts, production runs) ────────────────────────────
//
// Gated on the `projects` feature server-side, so these 403 for a business
// whose unit of work is an order. The nav hides the link as well, but hiding a
// link is not gating — the server's refusal is the real one.

export function useProjects(status?: EndpointQuery<typeof listProjects>["status"]) {
  return useQuery({
    queryKey: ["projects", status ?? "all"],
    queryFn: () => api.listProjects({ query: status ? { status } : {} }),
  });
}

export function useProject(id: string | null) {
  return useQuery({
    queryKey: ["project", id],
    queryFn: () => api.getProject({ params: { id: id! } }),
    enabled: !!id,
  });
}

export const useCreateProject = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: EndpointBody<typeof createProject>) => api.createProject({ body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects"] }),
  });
};

export const useUpdateProject = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; body: EndpointBody<typeof updateProject> }) =>
      api.updateProject({ params: { id: v.id }, body: v.body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["project"] });
    },
  });
};

/**
 * Raise an invoice against a project, optionally holding a percentage back.
 *
 * Invalidates the whole money surface, not just projects: with a retention this
 * writes two real receivables, so the owed lists, the ladder and the cash view
 * are all now stale.
 */
export const useBillProject = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; body: EndpointBody<typeof billProject> }) =>
      api.billProject({ params: { id: v.id }, body: v.body }),
    onSuccess: () => {
      invalidateMoney(qc);
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["project"] });
    },
  });
};

export function useBudget(id: string | null) {
  return useQuery({
    queryKey: ["budget", id],
    queryFn: () => api.getBudget({ params: { id: id! } }),
    enabled: !!id,
  });
}

export const useCreateBudget = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: EndpointBody<typeof createBudget>) => api.createBudget({ body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["budgets"] }),
  });
};

export const useUpdateBudget = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; body: EndpointBody<typeof updateBudget> }) =>
      api.updateBudget({ params: { id: v.id }, body: v.body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["budgets"] });
      qc.invalidateQueries({ queryKey: ["budget"] });
    },
  });
};

/**
 * A first draft from real history. Only fetched when the owner asks for it —
 * it reads months of the ledger, and nobody should pay for that on page load.
 */
export function useBudgetSuggestion(months: number, enabled: boolean) {
  return useQuery({
    queryKey: ["budget-suggestion", months],
    queryFn: () => api.suggestBudget({ query: { months } }),
    enabled,
  });
}

/**
 * Draw an advance down against a real bill. Invalidates the whole money
 * surface: this can settle the bill outright, which moves cash figures too.
 */
export const useSettleFromAdvance = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; body: EndpointBody<typeof settleFromAdvance> }) =>
      api.settleFromAdvance({ params: { id: v.id }, body: v.body }),
    onSuccess: () => invalidateMoney(qc),
  });
};

// ── The trade reports ───────────────────────────────────────────────────────

/** What went to waste. Never money of its own — a slice of spending already counted. */
export function useWasteReport(range: Range) {
  return useQuery({
    queryKey: ["waste", ...rangeKey(range)],
    queryFn: () => api.getWasteReport({ query: range }),
  });
}

/**
 * What the business owns. No period filter: an asset does not stop existing
 * because the header is showing August.
 */
export function useAssetsReport(includeFullyUsed = false) {
  return useQuery({
    queryKey: ["assets", includeFullyUsed],
    queryFn: () =>
      api.getAssetsReport({ query: includeFullyUsed ? { includeFullyUsed: "true" } : {} }),
  });
}
