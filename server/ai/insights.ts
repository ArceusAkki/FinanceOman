import type { Finding, ProcessKey } from '../../src/engine';
import { REFERENCE_MODELS } from '../../src/engine';
import type { ProcessAnalysis } from '../../src/engine';
import { FALLBACK_OPTIONS, FINANCE_SYSTEM_PROMPT, MODEL, aiEnabled, assertNotRefused, describeAiError, getClient, textOf } from './client';

export interface Narrative {
  text: string;
  mode: 'ai' | 'offline';
  notice?: string;
}

const hours = (h: number) => (h >= 48 ? `${(h / 24).toFixed(1)} days` : `${h.toFixed(1)} h`);

async function complete(task: string, payload: unknown, effort: 'low' | 'medium' | 'high'): Promise<string> {
  const response = await getClient().beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    ...FALLBACK_OPTIONS,
    thinking: { type: 'adaptive' },
    output_config: { effort },
    system: FINANCE_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: `${task}\n\n<data>\n${JSON.stringify(payload)}\n</data>` }],
  });
  assertNotRefused(response);
  return textOf(response);
}

function processPayload(analysis: ProcessAnalysis) {
  const d = analysis.discovery;
  return {
    process: analysis.name,
    cases: d.caseCount,
    medianCaseDuration: hours(d.medianCaseHours),
    p90CaseDuration: hours(d.p90CaseHours),
    reworkRate: d.reworkRate,
    topVariants: d.variants.slice(0, 6).map((v) => ({ share: v.share, path: v.path.join(' → '), median: hours(v.medianDurationHours) })),
    bottlenecks: d.bottlenecks.map((b) => ({ handoff: `${b.from} → ${b.to}`, cases: b.count, medianWait: hours(b.medianHours), p90Wait: hours(b.p90Hours) })),
    activities: d.activities.map((a) => ({ activity: a.activity, count: a.count, automatedShare: a.automatedShare })),
    conformance: { fitness: analysis.conformance.fitness, deviations: analysis.conformance.deviations.slice(0, 8).map((x) => ({ deviation: x.description, cases: x.cases, share: x.share })) },
    reference: REFERENCE_MODELS[analysis.key].steps.map((s) => ({ step: s.activity, sap: s.sap, oracle: s.oracle, control: s.control })),
  };
}

/** Explain the discovered process like a process-excellence consultant would. */
export async function explainProcess(analysis: ProcessAnalysis): Promise<Narrative> {
  if (aiEnabled()) {
    try {
      const text = await complete(
        `Explain how this company actually runs ${analysis.name}, based on the process-mining results below.
Structure the answer with these markdown headings: "How it really runs", "Where time is lost", "Control gaps", "Top 3 improvements".
For bottlenecks, separate waits caused by policy (e.g. payment terms) from waits caused by friction. Reference the SAP and Oracle transactions where useful. Keep it under 350 words.`,
        processPayload(analysis),
        'medium',
      );
      return { text, mode: 'ai' };
    } catch (error) {
      return { text: explainOffline(analysis), mode: 'offline', notice: describeAiError(error) };
    }
  }
  return { text: explainOffline(analysis), mode: 'offline', notice: 'Offline mode: add ANTHROPIC_API_KEY for AI-written explanations.' };
}

export function explainOffline(analysis: ProcessAnalysis): string {
  const d = analysis.discovery;
  const c = analysis.conformance;
  const main = d.variants[0];
  const lines = [
    `## How it really runs`,
    `${d.caseCount} ${analysis.name} cases were reconstructed from ${d.eventCount} events. The most common path (${Math.round((main?.share ?? 0) * 100)}% of cases) is: ${main?.path.join(' → ') ?? 'n/a'}.`,
    `There are ${d.variants.length}+ distinct variants; median end-to-end time is ${hours(d.medianCaseHours)} (slowest 10% take over ${hours(d.p90CaseHours)}).`,
    `## Where time is lost`,
    ...d.bottlenecks.slice(0, 3).map((b) => `- **${b.from} → ${b.to}**: ${b.count} cases wait a median of ${hours(b.medianHours)} (p90 ${hours(b.p90Hours)}).`),
    `## Control gaps`,
    `${Math.round(c.fitness * 100)}% of cases follow the reference model without deviation.`,
    ...c.deviations.slice(0, 4).map((x) => `- ${x.description}: ${x.cases} cases (${Math.round(x.share * 100)}%).`),
    `## Top 3 improvements`,
    ...recommendations(analysis.key, analysis).map((r, i) => `${i + 1}. ${r}`),
  ];
  return lines.join('\n');
}

