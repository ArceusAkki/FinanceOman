import type { ApInvoice, EventRecord, GoodsReceipt, Payment, PurchaseOrder, Vendor, VendorMasterChange } from '../engine/types';
import { expectedVat, expectedWht } from '../engine/oman';
import { DAY, HOUR, Rng, iso, r3, snapToWork } from './random';

export const BUYERS = ['H.ALSAIDI', 'N.ALHARTHY', 'P.MENON', 'W.ALOUFI', 'K.RAO'];
export const APPROVERS = ['K.ALMAAWALI', 'S.ALHINAI'];
export const AP_CLERKS = ['R.KUMAR', 'F.ALZADJALI', 'J.DSOUZA'];
export const TREASURY = ['M.ALRAWAHI', 'A.ALBUSAIDI'];
const REQUESTERS = ['T.ALAMRI', 'L.ALKINDI', 'Y.ALSHUKAILI', 'D.THOMAS'];
const WAREHOUSE = ['WH.SOHAR', 'WH.RUSAYL'];

const VENDOR_SEED: [string, string, boolean, number][] = [
  // name, country, service vendor, payment terms
  ['Al Wadi Industrial Supplies LLC', 'OM', false, 30],
  ['Batinah Steel Trading LLC', 'OM', false, 45],
  ['Muscat Office Solutions', 'OM', false, 30],
  ['Dhofar Packaging Co.', 'OM', false, 60],
  ['Sohar Logistics Services', 'OM', true, 30],
  ['Rusayl Electrical Works', 'OM', false, 45],
  ['Nizwa Facility Management', 'OM', true, 30],
  ['Sur Marine Engineering', 'OM', true, 60],
  ['Ibri Chemicals Trading', 'OM', false, 30],
  ['Al Khuwair IT Services', 'OM', true, 30],
  ['Barka Safety Equipment', 'OM', false, 45],
  ['Seeb Catering Services', 'OM', true, 15],
  ['Jebel Ali Industrial Parts FZE', 'AE', false, 60],
  ['Pune Automation Systems Pvt Ltd', 'IN', true, 45],
  ['Thames Engineering Consultants Ltd', 'GB', true, 30],
  ['Dubai Cloud Hosting FZ-LLC', 'AE', true, 30],
];

export interface P2PResult {
  vendors: Vendor[];
  purchaseOrders: PurchaseOrder[];
  goodsReceipts: GoodsReceipt[];
  apInvoices: ApInvoice[];
  payments: Payment[];
  vendorChanges: VendorMasterChange[];
  events: EventRecord[];
}

interface CaseOverrides {
  vendor?: Vendor;
  created?: number;
  buyer?: string;
  amount?: number;
  selfApprove?: boolean;
}

