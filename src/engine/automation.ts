import type { EventRecord, ProcessKey } from './types';
import { REFERENCE_MODELS, referenceStep } from './referenceModels';
import { discover, isAutomated } from './processMining';
import { daysBetween, round } from './stats';

export interface AutomationOpportunity {
  process: ProcessKey;
  activity: string;
  monthlyVolume: number;
  manualShare: number;
  automationPotential: number;
  hoursSavedPerMonth: number;
  score: number;
  approach: string;
}

const APPROACHES: Record<string, string> = {
  'Receive Invoice': 'AI document capture (OCR + LLM extraction) with Fawtara/e-invoice ingestion',
  'Three-Way Match': 'Auto-match with learned tolerances; AI proposes resolution for exceptions',
  'Post Invoice': 'Touchless posting for matched invoices; GL coding suggestions for non-PO spend',
  'Pay Invoice': 'Scheduled payment runs with anomaly screening before release',
  'Apply Cash': 'ML cash application matching remittances to open items',
  'Send Dunning Notice': 'Risk-segmented automated collections with AI-drafted reminders',
  'Create Billing Document': 'Billing due-list automation triggered by goods issue',
  'Reconcile Account': 'Auto-reconciliation with rule + ML matching, exceptions only',
  'Prepare Journal Entry': 'Recurring/accrual journals generated from templates and AI accrual estimates',
  'Approve Journal Entry': 'Risk-based approval: auto-approve low-risk recurring journals',
  'Credit Check': 'Automated credit scoring with external data',
  'Create Purchase Order': 'Auto-convert approved requisitions against catalogue/contract',
  'Change Price': 'Root-cause fix: sync contract prices to PO conditions',
  'Block Invoice': 'Predict blocks at receipt and pre-route to the right resolver',
};

function span(events: EventRecord[]): number {
  if (!events.length) return 1;
  const times = events.map((e) => Date.parse(e.timestamp));
  return Math.max(1, daysBetween(new Date(Math.min(...times)).toISOString(), new Date(Math.max(...times)).toISOString()) / 30.44);
}

/**
 * Rank activities by automation value: monthly volume × manual share × how
 * rule-based the step is × typical handling minutes.
 */
export function rankAutomation(logs: Partial<Record<ProcessKey, EventRecord[]>>): AutomationOpportunity[] {
  const out: AutomationOpportunity[] = [];
  for (const [process, events] of Object.entries(logs) as [ProcessKey, EventRecord[]][]) {
    if (!events?.length) continue;
    const months = span(events);
    const disc = discover(events);
    const exceptionSet = new Set(REFERENCE_MODELS[process].exceptionActivities);
    for (const act of disc.activities) {
      const ref = referenceStep(process, act.activity);
      const potential = ref?.automationPotential ?? (exceptionSet.has(act.activity) ? 0.7 : 0.5);
      const minutes = ref?.manualMinutes ?? 10;
      const manualEvents = events.filter((e) => e.activity === act.activity && !isAutomated(e.resource)).length;
      const manualShare = manualEvents / act.count;
      const monthlyVolume = act.count / months;
      const hours = (monthlyVolume * manualShare * potential * minutes) / 60;
      if (hours < 0.5) continue;
      out.push({
        process,
        activity: act.activity,
        monthlyVolume: round(monthlyVolume),
        manualShare: round(manualShare, 3),
        automationPotential: potential,
        hoursSavedPerMonth: round(hours),
        score: 0,
        approach: APPROACHES[act.activity] ?? 'Standardise the step, then automate with workflow rules',
      });
    }
  }
  const maxHours = Math.max(1, ...out.map((o) => o.hoursSavedPerMonth));
  for (const o of out) o.score = Math.round(100 * (0.7 * (o.hoursSavedPerMonth / maxHours) + 0.3 * o.automationPotential));
  return out.sort((a, b) => b.score - a.score);
}
