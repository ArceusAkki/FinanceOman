import type { Dataset, Finding, Severity } from './types';
import { DAY_MS, groupBy, round, sum } from './stats';
import { expectedVat, expectedWht, isAfterHours, isOmanWeekend, roundOmr } from './oman';

/** Strip everything but letters/digits and leading zeros so "INV-0042" ≈ "inv42". */
export function normalizeInvoiceNumber(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/^([a-z]*)0+/, '$1');
}

function severityFor(amount: number, high: number, critical: number): Severity {
  return amount >= critical ? 'critical' : amount >= high ? 'high' : 'medium';
}

/** Same vendor + same gross amount + same (normalised) invoice number or invoice dates within 7 days. */
export function findDuplicateInvoices(data: Dataset): Finding[] {
  const findings: Finding[] = [];
  const groups = groupBy(data.apInvoices, (i) => `${i.vendorId}|${i.grossAmount.toFixed(3)}`);
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i];
        const b = group[j];
        const sameNumber = normalizeInvoiceNumber(a.invoiceNumber) === normalizeInvoiceNumber(b.invoiceNumber);
        const closeDates = Math.abs(Date.parse(a.invoiceDate) - Date.parse(b.invoiceDate)) <= 7 * DAY_MS;
        if (!sameNumber && !closeDates) continue;
        const bothPaid = !!a.paidAt && !!b.paidAt;
        findings.push({
          id: `DUP-${a.id}-${b.id}`,
          type: 'Duplicate invoice',
          severity: bothPaid ? 'critical' : 'high',
          title: `Possible duplicate: ${a.invoiceNumber} / ${b.invoiceNumber}`,
          detail: `Vendor ${a.vendorId} billed the same amount twice${sameNumber ? ' with matching invoice numbers' : ' within 7 days'}${bothPaid ? '; both have already been paid' : ''}.`,
          amountAtRisk: b.grossAmount,
          refs: [a.id, b.id],
        });
      }
    }
  }
  return findings;
}

/**
 * POs to one vendor by one buyer within 48 hours, each under the release threshold but together
 * above it: three or more near-threshold POs, or two that are each at least 60% of the threshold.
 */
export function findSplitPurchaseOrders(data: Dataset, windowHours = 48): Finding[] {
  const threshold = data.company.poApprovalThreshold;
  const findings: Finding[] = [];
  const groups = groupBy(data.purchaseOrders.filter((p) => p.amount < threshold && p.amount >= threshold * 0.3), (p) => `${p.vendorId}|${p.createdBy}`);
  for (const group of groups.values()) {
    const sorted = [...group].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    const used = new Set<string>();
    for (const anchor of sorted) {
      if (used.has(anchor.id)) continue;
      const t0 = Date.parse(anchor.createdAt);
      const cluster = sorted.filter((p) => !used.has(p.id) && Date.parse(p.createdAt) >= t0 && Date.parse(p.createdAt) - t0 <= windowHours * 3_600_000);
      const total = sum(cluster.map((p) => p.amount));
      const suspicious = cluster.length >= 3 || (cluster.length === 2 && cluster.every((p) => p.amount >= threshold * 0.6));
      if (!suspicious || total < threshold) continue;
      cluster.forEach((p) => used.add(p.id));
      findings.push({
        id: `SPLIT-${cluster[0].id}`,
        type: 'Split purchase order',
        severity: 'high',
        title: `${cluster.length} POs to ${cluster[0].vendorId} totalling ${total.toFixed(3)} within ${windowHours}h`,
        detail: `Each PO is below the ${threshold.toFixed(3)} release threshold but together they exceed it — a pattern used to avoid second-level approval. Created by ${cluster[0].createdBy}.`,
        amountAtRisk: round(total, 3),
        refs: cluster.map((p) => p.id),
      });
    }
  }
  return findings;
}

