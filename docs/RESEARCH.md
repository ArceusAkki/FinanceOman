# FinanceOman — Research Report
**Topic:** How finance-department workflows run on SAP (ECC / S/4HANA) and Oracle (EBS / Fusion Cloud ERP), how to discover them from ERP data, where AI adds measurable value, and the Oman / GCC specifics.
**Date of research:** September 2026. **Author:** FinanceOman research lead.

**How to read this document**
- `[n]` = source in the *Sources* section at the end.
- **(PK)** = standard SAP/Oracle product knowledge (T-codes, table names, workflow engines). These are long-stable, well documented facts but were not re-fetched for this report.
- **(Inference)** = our own reasoning or design recommendation, not a sourced fact.
- **(Unverified)** = claim found only in weak/secondary sources, or could not be confirmed. Treat with caution.
- Vendor-reported performance numbers (match rates, accuracy) are marketing claims unless stated otherwise.

---

## 0. Executive summary

1. The finance "core four" (P2P, O2C, R2R, Treasury) share one data spine in each ERP: SAP's document flow (EBAN → EKKO/EKPO → MATDOC/MSEG → RBKP/RSEG → BKPF/ACDOCA + CDHDR/CDPOS) and Oracle's (PO_* → RCV_* → AP_* → XLA_* → GL_*). An event log for process mining can be built from these tables without changing the ERP [36][37].
2. Measured gaps between top and average performers are large: best-in-class AP processes invoices in ~2.9 days vs 8.2 days average and at ~79% lower cost per invoice (Ardent Partners 2025) [16][17]; APQC top-performers need 3.3 AP FTEs per $1B revenue vs 14.4 for bottom performers [18]; upper-quartile DSO is 28 days vs 46 median (Hackett, FY2024 data) [20]; half of finance teams still need 6+ business days to close [22].
3. Both SAP and Oracle shipped finance AI agents in 2025–2026 (SAP: Cash Management Agent, Dispute Resolution Agent, intelligent GR/IR, e-document error explanation [24][25][26][27]; Oracle: Ledger, Payables, Payments and Expenses agents in Fusion 26B, included at no extra cost [28][29]). These are strongest on **cloud** editions; the many Omani firms on ECC, EBS or heavily customised on-premise systems get little of it. **That gap is FinanceOman's opportunity (Inference).**
4. Oman specifics that must be built in from day one: 5% VAT (since 16 Apr 2021) [1][2]; 10% withholding tax on certain payments to non-residents, with dividends and interest suspended since 2023 [3]; **Fawtara e-invoicing is mandatory from 1 Apr 2027 (annual supplies > OMR 5m) and 1 Oct 2027 (all others)** under Decision 189/2026, with a voluntary pilot of ~100 large companies that started in Aug 2026 [4][5]; OMR has **3 decimals** (1,000 baisa) and is pegged at USD 2.6008 [8].

---

## 1. Core end-to-end finance processes: SAP vs Oracle

### 1.1 Procure-to-Pay (P2P)

**Standard flow:** Purchase requisition → approval → PO → goods receipt (GR) / service entry → invoice receipt (IR) → 2/3-way match → invoice posting & release → payment proposal/run → vendor clearing → GR/IR clearing at period end.

| Step | SAP ECC / S/4HANA (PK) | Oracle EBS / Fusion (PK) |
|---|---|---|
| Requisition | ME51N / Fiori "Manage Purchase Requisitions"; table **EBAN** | iProcurement / Self-Service Procurement; `PO_REQUISITION_HEADERS_ALL/_LINES_ALL` |
| PO | ME21N/ME22N/ME23N, ME29N (release); **EKKO** (header), **EKPO** (item), EKET (schedule), EKBE (PO history: GR/IR) | `PO_HEADERS_ALL`, `PO_LINES_ALL`, `PO_LINE_LOCATIONS_ALL`, `PO_DISTRIBUTIONS_ALL` |
| Goods receipt | MIGO (mvt type 101); ECC: **MKPF/MSEG**; S/4: **MATDOC** (MKPF+MSEG merged) [40] | Receiving: `RCV_SHIPMENT_HEADERS/LINES`, **`RCV_TRANSACTIONS`** (RECEIVE, DELIVER, RETURN) |
| Invoice receipt | MIRO / Fiori "Create Supplier Invoice", MIR7 (park), MIR4; **RBKP** (header), **RSEG** (item); blocked invoices: MRBR release, table RBKP_BLOCKED | `AP_INVOICES_ALL`, `AP_INVOICE_LINES_ALL`, `AP_INVOICE_DISTRIBUTIONS_ALL`; holds: `AP_HOLDS_ALL` |
| Match | 3-way match via EKBE; tolerance keys (OMR0) and invoice blocking reasons (price P, quantity Q, date, etc.) | Match approval level 2/3/4-way on PO shipment; holds such as QTY REC, PRICE, AMOUNT |
| Accounting | **BKPF** (header), **BSEG** (ECC line items); S/4: **ACDOCA** Universal Journal replaces most line-item/totals tables [40] | Subledger Accounting: `XLA_AE_HEADERS`, `XLA_AE_LINES`, `XLA_DISTRIBUTION_LINKS` → `GL_JE_HEADERS`, `GL_JE_LINES` (via `GL_JE_BATCHES`) |
| Vendor open/cleared items | ECC: **BSIK** (open) / **BSAK** (cleared) index tables; in S/4 these are compatibility views over ACDOCA/BSEG [40] | `AP_PAYMENT_SCHEDULES_ALL` (open amounts) |
| Payment | F110 (automatic payment run), F-53/F-58 manual; REGUH/REGUP (payment run data); DMEE formats | Payment Process Request (Payments/IBY): `IBY_PAY_SERVICE_REQUESTS`, `AP_CHECKS_ALL`, `AP_INVOICE_PAYMENTS_ALL` |
| Change history | **CDHDR** / **CDPOS** (who changed which field when, e.g., price, bank details) | `*_ARCHIVE` tables for PO revisions (e.g., `PO_HEADERS_ARCHIVE_ALL`); audit trail via AuditTrail / "WHO" columns |
| Master data | Vendor LFA1/LFB1 (ECC), Business Partner BUT000 (S/4) | Suppliers `POZ_SUPPLIERS` (Fusion), `AP_SUPPLIERS` (EBS) |

