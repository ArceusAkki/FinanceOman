import { z } from 'zod';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { REFERENCE_MODELS, type ProcessKey } from '../../src/engine';
import { FALLBACK_OPTIONS, FINANCE_SYSTEM_PROMPT, MODEL, aiEnabled, assertNotRefused, describeAiError, getClient } from './client';

export const WorkflowSchema = z.object({
  title: z.string(),
  process: z.enum(['P2P', 'O2C', 'R2R', 'OTHER']),
  summary: z.string(),
  steps: z.array(z.object({
    order: z.number().int(),
    name: z.string(),
    role: z.string(),
    system: z.string().describe('Where the step happens: SAP, Oracle, Excel, email, portal, paper...'),
    erpTransaction: z.string().describe('SAP T-code / Fiori app or Oracle page, or "none"'),
    mappedActivity: z.string().describe('Exact name of the matching reference activity, or "CUSTOM"'),
    manual: z.boolean(),
    controls: z.array(z.string()),
    painPoints: z.array(z.string()),
    automationIdea: z.string(),
    automationPotential: z.number().describe('0 to 1'),
  })),
  approvals: z.array(z.object({ trigger: z.string(), approver: z.string(), threshold: z.string() })),
  risks: z.array(z.object({ risk: z.string(), severity: z.enum(['critical', 'high', 'medium', 'low']), mitigation: z.string() })),
  quickWins: z.array(z.string()),
});

export type InterpretedWorkflow = z.infer<typeof WorkflowSchema>;

export interface InterpretResult {
  workflow: InterpretedWorkflow;
  mode: 'ai' | 'offline';
  notice?: string;
}

function referenceCatalogue(): string {
  return (Object.keys(REFERENCE_MODELS) as ProcessKey[])
    .map((k) => {
      const m = REFERENCE_MODELS[k];
      return `${k} – ${m.name}: ${[...m.steps.map((s) => `${s.activity} [${s.sap} | ${s.oracle}]`), ...m.exceptionActivities].join('; ')}`;
    })
    .join('\n');
}

/** Turn a free-text SOP, email thread or interview note into a structured, ERP-mapped workflow. */
export async function interpretWorkflow(text: string, hint?: ProcessKey): Promise<InterpretResult> {
  if (!aiEnabled()) return { workflow: interpretOffline(text, hint), mode: 'offline', notice: 'Offline mode: add ANTHROPIC_API_KEY for full AI interpretation.' };
  try {
    const response = await getClient().beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      ...FALLBACK_OPTIONS,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high', format: betaZodOutputFormat(WorkflowSchema) },
      system: `${FINANCE_SYSTEM_PROMPT}

Your task: read a description of how this company actually runs a finance workflow (an SOP, meeting notes, an email thread or an interview transcript) and model it as a structured workflow.
Map every step to the closest reference activity below using its exact name; use "CUSTOM" for company-specific steps such as Excel trackers, email approvals or portal uploads.
Capture approval thresholds, the controls that exist, the pain points people mention, and a concrete automation idea for each step.

Reference activities:
${referenceCatalogue()}`,
      messages: [{ role: 'user', content: `${hint ? `This is most likely the ${hint} process.\n\n` : ''}<workflow_description>\n${text}\n</workflow_description>` }],
    });
    assertNotRefused(response);
    if (!response.parsed_output) throw new Error('No structured output returned');
    return { workflow: response.parsed_output, mode: 'ai' };
  } catch (error) {
    return { workflow: interpretOffline(text, hint), mode: 'offline', notice: describeAiError(error) };
  }
}

const KEYWORDS: [RegExp, string, ProcessKey][] = [
  [/requisition|purchase request|\bpr\b/i, 'Create Purchase Requisition', 'P2P'],
  [/(approve|sign.?off).*(requisition|\bpr\b)/i, 'Approve Purchase Requisition', 'P2P'],
  [/(raise|create|issue).*(purchase order|\bpo\b)/i, 'Create Purchase Order', 'P2P'],
  [/(approve|release).*(purchase order|\bpo\b)/i, 'Approve Purchase Order', 'P2P'],
  [/goods receipt|\bgrn\b|migo|receiv(e|ing) (the )?goods|service entry/i, 'Record Goods Receipt', 'P2P'],
  [/(receive|scan|capture|e-?mails?)\b.*invoice|invoice.*(arrive|received|email)/i, 'Receive Invoice', 'P2P'],
  [/three.?way|3.?way|match/i, 'Three-Way Match', 'P2P'],
  [/(post|book|enter).*invoice|miro/i, 'Post Invoice', 'P2P'],
  [/payment run|pay(ing)? (the )?(vendor|supplier|invoice)|f110|bank transfer/i, 'Pay Invoice', 'P2P'],
  [/sales order|va01|customer order/i, 'Create Sales Order', 'O2C'],
  [/credit (check|limit)/i, 'Credit Check', 'O2C'],
  [/\b(deliver(y|ies)?|dispatch(ed)?|ship(ped|ment)?)\b/i, 'Create Delivery', 'O2C'],
  [/(bill|invoice) (the )?customer|billing/i, 'Create Billing Document', 'O2C'],
  [/\b(dunning|reminders?|chas(e|es|ing)|collections?)\b/i, 'Send Dunning Notice', 'O2C'],
  [/cash application|apply (the )?(cash|receipt)|allocate (the )?payment/i, 'Apply Cash', 'O2C'],
  [/journal|\bje\b|accrual/i, 'Prepare Journal Entry', 'R2R'],
  [/(approve|review).*(journal|\bje\b)/i, 'Approve Journal Entry', 'R2R'],
  [/reconcil/i, 'Reconcile Account', 'R2R'],
];

