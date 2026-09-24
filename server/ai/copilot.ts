import { z } from 'zod';
import type Anthropic from '@anthropic-ai/sdk';
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import { PROCESS_KEYS, type ProcessKey } from '../../src/engine';
import { formatOmr } from '../../src/engine/oman';
import { workspace } from '../workspace';
import { FALLBACK_OPTIONS, FINANCE_SYSTEM_PROMPT, MODEL, aiEnabled, assertNotRefused, describeAiError, getClient, textOf } from './client';

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface CopilotReply {
  reply: string;
  mode: 'ai' | 'offline';
  toolsUsed: string[];
  notice?: string;
}

// ---- Data accessors shared by the AI tools and the offline router ----

export const copilotData = {
  kpis: () => workspace.analysis.kpis,
  process: (key: ProcessKey) => {
    const p = workspace.analysis.processes[key];
    if (!p) return { error: `No event log loaded for ${key}` };
    const d = p.discovery;
    return {
      process: p.name,
      cases: d.caseCount,
      medianCaseHours: d.medianCaseHours,
      p90CaseHours: d.p90CaseHours,
      reworkRate: d.reworkRate,
      fitness: p.conformance.fitness,
      topVariants: d.variants.slice(0, 5).map((v) => ({ share: v.share, path: v.path.join(' → ') })),
      bottlenecks: d.bottlenecks,
      deviations: p.conformance.deviations.slice(0, 8).map(({ sampleCases, ...rest }) => ({ ...rest, sampleCases: sampleCases.slice(0, 3) })),
    };
  },
  findings: (filter: { severity?: string; type?: string }) =>
    workspace.analysis.findings
      .filter((f) => (!filter.severity || f.severity === filter.severity) && (!filter.type || f.type.toLowerCase().includes(filter.type.toLowerCase())))
      .slice(0, 15)
      .map((f) => ({ ...f, refs: f.refs.slice(0, 6) })),
  cash: () => {
    const c = workspace.analysis.cash;
    return { openingBalance: c.openingBalance, lowestBalance: c.lowestBalance, lowestWeek: c.lowestWeek, weeks: c.weeks, slowestPayers: c.customerBehaviour.slice(0, 5) };
  },
  matching: (status?: string) => {
    const m = workspace.analysis.matching;
    return {
      byStatus: m.byStatus,
      firstPassMatchRate: m.firstPassMatchRate,
      exceptionValue: m.exceptionValue,
      examples: m.results.filter((r) => (status ? r.status === status : r.status !== 'matched')).slice(0, 10),
    };
  },
  automation: () => workspace.analysis.automation.slice(0, 10),
  close: () => workspace.analysis.close,
  vendorSpend: (vendorId?: string) => {
    const { vendors, apInvoices } = workspace.data;
    return vendors
      .filter((v) => !vendorId || v.id === vendorId)
      .map((v) => {
        const invs = apInvoices.filter((i) => i.vendorId === v.id);
        return { ...v, invoices: invs.length, spend: invs.reduce((a, i) => a + i.grossAmount, 0), open: invs.filter((i) => !i.paidAt).length };
      })
      .sort((a, b) => b.spend - a.spend);
  },
};

const json = (value: unknown) => JSON.stringify(value);

function buildTools(trace: string[]) {
  const traced = <T,>(name: string, fn: (input: T) => unknown) => async (input: T) => { trace.push(name); return json(fn(input)); };
  return [
    betaZodTool({ name: 'get_kpis', description: 'Headline finance KPIs: DPO, DSO, on-time payment rate, touchless invoice rate, manual journal share, days to close, open AP and overdue AR (OMR).', inputSchema: z.object({}), run: traced('get_kpis', () => copilotData.kpis()) }),
    betaZodTool({ name: 'get_process', description: 'Process-mining results for one process: variants, bottlenecks (median/p90 wait hours), conformance fitness and deviations.', inputSchema: z.object({ process: z.enum(PROCESS_KEYS as [ProcessKey, ...ProcessKey[]]) }), run: traced('get_process', (i: { process: ProcessKey }) => copilotData.process(i.process)) }),
    betaZodTool({ name: 'list_findings', description: 'Control and fraud-risk findings (duplicates, split POs, SoD, bank changes, journal red flags, VAT/WHT, Fawtara readiness), optionally filtered.', inputSchema: z.object({ severity: z.enum(['critical', 'high', 'medium', 'low']).optional(), type: z.string().optional().describe('Substring of the finding type') }), run: traced('list_findings', (i: { severity?: string; type?: string }) => copilotData.findings(i)) }),
    betaZodTool({ name: 'get_cash_forecast', description: '13-week cash forecast (OMR) with the projected low point and the slowest-paying customers.', inputSchema: z.object({}), run: traced('get_cash_forecast', () => copilotData.cash()) }),
    betaZodTool({ name: 'get_invoice_matching', description: 'AP three-way match results and example exceptions. Status: matched, price_variance, quantity_variance, missing_receipt, no_po.', inputSchema: z.object({ status: z.string().optional() }), run: traced('get_invoice_matching', (i: { status?: string }) => copilotData.matching(i.status)) }),
    betaZodTool({ name: 'get_automation_opportunities', description: 'Activities ranked by automation value with estimated hours saved per month.', inputSchema: z.object({}), run: traced('get_automation_opportunities', () => copilotData.automation()) }),
    betaZodTool({ name: 'get_close_status', description: 'Month-end close tasks with planned vs actual business day, slippage and critical path.', inputSchema: z.object({}), run: traced('get_close_status', () => copilotData.close()) }),
    betaZodTool({ name: 'get_vendor_spend', description: 'Vendor master and spend summary (OMR), optionally for one vendor id like V-1007.', inputSchema: z.object({ vendorId: z.string().optional() }), run: traced('get_vendor_spend', (i: { vendorId?: string }) => copilotData.vendorSpend(i.vendorId)) }),
  ];
}