export function generateP2P(rng: Rng, start: number, asOf: number, threshold: number, poCount = 420): P2PResult {
  const vendors: Vendor[] = VENDOR_SEED.map(([name, country, service, terms], i) => ({
    id: `V-${1001 + i}`,
    name,
    country,
    isForeign: country !== 'OM',
    serviceVendor: service,
    // One domestic vendor is deliberately missing its VAT number (Fawtara readiness gap).
    vatNumber: country === 'OM' && i !== 11 ? `OM11000${String(10000 + i * 137).slice(0, 5)}` : undefined,
    paymentTermsDays: terms,
  }));
  const out: P2PResult = { vendors, purchaseOrders: [], goodsReceipts: [], apInvoices: [], payments: [], vendorChanges: [], events: [] };
  let seq = 0;

  const makeCase = (o: CaseOverrides = {}) => {
    seq++;
    const poId = `45${String(seq).padStart(8, '0')}`;
    const vendor = o.vendor ?? vendors[Math.min(vendors.length - 1, Math.floor(rng.next() ** 1.6 * vendors.length))];
    const created = o.created ?? snapToWork(start + rng.next() * (asOf - start - 4 * DAY), rng);
    const buyer = o.buyer ?? rng.pick(BUYERS);
    const qty = rng.int(1, 40);
    const unitPrice = o.amount ? r3(o.amount / qty) : r3(Math.min(4000, Math.max(5, rng.logNormal(90, 1.1))));
    const amount = r3(qty * unitPrice);
    const ev: EventRecord[] = [];
    const add = (activity: string, ts: number, resource: string) => ev.push({ caseId: poId, activity, timestamp: iso(ts), resource, amount });

    if (rng.chance(0.7)) {
      const prT = snapToWork(created - rng.between(20, 96) * HOUR, rng);
      add('Create Purchase Requisition', Math.min(prT, created - 2 * HOUR), rng.pick(REQUESTERS));
      add('Approve Purchase Requisition', Math.min(prT + rng.between(1, 12) * HOUR, created - HOUR), rng.pick(APPROVERS));
    }
    const afterTheFact = rng.chance(0.04);
    const afterTheFactInvoiceT = created - rng.between(2, 9) * DAY;
    if (afterTheFact) add('Receive Invoice', afterTheFactInvoiceT + 3 * HOUR, rng.pick(AP_CLERKS));
    add('Create Purchase Order', created, buyer);

    const approver = o.selfApprove ? buyer : rng.pick(APPROVERS);
    const approveT = snapToWork(created + (amount >= threshold ? rng.between(30, 150) : rng.between(0.5, 20)) * HOUR, rng);
    if (approveT > asOf) return finish();
    add('Approve Purchase Order', approveT, approver);
    const po: PurchaseOrder = { id: poId, vendorId: vendor.id, createdAt: iso(created), createdBy: buyer, approvedBy: approver, qty, unitPrice, amount };
    out.purchaseOrders.push(po);

    const missingGr = rng.chance(0.05);
    const grT = snapToWork(approveT + rng.between(48, 330) * HOUR, rng);
    if (grT > asOf) return finish();
    if (!missingGr) {
      add('Record Goods Receipt', grT, vendor.serviceVendor ? buyer : rng.pick(WAREHOUSE));
      out.goodsReceipts.push({ id: `50${String(seq).padStart(8, '0')}`, poId, postedAt: iso(grT), postedBy: 'WH', qty });
    }

    const invoiceDate = afterTheFact ? afterTheFactInvoiceT : grT + rng.between(0, 5) * DAY;
    const receiptT = afterTheFact ? afterTheFactInvoiceT + 3 * HOUR : snapToWork(invoiceDate + rng.between(4, 90) * HOUR, rng);
    if (receiptT > asOf) return finish();
    const priceFactor = rng.chance(0.1) ? rng.between(1.03, 1.15) : 1;
    const invQty = !missingGr && rng.chance(0.04) ? qty + rng.int(1, 3) : qty;
    const invUnit = r3(unitPrice * priceFactor);
    const net = r3(invUnit * invQty);
    let vat = expectedVat(net, vendor.isForeign);
    if (!vendor.isForeign && rng.chance(0.015)) vat = rng.chance(0.5) ? 0 : r3(net * 0.1);
    let wht = expectedWht(net, vendor.isForeign, vendor.serviceVendor);
    if (wht && rng.chance(0.3)) wht = 0;
    const receiver = rng.chance(0.45) ? 'SYSTEM' : rng.pick(AP_CLERKS);
    if (!afterTheFact) add('Receive Invoice', receiptT, receiver);

    const matchT = Math.max(receiptT, missingGr ? receiptT : grT) + rng.between(0.2, 3) * HOUR;
    if (matchT > asOf) return finish();
    add('Three-Way Match', matchT, 'SYSTEM');
    // The invoice document exists from the match onwards; blocked invoices stay unpaid.
    const invoice: ApInvoice = {
      id: `51${String(seq).padStart(8, '0')}`,
      vendorId: vendor.id,
      poId,
      invoiceNumber: `INV-${String(rng.int(100, 99999)).padStart(5, '0')}`,
      invoiceDate: iso(invoiceDate),
      postedAt: iso(matchT),
      postedBy: receiver,
      dueDate: iso(invoiceDate + vendor.paymentTermsDays * DAY),
      qty: invQty,
      unitPrice: invUnit,
      netAmount: net,
      vatAmount: vat,
      whtAmount: wht,
      grossAmount: r3(net + vat),
    };
    out.apInvoices.push(invoice);
    const exception = priceFactor > 1 || invQty > qty || missingGr;
    let postBase = matchT;
    if (exception) {
      add('Block Invoice', matchT + 0.1 * HOUR, 'SYSTEM');
      if (missingGr) return finish();
      const fixT = snapToWork(matchT + rng.between(24, 220) * HOUR, rng);
      if (fixT > asOf) return finish();
      add(priceFactor > 1 ? 'Change Price' : 'Change Quantity', fixT, buyer);
      postBase = snapToWork(fixT + rng.between(2, 30) * HOUR, rng);
      if (postBase > asOf) return finish();
      add('Release Invoice Block', postBase, rng.pick(AP_CLERKS));
    }
    const poster = !exception && receiver === 'SYSTEM' ? 'SYSTEM' : rng.pick(AP_CLERKS);
    const postT = poster === 'SYSTEM' ? postBase + 0.2 * HOUR : snapToWork(postBase + rng.between(0.5, 30) * HOUR, rng);
    if (postT > asOf) return finish();
    add('Post Invoice', postT, poster);
    invoice.postedAt = iso(postT);
    invoice.postedBy = poster;

    const payT = snapToWork(Math.max(postT + DAY, invoiceDate + vendor.paymentTermsDays * DAY + rng.between(-12, 9) * DAY), rng);
    if (payT <= asOf) {
      const releasedBy = poster === 'R.KUMAR' && rng.chance(0.2) ? 'R.KUMAR' : rng.pick(TREASURY);
      add('Pay Invoice', payT, releasedBy);
      invoice.paidAt = iso(payT);
      out.payments.push({ id: `20${String(seq).padStart(8, '0')}`, invoiceId: invoice.id, vendorId: vendor.id, amount: r3(invoice.grossAmount - wht), paidAt: iso(payT), releasedBy });
    }
    return finish();

    function finish() {
      out.events.push(...ev);
      return poId;
    }
  };

  for (let i = 0; i < poCount; i++) makeCase();

  // Split purchase orders: one buyer, one vendor, three POs just under the release threshold.
  for (const [vendorIdx, dayOffset] of [[2, 40], [10, 110]] as const) {
    const base = snapToWork(start + dayOffset * DAY, rng);
    for (let k = 0; k < 3; k++) {
      makeCase({ vendor: vendors[vendorIdx], created: base + k * 20 * HOUR, buyer: 'P.MENON', amount: threshold * rng.between(0.36, 0.46) });
    }
  }
  // Self-approved POs (segregation-of-duties breach).
  for (let k = 0; k < 3; k++) makeCase({ buyer: 'K.ALMAAWALI', selfApprove: true });

  injectDuplicates(rng, out, asOf);
  injectVendorChanges(rng, out);
  return out;
}

