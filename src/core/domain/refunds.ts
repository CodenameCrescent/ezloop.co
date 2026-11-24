import Decimal from "decimal.js";
import { addCents, mulCentsQty } from "./money";
import { netLineRevenue, orderDiscountShares } from "./profit";
import type { AdjustmentType, CostSnapshot, SnapshotComponent, TransactionDirection } from "./types";

/**
 * Append-only refund/chargeback construction. A refund is a NEW transaction
 * (direction flipped, parent_transaction_id set) whose lines point at the
 * original lines via refunded_line_id — the original is never edited, only
 * its status changes. All recovered-cost math reads the ORIGINAL line's
 * frozen snapshot.
 */

export interface RefundableLine {
  id: string;
  label?: string | null;
  qty: string;
  unitPriceCents: number;
  lineDiscountCents: number;
  costSnapshot: CostSnapshot | null;
}

export interface RefundableTransaction {
  id: string;
  direction: TransactionDirection;
  sourceId: string;
  currency: string;
  orderDiscountCents: number;
}

export interface RefundRequestLine {
  lineId: string;
  /** Decimal string — how many units go back. */
  qtyRefunded: string;
  amountRefundedCents: number;
  restocked?: boolean;
  feesRecovered?: boolean;
}

/** Prior refund lines against the same original transaction (for cumulative limits). */
export interface PriorRefundLine {
  refundedLineId: string;
  qtyRefunded: string;
  amountRefundedCents: number;
}

export interface BuiltRefundLine {
  refundedLineId: string | null;
  label: string | null;
  /** Refund lines carry the exact refunded amount as qty 1 × amount. */
  qty: string;
  unitPriceCents: number;
  lineDiscountCents: number;
  /** Recovered components only (filtered by restocked/fees_recovered), qty_basis = qtyRefunded. */
  costSnapshot: CostSnapshot | null;
  restocked: boolean | null;
  feesRecovered: boolean | null;
  profitImpactCents: number;
}

export interface BuiltRefund {
  transaction: {
    direction: TransactionDirection;
    parentTransactionId: string;
    adjustmentType: AdjustmentType;
    sourceId: string;
    currency: string;
    orderDiscountCents: number;
    shippingChargedCents: number;
    taxCollectedCents: number;
  };
  lines: BuiltRefundLine[];
  parentStatus: "refunded" | "partially_refunded";
  profitImpactCents: number;
}

function recoveredComponents(
  original: RefundableLine,
  qtyRefunded: string,
  restocked: boolean,
  feesRecovered: boolean,
): SnapshotComponent[] {
  if (!original.costSnapshot) return [];
  return original.costSnapshot.components
    .filter((component) => (component.kind === "cost" ? restocked : feesRecovered))
    .map((component) => ({
      ...component,
      per_unit_cents: mulCentsQty(component.per_unit_cents, qtyRefunded),
    }));
}

