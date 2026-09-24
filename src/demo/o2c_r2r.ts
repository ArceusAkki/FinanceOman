import type { ArInvoice, CloseTask, Customer, EventRecord, JournalEntry } from '../engine/types';
import { DAY, HOUR, Rng, iso, r3, snapToWork } from './random';

const SALES = ['O.ALFARSI', 'Z.ALLAWATI'];
const LOGISTICS = ['WH.SOHAR', 'WH.RUSAYL'];
const AR_CLERKS = ['B.ALMAMARI', 'C.FERNANDES'];
const CREDIT = 'I.ALJABRI';
const GL = ['G.ALRIYAMI', 'V.NAIR', 'Q.ALSAADI'];
const CONTROLLERS = ['E.ALBALUSHI', 'S.ALHINAI'];

const CUSTOMER_SEED: [string, number, number][] = [
  // name, typical days paid after due, payment terms
  ['Muscat Municipal Services', 32, 60],
  ['Oasis Construction Co.', 18, 45],
  ['Salalah Port Contractors', 6, 30],
  ['Al Batinah Retail Group', 2, 30],
  ['Majan Engineering LLC', 12, 45],
  ['Duqm Industrial Park Tenants Assn.', 40, 60],
  ['Sharqiya Hospitality', 0, 30],
  ['Musandam Fisheries Co-op', 25, 30],
  ['Qurum Healthcare Partners', 4, 45],
  ['Buraimi Trading House', 9, 30],
  ['Gulf Water Technologies', -2, 30],
  ['Nizwa Cement Distributors', 15, 45],
];

export interface O2CResult {
  customers: Customer[];
  arInvoices: ArInvoice[];
  events: EventRecord[];
}

export function generateO2C(rng: Rng, start: number, asOf: number, orders = 320): O2CResult {
  const customers: Customer[] = CUSTOMER_SEED.map(([name], i) => ({ id: `C-${2001 + i}`, name, creditLimit: 20_000 + i * 5_000 }));
  const out: O2CResult = { customers, arInvoices: [], events: [] };

  for (let i = 0; i < orders; i++) {
    const idx = Math.floor(rng.next() ** 1.3 * customers.length);
    const customer = customers[idx];
    const [, lateness, terms] = CUSTOMER_SEED[idx];
    const caseId = `SO-${String(10_000 + i)}`;
    const amount = r3(rng.logNormal(4_300, 0.9));
    const ev: EventRecord[] = [];
    const add = (activity: string, ts: number, resource: string) => ev.push({ caseId, activity, timestamp: iso(ts), resource, amount });
    const done = () => { out.events.push(...ev); };

    const orderT = snapToWork(start + rng.next() * (asOf - start - 3 * DAY), rng);
    add('Create Sales Order', orderT, rng.pick(SALES));
    add('Credit Check', orderT + 0.1 * HOUR, 'SYSTEM');
    let t = orderT + 0.2 * HOUR;
    if (rng.chance(lateness > 20 ? 0.35 : 0.08)) {
      t = snapToWork(t + rng.between(6, 110) * HOUR, rng);
      if (t > asOf) { done(); continue; }
      add('Release Credit Block', t, CREDIT);
    }
    t = snapToWork(t + rng.between(4, 60) * HOUR, rng);
    if (t > asOf) { done(); continue; }
    add('Create Delivery', t, rng.pick(LOGISTICS));
    t = snapToWork(t + rng.between(2, 40) * HOUR, rng);
    if (t > asOf) { done(); continue; }
    add('Post Goods Issue', t, rng.pick(LOGISTICS));
    const billT = t + rng.between(2, 20) * HOUR;
    if (billT > asOf) { done(); continue; }
    add('Create Billing Document', billT, 'BATCH');
    add('Send Invoice', billT + 0.5 * HOUR, 'SYSTEM');

    const due = billT + terms * DAY;
    const invoice: ArInvoice = { id: `90${String(100_000 + i)}`, customerId: customer.id, issuedAt: iso(billT), dueDate: iso(due), amount };
    if (rng.chance(0.05)) {
      const disputeT = snapToWork(billT + rng.between(5, 15) * DAY, rng);
      if (disputeT < asOf) {
        add('Dispute Raised', disputeT, rng.pick(AR_CLERKS));
        const memoT = snapToWork(disputeT + rng.between(2, 12) * DAY, rng);
        if (memoT < asOf) {
          add('Issue Credit Memo', memoT, rng.pick(AR_CLERKS));
          invoice.amount = r3(amount * 0.9);
        }
      }
    }
    const daysLate = Math.max(-5, rng.normal(lateness, Math.abs(lateness) * 0.4 + 3));
    const paidT = snapToWork(due + daysLate * DAY, rng);
    if (daysLate > 7 && due + 7 * DAY < asOf) add('Send Dunning Notice', snapToWork(due + 7 * DAY, rng), rng.chance(0.5) ? 'SYSTEM' : rng.pick(AR_CLERKS));
    if (paidT <= asOf) {
      add('Receive Payment', paidT, 'SYSTEM');
      const autoApplied = rng.chance(0.4);
      const applyT = autoApplied ? paidT + 0.3 * HOUR : snapToWork(paidT + rng.between(3, 80) * HOUR, rng);
      if (applyT <= asOf) add('Apply Cash', applyT, autoApplied ? 'SYSTEM' : rng.pick(AR_CLERKS));
      invoice.paidAt = iso(paidT);
    }
    out.arInvoices.push(invoice);
    done();
  }
  return out;
}

