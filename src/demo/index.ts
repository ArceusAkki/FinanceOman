import type { Dataset } from '../engine/types';
import { createRng } from './random';
import { generateP2P } from './p2p';
import { generateCloseTasks, generateO2C, generateR2R } from './o2c_r2r';

export const DEMO_AS_OF = '2026-09-20T10:00:00.000Z';
const DEMO_START = '2026-03-22T04:00:00.000Z';

/**
 * A fictional Omani manufacturer on SAP S/4HANA with six months of activity.
 * Deterministic for a given seed so tests and screenshots are reproducible.
 */
export function createDemoDataset(seed = 2026): Dataset {
  const rng = createRng(seed);
  const start = Date.parse(DEMO_START);
  const asOf = Date.parse(DEMO_AS_OF);
  const threshold = 5_000;
  const p2p = generateP2P(rng, start, asOf, threshold);
  const o2c = generateO2C(rng, start, asOf);
  const r2r = generateR2R(rng, start, asOf);

  return {
    company: {
      name: 'Al Noor Industrial Group (demo)',
      erp: 'SAP S/4HANA',
      currency: 'OMR',
      country: 'Oman',
      poApprovalThreshold: threshold,
    },
    asOf: DEMO_AS_OF,
    cashOnHand: 185_000,
    logs: { P2P: p2p.events, O2C: o2c.events, R2R: r2r.events },
    vendors: p2p.vendors,
    purchaseOrders: p2p.purchaseOrders,
    goodsReceipts: p2p.goodsReceipts,
    apInvoices: p2p.apInvoices,
    payments: p2p.payments,
    journals: r2r.journals,
    customers: o2c.customers,
    arInvoices: o2c.arInvoices,
    vendorChanges: p2p.vendorChanges,
    closeTasks: generateCloseTasks(),
  };
}
