// Core domain types shared by the analytics engine, the API server and the web client.

export type ProcessKey = 'P2P' | 'O2C' | 'R2R';
export const PROCESS_KEYS: ProcessKey[] = ['P2P', 'O2C', 'R2R'];

export type ErpSystem = 'SAP S/4HANA' | 'SAP ECC' | 'Oracle Fusion Cloud ERP' | 'Oracle E-Business Suite' | 'Other';

/** One row of a process-mining event log: something happened to a case at a time. */
export interface EventRecord {
  caseId: string;
  activity: string;
  timestamp: string; // ISO-8601
  resource?: string; // user id, or "BATCH"/"SYSTEM" for automated steps
  amount?: number;
}

export interface Company {
  name: string;
  erp: ErpSystem;
  currency: string;
  country: string;
  /** Posting above this amount needs a second-level PO release. */
  poApprovalThreshold: number;
}

export interface Vendor {
  id: string;
  name: string;
  country: string;
  isForeign: boolean;
  serviceVendor: boolean;
  vatNumber?: string;
  paymentTermsDays: number;
}

export interface PurchaseOrder {
  id: string;
  vendorId: string;
  createdAt: string;
  createdBy: string;
  approvedBy?: string;
  qty: number;
  unitPrice: number;
  amount: number;
}

export interface GoodsReceipt {
  id: string;
  poId: string;
  postedAt: string;
  postedBy: string;
  qty: number;
}

export interface ApInvoice {
  id: string;
  vendorId: string;
  poId?: string;
  invoiceNumber: string;
  invoiceDate: string;
  postedAt: string;
  postedBy: string;
  dueDate: string;
  qty: number;
  unitPrice: number;
  netAmount: number;
  vatAmount: number;
  whtAmount: number;
  grossAmount: number;
  paidAt?: string;
}

export interface Payment {
  id: string;
  invoiceId: string;
  vendorId: string;
  amount: number;
  paidAt: string;
  releasedBy: string;
}

export interface JournalEntry {
  id: string;
  postedAt: string;
  postedBy: string;
  account: string;
  amount: number;
  description: string;
  source: 'manual' | 'automatic';
}

export interface Customer {
  id: string;
  name: string;
  creditLimit: number;
}

export interface ArInvoice {
  id: string;
  customerId: string;
  issuedAt: string;
  dueDate: string;
  amount: number;
  paidAt?: string;
}

export interface VendorMasterChange {
  vendorId: string;
  field: 'bank_account' | 'address' | 'payment_terms' | 'name';
  changedAt: string;
  changedBy: string;
}

export interface CloseTask {
  id: string;
  name: string;
  owner: string;
  plannedDay: number; // business day of close (WD1, WD2 ...)
  actualDay?: number;
  status: 'done' | 'in_progress' | 'not_started';
  dependsOn: string[];
}

export interface Dataset {
  company: Company;
  asOf: string;
  cashOnHand: number;
  logs: Record<ProcessKey, EventRecord[]>;
  vendors: Vendor[];
  purchaseOrders: PurchaseOrder[];
  goodsReceipts: GoodsReceipt[];
  apInvoices: ApInvoice[];
  payments: Payment[];
  journals: JournalEntry[];
  customers: Customer[];
  arInvoices: ArInvoice[];
  vendorChanges: VendorMasterChange[];
  closeTasks: CloseTask[];
}

export type Severity = 'critical' | 'high' | 'medium' | 'low';

export interface Finding {
  id: string;
  type: string;
  severity: Severity;
  title: string;
  detail: string;
  amountAtRisk: number;
  refs: string[];
}