**Approval / workflow mechanisms (PK)**
- **SAP:** classic *release strategies* for PR/PO (characteristics-based, CL20N/CL24N, OMGS), SAP Business Workflow (SWDD) for invoice approval; in S/4HANA, **Flexible Workflow** (Fiori "Manage Workflows for Purchase Orders / Supplier Invoices") with condition-based steps. Heavy use of custom Z-workflows in older ECC estates.
- **Oracle EBS:** **AME** (Approvals Management Engine) rules + Oracle Workflow item types (e.g., APINVAPR, POAPPRV).
- **Oracle Fusion:** **BPM**-based approval rules (Transaction Console / "Manage Approval Rules"), configured per task (PO, requisition, invoice, expense).

**Roles:** requester, buyer, receiver/storekeeper, AP clerk, AP supervisor, treasury/payment approver, vendor master data steward.
**Key controls:** segregation of vendor master maintenance vs invoice entry vs payment release; 3-way match tolerances; duplicate invoice check (SAP: vendor + reference + date + amount; Oracle: invoice number per supplier); dual approval of payment runs; bank-detail change callbacks; GR/IR monthly review.

**KPIs & benchmarks**

| KPI | Benchmark | Source |
|---|---|---|
| Cost per invoice | Best-in-class ~79% lower than peers (Ardent 2025) [16]; APQC top performers ~$2.82 vs bottom ~$11 (as cited by Auxis) [18]. Other secondary sources quote APQC as $2.07 vs $10+ — figures vary by edition. | [16][18] |
| Invoice cycle time (receipt → approval) | Best-in-class 2.9 days vs 8.2 days average (Ardent 2025) [17] | [16][17] |
| Invoice exception rate | Average 18.4%; best-in-class ~47% lower (≈10%) [16] | [16] |
| Touchless / straight-through rate | Best-in-class 1.8× the STP rate of peers (absolute % not disclosed in the public summary) [16] | [16] |
| AP FTEs per $1B revenue | APQC top 3.3 vs bottom 14.4 [18] | [18] |
| Supplier e-invoice adoption | Best-in-class 67.2% (Ardent 2025) [17] | [17] |
| Duplicate / erroneous payments | APQC figures quoted as ~0.8% of disbursements (top) to ~2% (bottom); other studies 0.1–0.5% of AP spend — **wide disagreement, treat as order-of-magnitude** [23] | [23] |
| DPO | Median 59 days for top-1,000 US non-financial companies (Hackett, FY2024 data) [19] | [19] |
| First-pass match rate | No authoritative public benchmark found (Unverified). Measure as: invoices posted without any block/hold ÷ all PO invoices. | — |

### 1.2 Order-to-Cash (O2C)

**Standard flow:** Customer master & credit limit → quotation/sales order → credit check → delivery / goods issue → billing (invoice) → AR open item → dunning/collections → payment receipt → cash application → dispute/deduction handling → write-off/credit note.

| Step | SAP (PK) | Oracle (PK) |
|---|---|---|
| Sales order | VA01/VA02; **VBAK** (header), **VBAP** (item), VBEP; document flow **VBFA** | Order Management: `OE_ORDER_HEADERS_ALL`, `OE_ORDER_LINES_ALL` (EBS); Fusion `DOO_HEADERS_ALL`, `DOO_LINES_ALL` |
| Credit check | FD32 / UKM_BP (SAP Credit Management, S/4) | Credit Management (`AR_CMGT_*`), holds on order |
| Delivery / PGI | VL01N / VL02N; **LIKP**/LIPS; PGI creates material doc (MATDOC) | Shipping: `WSH_DELIVERY_DETAILS`, `WSH_NEW_DELIVERIES` |
| Billing | VF01 / VF04; **VBRK**/VBRP; posts to FI (BKPF/ACDOCA) | AutoInvoice → `RA_CUSTOMER_TRX_ALL`, `RA_CUSTOMER_TRX_LINES_ALL`, `RA_CUST_TRX_LINE_GL_DIST_ALL` |
| AR open/cleared | ECC **BSID** (open) / **BSAD** (cleared); S/4 compatibility views over ACDOCA/BSEG | `AR_PAYMENT_SCHEDULES_ALL` |
| Collections | Dunning F150; SAP Collections & Dispute Management (UDM_*, FSCM) | Advanced Collections (`IEX_*`), Fusion Collections |
| Cash receipt & application | F-28 (incoming payment), F-32 (clear), FF_5/FEBAN (bank statement post-processing); SAP Cash Application (ML) | `AR_CASH_RECEIPTS_ALL`, `AR_RECEIVABLE_APPLICATIONS_ALL`; Lockbox / AutoMatch; bank statement via Cash Management |

**Controls:** credit-limit enforcement and override approval, pricing-condition change approval, credit-note approval, segregation of billing vs cash posting, unapplied-cash ageing review.

**KPIs & benchmarks**
- **DSO:** Hackett FY2024 upper quartile 28 days vs median 46 days (18-day gap); DSO degraded for a second straight year [19][20]. Hackett's "Digital World Class" finance organisations report 48% lower DSO and 83% lower average days delinquent [21].
- **Cash-application auto-match:** vendor claims only — SAP Cash Application ~70–85%+ [42]; HighRadius claims 90%+ automated and 95–98% match accuracy [30]. (Vendor claims; no independent benchmark found.)
- Other KPIs to track (no authoritative benchmark verified): % current receivables, average days delinquent (ADD), dispute cycle time, unapplied cash %, bad-debt write-off %.

### 1.3 Record-to-Report (R2R)

**Standard flow:** Sub-ledger cut-off → accruals & provisions → recurring/allocations → FX revaluation → intercompany reconciliation & elimination → balance-sheet account reconciliations → review of journals → close sub-periods → consolidation → management & statutory reporting → audit support.

