import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { type ImportPreviewInput, type ImportCommitInput, type EndpointBody, previewEstimate, setTargetEstimate, clearTargetEstimate, createBusiness, updateBusiness } from "@workspace/api-contract";
import * as api from "@/lib/api-helpers/client";
import { BUSINESS_HEADER } from "@/lib/api-helpers/transport";
import { type Range, rangeKey } from "./MONEY_DERIVED_KEYS";
import { type CompareRange, IMPORT_BATCHES_KEY, invalidateImport } from "./IMPORT_MINTS_KEYS";

/**
 * The calendar the owner actually keeps, IANA-named.
 *
 * Returns undefined rather than guessing when the browser will not say, which
 * lets the server fall back to UTC on its own terms. Wrapped because
 * `resolvedOptions()` is allowed to throw, and an import must not fail over a
 * time zone lookup.
 */
export function readerTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

/**
 * What this file WOULD do. Writes nothing, so it re-runs freely — every time the
 * owner points a column somewhere else, answers the date question, or picks a
 * channel, the whole answer is recomputed by the server rather than adjusted in
 * the browser.
 *
 * The reader's time zone rides on both requests, filled HERE rather than at the
 * several call sites in the dialog, for the same reason `includeKeys` is: a
 * caller cannot forget what it never has to pass. A date in a spreadsheet is a
 * calendar day, and the server needs a zone to turn it into an instant — pick
 * UTC and the row lands on a different day from the one the owner wrote. A
 * caller that sets it explicitly still wins, which is what the spread order
 * says.
 *
 * IT DOES NOT SERIALISE, and a caller that fires it faster than it answers must
 * say which answer it still wants. Two changes 300 ms apart on a slower round
 * trip put two of these in flight, and nothing makes them come back in order;
 * a caller applying whichever lands last will show the older picture. See
 * `isCurrentRequest` in `pages/imports/importModel.ts`, which is how the
 * matching step drops an answer it has already moved past.
 */
export const useImportPreview = () =>
  useMutation({
    mutationFn: (body: ImportPreviewInput) =>
      api.previewImport({ body: { timeZone: readerTimeZone(), ...body } }),
  });

/**
 * Does it. The file is sent AGAIN rather than the preview's rows: the server
 * re-reads it and the only thing the browser is trusted for is `includeKeys` —
 * a list of decisions, never a list of figures.
 *
 * The caller's type is `ImportCommitInput` (`z.input`), where `includeKeys` is
 * optional because the schema gives it a default; the WIRE type is `z.infer`,
 * where it is always present. Filling it here is what the default means, and it
 * keeps every caller that ticked nothing back in from having to pass `[]`.
 */
export const useCommitImport = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ImportCommitInput) =>
      api.commitImport({
        body: { timeZone: readerTimeZone(), ...body, includeKeys: body.includeKeys ?? [] },
      }),
    onSuccess: () => invalidateImport(qc),
  });
};

/** Every import this business has run, newest first — undone ones included. */
export function useImportBatches() {
  return useQuery({
    queryKey: [IMPORT_BATCHES_KEY],
    queryFn: () => api.listImportBatches(),
  });
}

/**
 * Takes one back out. Invalidates exactly what committing does, and for the
 * stronger reason: undoing moves every money figure on screen DOWN, and a
 * dashboard still showing the imported total after the owner has undone it is
 * the worst possible moment to be stale.
 */
export const useUndoImport = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.undoImportBatch({ params: { id } }),
    onSuccess: () => invalidateImport(qc),
  });
};

// ── Estimated hours ─────────────────────────────────────────────────────────

/** Shows what an estimate would do. Writes nothing, so it re-runs as you type. */
export const usePreviewEstimate = () =>
  useMutation({
    mutationFn: (body: EndpointBody<typeof previewEstimate>) => api.previewEstimate({ body }),
  });

/** Both of these change what the grid and the profitability read say. */
export function invalidateHours(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["timesheet"] });
  qc.invalidateQueries({ queryKey: ["client-profitability"] });
  qc.invalidateQueries({ queryKey: ["estimates"] });
}

export const useSetTargetEstimate = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: EndpointBody<typeof setTargetEstimate>) => api.setTargetEstimate({ body }),
    onSuccess: () => invalidateHours(qc),
  });
};

export const useClearTargetEstimate = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: EndpointBody<typeof clearTargetEstimate>) => api.clearTargetEstimate({ body }),
    onSuccess: () => invalidateHours(qc),
  });
};

// ── Client profitability (the answer) ───────────────────────────────────────

/**
 * Per-client, per-product profit for a period. Every labour-derived figure is
 * nullable and null means ABSENT — a target with no hours has no margin, and
 * the screen must render a marker rather than a number.
 */
export function useClientProfitability(range: Range, basis: "accrual" | "cash" = "accrual") {
  return useQuery({
    queryKey: ["client-profitability", ...rangeKey(range), basis],
    queryFn: () => api.getClientProfitability({ query: { ...range, basis } }),
  });
}

// ── Ad spend ────────────────────────────────────────────────────────────────
//
// Ad spend is ordinary ledger money — an expense transaction on a source of
// kind `ad_platform`. There is no separate ad table, so these numbers can never
// disagree with the P&L; they are read back out of the same rows.

/**
 * The period's ad spend, split by platform, with its share of revenue.
 * `shareOfRevenueBps` is NULL when the period earned nothing — a share of
 * nothing is unanswerable, and the screen says so rather than printing 0%.
 */
