import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { PROCESS_KEYS, REFERENCE_MODELS, type ProcessKey } from '../src/engine';
import { eventsToCsv, parseEventLogCsv } from '../src/engine/eventLog';
import { discover } from '../src/engine/processMining';
import { checkConformance } from '../src/engine/conformance';
import { workspace } from './workspace';
import { MODEL, aiEnabled } from './ai/client';
import { interpretWorkflow } from './ai/workflowInterpreter';
import { explainProcess, triageFinding } from './ai/insights';
import { askCopilot } from './ai/copilot';

const ProcessParam = z.enum(PROCESS_KEYS as [ProcessKey, ...ProcessKey[]]);

type Handler = (req: Request, res: Response) => Promise<unknown> | unknown;
const route = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => {
  Promise.resolve(fn(req, res)).catch(next);
};

function parseOr400<T>(schema: z.ZodType<T>, value: unknown, res: Response): T | undefined {
  const result = schema.safeParse(value);
  if (!result.success) {
    res.status(400).json({ error: 'Invalid request', issues: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) });
    return undefined;
  }
  return result.data;
}

export const api = Router();

api.get('/status', route((_req, res) => {
  const { company, asOf } = workspace.data;
  res.json({ aiEnabled: aiEnabled(), model: aiEnabled() ? MODEL : null, company, asOf, sources: workspace.sources });
}));

api.get('/overview', route((_req, res) => {
  const a = workspace.analysis;
  res.json({
    company: a.company,
    asOf: a.asOf,
    kpis: a.kpis,
    processes: Object.values(a.processes).map((p) => ({
      key: p!.key,
      name: p!.name,
      cases: p!.discovery.caseCount,
      variants: p!.discovery.variants.length,
      medianCaseHours: p!.discovery.medianCaseHours,
      fitness: p!.conformance.fitness,
      topBottleneck: p!.discovery.bottlenecks[0] ?? null,
    })),
    findings: a.findings.slice(0, 6),
    findingTotals: { count: a.findings.length, amountAtRisk: a.findings.reduce((s, f) => s + f.amountAtRisk, 0) },
    cash: { lowestBalance: a.cash.lowestBalance, lowestWeek: a.cash.lowestWeek, openingBalance: a.cash.openingBalance },
    matching: { firstPassMatchRate: a.matching.firstPassMatchRate, byStatus: a.matching.byStatus },
    automation: a.automation.slice(0, 5),
  });
}));

api.get('/process/:key', route((req, res) => {
  const key = parseOr400(ProcessParam, req.params.key, res);
  if (!key) return;
  const p = workspace.analysis.processes[key];
  if (!p) return res.status(404).json({ error: `No event log loaded for ${key}` });
  res.json({ ...p, reference: REFERENCE_MODELS[key], source: workspace.sources[key] });
}));

api.post('/process/:key/explain', route(async (req, res) => {
  const key = parseOr400(ProcessParam, req.params.key, res);
  if (!key) return;
  const p = workspace.analysis.processes[key];
  if (!p) return res.status(404).json({ error: `No event log loaded for ${key}` });
  res.json(await explainProcess(p));
}));

api.get('/controls', route((_req, res) => {
  const a = workspace.analysis;
  res.json({ findings: a.findings, benford: a.benford, benfordManual: a.benfordManual });
}));

api.post('/controls/:id/triage', route(async (req, res) => {
  const finding = workspace.analysis.findings.find((f) => f.id === req.params.id);
  if (!finding) return res.status(404).json({ error: 'Finding not found' });
  const { vendors } = workspace.data;
  const context = { vendors: vendors.filter((v) => finding.detail.includes(v.id) || finding.title.includes(v.id)), companyThreshold: workspace.data.company.poApprovalThreshold };
  res.json(await triageFinding(finding, context));
}));

