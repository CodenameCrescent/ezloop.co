import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { startOfDay } from "./calcUtils";
import { toast } from "sonner";
import {
  useExpenseItems,
  useResetData,
  useRevenueItems,
  useSeedDemo,
  useSettings,
  useTransactions,
  useUpdateSettings,
} from "@/api/hooks";
import { ledgerToLegacy, revenueItemToProduct } from "./ledgerAdapter";
import { combineFigureStates, figureState, type FigureState } from "./figureState";
import type { CustomerMergeRecord } from "./customers";
import type { AppData, Order, Product, AdSpendEntry, Settings } from "./types";
import type { Expense } from "./legacyTypes";
import { computeAllMetrics } from "./decisions";
import { getCurrencySymbol } from "./currencyUtils";
import { formatCents, formatCentsSigned, formatCompactCents, formatCompactNumber } from "./money";
import { buildPeriodRangeFromDates } from "./period";
import { calculateProfitAndLoss } from "./finance";
import { normalizeBusinessModels } from "./businessModel";

const DEFAULT_SETTINGS: Settings = {
  currency: "PKR",
  currencySymbol: "Rs",
  businessName: "My Store",
  plan: "Starter Plan",
  defaultCostPrice: 1000,
  defaultSellingPrice: 2500,
  locale: "en-IN",
  toastsEnabled: true,
  adAttributionPct: 70,
  cashBuffer: 0,
  businessModels: [],
  thresholds: { scaleMargin: 30, stopScore: 45, minOrders: 3 },
};

interface StoreValue extends AppData {
  expenses: Expense[];
  customerMerges: CustomerMergeRecord[];
  isLoading: boolean;
  /**
   * Why the store is empty, when it is empty — for pages that print a figure
   * or a sentence off it.
   *
   * `isLoading` above is an OR of four `isLoading` flags, and each one of those
   * is false when its request FAILED or PAUSED. So a page that read it saw
   * "finished loading" over four empty arrays and printed the arithmetic of
   * nothing: Rs 0 spent, Rs 0 budgeted, "Nothing is flagged right now."
   *
   * `combineFigureStates` ranks the four so this names whatever best explains
   * the absence — being offline explains all four at once and outranks any
   * single failure. `isLoading` is kept for the places that only ever gate a
   * skeleton on it, where all four states behave the same.
   */
  dataState: FigureState;
  historyStart: Date;
  loadMoreHistory: () => void;
  mergeCustomers: (input: { primaryKey: string; primaryLabel: string; mergedKey: string; mergedLabel: string }) => void;
  undoCustomerMerge: (id: string) => void;
  addOrder: (input: unknown, callbacks?: { onSuccess?: () => void; onError?: (err: unknown) => void }) => void;
  updateOrder: (id: string, patch: unknown) => void;
  deleteOrder: (id: string) => void;
  addProduct: (input: unknown, callbacks?: { onSuccess?: () => void; onError?: (err: unknown) => void }) => void;
  updateProduct: (id: string, patch: Partial<Product>) => void;
  deleteProduct: (id: string) => void;
  addAdSpend: (input: Omit<AdSpendEntry, "id">) => void;
  deleteAdSpend: (id: string) => void;
  updateSettings: (patch: Partial<Settings>) => void;
  resetAll: () => void;
  reseed: () => void;
}

const StoreContext = createContext<StoreValue | null>(null);

/** Legacy write paths now live in Quick Add / the rebuilt catalog pages. */
function movedToQuickAdd() {
  toast.info("This action moved to Quick Add and the Business pages.");
}

