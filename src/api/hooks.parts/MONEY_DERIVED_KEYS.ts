import { type QueryClient, useQueryClient, useMutation, useQuery } from "@tanstack/react-query";
import { type EndpointBody, updateClientCustomer, connectIntegration } from "@workspace/api-contract";
import * as api from "@/lib/api-helpers/client";

// ── Period range (undefined bounds = all-time) ──────────────────────────────
export interface Range {
  startDate?: string;
  endDate?: string;
}
export const rangeKey = (r: Range) => [r.startDate ?? "*", r.endDate ?? "*"] as const;

// ── Invalidation: money changed somewhere → refresh everything money ────────

/**
 * Every query key whose answer is DERIVED FROM THE LEDGER.
 *
 * The rule for this list is "would a newly recorded sale change what this
 * screen says?" — if yes it belongs here, no matter which screen it feeds.
 * Over-invalidating costs one refetch; under-invalidating shows the owner a
 * figure that is quietly wrong, which is the failure this app cannot afford.
 *
 * Everything from `insights` down was missing, so recording a sale left the
 * whole Insights area — the score, the cards, the waterfall, every report —
 * showing the business as it was before the sale until its cache aged out.
 *
 * Deliberately NOT here: `categories`, `sources`, `settings`, `integrations`,
 * `transaction-templates`, `recurring`, `team-members` and the other
 * definition-shaped keys. Money moving does not change what a category is.
 */
export const MONEY_DERIVED_KEYS = [
  "transactions",
  "transaction",
  "revenue-items",
  "revenue-item",
  "expense-items",
  "expense-item",
  "pnl",
  // Ad spend IS ledger money: logging some moves True profit, and the ad screen
  // shows spend as a share of revenue, so a sale recorded elsewhere changes
  // what that screen should say.
  "ad-spend",
  // The Insights area, top to bottom.
  "insights",
  "pqs",
  "waterfall",
  "offers-report",
  "people-report",
  "marketing",
  "leaks",
  "drivers",
  "momentum",
  "retention",
  "cohorts",
  "signals",
  // Other ledger-derived reads. The P&L series keys off ["pnl", "series", …],
  // so "pnl" above already covers it — invalidation matches by prefix.
  "break-even",
  "client-profitability",
  "clients",
  "client-customers",
  "subscription-summary",
  // A person's card carries lifetime value and last-purchase date.
  "people",
  "person",
  // Anything that settles a bill or raises an invoice changes what is owed.
  "owed",
  // Billing a project, or costing one, changes what it has earned and spent.
  "projects",
  "project",
  // Actual spend is ledger money, so a budget is stale the moment any of it moves.
  "budgets",
  "budget",
  // Settling from an advance changes what is left on it.
  "advances",
  // Waste is read off purchase lines, and an asset is a purchase.
  "waste",
  "assets",
] as const;

export function invalidateMoney(qc: QueryClient) {
  for (const key of MONEY_DERIVED_KEYS) {
    qc.invalidateQueries({ queryKey: [key] });
  }
}

/**
 * A catalog write can MINT a category: the form free-types a name and the
 * server finds-or-creates it. The suggestion list has to hear about that, or
 * the owner sees no sign of the label they just used, types it again next time,
 * and ends up with two categories splitting one lot of revenue between them.
 */
export function useCatalogMutation<TVars, TData>(fn: (vars: TVars) => Promise<TData>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      invalidateMoney(qc);
      qc.invalidateQueries({ queryKey: ["categories"] });
    },
  });
}

// ── Revenue items ───────────────────────────────────────────────────────────
export function useRevenueItems(range: Range, status?: "active" | "archived") {
  return useQuery({
    queryKey: ["revenue-items", ...rangeKey(range), status ?? "all"],
    queryFn: () => api.listRevenueItems({ query: { ...range, status } }),
  });
}

export function useRevenueItem(id: string | null, range: Range) {
  return useQuery({
    queryKey: ["revenue-item", id, ...rangeKey(range)],
    queryFn: () => api.getRevenueItem({ params: { id: id! }, query: range }),
    enabled: !!id,
  });
}

// ── Expense items ───────────────────────────────────────────────────────────
export function useExpenseItems(range: Range, status?: "active" | "archived") {
  return useQuery({
    queryKey: ["expense-items", ...rangeKey(range), status ?? "all"],
    queryFn: () => api.listExpenseItems({ query: { ...range, status } }),
  });
}

export function useExpenseItem(id: string | null, range: Range) {
  return useQuery({
    queryKey: ["expense-item", id, ...rangeKey(range)],
    queryFn: () => api.getExpenseItem({ params: { id: id! }, query: range }),
    enabled: !!id,
  });
}

export function useTransactions(query: Record<string, string | number | undefined>, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ["transactions", query],
    queryFn: () => api.listTransactions({ query: query as never }),
    enabled: opts?.enabled ?? true,
  });
}

export function useTransaction(id: string | null) {
  return useQuery({
    queryKey: ["transaction", id],
    queryFn: () => api.getTransaction({ params: { id: id! } }),
    enabled: !!id,
  });
}

