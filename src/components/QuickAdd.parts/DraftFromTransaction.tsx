import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem, SelectGroup, SelectLabel } from "@/components/ui/select";
import { formatCents } from "@/lib/money";
import type { EndpointResponse, EndpointBody } from "@workspace/api-contract";
import type { previewTransaction, createTransaction } from "@workspace/api-contract";

export type Direction = "in" | "out";
export type PreviewResp = EndpointResponse<typeof previewTransaction>;
export type CreateBody = EndpointBody<typeof createTransaction>;
export type SplitTarget = NonNullable<NonNullable<CreateBody["lines"][number]["split"]>[number]["targetType"]>;
/** A reusable draft: the create body minus the date (templates + Duplicate). */
export type QuickAddDraft = Omit<CreateBody, "occurredAt">;

/**
 * Build a Quick-Add draft from an existing transaction summary (the drawer's
 * Duplicate action). The reference number is intentionally dropped — a copy
 * should get its own invoice number — and refund lines never carry over.
 */
export function draftFromTransaction(t: {
  direction: "in" | "out";
  sourceId: string;
  personName: string | null;
  notes: string | null;
  orderDiscountCents: number;
  lines: Array<{
    direction: "in" | "out";
    revenueItemId: string | null;
    expenseItemId: string | null;
    label: string | null;
    categoryId: string | null;
    qty: string;
    unitPriceCents: number;
    lineDiscountCents: number;
    spreadMonths: number | null;
    refundedLineId: string | null;
  }>;
}): QuickAddDraft {
  return {
    direction: t.direction,
    sourceId: t.sourceId,
    ...(t.personName ? { personName: t.personName } : {}),
    ...(t.notes ? { notes: t.notes } : {}),
    ...(t.orderDiscountCents ? { orderDiscountCents: t.orderDiscountCents } : {}),
    lines: t.lines
      .filter((l) => !l.refundedLineId)
      .map((l) => ({
        direction: l.direction,
        ...(l.revenueItemId ? { revenueItemId: l.revenueItemId } : {}),
        ...(l.expenseItemId ? { expenseItemId: l.expenseItemId } : {}),
        ...(l.label ? { label: l.label } : {}),
        ...(l.categoryId ? { categoryId: l.categoryId } : {}),
        qty: l.qty,
        unitPriceCents: l.unitPriceCents,
        ...(l.lineDiscountCents ? { lineDiscountCents: l.lineDiscountCents } : {}),
        ...(l.spreadMonths ? { spreadMonths: l.spreadMonths } : {}),
      })),
  };
}

/** One share of a split, as it is being typed. */
export interface SplitDraft {
  key: string;
  /** "targetType:targetId", or "" while nothing is picked yet. */
  targetKey: string;
  /** Percentage as typed. Relative, so it need not land exactly on 100. */
  percent: string;
}

export interface LineDraft {
  key: string;
  direction: Direction; // per-line: money in (revenue) or money out (cost/expense)
  itemId: string; // "" = free label
  label: string;
  categoryId: string; // "" = none
  qty: string;
  priceRupees: string;
  lineDiscountRupees: string;
  /** "" = charge it all to this month. Otherwise the number of months to spread it over. */
  spreadMonths: string;
  /** Money moved before the work did — cash now, cost when it is settled. */
  isAdvance: boolean;
  /** How much of it was wasted. Information only, never money. */
  wastedQty: string;
  /** "" = for the business generally. Otherwise "targetType:targetId". */
  targetKey: string;
  /**
   * Set when this one cost is being divided between several things. Each share
   * carries a percentage the owner typed; the SERVER turns those into money.
   */
  splitParts: SplitDraft[] | null;
}

export function emptyLine(direction: Direction = "in"): LineDraft {
  return { key: Math.random().toString(36).slice(2), direction, itemId: "", label: "", categoryId: "", qty: "1", priceRupees: "", lineDiscountRupees: "", spreadMonths: "", isAdvance: false, wastedQty: "", targetKey: "", splitParts: null };
}

/** The one other currency an entry can be typed in, for now. */
export const OTHER_CURRENCY = "USD";
/** A rate as typed: a plain positive number. The server checks it again. */
export const RATE_SHAPE = /^\d+(\.\d+)?$/;