| Area | SAP (PK) | Oracle (PK) |
|---|---|---|
| Journal entry | FB50/FB01, F-02; Fiori "Post General Journal Entries", "Upload General Journal Entries"; parking & workflow (FV50) | GL Journals (`GL_JE_*`), ADFdi spreadsheet upload (Fusion), Journal approval via AME/BPM |
| Accruals | Accrual Engine; S/4 "Manage Accruals" / Purchase-order accruals (ACAC_* tables) | Period-end accrual journals; Receipt accrual (PO) in EBS; recurring journals |
| Intercompany | ICMR (Intercompany Matching & Reconciliation) in S/4; cross-company postings | Intercompany (FUN_*), Fusion Intercompany Reconciliation |
| Reconciliations | GR/IR (F.13, F.19; Fiori "Monitor GR/IR Account Reconciliation" with ML [27]); bank recon | Oracle **ARCS** (Account Reconciliation Cloud), Cash Management reconciliation |
| Close orchestration | Financial Closing cockpit (ECC); **SAP S/4HANA Cloud for Advanced Financial Closing (AFC)** | Close Manager in Fusion GL / **EPM Task Manager** in FCCS |
| Consolidation | SAP **Group Reporting** (S/4), legacy BPC | Oracle **FCCS** (Financial Consolidation & Close Cloud), legacy HFM |

**Controls:** journal approval thresholds, manual-JE review, SoD between preparer and approver, reconciliation sign-off with evidence, period open/close controls, post-close adjustment logging.
**KPIs:** days to close. Ledge's 2025 survey (100 finance professionals): 50% take 6+ business days, only 18% close within 3 days; 94% still use Excel in the close [22]. APQC publishes monthly-close cycle-time quartiles but the page was inaccessible (Unverified).
Other: # manual JEs, % reconciliations completed on time, # post-close adjustments, unreconciled-item ageing.

### 1.4 Treasury, bank reconciliation, fixed assets, travel & expense

| Process | SAP (PK) | Oracle (PK) | Typical controls / KPIs |
|---|---|---|---|
| Bank account master | Bank Account Management (**BAM**), FI12 | Cash Management bank accounts (`CE_BANK_ACCOUNTS`) | Dual approval of bank-account changes |
| Bank statements | FF_5 / Fiori "Manage Bank Statements"; tables FEBKO/FEBEP; search strings for auto-posting | `CE_STATEMENT_HEADERS/LINES`; AutoReconciliation rules | Auto-reconciliation rate, # unreconciled items, recon lag |
| Cash position / forecast | SAP Cash Management (One Exposure, "Cash Position", "Cash Flow Analyzer"); **Joule Cash Management Agent** [25] | Cash Positioning & Forecasting (Fusion) | Forecast accuracy, idle cash |
| Payments | F110, SAP Bank Communication Mgmt / Multi-Bank Connectivity | Payments (IBY), payment process profiles | Payment approval SoD, sanctions screening |
| Fixed assets | AS01, ABZON/F-90 (acquisition), AFAB (depreciation run), ABUMN, ABAVN; ECC ANLA/ANLC/ANEP → ACDOCA in S/4 | Fusion Assets / EBS FA: `FA_ADDITIONS_B`, `FA_BOOKS`, `FA_DEPRN_SUMMARY`; Mass Additions from AP | CWIP ageing, capitalisation lag, physical verification |
| Travel & expense | SAP Concur (common), legacy FI-TV | Fusion Expenses (`EXM_EXPENSE_REPORTS`), iExpenses (EBS) | Policy violation rate, reimbursement cycle time |

---

## 2. Where companies customise, deviate and hurt

### 2.1 Typical customisations (PK + Inference)
- **SAP:** Z-transactions for invoice entry/upload, custom Z-tables for approval matrices (by cost centre / amount / plant), Z-reports replacing standard ageing (FBL1N/FBL5N clones), user exits/BAdIs on MIRO and F110, custom DMEE payment formats per local bank, custom VAT reports.
- **Oracle:** custom AME rules and attributes, custom concurrent programs for bank files and VAT returns, DFFs (descriptive flexfields) carrying approval or project codes, personalisations in OAF/Fusion page composer, spreadsheet (ADFdi / WebADI) uploads as the main JE route.
- **Outside the ERP:** approval by e-mail and signed PDFs, Excel trackers for accruals and GR/IR, SharePoint close checklists, bank portals used directly for urgent payments, WhatsApp/phone follow-ups (common in the GCC — Inference). These "shadow workflows" are invisible to process mining unless captured separately — **a core reason FinanceOman needs document/e-mail ingestion alongside ERP logs (Inference).**

### 2.2 Pain points & exceptions (and how they appear in data)

| Exception | Where it shows in SAP | Where it shows in Oracle |
|---|---|---|
| Price / quantity variance | RBKP/RSEG blocked (blocking reason P/Q), RBKP_BLOCKED; MRBR releases | `AP_HOLDS_ALL` (PRICE, QTY ORD, QTY REC) |
| Missing GR / invoice before GR | EKBE has IR without GR; GR/IR balance | QTY REC hold; receipt created after invoice date |
| Blocked / held invoices ageing | RBKP with payment block (ZLSPR) | Holds unreleased; `AP_PAYMENT_SCHEDULES_ALL.HOLD_FLAG` |
| Maverick buying / after-the-fact POs | PO creation date (EKKO-AEDAT) later than invoice date (RBKP-BLDAT) | `PO_HEADERS_ALL.CREATION_DATE` > invoice date |
| Duplicate payments | Same vendor/amount/reference variations; payment reversals | Same supplier/amount with invoice number variations |
| Late / manual journals | BKPF-CPUDT after period end; high share of manual doc types (SA) | `GL_JE_HEADERS` created after close; source = Manual/Spreadsheet |
| Reconciliation breaks | Uncleared items on bank clearing accounts, GR/IR | `CE_STATEMENT_LINES` unreconciled; ARCS unmatched |
| SoD conflicts | Same user created vendor (CDHDR) and posted/paid invoice | Same user in supplier update + invoice entry + payment |
| Master-data change risk | CDPOS on LFBK (bank data) shortly before payment | Supplier bank-account change before payment |
| Rework loops | CDPOS changes to price/qty after PO approval | PO revision number increments (`REVISION_NUM`) |

