/**
 * EVERY call the browser makes to the API, in one place.
 *
 * Each function is one endpoint: its name is the contract's name for it
 * (`src/core/contract`), the comment above it is the URL it hits, and the
 * route handler that answers is `src/app/api/<that path>/route.ts`. Request and
 * response types come from the same Zod contract the server validates against,
 * so a mismatch is a compile error rather than a runtime surprise.
 *
 * Call shape: `listSources()`, `createSource({ body })`,
 * `updateSource({ params: { id }, body })`, `getPnl({ query: range })`.
 *
 * Screens do not call these directly for data they display — they use the React
 * Query hooks in `src/api/hooks.ts`, which call these and own caching and
 * invalidation. Calling one directly is right for one-off actions outside a
 * hook (a download, the first business on the welcome screen).
 *
 * Adding an endpoint: define it in the contract, write its `GET`/`POST`/… in
 * `src/app/api/<path>/route.ts`, and add one line here.
 */
import * as c from "@workspace/api-contract";
import { apiRequest } from "./transport";
import { API_PREFIX, type Args, typedFetch, saveBlob } from "./client.parts/TypedFetch";
export { endpointUrl, healthCheck, listBusinesses, listClientCustomers, getSettings, listSources, listCategories, listRevenueItems, uploadAttachment, downloadImportTemplate } from "./client.parts/TypedFetch";
export type { Args } from "./client.parts/TypedFetch";
/** POST /api/businesses */
export const createBusiness = (args?: Args<typeof c.createBusiness>) => typedFetch(c.createBusiness, args);
/** PATCH /api/businesses/:id */
export const updateBusiness = (args?: Args<typeof c.updateBusiness>) => typedFetch(c.updateBusiness, args);
/** POST /api/client-customers */
export const createClientCustomer = (args?: Args<typeof c.createClientCustomer>) => typedFetch(c.createClientCustomer, args);
/** PATCH /api/client-customers/:id */
export const updateClientCustomer = (args?: Args<typeof c.updateClientCustomer>) => typedFetch(c.updateClientCustomer, args);
/** DELETE /api/client-customers/:id */
export const deleteClientCustomer = (args?: Args<typeof c.deleteClientCustomer>) => typedFetch(c.deleteClientCustomer, args);
/** PATCH /api/settings */
export const updateSettings = (args?: Args<typeof c.updateSettings>) => typedFetch(c.updateSettings, args);
/** POST /api/sources */
export const createSource = (args?: Args<typeof c.createSource>) => typedFetch(c.createSource, args);
/** PATCH /api/sources/:id */
export const updateSource = (args?: Args<typeof c.updateSource>) => typedFetch(c.updateSource, args);
/** POST /api/categories */
export const createCategory = (args?: Args<typeof c.createCategory>) => typedFetch(c.createCategory, args);
/** GET /api/revenue-items/:id */
export const getRevenueItem = (args?: Args<typeof c.getRevenueItem>) => typedFetch(c.getRevenueItem, args);
/** POST /api/revenue-items */
export const createRevenueItem = (args?: Args<typeof c.createRevenueItem>) => typedFetch(c.createRevenueItem, args);
/** PATCH /api/revenue-items/:id */
export const updateRevenueItem = (args?: Args<typeof c.updateRevenueItem>) => typedFetch(c.updateRevenueItem, args);
/** POST /api/revenue-items/:id/variants */
export const addRevenueItemVariant = (args?: Args<typeof c.addRevenueItemVariant>) => typedFetch(c.addRevenueItemVariant, args);
/** POST /api/revenue-items/:id/cost-components */
export const addCostComponent = (args?: Args<typeof c.addCostComponent>) => typedFetch(c.addCostComponent, args);
/** PATCH /api/cost-components/:id */
export const updateCostComponent = (args?: Args<typeof c.updateCostComponent>) => typedFetch(c.updateCostComponent, args);
/** POST /api/cost-components/:id/close */
export const closeCostComponent = (args?: Args<typeof c.closeCostComponent>) => typedFetch(c.closeCostComponent, args);

// ── Expense items (catalogue) ─────────────────────────────────────────────────

/** GET /api/expense-items */
export const listExpenseItems = (args?: Args<typeof c.listExpenseItems>) => typedFetch(c.listExpenseItems, args);
/** POST /api/expense-items */
export const createExpenseItem = (args?: Args<typeof c.createExpenseItem>) => typedFetch(c.createExpenseItem, args);
/** PATCH /api/expense-items/:id */
export const updateExpenseItem = (args?: Args<typeof c.updateExpenseItem>) => typedFetch(c.updateExpenseItem, args);
/** GET /api/expense-items/:id */
export const getExpenseItem = (args?: Args<typeof c.getExpenseItem>) => typedFetch(c.getExpenseItem, args);

