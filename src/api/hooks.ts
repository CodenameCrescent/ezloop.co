/**
 * Typed React Query hooks over lib/api-contract — the ONE data layer for the
 * money core. Every page reads through these; no page computes money or hits
 * the network directly. Mutations invalidate the ledger + affected item + P&L
 * queries so numbers update everywhere at once.
 */
import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from "@tanstack/react-query";
import { addCostComponent, addRevenueItemVariant, createCategory, createClientCustomer, createExpenseItem, createPerson, createRecurringSchedule, createRevenueItem, createSource, createSubscription, createTransaction, createTransactionTemplate, getSettings, logAdSpend, listTransactions, previewTransaction, refundTransaction, chargebackTransaction, updateCostComponent, updateExpenseItem, updatePerson, updateRevenueItem, updateSettings, updateSource, updateTransaction, type EndpointBody, type EndpointResponse } from "@workspace/api-contract";
import * as api from "@/lib/api-helpers/client";
import { type Range, rangeKey, invalidateMoney, useCatalogMutation, usePeopleMutation } from "./hooks.parts/MONEY_DERIVED_KEYS";
import { useRecurringMutation, useSubMutation } from "./hooks.parts/IMPORT_MINTS_KEYS";
export { invalidateMoney, useRevenueItems, useRevenueItem, useExpenseItems, useExpenseItem, useTransactions, useTransaction, useFxRate, useTransactionAttachments, useTransactionTemplates, usePnl, useBreakEven, usePnlSeries, useCostTargets, useCategories, useClientCustomers, useUpdateClientCustomer, useConnectIntegration, usePeople } from "./hooks.parts/MONEY_DERIVED_KEYS";
export type { Range } from "./hooks.parts/MONEY_DERIVED_KEYS";
export { useDrivers, useLeaks, useMomentum, useSignals, apiErrorCode, apiErrorStatus, useTeamMembers, useOverheadDefault, useTeamRateHistory, useCreateTeamMember, useUpdateTeamMember, useSetTeamMemberRate, useClients, useClientMatches, useCreateClient, useUpdateClientEngagement, useTimesheet, useSetTimesheetCell, useClearTimesheetRow, usePreviewTimeImport, useCommitTimeImport } from "./hooks.parts/IMPORT_MINTS_KEYS";
export { useImportPreview, useCommitImport, useImportBatches, useUndoImport, usePreviewEstimate, useSetTargetEstimate, useClearTargetEstimate, useClientProfitability, useAdSpend, useAdPlatforms, useInsights, usePqs, useWaterfall, useOffers, usePeopleReport, useMarketing, useBusinesses, useCreateBusiness, useUpdateBusiness, useBusinessPnl } from "./hooks.parts/UseImportPreview";
export { useOwed, useMarkPaid, useProjects, useProject, useCreateProject, useUpdateProject, useBillProject, useBudget, useCreateBudget, useUpdateBudget, useBudgetSuggestion, useSettleFromAdvance, useWasteReport, useAssetsReport } from "./hooks.parts/UseBillProject";

/** Global-period {start,end} Dates → contract query range. */
export function toApiRange(range: { start: Date; end: Date }): Range {
  return { startDate: range.start.toISOString(), endDate: range.end.toISOString() };
}

function useMoneyMutation<TVars, TData>(fn: (vars: TVars) => Promise<TData>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => invalidateMoney(qc) });
}

export const useCreateRevenueItem = () =>
  useCatalogMutation((body: EndpointBody<typeof createRevenueItem>) => api.createRevenueItem({ body }));

export const useUpdateRevenueItem = () =>
  useCatalogMutation((v: { id: string; body: EndpointBody<typeof updateRevenueItem> }) =>
    api.updateRevenueItem({ params: { id: v.id }, body: v.body }),
  );

/** Adds a variant to an item that already exists; the first one converts the parent. */
export const useAddVariant = () =>
  useCatalogMutation((v: { id: string; body: EndpointBody<typeof addRevenueItemVariant> }) =>
    api.addRevenueItemVariant({ params: { id: v.id }, body: v.body }),
  );

export const useAddCostComponent = () =>
  useMoneyMutation((v: { id: string; body: EndpointBody<typeof addCostComponent> }) =>
    api.addCostComponent({ params: { id: v.id }, body: v.body }),
  );

export const useUpdateCostComponent = () =>
  useMoneyMutation((v: { id: string; body: EndpointBody<typeof updateCostComponent> }) =>
    api.updateCostComponent({ params: { id: v.id }, body: v.body }),
  );

export const useCloseCostComponent = () =>
  useMoneyMutation((id: string) => api.closeCostComponent({ params: { id }, body: {} }));

export const useCreateExpenseItem = () =>
  useCatalogMutation((body: EndpointBody<typeof createExpenseItem>) => api.createExpenseItem({ body }));

