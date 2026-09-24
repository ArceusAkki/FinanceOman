import type { ApInvoice, Dataset } from './types';
import { round, sum } from './stats';

export type MatchStatus = 'matched' | 'price_variance' | 'quantity_variance' | 'missing_receipt' | 'no_po';

export interface MatchResult {
  invoiceId: string;
  invoiceNumber: string;
  vendorId: string;
  poId?: string;
  status: MatchStatus;
  priceVariancePct: number;
  qtyVariance: number;
  amount: number;
  suggestion: string;
}

export interface MatchSummary {
  results: MatchResult[];
  byStatus: Record<MatchStatus, number>;
  firstPassMatchRate: number;
  exceptionValue: number;
}

export interface MatchTolerance {
  pricePct: number;
  qtyUnits: number;
}

export const DEFAULT_TOLERANCE: MatchTolerance = { pricePct: 0.02, qtyUnits: 0 };

const SUGGESTIONS: Record<MatchStatus, string> = {
  matched: 'Auto-post and schedule for the next payment run.',
  price_variance: 'Compare against the PO condition/contract price; request a credit note or approve the PO price change.',
  quantity_variance: 'Hold the excess quantity until a goods receipt is posted, or request a corrected invoice.',
  missing_receipt: 'Ask the requester/warehouse to post the goods or service receipt (MIGO / Receipts) before release.',
  no_po: 'Non-PO invoice: route for cost-centre approval or create a retrospective PO and flag as maverick spend.',
};

/** PO–goods-receipt–invoice three-way match with configurable tolerances. */
export function threeWayMatch(data: Dataset, tol: MatchTolerance = DEFAULT_TOLERANCE): MatchSummary {
  const poById = new Map(data.purchaseOrders.map((p) => [p.id, p]));
  const receivedQty = new Map<string, number>();
  for (const gr of data.goodsReceipts) receivedQty.set(gr.poId, (receivedQty.get(gr.poId) ?? 0) + gr.qty);

  const results = data.apInvoices.map((inv: ApInvoice): MatchResult => {
    const po = inv.poId ? poById.get(inv.poId) : undefined;
    let status: MatchStatus = 'matched';
    let priceVariancePct = 0;
    let qtyVariance = 0;
    if (!po) {
      status = 'no_po';
    } else {
      const received = receivedQty.get(po.id) ?? 0;
      priceVariancePct = po.unitPrice ? (inv.unitPrice - po.unitPrice) / po.unitPrice : 0;
      qtyVariance = inv.qty - received;
      if (received === 0) status = 'missing_receipt';
      else if (Math.abs(priceVariancePct) > tol.pricePct) status = 'price_variance';
      else if (qtyVariance > tol.qtyUnits) status = 'quantity_variance';
    }
    return {
      invoiceId: inv.id,
      invoiceNumber: inv.invoiceNumber,
      vendorId: inv.vendorId,
      poId: inv.poId,
      status,
      priceVariancePct: round(priceVariancePct * 100, 2),
      qtyVariance,
      amount: inv.grossAmount,
      suggestion: SUGGESTIONS[status],
    };
  });

  const byStatus: Record<MatchStatus, number> = { matched: 0, price_variance: 0, quantity_variance: 0, missing_receipt: 0, no_po: 0 };
  for (const r of results) byStatus[r.status]++;
  const exceptions = results.filter((r) => r.status !== 'matched');

  return {
    results,
    byStatus,
    firstPassMatchRate: round(byStatus.matched / Math.max(results.length, 1), 3),
    exceptionValue: round(sum(exceptions.map((r) => r.amount)), 3),
  };
}