export const ALL_RANGE = { startDate: new Date(new Date().getFullYear() - 3, 0, 1).toISOString(), endDate: new Date().toISOString() };

/**
 * How long a big cost can be charged across. A short list, not a free number
 * box: the owner is answering "how long will this last me", and every one of
 * these is an answer someone would actually give.
 */
export const SPREAD_CHOICES = [3, 6, 12, 24, 36, 60] as const;

export function spreadChoiceLabel(months: number): string {
  if (months < 12) return `The next ${months} months`;
  const years = months / 12;
  return years === 1 ? "The next year" : `The next ${years} years`;
}

/**
 * "50 / 30 / 20" — what each share will actually get, restated as a percentage
 * of what was typed.
 *
 * Deliberately NOT a validation error when the numbers miss 100. The shares are
 * relative: someone typing 33 three times means "a third each", and refusing
 * that over one percentage point would be the app being pedantic about the
 * owner's own arithmetic. This tells them what will happen instead.
 */
export function shareNote(line: LineDraft): string {
  // A share with nobody on it is not a share yet, so it cannot count toward the
  // total — otherwise two blank rows at 50 would proudly report "adds to 100%".
  const parts = (line.splitParts ?? []).filter((p) => p.targetKey && Number(p.percent) > 0);
  if (parts.length < 2) return "Pick at least two";
  // The server refuses the same target twice. Saying so here beats letting the
  // owner fill the whole form and get an error back on Record.
  if (new Set(parts.map((p) => p.targetKey)).size !== parts.length) return "Pick a different one for each share";
  const total = parts.reduce((sum, p) => sum + Number(p.percent), 0);
  if (Math.abs(total - 100) < 0.005) return "Adds to 100%";
  const asPercent = parts.map((p) => Math.round((Number(p.percent) / total) * 100));
  return `Splits ${asPercent.join(" / ")}`;
}

/** A grouped picker for who a cost was for. Headings come from the server. */
export function TargetPicker({
  groups,
  value,
  onChange,
  /**
   * A share of a split must land on someone. Offering "the business generally"
   * inside a split would let the owner build one the server then refuses, so
   * the escape hatch is only shown where it is a real answer.
   */
  allowNobody = true,
}: {
  groups: Array<[string, Array<{ targetType: string; targetId: string; label: string }>]>;
  value: string;
  onChange: (value: string) => void;
  allowNobody?: boolean;
}) {
  return (
    <Select value={value || "__none__"} onValueChange={(v) => onChange(v === "__none__" ? "" : v)}>
      <SelectTrigger>
        <SelectValue placeholder={allowNobody ? "The business generally" : "Pick who"} />
      </SelectTrigger>
      <SelectContent>
        {allowNobody && <SelectItem value="__none__">The business generally</SelectItem>}
        {groups.map(([group, items]) => (
          <SelectGroup key={group}>
            <SelectLabel>{group}</SelectLabel>
            {items.map((t) => (
              <SelectItem key={`${t.targetType}:${t.targetId}`} value={`${t.targetType}:${t.targetId}`}>
                {t.label}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}

/** "Rs 95,000.00 over 24 months — Rs 3,958.34 a month." Blank unless both are known. */
export function spreadNote(line: LineDraft, symbol: string): string | null {
  const months = Number(line.spreadMonths.trim());
  if (!Number.isInteger(months) || months < 2) return null;
  const rupees = Number(line.priceRupees.trim()) * Number(line.qty.trim() || "1");
  if (!Number.isFinite(rupees) || rupees <= 0) return null;
  const totalCents = Math.round(rupees * 100);
  // Ceiling, because the earliest months carry the leftover cents — so this is
  // the figure the owner will actually see on the very next page they open.
  const perMonth = Math.ceil(totalCents / months);
  return `${formatCents(totalCents, symbol)} spread over ${months} months — about ${formatCents(perMonth, symbol)} a month. It still leaves your bank on the day you paid it.`;
}
export type QuickAddProps = { open: boolean; onOpenChange: (v: boolean) => void; initial?: QuickAddDraft | null };