export function AppStoreProvider({ children }: { children: React.ReactNode }) {
  // Legacy pages want a long history window; the ledger is small so we fetch wide.
  const [historyDays, setHistoryDays] = useState(1095);
  const range = useMemo(() => {
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    const start = new Date(end);
    start.setDate(end.getDate() - historyDays);
    start.setHours(0, 0, 0, 0);
    return { startDate: start.toISOString(), endDate: end.toISOString() };
  }, [historyDays]);

  // 200 is the contract's max page size; the legacy store reads one page for its
  // client-side adapters. TODO(R5): paginate via nextCursor if history exceeds a page.
  const txnsQuery = useTransactions({ ...range, limit: 200 });
  const revenueItemsQuery = useRevenueItems(range);
  const expenseItemsQuery = useExpenseItems(range);
  const settingsQuery = useSettings();

  const updateSettingsM = useUpdateSettings();
  const resetM = useResetData();
  const seedM = useSeedDemo();

  const value = useMemo<StoreValue>(() => {
    const settingsData = settingsQuery.data;
    const settings: Settings = {
      ...DEFAULT_SETTINGS,
      ...settingsData,
      businessModels: normalizeBusinessModels(settingsData?.businessModels),
      thresholds: { ...DEFAULT_SETTINGS.thresholds, ...settingsData?.thresholds },
    };

    const revenueItems = revenueItemsQuery.data?.items ?? [];
    const expenseItems = expenseItemsQuery.data?.items ?? [];
    const products = revenueItems.map(revenueItemToProduct);
    const { orders, expenses, adSpend } = ledgerToLegacy(txnsQuery.data?.items ?? [], expenseItems);

    return {
      products,
      orders,
      adSpend,
      settings,
      expenses,
      customerMerges: [],
      isLoading:
        txnsQuery.isLoading || revenueItemsQuery.isLoading || expenseItemsQuery.isLoading || settingsQuery.isLoading,
      /* Each query is asked whether it HAS its data, not just whether it is
         still fetching — a query holding a good page outranks one that failed
         beside it, the same rule the figure states follow everywhere else. */
      dataState: combineFigureStates([
        figureState(txnsQuery, txnsQuery.data != null),
        figureState(revenueItemsQuery, revenueItemsQuery.data != null),
        figureState(expenseItemsQuery, expenseItemsQuery.data != null),
        figureState(settingsQuery, settingsQuery.data != null),
      ]),
      historyStart: new Date(range.startDate),
      loadMoreHistory: () => setHistoryDays((d) => d + 365),

      mergeCustomers: movedToQuickAdd,
      undoCustomerMerge: movedToQuickAdd,
      addOrder: (_input, callbacks) => {
        movedToQuickAdd();
        callbacks?.onSuccess?.();
      },
      updateOrder: movedToQuickAdd,
      deleteOrder: movedToQuickAdd,
      addProduct: (_input, callbacks) => {
        movedToQuickAdd();
        callbacks?.onSuccess?.();
      },
      updateProduct: movedToQuickAdd,
      deleteProduct: movedToQuickAdd,
      addAdSpend: movedToQuickAdd,
      deleteAdSpend: movedToQuickAdd,

      updateSettings: (patch) => updateSettingsM.mutate(patch as never),
      resetAll: () => resetM.mutate(),
      reseed: () => seedM.mutate(),
      /* `exportJson` / `importJson` were removed with the Settings buttons that
         called them. Export serialised this store's ONE 200-row page into the
         legacy shape and called it "everything"; import only raised a toast,
         while Settings announced "Data imported" over the top of it. See the
         note in pages/Settings.tsx. */
    };
    /* `isPaused` and `isError` are listed beside `isLoading` because
       `dataState` reads all three. Leaving them out would freeze the store on
       whichever state it happened to be built in — a query that failed after
       the last render would keep reporting "loading" for ever. */
  }, [
    txnsQuery.data,
    txnsQuery.isLoading,
    txnsQuery.isPaused,
    txnsQuery.isError,
    revenueItemsQuery.data,
    revenueItemsQuery.isLoading,
    revenueItemsQuery.isPaused,
    revenueItemsQuery.isError,
    expenseItemsQuery.data,
    expenseItemsQuery.isLoading,
    expenseItemsQuery.isPaused,
    expenseItemsQuery.isError,
    settingsQuery.data,
    settingsQuery.isLoading,
    settingsQuery.isPaused,
    settingsQuery.isError,
    range,
    updateSettingsM,
    resetM,
    seedM,
  ]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used within AppStoreProvider");
  return ctx;
}

export function useProductMetrics() {
  const { products, orders } = useStore();
  return useMemo(() => computeAllMetrics(products, orders), [products, orders]);
}

export function useDayMetrics(date: Date) {
  const { orders, adSpend, expenses } = useStore();
  return useMemo(() => {
    const day = startOfDay(date);
    const yesterday = new Date(day);
    yesterday.setDate(day.getDate() - 1);

    const todayPnl = calculateProfitAndLoss(orders, adSpend, expenses, buildPeriodRangeFromDates(day, day, "Today"));
    const yestPnl = calculateProfitAndLoss(orders, adSpend, expenses, buildPeriodRangeFromDates(yesterday, yesterday, "Yesterday"));

    const today = {
      revenue: todayPnl.netRevenue,
      adSpend: todayPnl.adCost,
      grossProfit: todayPnl.grossProfit,
      orderProfit: todayPnl.orderProfit,
      orderCount: todayPnl.orderCount,
      operatingExpenses: todayPnl.fixedCosts + todayPnl.variableExpenses + todayPnl.customExpenses,
      netProfit: todayPnl.netProfit,
    };
    const yest = {
      revenue: yestPnl.netRevenue,
      adSpend: yestPnl.adCost,
      grossProfit: yestPnl.grossProfit,
      orderProfit: yestPnl.orderProfit,
      orderCount: yestPnl.orderCount,
      operatingExpenses: yestPnl.fixedCosts + yestPnl.variableExpenses + yestPnl.customExpenses,
      netProfit: yestPnl.netProfit,
    };

    const pct = (a: number, b: number) => (b === 0 ? (a === 0 ? 0 : 100) : ((a - b) / b) * 100);
    return {
      today,
      yest,
      todayAdSpend: today.adSpend,
      yestAdSpend: yest.adSpend,
      deltas: {
        netProfit: pct(today.netProfit, yest.netProfit),
        revenue: pct(today.revenue, yest.revenue),
        adSpend: pct(today.adSpend, yest.adSpend),
        grossProfit: pct(today.grossProfit, yest.grossProfit),
        operatingExpenses: pct(today.operatingExpenses, yest.operatingExpenses),
      },
    };
  }, [orders, adSpend, expenses, date]);
}

export function useFormatters() {
  const { settings } = useStore();
  const rawCurrency = settings.currency ?? "PKR";
  const currency = rawCurrency === "Rs" ? "PKR" : rawCurrency;
  const symbol = getCurrencySymbol(currency);
  return useMemo(() => {
    const fmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
    const fmt2 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 0 });
    /*
     * ── Currency is a LABEL here, not a conversion. ─────────────────────────
     *
     * These formatters used to multiply every figure by PKR_RATES[currency] —
     * a hardcoded table stamped "May 2025" — and then attach the chosen symbol.
     * Two things were wrong with that. It is money math in the UI, which the
     * architecture contract forbids outright; and it silently restated a
     * business's real profit through a rate that goes stale the day it ships,
     * with nothing on screen saying so.
     *
     * The server already owns currency properly: every transaction freezes its
     * own fx rate and `toBaseCurrency` converts to the business's base currency
     * before anything is returned. So the cents arriving here are already
     * correct, and the only honest job left is to put the right glyph in front
     * of them. Real multi-currency display, if it is ever wanted, belongs on
     * the server beside the rates that are actually maintained.
     */
    return {
      /** @deprecated Takes MAJOR units. Prefer `moneyCents` — the API speaks cents. */
      money: (n: number) => `${symbol} ${fmt.format(Math.round(n))}`,
      /**
       * @deprecated Takes MAJOR units. Prefer `moneyCentsSigned`.
       *
       * A POSITIVE value gets an explicit "+", matching `formatCentsSigned`.
       * It used to print a bare figure, which meant a gain was distinguished
       * from a loss by colour alone — the one thing money display may never
       * rely on (DESIGN.md 3a). The two signed formatters also simply
       * disagreed, which is its own bug.
       */
      moneySigned: (n: number) =>
        `${n > 0 ? "+" : n < 0 ? "-" : ""}${symbol} ${fmt.format(Math.abs(Math.round(n)))}`,

      /*
       * The cents family — use these for anything that came off the API. They
       * exist so the symbol and the number are taken from the SAME place; a
       * bare `formatCents(x, f.symbol)` invites the two to drift apart again.
       */
      moneyCents: (cents: number) => formatCents(cents, symbol),
      moneyCentsSigned: (cents: number) => formatCentsSigned(cents, symbol),
      /** Compact WITH the symbol — hero figures. */
      compactCents: (cents: number) => formatCompactCents(cents, symbol),
      /** Compact WITHOUT the symbol — axis ticks, where the glyph would repeat. */
      compactNumber: (cents: number) => formatCompactNumber(cents),

      number: (n: number) => fmt.format(n),
      decimal: (n: number) => fmt2.format(n),
      percent: (n: number) => `${fmt2.format(n)}%`,
      symbol,
      currency,
    };
  }, [currency, symbol]);
}