/** Keyword-based interpretation used when the AI is not configured or unavailable. */
export function interpretOffline(text: string, hint?: ProcessKey): InterpretedWorkflow {
  const sentences = text.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter((s) => s.length > 3);
  const votes: Record<ProcessKey, number> = { P2P: 0, O2C: 0, R2R: 0 };
  const steps: InterpretedWorkflow['steps'] = [];

  for (const sentence of sentences) {
    const hits = KEYWORDS.filter(([re]) => re.test(sentence));
    const best = hits[hits.length - 1];
    if (best) votes[best[2]]++;
    const manual = /excel|email|manual|paper|print|spreadsheet|whatsapp|call/i.test(sentence) || !/automatic|system|workflow|batch/i.test(sentence);
    const ref = best ? REFERENCE_MODELS[best[2]].steps.find((s) => s.activity === best[1]) : undefined;
    const roleMatch = /\b(the )?(ap clerk|buyer|procurement|finance manager|cfo|controller|treasury|warehouse|requester|accountant|manager|director|store ?keeper)\b/i.exec(sentence);
    const thresholdMatch = /(omr|ro|rial)\s?[\d,]+|[\d,]+\s?(omr|ro|rial)/i.exec(sentence);
    steps.push({
      order: steps.length + 1,
      name: sentence.length > 90 ? `${sentence.slice(0, 87)}…` : sentence,
      role: roleMatch ? roleMatch[2].replace(/\b\w/g, (c) => c.toUpperCase()) : ref?.role ?? 'Unspecified',
      system: /excel|spreadsheet/i.test(sentence) ? 'Excel' : /email|outlook/i.test(sentence) ? 'Email' : /oracle/i.test(sentence) ? 'Oracle' : /sap/i.test(sentence) ? 'SAP' : 'ERP / unspecified',
      erpTransaction: ref ? ref.sap : 'none',
      mappedActivity: best ? best[1] : 'CUSTOM',
      manual,
      controls: /approv|sign.?off|review|check/i.test(sentence) ? [thresholdMatch ? `Approval (${thresholdMatch[0]})` : 'Approval / review'] : [],
      painPoints: /\b(delay|wait|chas(e|ing)|lost|manual|excel|email|re-?key|duplicate|late)/i.test(sentence) ? ['Manual handling or waiting time mentioned'] : [],
      automationIdea: ref ? `Automate with ERP-native ${ref.sap.split(' ')[0]} workflow; AI assist where rules are clear` : 'Replace with a tracked workflow step in the ERP',
      automationPotential: ref?.automationPotential ?? (manual ? 0.6 : 0.3),
    });
  }

  const process = hint ?? ((Object.entries(votes).sort((a, b) => b[1] - a[1])[0]?.[1] ?? 0) > 0
    ? (Object.entries(votes).sort((a, b) => b[1] - a[1])[0][0] as ProcessKey)
    : 'OTHER');
  const approvals = steps.filter((s) => s.controls.length).map((s) => ({ trigger: s.name, approver: s.role, threshold: s.controls[0] }));
  const manualShare = steps.filter((s) => s.manual).length / Math.max(steps.length, 1);

  return {
    title: process === 'OTHER' ? 'Custom finance workflow' : `${REFERENCE_MODELS[process as ProcessKey].name} (as described)`,
    process,
    summary: `${steps.length} steps identified, ${Math.round(manualShare * 100)}% manual. ${steps.filter((s) => s.mappedActivity === 'CUSTOM').length} step(s) have no standard ERP equivalent.`,
    steps,
    approvals,
    risks: manualShare > 0.5 ? [{ risk: 'Heavy reliance on manual/email hand-offs', severity: 'medium', mitigation: 'Move approvals into ERP workflow so they are logged and auditable' }] : [],
    quickWins: steps.filter((s) => s.system === 'Excel' || s.system === 'Email').slice(0, 3).map((s) => `Replace “${s.name}” (${s.system}) with a tracked ERP step`),
  };
}