export function useAdSpend(range: Range) {
  return useQuery({
    queryKey: ["ad-spend", ...rangeKey(range)],
    queryFn: () => api.listAdSpend({ query: range }),
  });
}

/** The ad platforms this business already has, for the logging form's picker. */
export function useAdPlatforms() {
  return useQuery({
    queryKey: ["ad-spend", "platforms"],
    queryFn: () => api.listAdPlatforms({}),
  });
}

// ── The insight feed ────────────────────────────────────────────────────────
//
// Distinct from `useSignals`, which stays the ambient one-line nudge feed
// behind the sidebar chip and the dashboard banner. This returns whole cards:
// impact, cause, action, and the real arithmetic behind each one.

/**
 * Ranked insight cards for a period. Capped at five by the server — the cap is
 * a product rule, not a display convenience, so it is not re-applied here.
 */
export function useInsights(range: CompareRange | null, comparisonLabel?: string) {
  return useQuery({
    queryKey: ["insights", range?.startDate, range?.endDate, range?.priorStartDate, range?.priorEndDate, comparisonLabel ?? ""],
    queryFn: () =>
      api.getInsights({
        query: { ...range!, ...(comparisonLabel ? { comparisonLabel } : {}) },
      }),
    enabled: !!range,
    staleTime: 60_000,
  });
}

/**
 * The Profit Quality Score. Every pillar arrives with the scale it was judged
 * on and the raw inputs behind it, so the drawer can answer "based on what?"
 * without asking the server a second question.
 */
export function usePqs(range: CompareRange | null) {
  return useQuery({
    queryKey: ["pqs", range?.startDate, range?.endDate, range?.priorStartDate, range?.priorEndDate],
    queryFn: () => api.getPqs({ query: range! }),
    enabled: !!range,
    staleTime: 60_000,
  });
}

/**
 * The money waterfall and the Money page's four tiles. `reconciles` travels
 * with the data — the server throws before serving a chart that disagrees with
 * itself, so a false here means something is badly wrong.
 */
export function useWaterfall(range: CompareRange | null) {
  return useQuery({
    queryKey: ["waterfall", range?.startDate, range?.endDate, range?.priorStartDate, range?.priorEndDate],
    queryFn: () => api.getWaterfall({ query: range! }),
    enabled: !!range,
  });
}

/** What you sell, ranked by profit, plus the quadrant map and the revenue-vs-profit flip. */
export function useOffers(range: { startDate: string; endDate: string } | null) {
  return useQuery({
    queryKey: ["offers-report", range?.startDate, range?.endDate],
    queryFn: () => api.getOffers({ query: range! }),
    enabled: !!range,
  });
}

/** Who pays you and are they staying — the concentration bar's data. */
export function usePeopleReport(range: { startDate: string; endDate: string } | null) {
  return useQuery({
    queryKey: ["people-report", range?.startDate, range?.endDate],
    queryFn: () => api.getPeople({ query: range! }),
    enabled: !!range,
  });
}

/**
 * Is the ad spend making money. Every figure is BLENDED — nothing links a sale
 * to the advert that caused it — and `blendedCaveat` travels with the data so
 * the page cannot forget to say so.
 */
export function useMarketing(range: CompareRange | null) {
  return useQuery({
    queryKey: ["marketing", range?.startDate, range?.endDate, range?.priorStartDate, range?.priorEndDate],
    queryFn: () => api.getMarketing({ query: range! }),
    enabled: !!range,
  });
}

// ── Businesses (the workspace layer) ────────────────────────────────────────
//
// These sit ABOVE every other hook here. Each one below answers for the single
// business named by the `x-profit-loop-business-id` header; these three are how
// a user finds out which businesses they have and makes another, so they are
// the only ones that cannot presuppose a selection.

/**
 * An EMPTY list is a real answer — a brand-new account owns nothing until it
 * says so — and the screens read it as "show the welcome page", never as a
 * failed request.
 *
 * `retry: false` because the two ways this fails (not signed in, or the server
 * is down) are both answered by showing the user something immediately rather
 * than by trying again behind a spinner.
 */
export function useBusinesses(includeArchived = false) {
  return useQuery({
    queryKey: ["businesses", includeArchived],
    queryFn: () => api.listBusinesses({ query: includeArchived ? { includeArchived: "true" } : {} }),
    retry: false,
    staleTime: 30 * 1000,
  });
}

export const useCreateBusiness = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: EndpointBody<typeof createBusiness>) => api.createBusiness({ body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["businesses"] }),
  });
};

export const useUpdateBusiness = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; body: EndpointBody<typeof updateBusiness> }) =>
      api.updateBusiness({ params: { id: v.id }, body: v.body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["businesses"] }),
  });
};

/**
 * One business's profit for a period, asked for WITHOUT switching to it.
 *
 * The header is set explicitly here, which `apiRequest` respects over the
 * current selection — that is what lets the businesses page put a real figure on
 * every card instead of a name and nothing. Each card is its own query, so one
 * business failing costs that card its figure and leaves the others alone.
 */
export function useBusinessPnl(businessId: string, range: Range) {
  return useQuery({
    queryKey: ["business-pnl", businessId, ...rangeKey(range)],
    queryFn: () =>
      api.getPnl({
        query: range,
        request: { headers: { [BUSINESS_HEADER]: businessId } },
      }),
    retry: false,
    staleTime: 60 * 1000,
  });
}