/**
 * Today's rate from `from` into the business's own currency — a suggestion for
 * the rate box, never applied by itself. `rate` is null when none could be had.
 */
export function useFxRate(from: string | null) {
  return useQuery({
    queryKey: ["fx-rate", from],
    queryFn: () => api.getFxRate({ query: { from: from! } }),
    enabled: from !== null,
    staleTime: 60 * 60 * 1000,
  });
}

// ── Attachments / receipts ──────────────────────────────────────────────────
export function useTransactionAttachments(transactionId: string | null) {
  return useQuery({
    queryKey: ["attachments", transactionId],
    queryFn: () => api.listTransactionAttachments({ params: { id: transactionId! } }),
    enabled: !!transactionId,
  });
}
// ── Transaction templates (reusable Quick-Add drafts) ───────────────────────
export function useTransactionTemplates(opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ["transaction-templates"],
    queryFn: () => api.listTransactionTemplates(),
    enabled: opts?.enabled ?? true,
  });
}

// ── P&L ─────────────────────────────────────────────────────────────────────
/**
 * The profit ladder. `basis` picks which date it measures by — "accrual" (the
 * default) is profit, "cash" is what actually moved through the bank.
 */
export function usePnl(range: Range, basis: "accrual" | "cash" = "accrual") {
  return useQuery({
    queryKey: ["pnl", ...rangeKey(range), basis],
    queryFn: () => api.getPnl({ query: { ...range, basis } }),
  });
}

/**
 * How much must sell before the period stops costing money. Server-computed
 * from the same ledger the ladder reads — the page renders this and never
 * re-derives a break-even of its own.
 */
export function useBreakEven(range: Range, targetProfitCents?: number) {
  return useQuery({
    queryKey: ["break-even", ...rangeKey(range), targetProfitCents ?? null],
    queryFn: () =>
      api.getBreakEven({
        query: { ...range, ...(targetProfitCents === undefined ? {} : { targetProfitCents }) },
      }),
  });
}

/** The ladder over time — server-bucketed; rungs are additive to the whole-period ladder. */
export function usePnlSeries(range: { startDate: string; endDate: string }, bucket: "day" | "week" | "month" | "year") {
  return useQuery({
    queryKey: ["pnl", "series", range.startDate, range.endDate, bucket],
    queryFn: () => api.getPnlSeries({ query: { ...range, bucket } }),
  });
}

/**
 * Who a cost can be booked against — clients, offers, internal buckets.
 *
 * The same list the timesheet uses, so an hour and a bill booked to "Acme"
 * can never mean two different Acmes. Cached hard: it changes when a client is
 * added, not while an entry is being typed.
 */
export function useCostTargets(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ["cost-targets"],
    queryFn: () => api.listCostTargets(),
    staleTime: 5 * 60 * 1000,
    enabled: options?.enabled ?? true,
  });
}

/**
 * Categories for a picker.
 *
 * `usableFor` keeps the internal TIME buckets (Admin, Sales & pitching, …) out
 * of the money pickers — they absorb labour, not money, and filing a sale under
 * one puts revenue where no money report goes looking. Omit it only where every
 * category is genuinely wanted.
 */
export function useCategories(usableFor?: "revenue" | "expense" | "money") {
  return useQuery({
    queryKey: ["categories", usableFor ?? "all"],
    queryFn: () => api.listCategories({ query: usableFor ? { usableFor } : {} }),
  });
}

// ── People ──────────────────────────────────────────────────────────────────
export function useClientCustomers(opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ["client-customers"],
    queryFn: () => api.listClientCustomers(),
    enabled: opts?.enabled ?? true,
  });
}
export const useUpdateClientCustomer = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; body: EndpointBody<typeof updateClientCustomer> }) =>
      api.updateClientCustomer({ params: { id: v.id }, body: v.body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["client-customers"] }),
  });
};
export const useConnectIntegration = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { kind: EndpointBody<typeof connectIntegration> extends never ? string : string; body: EndpointBody<typeof connectIntegration> }) =>
      api.connectIntegration({ params: { kind: v.kind as never }, body: v.body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["integrations"] }),
  });
};

// ── People (R4) ─────────────────────────────────────────────────────────────
/**
 * Leaving `status` off means active only — which is what every picker calling
 * this wants, and what archiving someone is supposed to achieve.
 */
export function usePeople(
  kind?: "customer" | "vendor" | "employee" | "other",
  status?: "active" | "archived" | "all",
  opts?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: ["people", kind ?? "all", status ?? "active"],
    queryFn: () => api.listPeople({ query: { ...(kind ? { kind } : {}), ...(status ? { status } : {}) } }),
    enabled: opts?.enabled ?? true,
  });
}
export function usePeopleMutation<TVars, TData>(fn: (v: TVars) => Promise<TData>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["people"] });
      // The open record too, not just the list behind it: archiving or editing
      // from the detail panel changes what that panel is showing.
      qc.invalidateQueries({ queryKey: ["person"] });
    },
  });
}