api.get('/matching', route((_req, res) => {
  const vendorNames = new Map(workspace.data.vendors.map((v) => [v.id, v.name]));
  const m = workspace.analysis.matching;
  res.json({ ...m, results: m.results.map((r) => ({ ...r, vendorName: vendorNames.get(r.vendorId) ?? r.vendorId })) });
}));

api.get('/cash', route((_req, res) => res.json(workspace.analysis.cash)));
api.get('/automation', route((_req, res) => res.json(workspace.analysis.automation)));
api.get('/close', route((_req, res) => res.json(workspace.analysis.close)));

const InterpretBody = z.object({
  text: z.string().trim().min(20, 'Describe the workflow in at least a sentence or two').max(20_000),
  process: ProcessParam.optional(),
});

api.post('/workflow/interpret', route(async (req, res) => {
  const body = parseOr400(InterpretBody, req.body, res);
  if (!body) return;
  const result = await interpretWorkflow(body.text, body.process);
  const key = result.workflow.process === 'OTHER' ? undefined : (result.workflow.process as ProcessKey);
  let gap = null;
  if (key && workspace.data.logs[key].length) {
    // Documented vs actual: compare the described steps with what the event log shows.
    const observed = discover(workspace.data.logs[key]).activities.map((a) => a.activity);
    const documented = [...new Set(result.workflow.steps.map((s) => s.mappedActivity).filter((a) => a !== 'CUSTOM'))];
    gap = {
      process: key,
      documentedNotObserved: documented.filter((a) => !observed.includes(a)),
      observedNotDocumented: observed.filter((a) => !documented.includes(a)),
      customSteps: result.workflow.steps.filter((s) => s.mappedActivity === 'CUSTOM').map((s) => s.name),
      actualFitness: checkConformance(key, workspace.data.logs[key]).fitness,
    };
  }
  res.json({ ...result, gap });
}));

const CopilotBody = z.object({
  messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().trim().min(1).max(8_000) })).min(1).max(30),
}).refine((b) => b.messages.at(-1)?.role === 'user', 'The last message must come from the user');

api.post('/copilot', route(async (req, res) => {
  const body = parseOr400(CopilotBody, req.body, res);
  if (!body) return;
  res.json(await askCopilot(body.messages));
}));

const UploadBody = z.object({
  process: ProcessParam,
  csv: z.string().min(10).max(4_000_000),
  mapping: z.object({
    caseId: z.string().optional(),
    activity: z.string().optional(),
    timestamp: z.string().optional(),
    resource: z.string().optional(),
    amount: z.string().optional(),
  }).optional(),
});

api.post('/data/upload', route((req, res) => {
  const body = parseOr400(UploadBody, req.body, res);
  if (!body) return;
  const parsed = parseEventLogCsv(body.csv, body.mapping ?? {});
  if (!parsed.events.length) return res.status(422).json({ error: 'No valid events found', ...parsed, events: undefined });
  workspace.replaceLog(body.process, parsed.events);
  res.json({ loaded: parsed.events.length, cases: new Set(parsed.events.map((e) => e.caseId)).size, skipped: parsed.skipped, mapping: parsed.mapping, headers: parsed.headers, errors: parsed.errors });
}));

api.post('/data/reset', route((_req, res) => {
  workspace.reset();
  res.json({ ok: true });
}));

api.get('/data/export/:key', route((req, res) => {
  const key = parseOr400(ProcessParam, req.params.key, res);
  if (!key) return;
  res.type('text/csv').attachment(`${key.toLowerCase()}-event-log.csv`).send(eventsToCsv(workspace.data.logs[key]));
}));

api.get('/data/sources', route((_req, res) => {
  res.json((Object.keys(REFERENCE_MODELS) as ProcessKey[]).map((k) => ({
    key: k,
    name: REFERENCE_MODELS[k].name,
    sapTables: REFERENCE_MODELS[k].sapTables,
    oracleTables: REFERENCE_MODELS[k].oracleTables,
    steps: REFERENCE_MODELS[k].steps.map((s) => ({ activity: s.activity, sap: s.sap, oracle: s.oracle })),
  })));
}));
