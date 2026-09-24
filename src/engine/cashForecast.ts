import type { Dataset } from './types';
import { DAY_MS, daysBetween, groupBy, mean, round } from './stats';

export interface ForecastWeek {
  week: number;
  weekStart: string;
  inflow: number;
  outflow: number;
  net: number;
  closing: number;
}

export interface CashForecast {
  openingBalance: number;
  weeks: ForecastWeek[];
  lowestBalance: number;
  lowestWeek: number;
  customerBehaviour: { customerId: string; name: string; avgDaysLate: number; openAmount: number }[];
}

/**
 * 13-week direct cash forecast. Receipts are projected from open AR using each
 * customer's learned payment delay (mean days paid after due date); payments
 * from open AP on their due dates.
 */
export function forecastCash(data: Dataset, weeks = 13): CashForecast {
  const asOf = Date.parse(data.asOf);
  const paidByCustomer = groupBy(data.arInvoices.filter((i) => i.paidAt), (i) => i.customerId);
  const portfolioDelay = mean(data.arInvoices.filter((i) => i.paidAt).map((i) => daysBetween(i.dueDate, i.paidAt!)));
  const delayFor = (customerId: string) => {
    const history = paidByCustomer.get(customerId);
    return history && history.length >= 3 ? mean(history.map((i) => daysBetween(i.dueDate, i.paidAt!))) : portfolioDelay;
  };

  const buckets = Array.from({ length: weeks }, () => ({ inflow: 0, outflow: 0 }));
  const bucketOf = (ts: number) => Math.min(weeks - 1, Math.max(0, Math.floor((ts - asOf) / (7 * DAY_MS))));

  for (const inv of data.arInvoices.filter((i) => !i.paidAt)) {
    const expected = Date.parse(inv.dueDate) + Math.max(0, delayFor(inv.customerId)) * DAY_MS;
    if (expected - asOf > weeks * 7 * DAY_MS) continue;
    buckets[bucketOf(expected)].inflow += inv.amount;
  }
  for (const inv of data.apInvoices.filter((i) => !i.paidAt)) {
    const due = Date.parse(inv.dueDate);
    if (due - asOf > weeks * 7 * DAY_MS) continue;
    buckets[bucketOf(due)].outflow += inv.grossAmount - inv.whtAmount;
  }

  let balance = data.cashOnHand;
  let lowestBalance = balance;
  let lowestWeek = 0;
  const result = buckets.map((b, i) => {
    const net = b.inflow - b.outflow;
    balance += net;
    if (balance < lowestBalance) { lowestBalance = balance; lowestWeek = i + 1; }
    return {
      week: i + 1,
      weekStart: new Date(asOf + i * 7 * DAY_MS).toISOString().slice(0, 10),
      inflow: round(b.inflow, 3),
      outflow: round(b.outflow, 3),
      net: round(net, 3),
      closing: round(balance, 3),
    };
  });

  const customerBehaviour = data.customers.map((c) => ({
    customerId: c.id,
    name: c.name,
    avgDaysLate: round(delayFor(c.id)),
    openAmount: round(data.arInvoices.filter((i) => i.customerId === c.id && !i.paidAt).reduce((a, i) => a + i.amount, 0), 3),
  })).sort((a, b) => b.avgDaysLate - a.avgDaysLate);

  return { openingBalance: data.cashOnHand, weeks: result, lowestBalance: round(lowestBalance, 3), lowestWeek, customerBehaviour };
}