function injectDuplicates(rng: Rng, out: P2PResult, asOf: number) {
  const candidates = out.apInvoices.filter((i) => i.paidAt && !out.vendors.find((v) => v.id === i.vendorId)?.isForeign);
  for (let k = 0; k < 3; k++) {
    const src = candidates[Math.floor(candidates.length * (0.2 + 0.25 * k))];
    if (!src) continue;
    const invoiceDate = Date.parse(src.invoiceDate) + rng.int(1, 4) * DAY;
    const postT = snapToWork(Date.parse(src.postedAt) + rng.between(3, 8) * DAY, rng);
    const dup: ApInvoice = {
      ...src,
      id: `${src.id}D`,
      invoiceNumber: src.invoiceNumber.replace('INV-', k === 1 ? 'INV ' : 'inv'),
      invoiceDate: iso(invoiceDate),
      postedAt: iso(postT),
      postedBy: 'F.ALZADJALI',
      paidAt: undefined,
    };
    const caseId = dup.id;
    const ev = (activity: string, ts: number, resource: string): EventRecord => ({ caseId, activity, timestamp: iso(ts), resource, amount: dup.grossAmount });
    out.events.push(ev('Receive Invoice', postT - 5 * HOUR, 'F.ALZADJALI'), ev('Post Invoice', postT, 'F.ALZADJALI'));
    const payT = snapToWork(Date.parse(src.paidAt!) + rng.between(5, 15) * DAY, rng);
    if (k < 2 && payT <= asOf) {
      dup.paidAt = iso(payT);
      out.events.push(ev('Pay Invoice', payT, 'M.ALRAWAHI'));
      out.payments.push({ id: `P-${dup.id}`, invoiceId: dup.id, vendorId: dup.vendorId, amount: r3(dup.grossAmount - dup.whtAmount), paidAt: iso(payT), releasedBy: 'M.ALRAWAHI' });
    }
    out.apInvoices.push(dup);
  }
}

function injectVendorChanges(rng: Rng, out: P2PResult) {
  const target = out.payments.find((p) => p.vendorId === 'V-1007' && p.amount > 2000) ?? out.payments[Math.floor(out.payments.length * 0.7)];
  if (target) {
    out.vendorChanges.push({ vendorId: target.vendorId, field: 'bank_account', changedAt: iso(Date.parse(target.paidAt) - 9 * DAY), changedBy: 'J.DSOUZA' });
  }
  for (const [vendorId, field] of [['V-1003', 'address'], ['V-1012', 'payment_terms'], ['V-1005', 'name']] as const) {
    out.vendorChanges.push({ vendorId, field, changedAt: iso(Date.parse('2026-05-10T06:00:00Z') + rng.int(0, 60) * DAY), changedBy: 'J.DSOUZA' });
  }
}
