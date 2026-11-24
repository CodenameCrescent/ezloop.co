import { useState, useEffect, useMemo } from "react";
import { useFxRate, useRevenueItems, useExpenseItems, usePeople, useCategories, useSources, useCostTargets, useCreateTransaction, useTransactionTemplates, useCreateTransactionTemplate, useDeleteTransactionTemplate } from "@/api/hooks";
import { useFormatters } from "@/lib/store";
import { getCurrencySymbol } from "@/lib/currencyUtils";
import { todayInputValue } from "@/lib/period";
import { useArchivedMatches } from "@/lib/archivedMatch";
import { type Direction, type PreviewResp, type QuickAddDraft, type LineDraft, emptyLine, ALL_RANGE, type QuickAddProps } from "./DraftFromTransaction";

/** useQuickAddLogic's state and handlers, kept out of its render so each file stays short. */
export function useQuickAddDraftState({ open, initial }: Pick<QuickAddProps, "open" | "initial">) {
  const [date, setDate] = useState(todayInputValue);
  const [customer, setCustomer] = useState("");
  const [notes, setNotes] = useState("");
  const [reference, setReference] = useState("");
  const [sourceId, setSourceId] = useState<string>("");
  const [paid, setPaid] = useState(true);
  /** When the cash moved. Blank while unpaid; defaults to the date it happened. */
  const [paidDate, setPaidDate] = useState(todayInputValue);
  /** Empty = nothing agreed, which is a real answer and never makes a row late. */
  const [dueDate, setDueDate] = useState("");
  const [taxPaidRupees, setTaxPaidRupees] = useState("");
  const [taxReclaimable, setTaxReclaimable] = useState(false);
  const [lines, setLines] = useState<LineDraft[]>([emptyLine("in")]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [orderDiscountRupees, setOrderDiscountRupees] = useState("");
  const [preview, setPreview] = useState<PreviewResp | null>(null);
  /**
   * Null = amounts are typed in the business's own currency (the usual case).
   * Otherwise the currency they are typed in; the server converts on save.
   */
  const [typedIn, setTypedIn] = useState<string | null>(null);
  /** Own-currency per one unit of `typedIn`, as typed. Filled from today's rate. */
  const [fxRate, setFxRate] = useState("");
  const f = useFormatters();
  const fxLookup = useFxRate(open && typedIn ? typedIn : null);
  // Offered once, into an empty box: a rate the owner typed is never overwritten.
  const suggestedRate = fxLookup.data?.rate ?? null;
  useEffect(() => {
    if (typedIn && suggestedRate) setFxRate((current) => current || suggestedRate);
  }, [typedIn, suggestedRate]);
  const moneySymbol = typedIn ? getCurrencySymbol(typedIn) : f.symbol;

  const revenueItems = useRevenueItems(ALL_RANGE, "active");
  const expenseItems = useExpenseItems(ALL_RANGE, "active");
  const people = usePeople("customer");
  /**
   * Exact matches only: this notice claims the sale WILL land on that record,
   * so it has to fire on precisely what the server reuses and nothing looser.
   */
  const archivedMatches = useArchivedMatches({ name: customer }, "customer", {
    enabled: open,
    reusableOnly: true,
  });
  // A line here is money either way, so both money sides are offered — but the
  // internal time buckets are not money and stay out.
  const categories = useCategories("money");
  const sources = useSources();
  // Only fetched while the dialog is open — it is never needed behind it.
  const costTargets = useCostTargets({ enabled: open });
  const createM = useCreateTransaction();
  const templates = useTransactionTemplates({ enabled: open });
  const createTemplateM = useCreateTransactionTemplate();
  const deleteTemplateM = useDeleteTransactionTemplate();
  const [activeTemplateId, setActiveTemplateId] = useState<string>("");
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [templateName, setTemplateName] = useState("");

  /** Load a saved draft (template payload or Duplicate) into the form. */
  function applyDraft(draft: QuickAddDraft) {
    setLines(
      draft.lines.map((l) => ({
        key: Math.random().toString(36).slice(2),
        direction: (l.direction ?? draft.direction) as Direction,
        itemId: l.revenueItemId ?? l.expenseItemId ?? "",
        label: l.label ?? "",
        categoryId: l.categoryId ?? "",
        qty: l.qty ?? "1",
        priceRupees: l.unitPriceCents != null ? String(l.unitPriceCents / 100) : "",
        lineDiscountRupees: l.lineDiscountCents ? String(l.lineDiscountCents / 100) : "",
        spreadMonths: l.spreadMonths ? String(l.spreadMonths) : "",
        isAdvance: l.isAdvance ?? false,
        wastedQty: l.wastedQty ?? "",
        targetKey: l.targetType && l.targetId ? `${l.targetType}:${l.targetId}` : "",
        splitParts: l.split
          ? l.split.map((p) => ({
              key: Math.random().toString(36).slice(2),
              targetKey: `${p.targetType}:${p.targetId}`,
              percent: p.weight,
            }))
          : null,
      })),
    );
    setCustomer(draft.personName ?? "");
    setNotes(draft.notes ?? "");
    setReference(draft.referenceNumber ?? "");
    setSourceId(draft.sourceId ?? "");
    setPaid(draft.paidAt !== null);
    setTaxPaidRupees(draft.taxPaidCents ? String(draft.taxPaidCents / 100) : "");
    setTaxReclaimable(draft.taxReclaimable ?? false);
    setOrderDiscountRupees(draft.orderDiscountCents ? String(draft.orderDiscountCents / 100) : "");
    // The currency comes back, but not the old rate: today's is fetched fresh.
    setTypedIn(draft.enteredIn?.currency ?? null);
    setFxRate("");
    setShowAdvanced(!!(draft.notes || draft.referenceNumber || draft.lines.some((l) => l.categoryId || l.lineDiscountCents || l.spreadMonths)));
  }

  /**
   * "Today" means the day the dialog is OPENED, not the day the page loaded.
   *
   * This component sits mounted behind every screen's top bar, so the date was
   * being captured once and then kept — an app left open overnight went on
   * dating today's sales yesterday.
   */
  useEffect(() => {
    if (!open) return;
    setDate(todayInputValue());
    setPaidDate(todayInputValue());
    setDueDate("");
  }, [open]);

  // Duplicate flow: a parent-provided draft loads whenever the dialog opens with one.
  useEffect(() => {
    if (open && initial) applyDraft(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial]);

  const revCatalog = revenueItems.data?.items ?? [];
  const expCatalog = expenseItems.data?.items ?? [];
  const hasRevenue = lines.some((l) => l.direction === "in");

  /** Targets under their server-given headings, in the order they arrived. */
  const targetGroups = useMemo(() => {
    const byGroup = new Map<string, typeof items>();
    const items = costTargets.data?.items ?? [];
    for (const target of items) byGroup.set(target.group, [...(byGroup.get(target.group) ?? []), target]);
    return [...byGroup.entries()];
  }, [costTargets.data]);

  function reset() {
    setLines([emptyLine("in")]);
    setCustomer("");
    setNotes("");
    setReference("");
    setPaid(true);
    // Both dates go back to today. Leaving `date` out meant the second entry of
    // a session silently inherited the first one's date.
    setDate(todayInputValue());
    setPaidDate(todayInputValue());
    setDueDate("");
    setTaxPaidRupees("");
    setTaxReclaimable(false);
    setOrderDiscountRupees("");
    setTypedIn(null);
    setFxRate("");
    setShowAdvanced(false);
    setPreview(null);
    setActiveTemplateId("");
    setSavingTemplate(false);
    setTemplateName("");
  }

  return {
    templateName,
    createTemplateM,
    setSavingTemplate,
    setTemplateName,
    lines,
    hasRevenue,
    orderDiscountRupees,
    taxPaidRupees,
    fxRate,
    typedIn,
    date,
    paid,
    paidDate,
    dueDate,
    sourceId,
    customer,
    notes,
    reference,
    taxReclaimable,
    setPreview,
    setLines,
    revCatalog,
    expCatalog,
    setTypedIn,
    setFxRate,
    createM,
    reset,
    templates,
    activeTemplateId,
    setActiveTemplateId,
    applyDraft,
    deleteTemplateM,
    f,
    fxLookup,
    suggestedRate,
    preview,
    moneySymbol,
    showAdvanced,
    categories,
    targetGroups,
    setShowAdvanced,
    setDate,
    setSourceId,
    sources,
    setCustomer,
    people,
    archivedMatches,
    setReference,
    setNotes,
    setOrderDiscountRupees,
    setTaxPaidRupees,
    setTaxReclaimable,
    setPaid,
    setDueDate,
    setPaidDate,
    savingTemplate,
  };
}
