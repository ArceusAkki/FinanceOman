import type { CloseTask, Dataset } from './types';
import { daysBetween, mean, median, round } from './stats';
import { isAutomated } from './processMining';

export interface FinanceKpis {
  dpo: number;
  dso: number;
  onTimePaymentRate: number;
  earlyPaymentRate: number;
  manualJournalShare: number;
  touchlessInvoiceRate: number;
  invoiceCycleDays: number;
  daysToClose: number;
  openApValue: number;
  overdueArValue: number;
}

/**
 * Transaction-level approximations of the standard KPIs:
 * DPO ≈ mean days invoice→payment, DSO ≈ mean days billing→collection.
 */
export function computeKpis(data: Dataset): FinanceKpis {
  const paidInvoices = data.apInvoices.filter((i) => i.paidAt);
  const payDays = paidInvoices.map((i) => daysBetween(i.invoiceDate, i.paidAt!));
  const onTime = paidInvoices.filter((i) => Date.parse(i.paidAt!) <= Date.parse(i.dueDate) + 86_400_000);
  const early = paidInvoices.filter((i) => daysBetween(i.paidAt!, i.dueDate) > 5);
  const collected = data.arInvoices.filter((i) => i.paidAt);

  // Touchless = invoice received, matched, posted with no human step in between.
  const p2pByCase = new Map<string, { human: boolean; exception: boolean }>();
  for (const e of data.logs.P2P) {
    if (!['Receive Invoice', 'Three-Way Match', 'Post Invoice', 'Block Invoice', 'Release Invoice Block', 'Change Price'].includes(e.activity)) continue;
    const s = p2pByCase.get(e.caseId) ?? { human: false, exception: false };
    if (!isAutomated(e.resource)) s.human = true;
    if (e.activity.includes('Block') || e.activity === 'Change Price') s.exception = true;
    p2pByCase.set(e.caseId, s);
  }
  const invoiceCases = [...p2pByCase.values()];
  const touchless = invoiceCases.filter((s) => !s.human && !s.exception).length;

  const asOf = Date.parse(data.asOf);
  const manual = data.journals.filter((j) => j.source === 'manual').length;

  return {
    dpo: round(mean(payDays)),
    dso: round(mean(collected.map((i) => daysBetween(i.issuedAt, i.paidAt!)))),
    onTimePaymentRate: round(onTime.length / Math.max(paidInvoices.length, 1), 3),
    earlyPaymentRate: round(early.length / Math.max(paidInvoices.length, 1), 3),
    manualJournalShare: round(manual / Math.max(data.journals.length, 1), 3),
    touchlessInvoiceRate: round(touchless / Math.max(invoiceCases.length, 1), 3),
    invoiceCycleDays: round(median(data.apInvoices.map((i) => daysBetween(i.invoiceDate, i.postedAt)))),
    daysToClose: closeDuration(data.closeTasks),
    openApValue: round(data.apInvoices.filter((i) => !i.paidAt).reduce((a, i) => a + i.grossAmount, 0), 3),
    overdueArValue: round(data.arInvoices.filter((i) => !i.paidAt && Date.parse(i.dueDate) < asOf).reduce((a, i) => a + i.amount, 0), 3),
  };
}

export function closeDuration(tasks: CloseTask[]): number {
  const days = tasks.map((t) => t.actualDay ?? t.plannedDay);
  return days.length ? Math.max(...days) : 0;
}

export interface CloseTaskInsight extends CloseTask {
  slipDays: number;
  onCriticalPath: boolean;
  risk: 'late' | 'at_risk' | 'on_track';
}

/** Flag late tasks and the dependency chain that determines the close date. */
export function analyseClose(tasks: CloseTask[]): CloseTaskInsight[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const finish = (t: CloseTask) => t.actualDay ?? t.plannedDay;
  const critical = new Set<string>();
  let current = [...tasks].sort((a, b) => finish(b) - finish(a))[0];
  while (current) {
    critical.add(current.id);
    const deps = current.dependsOn.map((id) => byId.get(id)).filter((t): t is CloseTask => !!t);
    current = deps.sort((a, b) => finish(b) - finish(a))[0];
  }
  return tasks.map((t) => {
    const slipDays = (t.actualDay ?? t.plannedDay) - t.plannedDay;
    const upstreamLate = t.dependsOn.some((id) => {
      const d = byId.get(id);
      return d && (d.actualDay ?? d.plannedDay) > d.plannedDay;
    });
    return {
      ...t,
      slipDays,
      onCriticalPath: critical.has(t.id),
      risk: slipDays > 0 ? 'late' : upstreamLate && t.status !== 'done' ? 'at_risk' : 'on_track',
    };
  });
}