/** Segregation-of-duties conflicts seen in actual transactions (not just role design). */
export function findSodConflicts(data: Dataset): Finding[] {
  const findings: Finding[] = [];
  const selfApproved = data.purchaseOrders.filter((p) => p.approvedBy && p.approvedBy === p.createdBy);
  for (const [user, pos] of groupBy(selfApproved, (p) => p.createdBy)) {
    findings.push({
      id: `SOD-PO-${user}`,
      type: 'Segregation of duties',
      severity: 'high',
      title: `${user} created and approved ${pos.length} purchase order(s)`,
      detail: 'The same user raised and released these POs, bypassing maker–checker control.',
      amountAtRisk: round(sum(pos.map((p) => p.amount)), 3),
      refs: pos.map((p) => p.id),
    });
  }
  const invoiceById = new Map(data.apInvoices.map((i) => [i.id, i]));
  const selfPaid = data.payments.filter((p) => invoiceById.get(p.invoiceId)?.postedBy === p.releasedBy);
  for (const [user, pays] of groupBy(selfPaid, (p) => p.releasedBy)) {
    findings.push({
      id: `SOD-PAY-${user}`,
      type: 'Segregation of duties',
      severity: 'critical',
      title: `${user} posted invoices and released their payment (${pays.length})`,
      detail: 'Invoice posting and payment release by one person allows fictitious vendor payments to go undetected.',
      amountAtRisk: round(sum(pays.map((p) => p.amount)), 3),
      refs: pays.map((p) => p.id),
    });
  }
  return findings;
}

/** Vendor bank details changed shortly before a payment was released — a classic BEC fraud pattern. */
export function findBankChangeBeforePayment(data: Dataset, windowDays = 30): Finding[] {
  const findings: Finding[] = [];
  const bankChanges = data.vendorChanges.filter((c) => c.field === 'bank_account');
  for (const change of bankChanges) {
    const changedAt = Date.parse(change.changedAt);
    const pays = data.payments.filter((p) => p.vendorId === change.vendorId &&
      Date.parse(p.paidAt) >= changedAt && Date.parse(p.paidAt) - changedAt <= windowDays * DAY_MS);
    if (!pays.length) continue;
    const amount = round(sum(pays.map((p) => p.amount)), 3);
    findings.push({
      id: `BANK-${change.vendorId}-${change.changedAt.slice(0, 10)}`,
      type: 'Vendor bank change',
      severity: severityFor(amount, 5_000, 20_000),
      title: `Bank account of ${change.vendorId} changed ${pays.length} payment(s) before release`,
      detail: `Changed by ${change.changedBy} on ${change.changedAt.slice(0, 10)}; payments followed within ${windowDays} days. Verify by call-back to a known contact.`,
      amountAtRisk: amount,
      refs: pays.map((p) => p.id),
    });
  }
  return findings;
}

/** Manual journals posted on the Omani weekend (Fri/Sat), after hours, or with suspiciously round amounts. */
export function findJournalRedFlags(data: Dataset): Finding[] {
  const manual = data.journals.filter((j) => j.source === 'manual');
  const findings: Finding[] = [];
  const weekend = manual.filter((j) => isOmanWeekend(j.postedAt) || isAfterHours(j.postedAt));
  if (weekend.length) {
    findings.push({
      id: 'JE-TIMING',
      type: 'Journal entry timing',
      severity: weekend.length > 10 ? 'high' : 'medium',
      title: `${weekend.length} manual journals posted on Fri/Sat or outside 07:00–18:00`,
      detail: 'Out-of-hours manual postings are a standard ISA 240 journal-entry-testing criterion for management override.',
      amountAtRisk: round(sum(weekend.map((j) => Math.abs(j.amount))), 3),
      refs: weekend.slice(0, 20).map((j) => j.id),
    });
  }
  const roundAmounts = manual.filter((j) => Math.abs(j.amount) >= 1000 && Math.abs(j.amount) % 1000 === 0);
  if (roundAmounts.length) {
    findings.push({
      id: 'JE-ROUND',
      type: 'Journal entry round amounts',
      severity: 'medium',
      title: `${roundAmounts.length} manual journals with round-thousand amounts`,
      detail: 'Round amounts in manual journals often indicate estimates or plugs; review support and approvals.',
      amountAtRisk: round(sum(roundAmounts.map((j) => Math.abs(j.amount))), 3),
      refs: roundAmounts.slice(0, 20).map((j) => j.id),
    });
  }
  return findings;
}