export interface R2RResult {
  journals: JournalEntry[];
  events: EventRecord[];
}

const ACCOUNTS = ['400100 Revenue – Products', '510200 Freight Costs', '620000 Salaries & Wages', '630500 Accrued Expenses', '140000 Prepayments', '210500 GR/IR Clearing', '160000 Intercompany Receivable', '680000 FX Differences'];

/** Manual journals flow through a maker–checker workflow; automatic ones are posted by batch jobs. */
export function generateR2R(rng: Rng, start: number, asOf: number, manualCount = 240, autoCount = 720): R2RResult {
  const out: R2RResult = { journals: [], events: [] };

  for (let i = 0; i < autoCount; i++) {
    const day = new Date(start + rng.next() * (asOf - start));
    day.setUTCHours(20, rng.int(0, 59), 0, 0); // nightly batch, midnight Muscat
    out.journals.push({ id: `JA-${100_000 + i}`, postedAt: iso(day.getTime()), postedBy: 'BATCH', account: rng.pick(ACCOUNTS), amount: r3(rng.logNormal(900, 1.7)), description: 'Automatic posting (interface)', source: 'automatic' });
  }

  for (let i = 0; i < manualCount; i++) {
    const caseId = `JE-${200_000 + i}`;
    const preparer = rng.pick(GL);
    const round = i % 16 === 0;
    const amount = round ? rng.int(1, 40) * 1000 : r3(rng.logNormal(2_500, 1.6));
    const weekendPosting = i % 20 === 7;
    let prepT: number;
    if (weekendPosting) {
      const d = new Date(start + rng.next() * (asOf - start - 5 * DAY));
      while (d.getUTCDay() !== 5) d.setUTCDate(d.getUTCDate() + 1); // a Friday
      d.setUTCHours(rng.int(5, 14), rng.int(0, 59), 0, 0);
      prepT = d.getTime();
    } else {
      // Month-end concentration: half of manual journals land in the first days after period end.
      const monthEnd = rng.chance(0.5);
      const base = start + rng.next() * (asOf - start - 5 * DAY);
      const d = new Date(base);
      if (monthEnd) d.setUTCDate(rng.int(1, 4));
      prepT = snapToWork(d.getTime(), rng);
    }
    if (prepT > asOf - DAY) continue;
    const ev: EventRecord[] = [];
    const add = (activity: string, ts: number, resource: string) => ev.push({ caseId, activity, timestamp: iso(ts), resource, amount });
    add('Prepare Journal Entry', prepT, preparer);
    let postT: number;
    let postedBy = preparer;
    if (rng.chance(0.03)) {
      postT = prepT + rng.between(0.2, 2) * HOUR; // posted without approval
      add('Post Journal Entry', postT, preparer);
    } else {
      let t = prepT + rng.between(0.2, 4) * HOUR;
      add('Submit for Approval', t, preparer);
      if (rng.chance(0.08)) {
        t = snapToWork(t + rng.between(4, 48) * HOUR, rng);
        add('Reject Journal Entry', t, rng.pick(CONTROLLERS));
        t = snapToWork(t + rng.between(2, 30) * HOUR, rng);
        add('Correct Journal Entry', t, preparer);
        t += rng.between(0.2, 2) * HOUR;
        add('Submit for Approval', t, preparer);
      }
      const monthEndDay = new Date(t).getUTCDate() <= 5;
      const approver = rng.pick(CONTROLLERS);
      t = weekendPosting ? t + rng.between(0.5, 3) * HOUR : snapToWork(t + (monthEndDay ? rng.between(8, 72) : rng.between(1, 20)) * HOUR, rng);
      add('Approve Journal Entry', t, approver);
      postT = t + 0.05 * HOUR;
      add('Post Journal Entry', postT, 'SYSTEM');
      postedBy = preparer;
    }
    if (rng.chance(0.04)) add('Reverse Journal Entry', snapToWork(postT + rng.between(24, 240) * HOUR, rng), preparer);
    if (postT > asOf) continue;
    out.journals.push({ id: caseId, postedAt: iso(postT), postedBy, account: rng.pick(ACCOUNTS), amount, description: 'Manual journal', source: 'manual' });
    out.events.push(...ev.filter((e) => Date.parse(e.timestamp) <= asOf));
  }
  return out;
}