export const useUpdateExpenseItem = () =>
  useCatalogMutation((v: { id: string; body: EndpointBody<typeof updateExpenseItem> }) =>
    api.updateExpenseItem({ params: { id: v.id }, body: v.body }),
  );

// ── Transactions (ledger) ───────────────────────────────────────────────────
export type TransactionQuery = EndpointResponse<typeof listTransactions> extends { items: infer _I } ? Record<string, unknown> : never;

export const useCreateTransaction = () =>
  useMoneyMutation((body: EndpointBody<typeof createTransaction>) => api.createTransaction({ body }));

/** Append-only-safe header edit (notes/date/customer/paid-status only). */
export const useUpdateTransaction = () =>
  useMoneyMutation((v: { id: string; body: EndpointBody<typeof updateTransaction> }) =>
    api.updateTransaction({ params: { id: v.id }, body: v.body }),
  );

export const useRefundTransaction = () =>
  useMoneyMutation((v: { id: string; body: EndpointBody<typeof refundTransaction> }) =>
    api.refundTransaction({ params: { id: v.id }, body: v.body }),
  );

export const useChargebackTransaction = () =>
  useMoneyMutation((v: { id: string; body: EndpointBody<typeof chargebackTransaction> }) =>
    api.chargebackTransaction({ params: { id: v.id }, body: v.body }),
  );

export const useVoidTransaction = () =>
  useMoneyMutation((id: string) => api.voidTransaction({ params: { id }, body: {} }));

/** Fire-and-forget preview (not a hook subscription) — used live in Quick Add. */
export function previewTransactionFetch(body: EndpointBody<typeof previewTransaction>) {
  return api.previewTransaction({ body });
}
export const useDeleteAttachment = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteTransactionAttachment({ params: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["attachments"] }),
  });
};
export const useCreateTransactionTemplate = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: EndpointBody<typeof createTransactionTemplate>) => api.createTransactionTemplate({ body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["transaction-templates"] }),
  });
};
export const useDeleteTransactionTemplate = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteTransactionTemplate({ params: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["transaction-templates"] }),
  });
};

// ── Sources / categories ────────────────────────────────────────────────────
export function useSources() {
  return useQuery({ queryKey: ["sources"], queryFn: () => api.listSources() });
}
export const useCreateSource = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: EndpointBody<typeof createSource>) => api.createSource({ body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sources"] }),
  });
};
export const useUpdateSource = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; body: EndpointBody<typeof updateSource> }) => api.updateSource({ params: { id: v.id }, body: v.body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sources"] }),
  });
};
export const useCreateCategory = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: EndpointBody<typeof createCategory>) => api.createCategory({ body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["categories"] }),
  });
};

// ── Settings ────────────────────────────────────────────────────────────────
export function useSettings(opts?: Partial<UseQueryOptions<EndpointResponse<typeof getSettings>>>) {
  return useQuery({ queryKey: ["settings"], queryFn: () => api.getSettings(), ...opts });
}
export const useUpdateSettings = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: EndpointBody<typeof updateSettings>) => api.updateSettings({ body }),
    onSuccess: (data) => qc.setQueryData(["settings"], data),
  });
};
export const clientCustomersKey = () => ["client-customers"] as const;
export const useCreateClientCustomer = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: EndpointBody<typeof createClientCustomer>) => api.createClientCustomer({ body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["client-customers"] }),
  });
};
export const useDeleteClientCustomer = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteClientCustomer({ params: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["client-customers"] }),
  });
};

// ── Integrations ────────────────────────────────────────────────────────────
export function useIntegrations() {
  return useQuery({ queryKey: ["integrations"], queryFn: () => api.listIntegrations() });
}
export const useSyncIntegration = () =>
  useMutation({ mutationFn: (kind: string) => api.syncIntegration({ params: { kind: kind as never }, body: {} }) });
export const useDisconnectIntegration = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (kind: string) => api.disconnectIntegration({ params: { kind: kind as never } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["integrations"] }),
  });
};

// ── Dev / demo data ─────────────────────────────────────────────────────────
export const useSeedDemo = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: () => api.seedDemoData(), onSuccess: () => qc.invalidateQueries() });
};
export const useResetData = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: () => api.resetData(), onSuccess: () => qc.invalidateQueries() });
};

// ── Account ─────────────────────────────────────────────────────────────────
/** No cache work on success: the caller signs out and leaves the app. */
export const useDeleteAccount = () =>
  useMutation({ mutationFn: () => api.deleteAccount({ body: { confirm: "DELETE" } }) });
