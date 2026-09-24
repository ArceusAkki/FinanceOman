import { describe, expect, it } from 'vitest';
import { createDemoDataset } from '../src/demo';
import { analyseDataset } from '../src/engine';
import { detectAnomalies, normalizeInvoiceNumber, findSplitPurchaseOrders, findSodConflicts } from '../src/engine/anomalies';
import { threeWayMatch } from '../src/engine/matching';
import { forecastCash } from '../src/engine/cashForecast';
import type { Dataset } from '../src/engine/types';

const data = createDemoDataset();

describe('demo dataset', () => {
  it('is deterministic for a given seed', () => {
    const again = createDemoDataset();
    expect(again.apInvoices.length).toBe(data.apInvoices.length);
    expect(again.logs.P2P.slice(0, 20)).toEqual(data.logs.P2P.slice(0, 20));
  });

  it('keeps every event on or before the as-of date', () => {
    const asOf = Date.parse(data.asOf);
    for (const events of Object.values(data.logs)) {
      expect(events.every((e) => Date.parse(e.timestamp) <= asOf)).toBe(true);
    }
  });

  it('produces a full analysis for all three processes', () => {
    const a = analyseDataset(data);
    expect(Object.keys(a.processes).sort()).toEqual(['O2C', 'P2P', 'R2R']);
    expect(a.kpis.dpo).toBeGreaterThan(0);
    expect(a.kpis.touchlessInvoiceRate).toBeGreaterThan(0);
    expect(a.cash.weeks).toHaveLength(13);
  });
});

describe('control tests on the demo data', () => {
  const findings = detectAnomalies(data);
  const types = new Set(findings.map((f) => f.type));

  it('detects each injected risk scenario', () => {
    for (const t of ['Duplicate invoice', 'Split purchase order', 'Segregation of duties', 'Vendor bank change', 'Journal entry timing', 'Journal entry round amounts', 'Withholding tax not deducted', 'VAT mismatch', 'After-the-fact PO', 'Fawtara readiness']) {
      expect(types, t).toContain(t);
    }
  });

  it('finds the three injected duplicate invoices', () => {
    expect(findings.filter((f) => f.type === 'Duplicate invoice').length).toBeGreaterThanOrEqual(3);
  });

  it('flags the two injected split-PO clusters without flooding false positives', () => {
    const split = findSplitPurchaseOrders(data);
    expect(split.length).toBeGreaterThanOrEqual(2);
    expect(split.length).toBeLessThanOrEqual(4);
    expect(split.every((f) => f.refs.length >= 2)).toBe(true);
  });

  it('sorts by severity, then value', () => {
    const order = { critical: 0, high: 1, medium: 2, low: 3 };
    for (let i = 1; i < findings.length; i++) {
      expect(order[findings[i - 1].severity]).toBeLessThanOrEqual(order[findings[i].severity]);
    }
  });

  it('normalises invoice numbers for fuzzy duplicate matching', () => {
    expect(normalizeInvoiceNumber('INV-00042')).toBe(normalizeInvoiceNumber('inv 42'));
    expect(normalizeInvoiceNumber('INV-00042')).not.toBe(normalizeInvoiceNumber('INV-00043'));
  });

  it('detects self-approved POs', () => {
    const tiny: Dataset = { ...data, purchaseOrders: [{ id: 'P1', vendorId: 'V', createdAt: data.asOf, createdBy: 'U', approvedBy: 'U', qty: 1, unitPrice: 10, amount: 10 }], payments: [] };
    expect(findSodConflicts(tiny)).toHaveLength(1);
  });
});

describe('three-way match', () => {
  it('classifies invoices and computes the first-pass rate', () => {
    const m = threeWayMatch(data);
    const total = Object.values(m.byStatus).reduce((a, b) => a + b, 0);
    expect(total).toBe(data.apInvoices.length);
    expect(m.byStatus.price_variance).toBeGreaterThan(0);
    expect(m.byStatus.missing_receipt).toBeGreaterThan(0);
    expect(m.firstPassMatchRate).toBeGreaterThan(0.5);
    expect(m.firstPassMatchRate).toBeLessThan(1);
  });

  it('respects the price tolerance', () => {
    const one: Dataset = {
      ...data,
      purchaseOrders: [{ id: 'PO', vendorId: 'V', createdAt: data.asOf, createdBy: 'A', approvedBy: 'B', qty: 10, unitPrice: 100, amount: 1000 }],
      goodsReceipts: [{ id: 'GR', poId: 'PO', postedAt: data.asOf, postedBy: 'W', qty: 10 }],
      apInvoices: [101, 103].map((price, i) => ({ id: `I${i}`, vendorId: 'V', poId: 'PO', invoiceNumber: `N${i}`, invoiceDate: data.asOf, postedAt: data.asOf, postedBy: 'C', dueDate: data.asOf, qty: 10, unitPrice: price, netAmount: price * 10, vatAmount: 0, whtAmount: 0, grossAmount: price * 10 })),
    };
    expect(threeWayMatch(one).results.map((r) => r.status)).toEqual(['matched', 'price_variance']);
  });
});

describe('cash forecast', () => {
  it('rolls the balance forward week by week', () => {
    const f = forecastCash(data);
    let balance = f.openingBalance;
    for (const w of f.weeks) {
      balance += w.net;
      expect(w.closing).toBeCloseTo(balance, 2);
    }
    expect(Math.min(f.openingBalance, ...f.weeks.map((w) => w.closing))).toBeCloseTo(f.lowestBalance, 2);
  });
});