// ── Transactions (the ledger) ─────────────────────────────────────────────────

/** GET /api/transactions */
export const listTransactions = (args?: Args<typeof c.listTransactions>) => typedFetch(c.listTransactions, args);
/** GET /api/transactions/:id */
export const getTransaction = (args?: Args<typeof c.getTransaction>) => typedFetch(c.getTransaction, args);
/** POST /api/transactions */
export const createTransaction = (args?: Args<typeof c.createTransaction>) => typedFetch(c.createTransaction, args);
/** POST /api/transactions/preview */
export const previewTransaction = (args?: Args<typeof c.previewTransaction>) => typedFetch(c.previewTransaction, args);
/** GET /api/fx-rate */
export const getFxRate = (args?: Args<typeof c.getFxRate>) => typedFetch(c.getFxRate, args);
/** PATCH /api/transactions/:id */
export const updateTransaction = (args?: Args<typeof c.updateTransaction>) => typedFetch(c.updateTransaction, args);
/** POST /api/transactions/:id/refund */
export const refundTransaction = (args?: Args<typeof c.refundTransaction>) => typedFetch(c.refundTransaction, args);
/** POST /api/transactions/:id/chargeback */
export const chargebackTransaction = (args?: Args<typeof c.chargebackTransaction>) => typedFetch(c.chargebackTransaction, args);
/** POST /api/transactions/:id/void */
export const voidTransaction = (args?: Args<typeof c.voidTransaction>) => typedFetch(c.voidTransaction, args);
/** GET /api/transaction-templates */
export const listTransactionTemplates = (args?: Args<typeof c.listTransactionTemplates>) => typedFetch(c.listTransactionTemplates, args);
/** POST /api/transaction-templates */
export const createTransactionTemplate = (args?: Args<typeof c.createTransactionTemplate>) => typedFetch(c.createTransactionTemplate, args);
/** DELETE /api/transaction-templates/:id */
export const deleteTransactionTemplate = (args?: Args<typeof c.deleteTransactionTemplate>) => typedFetch(c.deleteTransactionTemplate, args);
/** GET /api/transactions/:id/attachments */
export const listTransactionAttachments = (args?: Args<typeof c.listTransactionAttachments>) => typedFetch(c.listTransactionAttachments, args);
/** DELETE /api/attachments/:id */
export const deleteTransactionAttachment = (args?: Args<typeof c.deleteTransactionAttachment>) => typedFetch(c.deleteTransactionAttachment, args);
/** POST /api/transactions/:id/confirm */
export const confirmPendingTransaction = (args?: Args<typeof c.confirmPendingTransaction>) => typedFetch(c.confirmPendingTransaction, args);
/** POST /api/transactions/:id/skip */
export const skipPendingTransaction = (args?: Args<typeof c.skipPendingTransaction>) => typedFetch(c.skipPendingTransaction, args);
/** POST /api/transactions/:id/edit-amount */
export const editPendingTransactionAmount = (args?: Args<typeof c.editPendingTransactionAmount>) => typedFetch(c.editPendingTransactionAmount, args);
/** GET /api/cost-targets */
export const listCostTargets = (args?: Args<typeof c.listCostTargets>) => typedFetch(c.listCostTargets, args);

// ── Ad spend ──────────────────────────────────────────────────────────────────

/** GET /api/ad-spend */
export const listAdSpend = (args?: Args<typeof c.listAdSpend>) => typedFetch(c.listAdSpend, args);
/** GET /api/ad-spend/platforms */
export const listAdPlatforms = (args?: Args<typeof c.listAdPlatforms>) => typedFetch(c.listAdPlatforms, args);
/** POST /api/ad-spend */
export const logAdSpend = (args?: Args<typeof c.logAdSpend>) => typedFetch(c.logAdSpend, args);
/** POST /api/ad-spend/:id/void */
export const voidAdSpend = (args?: Args<typeof c.voidAdSpend>) => typedFetch(c.voidAdSpend, args);

// ── Reports & insights ────────────────────────────────────────────────────────

