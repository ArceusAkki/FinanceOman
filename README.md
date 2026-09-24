# Cognifi

**Finance that thinks: AI workflow intelligence for finance departments that run SAP or Oracle.**

Cognifi learns how a company's finance team *actually* works — not how the SOP says it works. It mines the event trail your ERP already records (purchase orders, receipts, invoices, payments, journals, sales orders), reconstructs the real Procure-to-Pay, Order-to-Cash and Record-to-Report workflows, and uses Claude to explain them, find control gaps and fraud risk, and show where automation pays off. It is built for Omani and GCC companies: OMR with three decimals, 5% VAT, 10% withholding tax, a Friday–Saturday weekend and Fawtara e-invoicing readiness.

> The research behind the feature set, with sources, is in [`docs/RESEARCH.md`](docs/RESEARCH.md).

## What it does

| Module | What you get | AI / technique |
|---|---|---|
| **Process Discovery** | Process map of the real workflow, variants, bottlenecks (median/p90 waits), conformance against a best-practice reference model with SAP T-codes and Oracle screens | Process mining (directly-follows graph, variants, conformance) + Claude narrative ("how it really runs, where time is lost, control gaps, top 3 fixes") |
| **Workflow Studio** | Paste an SOP, email thread or interview notes → structured workflow (roles, systems, approvals, controls, pain points, automation ideas) mapped to SAP/Oracle, plus a **documented-vs-actual** gap analysis against the ERP data | Claude structured outputs (Zod schema) |
| **Controls & Risk** | Continuous control monitoring: duplicate invoices (fuzzy), split POs, segregation-of-duties breaches in real transactions, vendor bank-change-before-payment, out-of-hours/Fri–Sat and round-amount journals, Benford's law, VAT 5% / WHT 10% errors, after-the-fact POs, Fawtara readiness | Rules + statistics; Claude triage per finding (likely explanations, evidence to pull, remediation) |
| **Invoice Matching** | PO ↔ goods receipt ↔ invoice three-way match with tolerances, exception worklist with a suggested resolution and owner | Rules with AI-suggested resolution |
| **Cash Forecast** | 13-week direct cash forecast using each customer's *learned* payment delay, projected low point | Behavioural forecasting |
| **Close Cockpit** | Month-end close timeline, slippage, critical path and root-cause tasks | Dependency analysis |
| **Automation** | Activities ranked by hours saved per month (volume × manual share × automation potential × handling time) | Process-mining analytics |
| **Finance Copilot** | Ask questions in plain language ("Where are we exposed to fraud?", "Will we have a cash squeeze?") | Claude tool use over the live analytics (8 tools) |

Every AI feature has a deterministic **offline mode**, so the app is fully usable — and testable — without an API key. With a key, Claude takes over the narrative, interpretation, triage and chat.

## Quick start

Requires Node.js 20.12 or later.

```bash
npm install
cp .env.example .env        # optional: add ANTHROPIC_API_KEY to enable Claude
npm run dev                 # web on http://localhost:5173, API on :8787
```

Production build, served by one Node process:

```bash
npm run build
PORT=8080 npm start         # serves the API and the built UI on :8080
```

Tests and type-check:

```bash
npm test
npm run typecheck
```

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Enables Claude. Without it the rules engine answers. |
| `ANTHROPIC_MODEL` | `claude-opus-5` | Model used for all AI features. |
| `COGNIFI_OFFLINE` | — | Set to `1` to force offline mode even when a key is present. |
| `PORT` | `8787` | Port for `npm start` (production). |
| `API_PORT` | `8787` | API port during `npm run dev`. |

AI requests use adaptive thinking, structured outputs for workflow interpretation, the SDK tool runner for the Copilot, prompt caching on the Copilot system prompt, and server-side refusal fallbacks (`fallbacks: "default"`).

## Using your own ERP data

The app ships with a fictional demo company (*Al Noor Industrial Group*, SAP S/4HANA, six months of activity with realistic exceptions and planted fraud patterns). To analyse your own processes, go to **Data & ERP** and upload an event-log CSV — one row per event:

```csv
case_id,activity,timestamp,resource,amount
4500000123,Create Purchase Order,2026-05-03 09:14,BUYER01,1250.500
4500000123,Approve Purchase Order,2026-05-04 11:02,FINMGR,1250.500
```

Column names are auto-detected, including SAP (`EBELN`, `BELNR`, `USNAM`, `CPUDT`) and Oracle (`PO_HEADER_ID`, `CREATED_BY`, `CREATION_DATE`) names. Timestamps can be ISO, `YYYYMMDDHHMMSS` or `DD.MM.YYYY HH:MM`. Activity names that match the reference models (see `src/engine/referenceModels.ts`) get full conformance checks; custom activities are reported as company-specific steps.

Where the evidence lives:

- **SAP:** EBAN, EKKO/EKPO, EKBE, MATDOC/MSEG, RBKP/RSEG, BKPF/BSEG/ACDOCA, BSIK/BSAK, REGUH/REGUP, VBAK/LIKP/VBRK, CDHDR/CDPOS, LFA1/LFBK
- **Oracle:** PO_HEADERS_ALL/PO_LINES_ALL, RCV_TRANSACTIONS, AP_INVOICES_ALL, AP_HOLDS_ALL, AP_CHECKS_ALL, XLA_AE_HEADERS/LINES, GL_JE_HEADERS/LINES, RA_CUSTOMER_TRX_ALL, AR_CASH_RECEIPTS_ALL

Uploaded event logs drive process discovery, conformance and automation. Document-level analytics (controls, matching, cash) currently use the demo document tables; direct ERP connectors are on the roadmap.

## Architecture

```
src/engine/     Pure TypeScript analytics (process mining, conformance, controls, Benford,
                3-way match, KPIs, cash forecast, automation scoring, Oman rules, CSV import)
src/demo/       Seeded synthetic SAP-style dataset (deterministic)
server/         Express API with zod-validated routes; in-memory workspace
server/ai/      Claude integration: workflow interpreter, process explainer, finding triage,
                Copilot (tool runner) — each with an offline fallback
src/web/        React UI (Vite): views, process map (dagre), SVG charts
tests/          Vitest: engine, dataset controls, API (offline)
docs/           Research report
```

## Oman specifics built in

- **OMR** amounts carry three decimals (1,000 baisa).
- **VAT 5%** (since 16 April 2021): invoices where VAT ≠ 5% of net are flagged.
- **Withholding tax 10%** on services and similar payments to non-residents: flagged when not deducted. Payments in the cash forecast are shown net of WHT.
- **Fri–Sat weekend** and Muscat working hours drive the journal-timing tests.
- **Fawtara** e-invoicing (Peppol / UBL 2.1; mandatory from April 2027 for large taxpayers and October 2027 for others, per Decision 189/2026): vendor master readiness check.

Tax rules are implemented for analytics, not as tax advice. Verify thresholds and rates with the Oman Tax Authority.

## Roadmap

- Direct connectors: SAP OData / CDS views and Oracle BI Publisher/BICC extracts
- Fawtara UBL 2.1 invoice validation and submission pre-checks
- Bank statement ingestion (MT940 / camt.053) for AI cash application and bank reconciliation
- Multi-company workspaces with persistent storage and role-based access
- Arabic UI

## Security notes

- No credentials are stored in the repo; `.env` is git-ignored.
- All API inputs are validated with zod. Request bodies are capped at 5 MB.
- Rendered AI output uses a minimal markdown renderer that never injects raw HTML.
- The demo workspace is single-tenant and in-memory. Add authentication before exposing it beyond a trusted network.
