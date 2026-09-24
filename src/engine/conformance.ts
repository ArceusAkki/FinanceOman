import type { EventRecord, ProcessKey } from './types';
import { REFERENCE_MODELS } from './referenceModels';
import { toTraces } from './processMining';
import { round } from './stats';

export type DeviationType = 'missing_step' | 'wrong_order' | 'rework' | 'exception_step' | 'unknown_step';

export interface Deviation {
  type: DeviationType;
  description: string;
  cases: number;
  share: number;
  sampleCases: string[];
}

export interface ConformanceResult {
  process: ProcessKey;
  /** Share of cases that follow the reference model with no deviation. */
  fitness: number;
  conformingCases: number;
  caseCount: number;
  deviations: Deviation[];
}

/**
 * Compare every case against the reference model: are mandatory steps present,
 * do precedence rules hold, is there rework or an exception activity?
 */
export function checkConformance(process: ProcessKey, events: EventRecord[]): ConformanceResult {
  const model = REFERENCE_MODELS[process];
  const known = new Set([...model.steps.map((s) => s.activity), ...model.exceptionActivities]);
  const mandatory = model.steps.filter((s) => s.mandatory).map((s) => s.activity);
  const traces = toTraces(events);
  const buckets = new Map<string, { type: DeviationType; description: string; cases: string[] }>();
  let conforming = 0;

  const flag = (type: DeviationType, description: string, caseId: string) => {
    const key = `${type}:${description}`;
    const bucket = buckets.get(key) ?? { type, description, cases: [] };
    bucket.cases.push(caseId);
    buckets.set(key, bucket);
  };

  for (const [caseId, trace] of traces) {
    const path = trace.map((e) => e.activity);
    const firstIndex = new Map<string, number>();
    path.forEach((a, i) => { if (!firstIndex.has(a)) firstIndex.set(a, i); });
    let deviates = false;

    // An in-flight case (last event recent, no terminal step) is not "missing" its tail yet,
    // so only flag missing steps that should have happened before the latest observed step.
    const lastMandatoryIdx = Math.max(...path.map((a) => mandatory.indexOf(a)));
    for (const step of mandatory.slice(0, Math.max(lastMandatoryIdx, 0))) {
      if (!firstIndex.has(step)) { flag('missing_step', `Skipped “${step}”`, caseId); deviates = true; }
    }
    for (const [a, b] of model.precedence) {
      const ia = firstIndex.get(a);
      const ib = firstIndex.get(b);
      if (ia !== undefined && ib !== undefined && ib < ia) {
        flag('wrong_order', `“${b}” happened before “${a}”`, caseId);
        deviates = true;
      }
    }
    const seen = new Set<string>();
    for (const a of path) {
      if (seen.has(a) && !model.exceptionActivities.includes(a)) { flag('rework', `Repeated “${a}”`, caseId); deviates = true; break; }
      seen.add(a);
    }
    for (const a of new Set(path)) {
      if (model.exceptionActivities.includes(a)) { flag('exception_step', `Exception: “${a}”`, caseId); deviates = true; }
      else if (!known.has(a)) { flag('unknown_step', `Custom step “${a}” not in reference model`, caseId); deviates = true; }
    }
    if (!deviates) conforming++;
  }

  const caseCount = traces.size;
  const deviations = [...buckets.values()]
    .map((b) => ({
      type: b.type,
      description: b.description,
      cases: b.cases.length,
      share: round(b.cases.length / Math.max(caseCount, 1), 3),
      sampleCases: b.cases.slice(0, 5),
    }))
    .sort((a, b) => b.cases - a.cases);

  return {
    process,
    fitness: round(conforming / Math.max(caseCount, 1), 3),
    conformingCases: conforming,
    caseCount,
    deviations,
  };
}