export function buildRefund(
  originalTx: RefundableTransaction,
  originalLines: RefundableLine[],
  requests: RefundRequestLine[],
  options: {
    adjustmentType?: Extract<AdjustmentType, "refund" | "chargeback">;
    /** Chargebacks usually cost an extra processor fee — posted as an unlinked out-line. */
    chargebackFeeCents?: number;
    priorRefunds?: PriorRefundLine[];
  } = {},
): BuiltRefund {
  const adjustmentType = options.adjustmentType ?? "refund";
  const priorRefunds = options.priorRefunds ?? [];
  if (requests.length === 0) throw new RangeError("buildRefund: at least one refund line is required");

  const linesById = new Map(originalLines.map((line) => [line.id, line]));
  const shares = orderDiscountShares(originalTx.orderDiscountCents, originalLines);
  const shareByLineId = new Map(originalLines.map((line, index) => [line.id, shares[index]]));

  const builtLines: BuiltRefundLine[] = [];
  let profitImpactCents = 0;

  for (const request of requests) {
    const original = linesById.get(request.lineId);
    if (!original) throw new RangeError(`buildRefund: line ${request.lineId} is not on transaction ${originalTx.id}`);
    if (!Number.isSafeInteger(request.amountRefundedCents) || request.amountRefundedCents <= 0) {
      throw new RangeError(`buildRefund: amount_refunded_cents must be positive integer cents`);
    }

    const prior = priorRefunds.filter((refund) => refund.refundedLineId === request.lineId);
    const priorQty = prior.reduce((sum, refund) => sum.plus(refund.qtyRefunded), new Decimal(0));
    const priorAmount = prior.reduce((sum, refund) => addCents(sum, refund.amountRefundedCents), 0);

    const qtyRefunded = new Decimal(request.qtyRefunded);
    if (qtyRefunded.lte(0)) throw new RangeError("buildRefund: qty_refunded must be positive");
    if (priorQty.plus(qtyRefunded).gt(new Decimal(original.qty))) {
      throw new RangeError(
        `buildRefund: cumulative refunded qty for line ${original.id} exceeds the original quantity`,
      );
    }

    const maxRefundable = netLineRevenue(original, shareByLineId.get(original.id) ?? 0);
    if (priorAmount + request.amountRefundedCents > maxRefundable) {
      throw new RangeError(
        `buildRefund: cumulative refunded amount for line ${original.id} exceeds its refundable amount (${maxRefundable})`,
      );
    }

    const restocked = request.restocked ?? false;
    const feesRecovered = request.feesRecovered ?? false;
    const components = recoveredComponents(original, request.qtyRefunded, restocked, feesRecovered);
    const recoveredTotal = components.reduce((sum, component) => addCents(sum, component.per_unit_cents), 0);
    // Always emitted (even with nothing recovered): qty_basis is how later
    // refunds reconstruct the cumulative refunded QUANTITY from stored rows.
    const snapshot: CostSnapshot = {
      version: 1,
      components,
      total_per_unit_cents: recoveredTotal,
      qty_basis: request.qtyRefunded,
    };

    const lineImpact = addCents(-request.amountRefundedCents, recoveredTotal);
    profitImpactCents = addCents(profitImpactCents, lineImpact);

    builtLines.push({
      refundedLineId: original.id,
      label: original.label ?? null,
      qty: "1",
      unitPriceCents: request.amountRefundedCents,
      lineDiscountCents: 0,
      costSnapshot: snapshot,
      restocked,
      feesRecovered,
      profitImpactCents: lineImpact,
    });
  }

  if (adjustmentType === "chargeback" && options.chargebackFeeCents && options.chargebackFeeCents > 0) {
    profitImpactCents = addCents(profitImpactCents, -options.chargebackFeeCents);
    builtLines.push({
      refundedLineId: null,
      label: "Chargeback fee",
      qty: "1",
      unitPriceCents: options.chargebackFeeCents,
      lineDiscountCents: 0,
      costSnapshot: null,
      restocked: null,
      feesRecovered: null,
      profitImpactCents: -options.chargebackFeeCents,
    });
  }

  // Parent status: fully refunded when the cumulative refunded amount reaches
  // the total refundable amount of all lines (shipping is not refundable here).
  const totalRefundable = originalLines.reduce(
    (sum, line) => addCents(sum, netLineRevenue(line, shareByLineId.get(line.id) ?? 0)),
    0,
  );
  const cumulativeRefunded =
    priorRefunds.reduce((sum, refund) => addCents(sum, refund.amountRefundedCents), 0) +
    requests.reduce((sum, request) => addCents(sum, request.amountRefundedCents), 0);
  const parentStatus = cumulativeRefunded >= totalRefundable ? "refunded" : "partially_refunded";

  return {
    transaction: {
      direction: originalTx.direction === "in" ? "out" : "in",
      parentTransactionId: originalTx.id,
      adjustmentType,
      sourceId: originalTx.sourceId,
      currency: originalTx.currency,
      orderDiscountCents: 0,
      shippingChargedCents: 0,
      taxCollectedCents: 0,
    },
    lines: builtLines,
    parentStatus,
    profitImpactCents,
  };
}