Evidence of prevalence: average invoice exception rate 18.4% (Ardent 2025) [16]; Excel dependence in close 94% (Ledge) [22]; manual cash reconciliation 20–50 hours per month (Ledge) [22].

---

## 3. Discovering workflows from ERP data

### 3.1 Event-log construction
A classic event log needs **case ID, activity, timestamp, resource** (plus attributes). Research from RWTH (van der Aalst et al.) formalises extraction from SAP tables such as EBAN, EKKO/EKPO, EKBE, RBKP/RSEG, BKPF/BSEG and CDHDR/CDPOS, and argues for **object-centric** logs (OCEL) because a PO item, GR and invoice are many-to-many [36]. Celonis ships change-log (CDHDR/CDPOS) configurations for standard P2P, O2C, AP, AR templates, and has extractors for Oracle EBS and Oracle Fusion (REST and BICC) [37].

**Example activity mapping (PK / Inference):**

| Activity | SAP source (timestamp / resource) | Oracle source |
|---|---|---|
| Create PR | EBAN.BADAT / ERNAM | `PO_REQUISITION_HEADERS_ALL.CREATION_DATE / CREATED_BY` |
| Approve / release PR/PO | CDHDR/CDPOS on FRGKZ/FRGZU; SWW* workflow logs | `PO_ACTION_HISTORY` (EBS), approval history (Fusion) |
| Create PO | EKKO.AEDAT / ERNAM | `PO_HEADERS_ALL.CREATION_DATE` |
| Change PO price/qty | CDPOS (TABNAME=EKPO, FNAME=NETPR/MENGE) | `PO_LINES_ARCHIVE_ALL` revisions |
| Record GR | MATDOC/MKPF.CPUDT+CPUTM / USNAM (mvt 101) | `RCV_TRANSACTIONS.TRANSACTION_DATE` (RECEIVE) |
| Receive invoice / scan | RBKP.CPUDT; or OCR/VIM logs (/OPT/* for OpenText VIM) | `AP_INVOICES_ALL.CREATION_DATE` |
| Invoice blocked / released | RBKP_BLOCKED; CDPOS ZLSPR changes | `AP_HOLDS_ALL.HOLD_DATE / RELEASE_DATE` |
| Post invoice | BKPF.CPUDT (doc type RE) | `XLA_AE_HEADERS.ACCOUNTING_DATE` |
| Pay | REGUH.LAUFD; clearing BSAK.AUGDT | `AP_CHECKS_ALL.CHECK_DATE` |
| Clear GR/IR | BSAS/ACDOCA clearing on GR/IR account | Accrual write-off / reconciliation |

**Case notions:** PO item (P2P), invoice (AP), sales order item (O2C), customer open item (AR), JE / reconciliation (R2R), bank statement line (treasury). Use OCEL 2.0-style object-centric storage and flatten per view (Inference, following [36]).

### 3.2 Analyses to run
- **Directly-follows graph (DFG)** with frequency and performance (median/p90 waiting time on edges).
- **Variant analysis:** cluster traces; typical finding is that a few variants cover most cases and a long tail holds exceptions and rework (Inference).
- **Conformance checking** against a reference model (e.g., PR → PO approval → GR → IR → pay): token-based replay or alignments; flag "invoice before PO", "payment before GR", "PO changed after approval".
- **Bottleneck detection:** edge waiting times, per-resource queue length, rework loops (repeated "change price"), weekday/month-end seasonality.
- **Organisational mining:** handover-of-work networks across approvers; SoD violations as resource-pair rules.
- **Tools:** Celonis (SAP & Oracle connectors, OCI partnership with Oracle) [37][41]; **SAP Signavio Process Intelligence** (extraction via on-prem RFC extractor or SAP Datasphere replication flows; Nov-2025 release added AI-assisted "text-to-insights") [38]; Oracle has no first-party process-mining product of note — it relies on Fusion Analytics / Fusion Data Intelligence plus partners such as Celonis (Inference based on [41] and Oracle analytics pages). Open-source: PM4Py (Python) for our own engine (PK).

### 3.3 Practical extraction notes (Inference)
- Read-only extraction via SAP RFC/ODP/CDS views or SLT; for S/4 prefer ACDOCA + MATDOC and CDS views; BSIK/BSAK/BSID/BSAD are compatibility views in S/4 [40].
- Oracle Fusion: BICC extracts or BI Publisher reports (no direct DB access); EBS: read-only DB user on APPS schema views.
- Enable change documents for relevant objects before go-live; timestamp resolution in SAP often combines date + time fields (CPUDT+CPUTM, UDATE+UTIME).
- Timezone: Oman is UTC+4 without DST (PK) — normalise server vs local timestamps.

---

## 4. State of AI in ERP finance (2025–2026)

### 4.1 SAP
- **Joule & Joule Agents:** SAP positions Joule as the copilot with specialised agents. **Cash Management Agent** reasons over daily bank statements to automate reconciliation and flag cash shortfalls/surpluses; SAP estimates up to 70% time saving on manual reconciliation; GA planned Q1 2026 [25]. **Dispute Resolution Agent** does root-cause analysis over invoices, orders, deliveries, pricing and tax rules and proposes e.g. credit memos (S/4HANA Cloud Public Edition; beta in Q1 2026) [24][26].
- **Q1 2026 release highlights (finance):** Joule explanation of e-invoicing / electronic-document errors (SAP says ~80% less time to understand errors, 150 → ~30 min); Document AI **payment advice processing** (SAP claims 70% less processing time); sales orders from unstructured PDFs; fixed-asset key-figure explanations; settlement-rule proposals (≈50% less effort) [24].
- **Embedded ML (longer-standing):** intelligent **GR/IR reconciliation** (learns from past clearing decisions, proposes next step, priority and root cause) [27]; **SAP Cash Application** ML matching of incoming payments (vendor-cited 80%+ auto-match) [42].
- Caveat (Inference): most new agent capabilities target S/4HANA Cloud (Public/Private) and RISE customers; ECC customers (mainstream maintenance ends 31 Dec 2027, extended to 2030 for EHP 6–8 [39]) get little.

### 4.2 Oracle
- At AI World (Oct 2025) Oracle announced finance agents inside Fusion, **included at no additional cost** [28]. In **Fusion 26B** four finance agents became available: **Ledger Agent** (monitors balances/journals, answers variance questions within existing security), **Payables Agent** (multichannel invoice ingestion — email, portals, e-invoicing, PDF — extraction, PO/receipt matching, accounting, tax/policy/fraud checks, routing), **Payments Agent** (payment timing/method optimisation, dynamic discounting, virtual cards), **Expenses Agent** (receipts by e-mail → auto-created expense reports) [28][29].
- Oracle EBS customers do not receive these agents (Inference) — relevant because Oman government entities historically ran on-premise Oracle ERP/CRM being moved to an in-country Oracle cloud region [15].

### 4.3 Third parties (vendor claims unless noted)

| Vendor | Focus | Most valuable, concrete capability |
|---|---|---|
| **BlackLine** | Close & reconciliation | Rules-based high-volume Transaction Matching; "Verity AI" agents on a deterministic matching engine [31] |
| **HighRadius** | O2C & treasury | Cash application agents: claims 90%+ automated posting, 95–98% match accuracy [30]; collections prioritisation, deductions |
| **Trintech (Cadency/Adra)** | Close & recon | AI Risk Rating Engine for transactions/reconciliations; multi-way matching; intercompany; "Cadency Beacon" assistant [32] |
| **AppZen** | T&E / AP audit | 100% pre-payment audit of expense reports and receipts, 42 languages [33] |
| **Vic.ai** | AP autonomy | Claims 97–99% extraction/coding accuracy and up to 85% no-touch invoices [34] |
| **Stampli ("Billy")** | AP collaboration | Line-level GL coding learned from history, approver prediction from past patterns, fraud flags [35] |

### 4.4 What delivers the most measurable value (synthesis — Inference, grounded in the numbers above)
1. **Exception handling in AP** (blocked invoices, holds) — directly attacks the 18.4% exception rate and cycle time [16].
2. **Cash application & bank reconciliation matching** — high volume, deterministic ground truth, clear time savings (SAP 70% claim [25], Ledge 20–50 h/month recon effort [22]).
3. **Invoice capture + GL coding** — cost per invoice; e-invoicing (Fawtara) will make structured data available, shifting value from OCR to validation and matching.
4. **Collections prioritisation & dispute root-cause** — DSO gap of 18 days between median and top quartile [20].
5. **Close orchestration + variance explanation** — days to close (50% at 6+ days) [22].
6. **Continuous controls** (duplicates, SoD, bank-detail change) — duplicate/erroneous payments of 0.1–2% of spend depending on source [23].

---

## 5. Ranked AI features for FinanceOman (value × feasibility)

Scoring (Inference): Value 1–5 (KPI impact × prevalence in Omani mid/large enterprises), Feasibility 1–5 (data availability via read-only extraction, technique maturity, low integration risk). Rank by product.

| # | Feature | What it does | Data needed | Technique | KPI moved | V | F | Score |
|---|---|---|---|---|---|---|---|---|
| 1 | **Workflow discovery & "as-is" map** | Auto-builds P2P/O2C/R2R process maps, variants, approval chains and deviations per company from ERP logs | Tables in §3.1 (SAP/Oracle), change logs, workflow logs | Event-log extraction, DFG / inductive miner, variant clustering; LLM to name activities & narrate | Visibility baseline for every KPI; conformance % | 5 | 5 | 25 |
| 2 | **AP exception triage & resolution copilot** | For each blocked/held invoice: root cause (price, qty, missing GR), suggested action, who to chase, draft message | RBKP/RSEG/EKBE or AP_HOLDS/RCV; vendor & PO history | Rules + gradient-boosted classifier on past resolutions; LLM for explanation & drafts | Exception rate, cycle time, first-pass match | 5 | 5 | 25 |
| 3 | **Duplicate & anomalous payment detection** | Pre-payment scan of payment proposals for duplicates, bank-detail changes before payment, round-sum/weekend postings | Invoices, payment run (REGUH / AP_CHECKS), vendor master change logs | Fuzzy matching (invoice no., amount, date), rules, isolation forest | Duplicate payment rate, fraud losses | 5 | 5 | 25 |
| 4 | **Oman VAT / WHT / Fawtara compliance checker** | Validates 5% VAT codes, reverse charge on imports of services, 10% WHT on non-resident services/royalties, OMR 3-decimal rounding, Fawtara (PINT OM) field completeness before submission; explains rejections | Invoices, tax codes, vendor residency, e-invoice XML | Deterministic rule engine + LLM explanations (bilingual Arabic/English) | Compliance penalties avoided, e-invoice rejection rate | 5 | 4 | 20 |
| 5 | **Bank reconciliation & cash-application matching** | Matches Omani bank statement lines (MT940/CAMT or bank CSV) and remittances to open items, including partial/multi-invoice payments | Bank statements, open AR/AP items, remittance e-mails | Rules + learned matching (similarity features, ML ranker); LLM parses remittance text | Auto-match rate, unapplied cash, recon hours | 4 | 5 | 20 |
| 6 | **Approval-chain intelligence** | Discovers the *real* approval matrix (incl. email approvals), flags bypasses, bottleneck approvers, SoD conflicts | Release/AME/BPM logs, CDHDR, user master, e-mail metadata | Organisational mining, graph analysis, rule-based SoD | Approval cycle time, SoD violations | 4 | 5 | 20 |
| 7 | **Natural-language finance Q&A ("ask the ledger")** | Answers "why did GR/IR grow in Aug?", "which vendors are blocked >30 days?" with SQL/CDS generation and cited records | Semantic layer over extracted tables | LLM text-to-SQL on a curated semantic model with guardrails | Analyst hours, time-to-insight | 4 | 4 | 16 |
| 8 | **Close cockpit & JE anomaly review** | Tracks close tasks across ERP + Excel, predicts late tasks, flags unusual manual journals (amount, account combo, timing, user) | BKPF/ACDOCA or GL_JE_*, task lists | Statistics (Benford, z-scores), ML anomaly scoring, LLM summaries | Days to close, post-close adjustments | 4 | 4 | 16 |
| 9 | **GR/IR & accrual proposer** | Proposes clearing / write-off / follow-up for GR/IR items and generates accrual proposals for received-not-invoiced | EKBE/ACDOCA GR/IR; RCV vs AP | Rules + classifier trained on past clearing (mirrors SAP intelligent GR/IR [27]) | GR/IR balance ageing, close effort | 4 | 4 | 16 |
| 10 | **Collections prioritisation & dispute root-cause** | Scores customers by likelihood/lateness, suggests next action, drafts Arabic/English dunning, groups disputes by cause | AR open items, payment history, disputes, credit data | Survival/GBM models for payment-date prediction; LLM drafting | DSO, ADD, dispute cycle time | 4 | 3 | 12 |
| 11 | **Invoice capture & GL coding for non-PO invoices** | Extracts fields from PDF/scan (Arabic + English) and proposes GL/cost-centre coding; becomes a validation layer once Fawtara XML flows | Invoice images/XML, historical coding | Document AI / vision-LLM, kNN on past coding | Cost per invoice, touchless rate | 3 | 4 | 12 |
| 12 | **Cash forecasting (13-week)** | Forecasts cash from AR/AP schedules, payroll (WPS) cycles, and history; explains variance | AR/AP due dates, bank balances, payroll calendar | Time-series (gradient boosting / Prophet-style) + driver-based rules | Forecast accuracy, idle cash | 3 | 3 | 9 |

**Build order recommendation (Inference):** 1 → 2/3 (quick, measurable wins on data already extracted for #1) → 4 (Oman differentiator timed to the April 2027 Fawtara deadline) → 5/6 → rest. Keep deterministic rules as the system of record for anything that posts or pays; use LLMs for explanation, drafting and classification with human approval.

---

## 6. Oman / GCC specifics

### 6.1 Tax
| Item | Fact | Source |
|---|---|---|
| **VAT** | 5% standard rate; Royal Decree 121/2020; effective **16 April 2021**; administered by the **Oman Tax Authority (OTA)**; zero-rating for items such as basic food, certain medical supplies, exports | [1][2] |
| VAT registration thresholds | Mandatory above OMR 38,500 annual supplies; voluntary above OMR 19,250 | [2] |
| **Withholding tax** | 10% on gross payments to non-residents without an Omani PE for royalties, R&D consideration, software use rights, management fees and services (with exclusions); rate can be reduced by DTAs. **WHT on dividends and interest suspended** by Royal Directive (Jan 2023) | [3] |
| WHT remittance | Payer withholds and pays to OTA within 14 days after the end of the month of payment (secondary sources; confirm against OTA guidance) | [3] (secondary-source detail: Unverified) |
| **Corporate income tax** | 15% standard (Income Tax Law, RD 28/2009); 3% for qualifying small Omani businesses; return due within 4 months of financial year end | [9] |
| Personal income tax | 5% on individuals with annual income > OMR 42,000 from **1 Jan 2028** (RD 56/2025) — relevant for payroll/finance systems later | [10] |
| Pillar Two / DMTT | Oman has introduced a domestic minimum top-up tax for large MNE groups (reported effective 2025) — **Unverified in this research** | — |

### 6.2 E-invoicing — "Fawtara"
- **Legal basis:** OTA Decision **No. 189/2026** amending the VAT Executive Regulations (published Aug 2026) [4][5].
- **Mandatory dates:** **1 April 2027** for businesses with annual supplies **> OMR 5 million**; **1 October 2027** for all other VAT-registered businesses [4][5].
- **Pilot:** ~100 large VAT-registered companies selected for a (now voluntary) pilot from end-August 2026; others may opt in early [4][5].
- **History (important for customer conversations):** until August 2026, most advisors described a four-phase rollout (Phase 1 Aug 2026 top-100; Phase 2 Feb 2027 all large taxpayers; Phase 3 Aug 2027 remaining incl. SMEs; Phase 4 government, date TBA) [7][6]. Decision 189/2026 supersedes this with the two-date model; **government/B2G scope under the new decision is not clear from sources reviewed (Unverified)**.
- **Model & format:** Peppol-based **five-corner** model via OTA-accredited service providers, near-real-time reporting/validation by OTA; OTA became a Peppol Authority (Jan 2026) and published the **PINT OM** specification (April 2026); **UBL 2.1 XML** per PINT OM (PDF/A-3 mentioned by some advisors) — plain PDFs and images do not qualify [4][5][6].
- **Platform milestones:** sandbox Feb 2026; platform Release 2 live 28 June 2026; ~a dozen service providers accredited by July 2026 [6].
- **Penalties & archiving:** secondary sources cite OMR 500–5,000 per violation and 10-year electronic archiving — **Unverified; confirm with OTA text** [5].
- **Implication for FinanceOman (Inference):** e-invoicing turns supplier invoices into structured XML, raising touchless-match potential and making pre-submission validation, rejection explanation (cf. SAP's Joule e-document error explanation [24]) and reconciliation of OTA-cleared invoices vs ERP postings high-value features. SAP (Document and Reporting Compliance) and Oracle will ship Oman connectors; FinanceOman should *complement*, not replace, the ERP's e-invoice submission.

### 6.3 Currency, banking and calendar
- **OMR:** ISO 4217 code OMR (512), **3 decimal places** — 1 rial = 1,000 baisa; pegged to USD at **USD 2.6008 per OMR** since 1986 (≈ OMR 0.3845 per USD) [8]. Design implications: store amounts as fixed-point with ≥3 decimals, handle rounding differences when interfacing with 2-decimal systems (Inference).
- **Central Bank of Oman (CBO):** issues the currency and manages the peg [8]; regulates banks/payment service providers; operates payment systems including an instant payment system; in 2025 CBO waived fees on local digital transfers and simplified WPS fees (employers charged up to OMR 1/month for salary files) [12].
- **Wage Protection System (WPS):** private-sector wages must be paid electronically through CBO-regulated banks/institutions, recorded by the Ministry of Labour [12]. Relevant to payroll-to-GL reconciliation and cash forecasting.
- **Fiscal year:** the state budget runs on the calendar year, and most Omani companies use a 31 December year end (PK / Inference — not re-verified); CIT return due 4 months after FY end [9]. Weekend is Friday–Saturday (PK) — matters for payment-run scheduling and cycle-time calculations.
- **Timezone:** UTC+4, no daylight saving (PK).

### 6.4 Omanisation & local content
- **Omanisation:** Ministerial Decree 501/2024 expanded professions restricted to Omanis in phases (Sept 2024, Jan 2025, 2026, 2027), but KPMG's summary lists **no core accounting/finance roles** among them [11]. Claims that accounting roles must reach 75% Omanisation by 2025 and 100% by 2027 appear only in low-quality sources — **Unverified**. Banking/finance sector quotas are high (commonly cited ~60%+) — **Unverified**.
- **Implication (Inference):** Omani finance teams include many early-career nationals being trained into roles; explainable, bilingual (Arabic/English) guidance and "why was this blocked" explanations are a real adoption lever and support national-talent goals.
- **In-Country Value (ICV):** government tenders embed ICV requirements (e.g., minimum 10% of contract value reinvested in Oman) administered by the Authority for Projects, Tenders and Local Content; oil & gas operators evaluate bids on ICV elements [13]. Finance impact: tracking local vs foreign spend, SME supplier share, and ICV reporting from P2P data — a natural add-on analytic (Inference).

### 6.5 ERPs used by large Omani organisations (publicly known)
| Organisation | ERP (public evidence) | Source |
|---|---|---|
| **OQ** (energy group) | SAP "One ERP"; moving to **RISE with SAP private cloud** ("e-Symphony") in an in-country data centre — SAP's first private-cloud customer in Oman; also uses SuccessFactors, Concur, IBP | [14] |
| **Oman government entities** | Oracle ERP & CRM applications on Oracle **Dedicated Region Cloud@Customer** under the Oman G-Cloud initiative, serving 120+ government entities (Oracle press release) | [15] |
| Oman Data Park | Hosts Oracle Cloud ERP locally (marketing posts) | (social posts; Unverified) |
| **Omantel, banks (e.g., Bank Muscat), PDO, others** | **Not verified** in this research — no authoritative public source found. Must be confirmed per account. | — |

**Market implication (Inference):** expect a mixed estate — SAP ECC → S/4HANA migrations under the 2027 deadline [39] in energy/industrial groups, Oracle (EBS and Fusion) in government and many services firms, plus Microsoft Dynamics / local ERPs in the mid-market. Data-residency expectations are strong (both OQ's SAP and the government's Oracle cloud are in-country [14][15]) — FinanceOman should plan for in-country hosting or on-prem deployment.

### 6.6 GCC context (brief)
- VAT across the GCC follows the GCC unified agreement; Oman's 5% matches UAE; Saudi Arabia is 15% (PK). Saudi ZATCA "FATOORA" (clearance, since 2021) and UAE's Peppol-based programme are the regional precedents Oman's design resembles (PK / Inference). A GCC-extensible tax-rule engine is advisable.

---

## 7. Open questions / things to verify next
1. Final OTA text of Decision 189/2026: penalties, archiving period, B2G/B2C scope, whether QR codes are mandatory for B2C.
2. Official OTA WHT payment deadline and current list of services subject to WHT.
3. APQC current quartile values for monthly close cycle time and first-pass match rate (behind paywall).
4. Omantel, Bank Muscat, PDO, Oman Air, Nama Group ERP landscapes (customer discovery).
5. Availability dates of SAP Joule agents for S/4HANA **Private** Edition vs Public Edition in the Middle East data centres.

---

## Sources
1. PwC Worldwide Tax Summaries — Oman, Other taxes (VAT). https://taxsummaries.pwc.com/oman/corporate/other-taxes
2. Crowe Oman — Value Added Tax. https://www.crowe.com/om/services/tax/value-added-tax
3. PwC Worldwide Tax Summaries — Oman, Withholding taxes. https://taxsummaries.pwc.com/oman/corporate/withholding-taxes
4. VATupdate (24 Aug 2026) — Oman Introduces Mandatory E-Invoicing from April 2027. https://www.vatupdate.com/2026/08/24/oman-to-launch-mandatory-fawtara-e-invoicing-in-2027/
5. ClearTax Oman — E-Invoicing in Oman 2026. https://www.cleartax.com/om/e-invoicing-oman (also: https://goroute.ai/blog/oman-e-invoicing-mandate-2027/)
6. Banqup — Oman Fawtara e-invoicing: status & guide (updated 20 Jul 2026). https://www.banqup.com/resources/blog/oman-fawtara-e-invoicing-status-guide
7. VATupdate (27 Jul 2026) — Oman Launches "Fawtara": Four-Phase Rollout. https://www.vatupdate.com/2026/07/27/oman-launches-fawtara-e-invoicing-four-phase-rollout-begins-august-2026-e-invoicing-faqs/
8. Omani rial (Wikipedia) https://en.wikipedia.org/wiki/Omani_rial ; Central Bank of Oman — Fixed Peg. https://cbo.gov.om/Pages/FixedPeg.aspx
9. PwC Worldwide Tax Summaries — Oman, Taxes on corporate income. https://taxsummaries.pwc.com/oman/corporate/taxes-on-corporate-income
10. KPMG — Oman: Introduction of Personal Income Tax effective 1 Jan 2028. https://kpmg.com/xx/en/our-insights/gms-flash-alert/flash-alert-2025-122.html
11. KPMG Oman — Ministry of Labour increases restrictions on professions for expatriates (Decree 501/2024). https://kpmg.com/om/en/insights/2024/10/oman-ministry-of-labour-increases-restrictions-on-professions-for-expatriates.html
12. Oman Portal — Wages Protection System. https://omanportal.gov.om/wps/wcm/connect/EN/site/home/gov/gov22/WPS/ ; Oman Observer — CBO fee waiver for local digital transfers. https://www.omanobserver.om/article/1191408/business/banking/central-bank-of-oman-announces-fee-waiver-for-local-digital-transfers ; KPMG — Ministry of Labour updates WPS. https://kpmg.com/xx/en/our-insights/gms-flash-alert/flash-alert-2025-024.html
13. Oman Observer — Omanisation and ICV: a comprehensive overview. https://www.omanobserver.om/article/1169958/opinion/omanisation-and-icv-a-comprehensive-overview
14. SAP MENA News — OQ launches e-Symphony, Oman's largest private cloud ERP deployment (Jan 2025). https://news.sap.com/mena/2025/01/oq-launches-e-symphony-omans-largest-private-cloud-erp-deployment/ ; ERP Today. https://erp.today/oq-becomes-saps-first-private-cloud-customer-in-oman/
15. Oracle press release — Sultanate of Oman launches national project (Dedicated Region Cloud@Customer). https://www.oracle.com/corporate/pressrelease/oracle-dedicated-region-cloud-at-customer-oman-071320.html
16. Ardent Partners, Payables Place — State of ePayables (Part Nine): AP Benchmarks and Best-in-Class Performance (Jan 2026). https://payablesplace.ardentpartners.com/2026/01/state-of-epayables-part-nine-ap-benchmarks-and-best-in-class-performance/
17. Medius — Ardent Partners' 2025 State of ePayables Report. https://www.medius.com/resources/guides-reports/ardent-partners-state-of-epayables/
18. Auxis — Accounts Payable Metrics: Are You a Peak Performer? (APQC data). https://www.auxis.com/accounts-payable-key-performance-metrics-are-you-a-top-performer/
19. The Hackett Group — 2025 Working Capital Survey (Aug 2025). https://www.thehackettgroup.com/2025-working-capital-survey-payables-rebound-receivables-inventory-lag/
20. Billtrust webinar citing Hackett — Close the 18-day DSO gap. https://www.billtrust.com/resources/webinars/working-capital-optimization-strategies
21. The Hackett Group — Digital World Class finance teams operate at 45% lower cost. https://www.thehackettgroup.com/the-hackett-group-digital-world-class-finance-teams-operate-at-45-lower-cost-and-deliver-faster-smarter-insights/
22. Ledge — The state of month-end close in 2025. https://www.ledge.co/content/month-end-close-benchmarks-for-2025 ; CFO.com. https://www.cfo.com/news/50-of-finance-take-week-to-close-books-ledge-month-end-close-time-cfo-three-day-close-myth-/746085/
23. Transparent — What percentage of AP spend is lost to duplicate payments. https://transparentglobal.com/blog/what-percentage-of-ap-spend-is-lost-to-duplicate-payments-industry-benchmarks/
24. SAP News — SAP Business AI Release Highlights Q1 2026. https://news.sap.com/2026/04/sap-business-ai-release-highlights-q1-2026/
25. SAP — Joule Agents: Cash Management Agent. https://www.sap.com/assetdetail/2026/02/32c80e46-407f-0010-bca6-c68f7e60039b.html
26. SAP — Joule Agents: Dispute Resolution Agent. https://www.sap.com/assetdetail/2025/02/3adefebc-f27e-0010-bca6-c68f7e60039b.html
27. SAP Help — Intelligent GR/IR Account Reconciliation. https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/651d8af3ea974ad1a4d74449122c620e/736e458481024138a4b0f38e201443fe.html
28. Oracle — AI World: Oracle AI Agents Help Finance Leaders (15 Oct 2025). https://www.oracle.com/news/announcement/ai-world-oracle-ai-agents-help-finance-leaders-accelerate-business-insights-and-boost-efficiency-2025-10-15/ ; Computer Weekly. https://www.computerweekly.com/news/366632781/AI-World-Oracle-brings-agents-to-bear-on-world-of-finance
29. Kyte Consulting — Oracle Fusion Cloud Financials Release 26B: AI Agents. https://www.kyteconsulting.com.au/insights/oracle-fusion-cloud-financials-release-26b-ai-agents-take-the-helm
30. HighRadius — Cash Application Automation. https://www.highradius.com/product/cash-application-automation/
31. BlackLine — Transaction Matching / Verity AI. https://www.blackline.com/products/financial-close/transaction-matching/ ; https://www.blackline.com/products/verity-ai/
32. Trintech — Cadency AI Risk Rating for Transactions. https://www.trintech.com/blog/reconciling-balance-sheet-accounts-ai-risk-rating-transactions/
33. AppZen — AI Expense Audit. https://www.appzen.com/ai-for-expense-audit
34. Vic.ai — AP automation. https://www.vic.ai/
35. Stampli — Billy, AI for Procure-to-Pay. https://www.stampli.com/billy-stampli-ai/
36. Berti, Park, van der Aalst et al. — An Event Data Extraction Approach from SAP ERP for Process Mining. https://arxiv.org/abs/2110.03467 (PDF: https://www.vdaalst.com/publications/p1255.pdf)
37. Celonis Docs — Connecting to Oracle EBS; Oracle Fusion Cloud BICC. https://docs.celonis.com/en/connecting-to-oracle-ebs.html ; https://docs.celonis.com/en/connecting-to-oracle-fusion-cloud-bicc.html
38. SAP Community — Source data extraction for SAP Signavio Process Intelligence using SAP Datasphere; Signavio Nov 2025 release. https://community.sap.com/t5/technology-blog-posts-by-sap/source-data-extraction-for-sap-signavio-process-intelligence-using-sap/ba-p/14030384 ; https://community.sap.com/t5/technology-blog-posts-by-sap/sap-signavio-november-2025-release-sap-signavio-process-insights-and/ba-p/14250661
39. ERP Research — SAP ECC 6.0 End of Support: 2027 & 2030. https://www.erpresearch.com/en-us/blog/sap-ecc-6.0-end-of-support
40. Irvine Analytics — BSIK & BSAK in S/4HANA; QueryViz — ECC to S/4HANA table mapping. https://irvineanalytics.ai/catalog/sap-s4hana/accounts-payable/bsik-bsak-to-acdoca.html ; https://queryviz.io/blog/ecc-to-s4hana-table-mapping-cheat-sheet
41. ERP Today — Celonis expands Oracle partnership with OCI deployment. https://erp.today/celonis-expands-oracle-partnership-with-oci-deployment/
42. Emagia — Intelligent AR matching with SAP Cash Application (vendor source). https://www.emagia.com/resources/glossary/intelligent-accounts-receivables-matching-with-sap-cash-application/