/** GET /api/reports/pnl */
export const getPnl = (args?: Args<typeof c.getPnl>) => typedFetch(c.getPnl, args);
/** GET /api/reports/break-even */
export const getBreakEven = (args?: Args<typeof c.getBreakEven>) => typedFetch(c.getBreakEven, args);
/** GET /api/reports/pnl-series */
export const getPnlSeries = (args?: Args<typeof c.getPnlSeries>) => typedFetch(c.getPnlSeries, args);
/** GET /api/reports/cohorts */
export const getCohorts = (args?: Args<typeof c.getCohorts>) => typedFetch(c.getCohorts, args);
/** GET /api/reports/drivers */
export const getDrivers = (args?: Args<typeof c.getDrivers>) => typedFetch(c.getDrivers, args);
/** GET /api/reports/signals */
export const getSignals = (args?: Args<typeof c.getSignals>) => typedFetch(c.getSignals, args);
/** GET /api/reports/momentum */
export const getMomentum = (args?: Args<typeof c.getMomentum>) => typedFetch(c.getMomentum, args);
/** GET /api/reports/leaks */
export const getLeaks = (args?: Args<typeof c.getLeaks>) => typedFetch(c.getLeaks, args);
/** GET /api/reports/retention */
export const getRetention = (args?: Args<typeof c.getRetention>) => typedFetch(c.getRetention, args);
/** GET /api/reports/insights */
export const getInsights = (args?: Args<typeof c.getInsights>) => typedFetch(c.getInsights, args);
/** GET /api/reports/pqs */
export const getPqs = (args?: Args<typeof c.getPqs>) => typedFetch(c.getPqs, args);
/** GET /api/reports/waterfall */
export const getWaterfall = (args?: Args<typeof c.getWaterfall>) => typedFetch(c.getWaterfall, args);
/** GET /api/reports/offers */
export const getOffers = (args?: Args<typeof c.getOffers>) => typedFetch(c.getOffers, args);
/** GET /api/reports/people */
export const getPeople = (args?: Args<typeof c.getPeople>) => typedFetch(c.getPeople, args);
/** GET /api/reports/marketing */
export const getMarketing = (args?: Args<typeof c.getMarketing>) => typedFetch(c.getMarketing, args);

// ── Money owed ────────────────────────────────────────────────────────────────

/** GET /api/reports/owed */
export const getOwed = (args?: Args<typeof c.getOwed>) => typedFetch(c.getOwed, args);

// ── Integrations ──────────────────────────────────────────────────────────────

/** GET /api/integrations */
export const listIntegrations = (args?: Args<typeof c.listIntegrations>) => typedFetch(c.listIntegrations, args);
/** POST /api/integrations/:kind/connect */
export const connectIntegration = (args?: Args<typeof c.connectIntegration>) => typedFetch(c.connectIntegration, args);
/** POST /api/integrations/:kind/sync */
export const syncIntegration = (args?: Args<typeof c.syncIntegration>) => typedFetch(c.syncIntegration, args);
/** DELETE /api/integrations/:kind */
export const disconnectIntegration = (args?: Args<typeof c.disconnectIntegration>) => typedFetch(c.disconnectIntegration, args);

// ── Demo data ─────────────────────────────────────────────────────────────────

/** POST /api/data/seed */
export const seedDemoData = (args?: Args<typeof c.seedDemoData>) => typedFetch(c.seedDemoData, args);
/** POST /api/data/reset */
export const resetData = (args?: Args<typeof c.resetData>) => typedFetch(c.resetData, args);

// ── People ────────────────────────────────────────────────────────────────────

/** GET /api/people */
export const listPeople = (args?: Args<typeof c.listPeople>) => typedFetch(c.listPeople, args);
/** GET /api/people/:id */
export const getPersonDetail = (args?: Args<typeof c.getPersonDetail>) => typedFetch(c.getPersonDetail, args);
/** POST /api/people */
export const createPerson = (args?: Args<typeof c.createPerson>) => typedFetch(c.createPerson, args);
/** PATCH /api/people/:id */
export const updatePerson = (args?: Args<typeof c.updatePerson>) => typedFetch(c.updatePerson, args);
/** POST /api/people/:id/merge */
export const mergePeople = (args?: Args<typeof c.mergePeople>) => typedFetch(c.mergePeople, args);

// ── Projects ──────────────────────────────────────────────────────────────────

/** GET /api/projects */
export const listProjects = (args?: Args<typeof c.listProjects>) => typedFetch(c.listProjects, args);
/** GET /api/projects/:id */
export const getProject = (args?: Args<typeof c.getProject>) => typedFetch(c.getProject, args);
/** POST /api/projects */
export const createProject = (args?: Args<typeof c.createProject>) => typedFetch(c.createProject, args);
/** PATCH /api/projects/:id */
export const updateProject = (args?: Args<typeof c.updateProject>) => typedFetch(c.updateProject, args);
/** POST /api/projects/:id/bill */
export const billProject = (args?: Args<typeof c.billProject>) => typedFetch(c.billProject, args);