/** Last month's close calendar, with a late intercompany reconciliation rippling downstream. */
export function generateCloseTasks(): CloseTask[] {
  const t = (id: string, name: string, owner: string, plannedDay: number, actualDay: number | undefined, dependsOn: string[] = []): CloseTask => ({
    id, name, owner, plannedDay, actualDay, dependsOn, status: actualDay === undefined ? 'in_progress' : 'done',
  });
  return [
    t('C01', 'AP cut-off & accruals', 'F.ALZADJALI', 1, 1),
    t('C02', 'AR cut-off & revenue recognition', 'B.ALMAMARI', 1, 1),
    t('C03', 'Bank reconciliations', 'M.ALRAWAHI', 2, 2),
    t('C04', 'Depreciation run (AFAB)', 'V.NAIR', 2, 2),
    t('C05', 'Payroll accruals', 'Q.ALSAADI', 2, 3),
    t('C06', 'GR/IR clearing & analysis', 'G.ALRIYAMI', 3, 4, ['C01']),
    t('C07', 'Intercompany reconciliation', 'V.NAIR', 3, 5, ['C02']),
    t('C08', 'Inventory valuation', 'G.ALRIYAMI', 3, 3),
    t('C09', 'VAT reconciliation (OTA return prep)', 'Q.ALSAADI', 4, 4, ['C01', 'C02']),
    t('C10', 'Balance sheet reconciliations', 'G.ALRIYAMI', 4, 6, ['C03', 'C06', 'C07']),
    t('C11', 'Management adjustments', 'E.ALBALUSHI', 5, 6, ['C10']),
    t('C12', 'Trial balance review', 'E.ALBALUSHI', 5, 7, ['C11']),
    t('C13', 'Consolidation & eliminations', 'S.ALHINAI', 6, 8, ['C07', 'C12']),
    t('C14', 'Management reporting pack', 'S.ALHINAI', 7, undefined, ['C13']),
  ];
}