/** VAT at 5% on domestic supplies and WHT at 10% on foreign service vendors. */
export function findTaxIssues(data: Dataset): Finding[] {
  const vendorById = new Map(data.vendors.map((v) => [v.id, v]));
  const vatIssues = [];
  const whtIssues = [];
  for (const inv of data.apInvoices) {
    const vendor = vendorById.get(inv.vendorId);
    if (!vendor) continue;
    const vatGap = roundOmr(inv.vatAmount - expectedVat(inv.netAmount, vendor.isForeign));
    if (Math.abs(vatGap) > 0.01) vatIssues.push({ inv, gap: vatGap });
    const whtGap = roundOmr(expectedWht(inv.netAmount, vendor.isForeign, vendor.serviceVendor) - inv.whtAmount);
    if (whtGap > 0.01) whtIssues.push({ inv, gap: whtGap });
  }
  const findings: Finding[] = [];
  if (vatIssues.length) {
    findings.push({
      id: 'TAX-VAT',
      type: 'VAT mismatch',
      severity: 'medium',
      title: `${vatIssues.length} invoice(s) where VAT ≠ 5% of the net amount`,
      detail: 'Input VAT that does not reconcile to the standard rate risks disallowed recovery on the Oman VAT return.',
      amountAtRisk: round(sum(vatIssues.map((v) => Math.abs(v.gap))), 3),
      refs: vatIssues.map((v) => v.inv.id),
    });
  }
  if (whtIssues.length) {
    findings.push({
      id: 'TAX-WHT',
      type: 'Withholding tax not deducted',
      severity: 'high',
      title: `${whtIssues.length} payment(s) to non-resident service providers without 10% WHT`,
      detail: 'Under-withheld tax on payments to non-residents becomes a liability of the Omani payer, plus penalties.',
      amountAtRisk: round(sum(whtIssues.map((v) => v.gap)), 3),
      refs: whtIssues.map((v) => v.inv.id),
    });
  }
  return findings;
}

/** Invoices received before a PO existed ("after-the-fact" POs). */
export function findAfterTheFactPOs(data: Dataset): Finding[] {
  const poById = new Map(data.purchaseOrders.map((p) => [p.id, p]));
  const late = data.apInvoices.filter((inv) => {
    const po = inv.poId ? poById.get(inv.poId) : undefined;
    return po && Date.parse(inv.invoiceDate) < Date.parse(po.createdAt);
  });
  if (!late.length) return [];
  return [{
    id: 'P2P-ATF',
    type: 'After-the-fact PO',
    severity: 'medium',
    title: `${late.length} invoice(s) dated before their purchase order`,
    detail: 'Goods or services were committed without an approved PO — maverick buying that bypasses budget control.',
    amountAtRisk: round(sum(late.map((i) => i.grossAmount)), 3),
    refs: late.map((i) => i.id),
  }];
}

/**
 * Fawtara (Oman e-invoicing, Peppol/UBL 2.1) needs clean VAT identifiers on both parties.
 * Domestic vendors without a VAT number on the master record will block e-invoice exchange.
 */
export function findFawtaraReadinessGaps(data: Dataset): Finding[] {
  const missing = data.vendors.filter((v) => !v.isForeign && !v.vatNumber);
  if (!missing.length) return [];
  const spend = data.apInvoices.filter((i) => missing.some((v) => v.id === i.vendorId));
  return [{
    id: 'FAWTARA-VAT-ID',
    type: 'Fawtara readiness',
    severity: 'low',
    title: `${missing.length} domestic vendor(s) have no VAT registration number`,
    detail: `Fawtara e-invoicing becomes mandatory in 2027; vendor master data needs valid VAT IDs before Peppol exchange. Affected: ${missing.map((v) => v.name).join(', ')}.`,
    amountAtRisk: round(sum(spend.map((i) => i.vatAmount)), 3),
    refs: missing.map((v) => v.id),
  }];
}

const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export function detectAnomalies(data: Dataset): Finding[] {
  return [
    ...findDuplicateInvoices(data),
    ...findSplitPurchaseOrders(data),
    ...findSodConflicts(data),
    ...findBankChangeBeforePayment(data),
    ...findJournalRedFlags(data),
    ...findTaxIssues(data),
    ...findAfterTheFactPOs(data),
    ...findFawtaraReadinessGaps(data),
  ].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || b.amountAtRisk - a.amountAtRisk);
}