// ── Budgets ───────────────────────────────────────────────────────────────────

/** GET /api/budgets */
export const listBudgets = (args?: Args<typeof c.listBudgets>) => typedFetch(c.listBudgets, args);
/** GET /api/budgets/:id */
export const getBudget = (args?: Args<typeof c.getBudget>) => typedFetch(c.getBudget, args);
/** POST /api/budgets */
export const createBudget = (args?: Args<typeof c.createBudget>) => typedFetch(c.createBudget, args);
/** PATCH /api/budgets/:id */
export const updateBudget = (args?: Args<typeof c.updateBudget>) => typedFetch(c.updateBudget, args);
/** GET /api/budgets/suggestion */
export const suggestBudget = (args?: Args<typeof c.suggestBudget>) => typedFetch(c.suggestBudget, args);

// ── Advances ──────────────────────────────────────────────────────────────────

/** GET /api/advances */
export const listOpenAdvances = (args?: Args<typeof c.listOpenAdvances>) => typedFetch(c.listOpenAdvances, args);
/** POST /api/transactions/:id/settle-from-advance */
export const settleFromAdvance = (args?: Args<typeof c.settleFromAdvance>) => typedFetch(c.settleFromAdvance, args);

// ── Trade (units & waste) ─────────────────────────────────────────────────────

/** GET /api/reports/waste */
export const getWasteReport = (args?: Args<typeof c.getWasteReport>) => typedFetch(c.getWasteReport, args);
/** GET /api/reports/assets */
export const getAssetsReport = (args?: Args<typeof c.getAssetsReport>) => typedFetch(c.getAssetsReport, args);

// ── Recurring schedules ───────────────────────────────────────────────────────

/** GET /api/recurring */
export const listRecurringSchedules = (args?: Args<typeof c.listRecurringSchedules>) => typedFetch(c.listRecurringSchedules, args);
/** POST /api/recurring */
export const createRecurringSchedule = (args?: Args<typeof c.createRecurringSchedule>) => typedFetch(c.createRecurringSchedule, args);
/** POST /api/recurring/:id/status */
export const setRecurringScheduleStatus = (args?: Args<typeof c.setRecurringScheduleStatus>) => typedFetch(c.setRecurringScheduleStatus, args);
/** POST /api/recurring/:id/edit-future */
export const editRecurringScheduleFuture = (args?: Args<typeof c.editRecurringScheduleFuture>) => typedFetch(c.editRecurringScheduleFuture, args);

// ── Subscriptions ─────────────────────────────────────────────────────────────

/** GET /api/subscriptions */
export const listSubscriptions = (args?: Args<typeof c.listSubscriptions>) => typedFetch(c.listSubscriptions, args);
/** GET /api/subscriptions/summary */
export const getSubscriptionSummary = (args?: Args<typeof c.getSubscriptionSummary>) => typedFetch(c.getSubscriptionSummary, args);
/** POST /api/subscriptions */
export const createSubscription = (args?: Args<typeof c.createSubscription>) => typedFetch(c.createSubscription, args);
/** POST /api/subscriptions/:id/cancel */
export const cancelSubscription = (args?: Args<typeof c.cancelSubscription>) => typedFetch(c.cancelSubscription, args);
/** POST /api/subscriptions/:id/change-plan */
export const changeSubscriptionPlan = (args?: Args<typeof c.changeSubscriptionPlan>) => typedFetch(c.changeSubscriptionPlan, args);

// ── Client profitability, team & hours ────────────────────────────────────────

