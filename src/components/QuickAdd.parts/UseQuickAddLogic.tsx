import { useEffect } from "react";
import { toast } from "sonner";
import { apiErrorMessage, previewTransactionFetch } from "@/api/hooks";
import { dateInputToInstant } from "@/lib/period";
import { type Direction, type CreateBody, type LineDraft, type SplitDraft, type QuickAddProps } from "./DraftFromTransaction";
import { useQuickAddDraftState } from "./UseQuickAddDraftState";
import { useQuickAddDraftBody } from "./UseQuickAddDraftBody";

/** QuickAdd's state and handlers, kept out of its render so each file stays short. */
export function useQuickAddLogic({ open, onOpenChange, initial }: Pick<QuickAddProps, "open" | "onOpenChange" | "initial">) {
  const {
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
  } = useQuickAddDraftState({ open, initial });

  function saveAsTemplate() {
    if (!body) {
      toast.error("Fill in the entry first, then save it as a template");
      return;
    }
    if (!templateName.trim()) {
      toast.error("Give the template a name");
      return;
    }
    const { occurredAt: _drop, ...payload } = body;
    createTemplateM.mutate(
      { name: templateName.trim(), payload },
      {
        onSuccess: () => {
          toast.success("Template saved");
          setSavingTemplate(false);
          setTemplateName("");
        },
        onError: (err) => toast.error(apiErrorMessage(err, "Could not save template")),
      },
    );
  }
  const { body, moneyProblem } = useQuickAddDraftBody({ lines, hasRevenue, orderDiscountRupees, taxPaidRupees, fxRate, typedIn, date, paid, paidDate, dueDate, sourceId, customer, notes, reference, taxReclaimable });

  // Live preview — debounced, server-computed so it matches the drawer exactly.
  useEffect(() => {
    if (!open || !body) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      previewTransactionFetch(body)
        .then((p) => !cancelled && setPreview(p))
        .catch(() => !cancelled && setPreview(null));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [open, body, setPreview]);

  function updateLine(key: string, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function updateShare(lineKey: string, shareKey: string, patch: Partial<SplitDraft>) {
    setLines((prev) =>
      prev.map((l) =>
        l.key === lineKey
          ? { ...l, splitParts: (l.splitParts ?? []).map((s) => (s.key === shareKey ? { ...s, ...patch } : s)) }
          : l,
      ),
    );
  }

  function addShare(lineKey: string) {
    setLines((prev) =>
      prev.map((l) =>
        l.key === lineKey
          ? {
              ...l,
              splitParts: [
                ...(l.splitParts ?? []),
                { key: Math.random().toString(36).slice(2), targetKey: "", percent: "" },
              ],
            }
          : l,
      ),
    );
  }

  function removeShare(lineKey: string, shareKey: string) {
    setLines((prev) =>
      prev.map((l) =>
        l.key === lineKey ? { ...l, splitParts: (l.splitParts ?? []).filter((s) => s.key !== shareKey) } : l,
      ),
    );
  }

  function setLineDirection(key: string, direction: Direction) {
    // Switching direction clears the linked item (revenue/expense catalogs differ).
    updateLine(key, { direction, itemId: "", priceRupees: "" });
  }

  function selectItem(key: string, direction: Direction, itemId: string) {
    if (!itemId) {
      updateLine(key, { itemId: "" });
      return;
    }
    // A saved price is in the business's own currency — offering it as a dollar
    // figure would be wrong by the whole exchange rate. The owner types it.
    if (typedIn) {
      updateLine(key, { itemId, priceRupees: "" });
      return;
    }
    if (direction === "in") {
      const item = revCatalog.find((i) => i.id === itemId);
      const price = item && item.pricingModel !== "variable" && item.unitPriceCents != null ? String(item.unitPriceCents / 100) : "";
      updateLine(key, { itemId, priceRupees: price });
    } else {
      const item = expCatalog.find((i) => i.id === itemId);
      const price = item?.defaultAmountCents != null ? String(item.defaultAmountCents / 100) : "";
      updateLine(key, { itemId, priceRupees: price });
    }
  }

  /** Switching currency clears prices that came from the catalogue, for the same reason. */
  function chooseCurrency(next: string | null) {
    if (next === typedIn) return;
    setTypedIn(next);
    setFxRate("");
    setLines((prev) => prev.map((l) => (l.itemId ? { ...l, priceRupees: "" } : l)));
  }

  function save() {
    // Say which box is wrong, by the name printed beside it. The server can
    // only see `unitPriceCents` and used to answer "Invalid request".
    if (moneyProblem) {
      toast.error(moneyProblem);
      return;
    }
    if (!body) {
      toast.error("Add at least one item or a labelled line");
      return;
    }
    // Stamped when Record is pressed, not when the form was last touched: a
    // draft left open for ten minutes should still record the time it was
    // actually saved.
    const now = new Date();
    const payload: CreateBody = {
      ...body,
      occurredAt: dateInputToInstant(date, now).toISOString(),
      paidAt: paid ? dateInputToInstant(paidDate || date, now).toISOString() : null,
    };
    createM.mutate(payload, {
      onSuccess: () => {
        toast.success(hasRevenue ? "Saved" : "Expense recorded");
        reset();
        onOpenChange(false);
      },
      onError: (err) => toast.error(apiErrorMessage(err, "Could not save")),
    });
  }

  return {
    reset,
    templates,
    activeTemplateId,
    setActiveTemplateId,
    applyDraft,
    deleteTemplateM,
    f,
    typedIn,
    chooseCurrency,
    fxRate,
    setFxRate,
    fxLookup,
    suggestedRate,
    preview,
    lines,
    revCatalog,
    expCatalog,
    setLineDirection,
    setLines,
    updateLine,
    selectItem,
    moneySymbol,
    showAdvanced,
    categories,
    hasRevenue,
    paid,
    targetGroups,
    updateShare,
    removeShare,
    addShare,
    setShowAdvanced,
    date,
    setDate,
    sourceId,
    setSourceId,
    sources,
    customer,
    setCustomer,
    people,
    archivedMatches,
    reference,
    setReference,
    notes,
    setNotes,
    orderDiscountRupees,
    setOrderDiscountRupees,
    taxPaidRupees,
    setTaxPaidRupees,
    taxReclaimable,
    setTaxReclaimable,
    setPaid,
    dueDate,
    setDueDate,
    paidDate,
    setPaidDate,
    savingTemplate,
    templateName,
    setTemplateName,
    saveAsTemplate,
    createTemplateM,
    setSavingTemplate,
    body,
    save,
    createM,
    moneyProblem,
  };
}

export type QuickAddState = ReturnType<typeof useQuickAddLogic>;