function recommendations(key: ProcessKey, analysis: ProcessAnalysis): string[] {
  const devs = analysis.conformance.deviations.map((d) => d.description).join(' ');
  const recs: string[] = [];
  if (key === 'P2P') {
    if (/Block Invoice|Change Price/.test(devs)) recs.push('Cut invoice blocks at source: sync contract prices into PO conditions and use AI to pre-route predicted price variances to buyers.');
    if (/before “Create Purchase Order”/.test(devs)) recs.push('Enforce “no PO, no pay”: reject invoices without an approved PO and report after-the-fact POs by requester.');
    recs.push('Raise the touchless rate with AI invoice capture and auto-posting of matched invoices.');
  } else if (key === 'O2C') {
    recs.push('Prioritise collections with a risk score per customer (learned days-late) and automate dunning for low-risk accounts.');
    if (/Credit Block/.test(devs)) recs.push('Review credit limits for customers that are routinely released from credit block — the block adds days to delivery without reducing risk.');
    recs.push('Auto-apply incoming payments with ML matching on remittance references to cut unapplied cash.');
  } else {
    recs.push('Auto-approve low-risk recurring journals and focus controller review on manual, round-amount and out-of-hours postings.');
    if (/Skipped “Approve/.test(devs)) recs.push('Close the gap that lets journals post without approval (workflow configuration / authorisations).');
    recs.push('Reduce rejections by validating journals (accounts, cost objects, support) before submission.');
  }
  return recs.slice(0, 3);
}

const TRIAGE_PLAYBOOK: Record<string, string> = {
  'Duplicate invoice': 'Compare the two documents (invoice number, date, PO, amount). If duplicate: place a payment block, request a credit note or refund from the vendor, and add fuzzy duplicate checks at invoice entry.',
  'Split purchase order': 'Review whether the POs cover one requirement. Discuss with the buyer, consolidate future demand and lower the release threshold for this buyer/vendor pair.',
  'Segregation of duties': 'Confirm the user roles in SAP (SUIM) / Oracle (Security Console). Remove the conflicting role, then have an independent reviewer re-perform the affected transactions.',
  'Vendor bank change': 'Call the vendor on a number from the contract (not the change request) to confirm the new account. Hold further payments until confirmed; review who approved the master-data change.',
  'Journal entry timing': 'Obtain support and business rationale for each out-of-hours manual journal; confirm approval evidence and that the user was authorised to post.',
  'Journal entry round amounts': 'Check whether round-amount journals are estimates; require calculation support and reverse/true-up in the next period.',
  'Withholding tax not deducted': 'Recalculate WHT at 10% for the affected payments, pay the shortfall to the Oman Tax Authority, and fix the vendor master WHT indicator.',
  'VAT mismatch': 'Recompute VAT at 5% of net and request corrected tax invoices before claiming input VAT on the return.',
  'After-the-fact PO': 'Report after-the-fact POs by requester and department; enforce “no PO, no pay” with exceptions approved by the CFO.',
  'Fawtara readiness': 'Collect VAT registration certificates from affected vendors and update the vendor master before Fawtara go-live.',
};

/** Recommend how to investigate and remediate a control finding. */
export async function triageFinding(finding: Finding, context: unknown): Promise<Narrative> {
  const offline = `**Likely explanation & next steps**\n\n${TRIAGE_PLAYBOOK[finding.type] ?? 'Investigate the referenced documents, confirm the facts with the process owner, and document the outcome.'}\n\n**Amount at risk:** OMR ${finding.amountAtRisk.toFixed(3)} · **Documents:** ${finding.refs.slice(0, 8).join(', ')}`;
  if (!aiEnabled()) return { text: offline, mode: 'offline', notice: 'Offline mode: add ANTHROPIC_API_KEY for AI triage.' };
  try {
    const text = await complete(
      `Triage this finance control finding for the finance controller. Give: (1) the most likely benign and fraudulent explanations, (2) the exact evidence to pull from SAP/Oracle (transactions or tables), (3) remediation and the control to fix, (4) a one-line risk rating. Under 250 words, markdown.`,
      { finding, context },
      'medium',
    );
    return { text, mode: 'ai' };
  } catch (error) {
    return { text: offline, mode: 'offline', notice: describeAiError(error) };
  }
}
