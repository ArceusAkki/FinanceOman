import type { ProcessKey } from './types';

/** A step in a standard (best-practice) finance process, with its SAP and Oracle touchpoints. */
export interface ReferenceStep {
  activity: string;
  mandatory: boolean;
  role: string;
  sap: string;
  oracle: string;
  /** 0..1: how rule-based / repetitive the step typically is. */
  automationPotential: number;
  /** Typical manual effort per occurrence, in minutes. */
  manualMinutes: number;
  control?: string;
}

export interface ReferenceModel {
  key: ProcessKey;
  name: string;
  description: string;
  steps: ReferenceStep[];
  /** Activities that signal rework or exceptions when they appear. */
  exceptionActivities: string[];
  /** Pairs [a, b] where a must happen before b whenever both occur. */
  precedence: [string, string][];
  sapTables: string[];
  oracleTables: string[];
}

export const REFERENCE_MODELS: Record<ProcessKey, ReferenceModel> = {
  P2P: {
    key: 'P2P',
    name: 'Procure-to-Pay',
    description: 'Requisition through purchase order, goods receipt, invoice verification and payment.',
    steps: [
      { activity: 'Create Purchase Requisition', mandatory: false, role: 'Requester', sap: 'ME51N / Manage Purchase Requisitions', oracle: 'Self Service Procurement › Requisitions', automationPotential: 0.4, manualMinutes: 10 },
      { activity: 'Approve Purchase Requisition', mandatory: false, role: 'Budget owner', sap: 'Flexible Workflow / ME54N', oracle: 'BPM Approvals (AME)', automationPotential: 0.5, manualMinutes: 4, control: 'Budget availability check' },
      { activity: 'Create Purchase Order', mandatory: true, role: 'Buyer', sap: 'ME21N / Manage Purchase Orders', oracle: 'Purchasing › Create Order', automationPotential: 0.6, manualMinutes: 12 },
      { activity: 'Approve Purchase Order', mandatory: true, role: 'Procurement manager', sap: 'Release strategy ME29N / Flexible Workflow', oracle: 'Purchase Order Approval (BPM)', automationPotential: 0.4, manualMinutes: 5, control: 'Delegation of authority; segregation of duties' },
      { activity: 'Record Goods Receipt', mandatory: true, role: 'Warehouse', sap: 'MIGO (movement 101)', oracle: 'Receiving › Receipts', automationPotential: 0.5, manualMinutes: 6 },
      { activity: 'Receive Invoice', mandatory: true, role: 'AP clerk', sap: 'MIRO / Supplier Invoice (VIM, OCR)', oracle: 'Payables › Create Invoice / Intelligent Document Recognition', automationPotential: 0.9, manualMinutes: 8 },
      { activity: 'Three-Way Match', mandatory: true, role: 'System', sap: 'Invoice verification tolerances (OMR6)', oracle: 'Invoice validation / match holds', automationPotential: 0.95, manualMinutes: 6, control: 'PO–GR–invoice match within tolerance' },
      { activity: 'Post Invoice', mandatory: true, role: 'AP clerk', sap: 'MIRO post (RBKP/RSEG → ACDOCA)', oracle: 'Payables › Validate & account', automationPotential: 0.85, manualMinutes: 3 },
      { activity: 'Pay Invoice', mandatory: true, role: 'Treasury', sap: 'F110 / Manage Automatic Payments', oracle: 'Payments › Payment Process Request', automationPotential: 0.8, manualMinutes: 4, control: 'Dual release of payment run; bank detail verification' },
    ],
    exceptionActivities: ['Change Price', 'Change Quantity', 'Block Invoice', 'Release Invoice Block', 'Cancel Invoice', 'Change Vendor Bank Details'],
    precedence: [
      ['Create Purchase Order', 'Receive Invoice'],
      ['Approve Purchase Order', 'Record Goods Receipt'],
      ['Record Goods Receipt', 'Post Invoice'],
      ['Post Invoice', 'Pay Invoice'],
    ],
    sapTables: ['EBAN (requisitions)', 'EKKO/EKPO (PO header/item)', 'EKBE (PO history)', 'MATDOC / MSEG (goods movements)', 'RBKP/RSEG (invoice docs)', 'BKPF/BSEG, ACDOCA (accounting)', 'BSIK/BSAK (vendor open/cleared)', 'REGUH/REGUP (payment runs)', 'CDHDR/CDPOS (change log)', 'LFA1/LFBK (vendor master/bank)'],
    oracleTables: ['POR_REQUISITION_HEADERS_ALL', 'PO_HEADERS_ALL / PO_LINES_ALL', 'RCV_TRANSACTIONS', 'AP_INVOICES_ALL / AP_INVOICE_LINES_ALL', 'AP_HOLDS_ALL', 'AP_CHECKS_ALL / AP_INVOICE_PAYMENTS_ALL', 'XLA_AE_HEADERS / XLA_AE_LINES', 'POZ_SUPPLIERS / IBY_EXT_BANK_ACCOUNTS'],
  },
  O2C: {
    key: 'O2C',
    name: 'Order-to-Cash',
    description: 'Sales order through credit check, delivery, billing, collections and cash application.',
    steps: [
      { activity: 'Create Sales Order', mandatory: true, role: 'Sales ops', sap: 'VA01 / Manage Sales Orders', oracle: 'Order Management › Create Order', automationPotential: 0.6, manualMinutes: 10 },
      { activity: 'Credit Check', mandatory: true, role: 'System', sap: 'Credit Management (UKM)', oracle: 'Credit Management', automationPotential: 0.9, manualMinutes: 5, control: 'Credit limit enforcement' },
      { activity: 'Release Credit Block', mandatory: false, role: 'Credit controller', sap: 'UKM_CASE / VKM1', oracle: 'Credit Management › Credit Case', automationPotential: 0.5, manualMinutes: 15 },
      { activity: 'Create Delivery', mandatory: true, role: 'Logistics', sap: 'VL01N', oracle: 'Shipping › Pick Release', automationPotential: 0.7, manualMinutes: 6 },
      { activity: 'Post Goods Issue', mandatory: true, role: 'Warehouse', sap: 'VL02N (PGI)', oracle: 'Ship Confirm', automationPotential: 0.6, manualMinutes: 4 },
      { activity: 'Create Billing Document', mandatory: true, role: 'Billing', sap: 'VF01 / VF04 billing due list', oracle: 'Receivables › AutoInvoice', automationPotential: 0.9, manualMinutes: 5 },
      { activity: 'Send Invoice', mandatory: true, role: 'Billing', sap: 'Output management / e-invoice', oracle: 'Receivables › Print/Deliver', automationPotential: 0.95, manualMinutes: 3 },
      { activity: 'Send Dunning Notice', mandatory: false, role: 'Collections', sap: 'F150 / Collections Management', oracle: 'Advanced Collections', automationPotential: 0.85, manualMinutes: 8 },
      { activity: 'Receive Payment', mandatory: true, role: 'Treasury', sap: 'Bank statement FF_5 / FEBAN', oracle: 'Cash Management › Bank Statements', automationPotential: 0.8, manualMinutes: 4 },
      { activity: 'Apply Cash', mandatory: true, role: 'AR clerk', sap: 'F-28 / Cash Application (SAP AI)', oracle: 'Receivables › Lockbox / AutoMatch', automationPotential: 0.9, manualMinutes: 9, control: 'Unapplied cash review' },
    ],
    exceptionActivities: ['Change Price', 'Issue Credit Memo', 'Dispute Raised', 'Send Dunning Notice', 'Release Credit Block'],
    precedence: [
      ['Credit Check', 'Create Delivery'],
      ['Post Goods Issue', 'Create Billing Document'],
      ['Create Billing Document', 'Receive Payment'],
      ['Receive Payment', 'Apply Cash'],
    ],
    sapTables: ['VBAK/VBAP (sales orders)', 'LIKP/LIPS (deliveries)', 'VBRK/VBRP (billing)', 'BSID/BSAD (customer open/cleared)', 'UKMBP_CMS (credit)', 'FEBKO/FEBEP (bank statements)'],
    oracleTables: ['DOO_HEADERS_ALL / DOO_LINES_ALL', 'WSH_DELIVERY_DETAILS', 'RA_CUSTOMER_TRX_ALL', 'AR_PAYMENT_SCHEDULES_ALL', 'AR_CASH_RECEIPTS_ALL', 'AR_RECEIVABLE_APPLICATIONS_ALL', 'CE_STATEMENT_LINES'],
  },
  R2R: {
    key: 'R2R',
    name: 'Record-to-Report',
    description: 'Journal preparation, approval, posting, reconciliation and period close.',
    steps: [
      { activity: 'Prepare Journal Entry', mandatory: true, role: 'GL accountant', sap: 'FV50 park / Post General Journal Entries', oracle: 'General Ledger › Create Journal', automationPotential: 0.6, manualMinutes: 15 },
      { activity: 'Submit for Approval', mandatory: true, role: 'GL accountant', sap: 'Verify General Journal Entries (workflow)', oracle: 'Journal Approval (AME)', automationPotential: 0.7, manualMinutes: 2 },
      { activity: 'Approve Journal Entry', mandatory: true, role: 'Finance controller', sap: 'Flexible Workflow approval', oracle: 'Journal Approval', automationPotential: 0.3, manualMinutes: 6, control: 'Maker–checker on manual journals' },
      { activity: 'Post Journal Entry', mandatory: true, role: 'System', sap: 'FB50 post → ACDOCA', oracle: 'Post Journals', automationPotential: 0.95, manualMinutes: 2 },
      { activity: 'Reconcile Account', mandatory: false, role: 'GL accountant', sap: 'Advanced Financial Closing / F.13', oracle: 'Account Reconciliation (ARCS)', automationPotential: 0.8, manualMinutes: 25, control: 'Balance sheet reconciliation sign-off' },
    ],
    exceptionActivities: ['Reject Journal Entry', 'Reverse Journal Entry', 'Correct Journal Entry'],
    precedence: [
      ['Submit for Approval', 'Approve Journal Entry'],
      ['Approve Journal Entry', 'Post Journal Entry'],
    ],
    sapTables: ['BKPF/BSEG, ACDOCA (journal lines)', 'FAGLFLEXT (GL totals, ECC)', 'Advanced Financial Closing task lists'],
    oracleTables: ['GL_JE_HEADERS / GL_JE_LINES', 'GL_BALANCES', 'ARCS reconciliations (EPM)', 'FCCS close tasks'],
  },
};

export function referenceStep(process: ProcessKey, activity: string): ReferenceStep | undefined {
  return REFERENCE_MODELS[process].steps.find((s) => s.activity === activity);
}
