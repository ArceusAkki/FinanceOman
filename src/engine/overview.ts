import type { Dataset } from './types';
import { isAutomated } from './processMining';
import { DAY_MS, round, sum } from './stats';

export interface MonthlyPosting {
  month: string; // YYYY-MM
  automated: number;
  manual: number;
}

/** AP invoices posted per month, split into touchless (system-posted) and manual postings. */
export function monthlyInvoicePosting(data: Dataset, months = 6): MonthlyPosting[] {
  const buckets = new Map<string, MonthlyPosting>();
  for (const e of data.logs.P2P) {
    if (e.activity !== 'Post Invoice') continue;
    const month = e.timestamp.slice(0, 7);
    const b = buckets.get(month) ?? { month, automated: 0, manual: 0 };
    if (isAutomated(e.resource)) b.automated++;
    else b.manual++;
    buckets.set(month, b);
  }
  return [...buckets.values()].sort((a, b) => a.month.localeCompare(b.month)).slice(-months);
}

export interface CashFlows {
  receipts: number;
  payments: number;
  days: number;
}

/** Cash collected from customers and paid to vendors over the trailing window. */
export function trailingCashFlows(data: Dataset, days = 30): CashFlows {
  const asOf = Date.parse(data.asOf);
  const inWindow = (iso?: string) => !!iso && Date.parse(iso) <= asOf && asOf - Date.parse(iso) <= days * DAY_MS;
  return {
    receipts: round(sum(data.arInvoices.filter((i) => inWindow(i.paidAt)).map((i) => i.amount)), 3),
    payments: round(sum(data.payments.filter((p) => inWindow(p.paidAt)).map((p) => p.amount)), 3),
    days,
  };
}

export interface ScheduledPayment {
  invoiceId: string;
  vendorName: string;
  dueDate: string;
  amount: number;
}

/** Open vendor invoices falling due next, net of withholding tax. */
export function upcomingPayments(data: Dataset, limit = 3): ScheduledPayment[] {
  const asOf = Date.parse(data.asOf);
  const names = new Map(data.vendors.map((v) => [v.id, v.name]));
  return data.apInvoices
    .filter((i) => !i.paidAt && Date.parse(i.dueDate) >= asOf)
    .sort((a, b) => Date.parse(a.dueDate) - Date.parse(b.dueDate))
    .slice(0, limit)
    .map((i) => ({ invoiceId: i.id, vendorName: names.get(i.vendorId) ?? i.vendorId, dueDate: i.dueDate, amount: round(i.grossAmount - i.whtAmount, 3) }));
}