export async function askCopilot(history: ChatTurn[]): Promise<CopilotReply> {
  const question = history[history.length - 1]?.content ?? '';
  if (!aiEnabled()) return { reply: answerOffline(question), mode: 'offline', toolsUsed: [], notice: 'Offline mode: add ANTHROPIC_API_KEY for conversational AI.' };
  const trace: string[] = [];
  try {
    const { company, asOf } = workspace.data;
    const system: Anthropic.Beta.BetaTextBlockParam[] = [
      { type: 'text', text: FINANCE_SYSTEM_PROMPT },
      { type: 'text', text: `Company: ${company.name} · ERP: ${company.erp} · Currency: ${company.currency} · Data as of ${asOf.slice(0, 10)}.\nUse the tools to fetch data before answering; never guess numbers. Answer in short markdown.`, cache_control: { type: 'ephemeral' } },
    ];
    const final = await getClient().beta.messages.toolRunner({
      model: MODEL,
      max_tokens: 16000,
      ...FALLBACK_OPTIONS,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium' },
      system,
      tools: buildTools(trace),
      messages: history.map((t) => ({ role: t.role, content: t.content })),
      max_iterations: 8,
    });
    assertNotRefused(final);
    return { reply: textOf(final) || 'I could not produce an answer from the available data.', mode: 'ai', toolsUsed: [...new Set(trace)] };
  } catch (error) {
    return { reply: answerOffline(question), mode: 'offline', toolsUsed: [], notice: describeAiError(error) };
  }
}

/** Deterministic keyword router so the Copilot is useful without an API key. */
export function answerOffline(question: string): string {
  const q = question.toLowerCase();
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  if (/cash|forecast|liquid/.test(q)) {
    const c = copilotData.cash();
    return `**13-week cash outlook**: opening ${formatOmr(c.openingBalance)}, lowest ${formatOmr(c.lowestBalance)} in week ${c.lowestWeek}.\n\nSlowest payers: ${c.slowestPayers.map((p) => `${p.name} (~${p.avgDaysLate} days late)`).join(', ')}.`;
  }
  if (/fraud|risk|duplicate|anomal|control|sod|segregation|finding|audit/.test(q)) {
    const top = copilotData.findings({}).slice(0, 5);
    return `**Top control findings**\n\n${top.map((f) => `- **${f.severity.toUpperCase()}** · ${f.title} — ${formatOmr(f.amountAtRisk)} at risk`).join('\n')}`;
  }
  if (/automat|save|efficien|fte/.test(q)) {
    return `**Best automation opportunities**\n\n${copilotData.automation().slice(0, 5).map((o) => `- ${o.process} · ${o.activity}: ~${o.hoursSavedPerMonth} h/month — ${o.approach}`).join('\n')}`;
  }
  if (/close|month.?end|period/.test(q)) {
    const late = copilotData.close().filter((t) => t.risk !== 'on_track');
    return `**Close status**: ${late.length} task(s) late or at risk.\n\n${late.map((t) => `- ${t.name} (${t.owner}): planned WD${t.plannedDay}${t.actualDay ? `, actual WD${t.actualDay}` : ', in progress'}${t.onCriticalPath ? ' — on critical path' : ''}`).join('\n')}`;
  }
  if (/match|block|invoice|exception/.test(q)) {
    const m = copilotData.matching();
    return `**Invoice matching**: first-pass match rate ${pct(m.firstPassMatchRate)}; exceptions worth ${formatOmr(m.exceptionValue)}.\n\n${Object.entries(m.byStatus).map(([k, v]) => `- ${k.replace('_', ' ')}: ${v}`).join('\n')}`;
  }
  const processKey = (['p2p', 'o2c', 'r2r'] as const).find((k) => q.includes(k)) ?? (/procure|purchase|payable|vendor/.test(q) ? 'p2p' : /order|receivable|customer|collect/.test(q) ? 'o2c' : /journal|record|ledger/.test(q) ? 'r2r' : undefined);
  if (processKey || /bottleneck|slow|delay|process|variant/.test(q)) {
    const p = copilotData.process((processKey ?? 'p2p').toUpperCase() as ProcessKey);
    if ('error' in p) return p.error as string;
    return `**${p.process}**: ${p.cases} cases, median ${Math.round(p.medianCaseHours / 24)} days, ${pct(p.fitness)} conform to the reference model.\n\nBottlenecks:\n${p.bottlenecks.slice(0, 3).map((b) => `- ${b.from} → ${b.to}: median ${Math.round(b.medianHours)} h over ${b.count} cases`).join('\n')}`;
  }
  const k = copilotData.kpis();
  return `**Finance health** — DPO ${k.dpo} days · DSO ${k.dso} days · on-time payments ${pct(k.onTimePaymentRate)} · touchless invoices ${pct(k.touchlessInvoiceRate)} · days to close ${k.daysToClose}.\n\nAsk me about cash, fraud risks, bottlenecks in P2P/O2C/R2R, invoice exceptions, the close, or automation.`;
}