export function usePersonDetail(id: string | null) {
  return useQuery({
    queryKey: ["person", id],
    queryFn: () => api.getPersonDetail({ params: { id: id! } }),
    enabled: !!id,
  });
}
export const useCreatePerson = () => usePeopleMutation((body: EndpointBody<typeof createPerson>) => api.createPerson({ body }));
export const useUpdatePerson = () =>
  usePeopleMutation((v: { id: string; body: EndpointBody<typeof updatePerson> }) => api.updatePerson({ params: { id: v.id }, body: v.body }));
export const useMergePeople = () =>
  usePeopleMutation((v: { id: string; mergeId: string }) => api.mergePeople({ params: { id: v.id }, body: { mergeId: v.mergeId } }));

// ── Recurring (R4) ──────────────────────────────────────────────────────────
export function useRecurringSchedules() {
  return useQuery({ queryKey: ["recurring"], queryFn: () => api.listRecurringSchedules() });
}
export const useCreateRecurringSchedule = () =>
  useRecurringMutation((body: EndpointBody<typeof createRecurringSchedule>) => api.createRecurringSchedule({ body }));
export const useSetScheduleStatus = () =>
  useRecurringMutation((v: { id: string; status: "active" | "paused" | "canceled" }) => api.setRecurringScheduleStatus({ params: { id: v.id }, body: { status: v.status } }));
export const useEditScheduleFuture = () =>
  useRecurringMutation((v: { id: string; amountCents?: number | null; qty?: string }) =>
    api.editRecurringScheduleFuture({ params: { id: v.id }, body: { amountCents: v.amountCents, qty: v.qty } }),
  );

// ── Subscriptions (R4) ──────────────────────────────────────────────────────
export function useSubscriptions() {
  return useQuery({ queryKey: ["subscriptions"], queryFn: () => api.listSubscriptions() });
}
export function useSubscriptionSummary(range: Range) {
  return useQuery({ queryKey: ["subscription-summary", ...rangeKey(range)], queryFn: () => api.getSubscriptionSummary({ query: range }) });
}
export const useCreateSubscription = () => useSubMutation((body: EndpointBody<typeof createSubscription>) => api.createSubscription({ body }));
export const useCancelSubscription = () =>
  useSubMutation((v: { id: string; reason?: string }) => api.cancelSubscription({ params: { id: v.id }, body: { reason: v.reason ?? null } }));
export const useChangeSubscriptionPlan = () =>
  useSubMutation((v: { id: string; amountCents: number }) => api.changeSubscriptionPlan({ params: { id: v.id }, body: { amountCents: v.amountCents } }));

// ── Cohorts (R4) ────────────────────────────────────────────────────────────
export function useCohorts() {
  return useQuery({ queryKey: ["cohorts"], queryFn: () => api.getCohorts() });
}

/** Retention + repeat-purchase (Wave 1.4 data layer; consumed by the Insights redesign). */
export function useRetention() {
  return useQuery({ queryKey: ["retention"], queryFn: () => api.getRetention() });
}

// ── Pending recurring queue actions (R4) ────────────────────────────────────
export const useConfirmPending = () => useMoneyMutation((id: string) => api.confirmPendingTransaction({ params: { id }, body: {} }));
export const useSkipPending = () => useMoneyMutation((id: string) => api.skipPendingTransaction({ params: { id }, body: {} }));
export const useEditPendingAmount = () =>
  useMoneyMutation((v: { id: string; amountCents: number }) => api.editPendingTransactionAmount({ params: { id: v.id }, body: { amountCents: v.amountCents } }));

// ── Human-readable API error → toast message ────────────────────────────────
export function apiErrorMessage(error: unknown, fallback: string): string {
  const data = (error as { data?: { error?: { message?: string; code?: string }; message?: string } } | null)?.data;
  return data?.error?.message ?? data?.message ?? (error instanceof Error ? error.message : fallback);
}

export function useTargetEstimates(range: { startDate?: string; endDate?: string } = {}) {
  return useQuery({
    queryKey: ["estimates", range.startDate ?? "", range.endDate ?? ""],
    queryFn: () => api.listTargetEstimates({ query: range }),
  });
}

/** Log spend. Writes through the ledger, so True profit updates with it. */
export const useLogAdSpend = () =>
  useMoneyMutation((body: EndpointBody<typeof logAdSpend>) => api.logAdSpend({ body }));

/** Voiding is a status change — the row stays, it just stops counting. */
export const useVoidAdSpend = () =>
  useMoneyMutation((id: string) => api.voidAdSpend({ params: { id } }));

// ── Budgets ─────────────────────────────────────────────────────────────────

export function useBudgets() {
  return useQuery({ queryKey: ["budgets"], queryFn: () => api.listBudgets({ query: {} }) });
}

// ── Advances ────────────────────────────────────────────────────────────────

/** Money paid ahead, and money being held. Both still have something on them. */
export function useOpenAdvances() {
  return useQuery({ queryKey: ["advances"], queryFn: () => api.listOpenAdvances() });
}
