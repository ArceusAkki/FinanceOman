import type { Dataset, ProcessKey } from './types';
import { PROCESS_KEYS } from './types';
import { discover, type Discovery } from './processMining';
import { checkConformance, type ConformanceResult } from './conformance';
import { detectAnomalies } from './anomalies';
import { benfordTest } from './benford';
import { threeWayMatch } from './matching';
import { computeKpis, analyseClose } from './kpis';
import { forecastCash } from './cashForecast';
import { rankAutomation } from './automation';
import { REFERENCE_MODELS } from './referenceModels';

export * from './types';
export { REFERENCE_MODELS } from './referenceModels';

export interface ProcessAnalysis {
  key: ProcessKey;
  name: string;
  discovery: Discovery;
  conformance: ConformanceResult;
}

export function analyseProcess(data: Dataset, key: ProcessKey): ProcessAnalysis {
  const events = data.logs[key];
  return {
    key,
    name: REFERENCE_MODELS[key].name,
    discovery: discover(events),
    conformance: checkConformance(key, events),
  };
}

/** Everything the dashboard needs, computed once per dataset. */
export function analyseDataset(data: Dataset) {
  const processes = Object.fromEntries(
    PROCESS_KEYS.filter((k) => data.logs[k].length > 0).map((k) => [k, analyseProcess(data, k)]),
  ) as Partial<Record<ProcessKey, ProcessAnalysis>>;
  const manualJournals = data.journals.filter((j) => j.source === 'manual').map((j) => j.amount);
  return {
    company: data.company,
    asOf: data.asOf,
    kpis: computeKpis(data),
    processes,
    findings: detectAnomalies(data),
    benford: benfordTest(data.journals.map((j) => j.amount)),
    benfordManual: benfordTest(manualJournals),
    matching: threeWayMatch(data),
    cash: forecastCash(data),
    automation: rankAutomation(data.logs),
    close: analyseClose(data.closeTasks),
  };
}

export type DatasetAnalysis = ReturnType<typeof analyseDataset>;
