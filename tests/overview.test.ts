import { describe, expect, it } from 'vitest';
import { createDemoDataset } from '../src/demo';
import { monthlyInvoicePosting, trailingCashFlows, upcomingPayments } from '../src/engine/overview';

const data = createDemoDataset();

describe('dashboard widgets', () => {
  it('splits monthly invoice postings into touchless and manual', () => {
    const months = monthlyInvoicePosting(data);
    expect(months.length).toBeGreaterThan(0);
    expect(months.length).toBeLessThanOrEqual(6);
    const posted = data.logs.P2P.filter((e) => e.activity === 'Post Invoice' && months.some((m) => e.timestamp.startsWith(m.month))).length;
    expect(months.reduce((a, m) => a + m.automated + m.manual, 0)).toBe(posted);
    expect(months.map((m) => m.month)).toEqual([...months.map((m) => m.month)].sort());
  });

  it('sums cash in and out over the trailing window', () => {
    const flows = trailingCashFlows(data, 30);
    expect(flows.receipts).toBeGreaterThan(0);
    expect(flows.payments).toBeGreaterThan(0);
    expect(trailingCashFlows(data, 60).receipts).toBeGreaterThanOrEqual(flows.receipts);
  });

  it('lists the next open vendor invoices by due date, net of WHT', () => {
    const next = upcomingPayments(data, 3);
    expect(next).toHaveLength(3);
    for (let i = 1; i < next.length; i++) expect(Date.parse(next[i].dueDate)).toBeGreaterThanOrEqual(Date.parse(next[i - 1].dueDate));
    expect(next.every((p) => Date.parse(p.dueDate) >= Date.parse(data.asOf))).toBe(true);
  });
});