/** GET /api/client-profitability/internal-categories */
export const listInternalTimeCategories = (args?: Args<typeof c.listInternalTimeCategories>) => typedFetch(c.listInternalTimeCategories, args);
/** GET /api/client-profitability/team-members */
export const listTeamMembers = (args?: Args<typeof c.listTeamMembers>) => typedFetch(c.listTeamMembers, args);
/** POST /api/client-profitability/team-members */
export const createTeamMember = (args?: Args<typeof c.createTeamMember>) => typedFetch(c.createTeamMember, args);
/** PATCH /api/client-profitability/team-members/:id */
export const updateTeamMember = (args?: Args<typeof c.updateTeamMember>) => typedFetch(c.updateTeamMember, args);
/** POST /api/client-profitability/team-members/:id/rate */
export const setTeamMemberRate = (args?: Args<typeof c.setTeamMemberRate>) => typedFetch(c.setTeamMemberRate, args);
/** GET /api/client-profitability/team-members/:id/rate-history */
export const getTeamMemberRateHistory = (args?: Args<typeof c.getTeamMemberRateHistory>) => typedFetch(c.getTeamMemberRateHistory, args);
/** GET /api/client-profitability/overhead-default */
export const getOverheadDefault = (args?: Args<typeof c.getOverheadDefault>) => typedFetch(c.getOverheadDefault, args);
/** GET /api/client-profitability/clients */
export const listClients = (args?: Args<typeof c.listClients>) => typedFetch(c.listClients, args);
/** GET /api/client-profitability/client-matches */
export const findClientMatches = (args?: Args<typeof c.findClientMatches>) => typedFetch(c.findClientMatches, args);
/** POST /api/client-profitability/clients */
export const createClient = (args?: Args<typeof c.createClient>) => typedFetch(c.createClient, args);
/** PATCH /api/client-profitability/clients/:engagementId */
export const updateClientEngagement = (args?: Args<typeof c.updateClientEngagement>) => typedFetch(c.updateClientEngagement, args);
/** GET /api/client-profitability/timesheet */
export const getTimesheet = (args?: Args<typeof c.getTimesheet>) => typedFetch(c.getTimesheet, args);
/** POST /api/client-profitability/timesheet/cell */
export const setTimesheetCell = (args?: Args<typeof c.setTimesheetCell>) => typedFetch(c.setTimesheetCell, args);
/** POST /api/client-profitability/timesheet/clear-row */
export const clearTimesheetRow = (args?: Args<typeof c.clearTimesheetRow>) => typedFetch(c.clearTimesheetRow, args);
/** POST /api/client-profitability/time-import/preview */
export const previewTimeImport = (args?: Args<typeof c.previewTimeImport>) => typedFetch(c.previewTimeImport, args);
/** POST /api/client-profitability/time-import/commit */
export const commitTimeImport = (args?: Args<typeof c.commitTimeImport>) => typedFetch(c.commitTimeImport, args);
/** POST /api/client-profitability/estimates/preview */
export const previewEstimate = (args?: Args<typeof c.previewEstimate>) => typedFetch(c.previewEstimate, args);
/** POST /api/client-profitability/estimates */
export const setTargetEstimate = (args?: Args<typeof c.setTargetEstimate>) => typedFetch(c.setTargetEstimate, args);
/** POST /api/client-profitability/estimates/clear */
export const clearTargetEstimate = (args?: Args<typeof c.clearTargetEstimate>) => typedFetch(c.clearTargetEstimate, args);
/** GET /api/client-profitability/estimates */
export const listTargetEstimates = (args?: Args<typeof c.listTargetEstimates>) => typedFetch(c.listTargetEstimates, args);
/** GET /api/client-profitability/profitability */
export const getClientProfitability = (args?: Args<typeof c.getClientProfitability>) => typedFetch(c.getClientProfitability, args);

// ── Spreadsheet imports ───────────────────────────────────────────────────────

/** POST /api/imports/preview */
export const previewImport = (args?: Args<typeof c.previewImport>) => typedFetch(c.previewImport, args);
/** POST /api/imports/commit */
export const commitImport = (args?: Args<typeof c.commitImport>) => typedFetch(c.commitImport, args);
/** GET /api/imports */
export const listImportBatches = (args?: Args<typeof c.listImportBatches>) => typedFetch(c.listImportBatches, args);
/** POST /api/imports/:id/undo */
export const undoImportBatch = (args?: Args<typeof c.undoImportBatch>) => typedFetch(c.undoImportBatch, args);

// ── Account ───────────────────────────────────────────────────────────────────

/** POST /api/account/delete */
export const deleteAccount = (args?: Args<typeof c.deleteAccount>) => typedFetch(c.deleteAccount, args);

// ── Sign-up and password recovery (signing in/out is next-auth/react) ────────

/** POST /api/auth/sign-up */
export const signUp = (args?: Args<typeof c.signUp>) => typedFetch(c.signUp, args);
/** POST /api/auth/forgot-password */
export const requestPasswordReset = (args?: Args<typeof c.requestPasswordReset>) => typedFetch(c.requestPasswordReset, args);
/** POST /api/auth/reset-password */
export const resetPassword = (args?: Args<typeof c.resetPassword>) => typedFetch(c.resetPassword, args);

/** GET /api/attachments/:id/download — saved through the browser's dialog. */
export async function downloadAttachment(id: string, filename: string) {
  saveBlob(await apiRequest<Blob>(`${API_PREFIX}/attachments/${encodeURIComponent(id)}/download`, { responseType: "blob" }), filename);
}
