import { useCallback, useEffect, useState } from 'react';
import type { Company, Finding, ProcessKey } from '../engine/types';
import type { FinanceKpis, CloseTaskInsight } from '../engine/kpis';
import type { Discovery, EdgeStat } from '../engine/processMining';
import type { ConformanceResult } from '../engine/conformance';
import type { ReferenceModel } from '../engine/referenceModels';
import type { BenfordResult } from '../engine/benford';
import type { MatchResult, MatchStatus } from '../engine/matching';
import type { CashForecast } from '../engine/cashForecast';
import type { AutomationOpportunity } from '../engine/automation';
import type { CashFlows, MonthlyPosting, ScheduledPayment } from '../engine/overview';

export type { Finding, ProcessKey, CloseTaskInsight, AutomationOpportunity, CashForecast, MatchStatus };

export interface Status {
  aiEnabled: boolean;
  model: string | null;
  company: Company;
  asOf: string;
  sources: Record<ProcessKey, 'demo' | 'upload'>;
}

export interface Overview {
  company: Company;
  asOf: string;
  kpis: FinanceKpis;
  processes: { key: ProcessKey; name: string; cases: number; variants: number; medianCaseHours: number; fitness: number; topBottleneck: EdgeStat | null }[];
  findings: Finding[];
  findingTotals: { count: number; amountAtRisk: number };
  cash: { lowestBalance: number; lowestWeek: number; openingBalance: number };
  matching: { firstPassMatchRate: number; byStatus: Record<MatchStatus, number> };
  automation: AutomationOpportunity[];
  postingByMonth: MonthlyPosting[];
  cashFlows: CashFlows;
  upcomingPayments: ScheduledPayment[];
}

export interface ProcessDetail {
  key: ProcessKey;
  name: string;
  discovery: Discovery;
  conformance: ConformanceResult;
  reference: ReferenceModel;
  source: 'demo' | 'upload';
}

export interface Narrative { text: string; mode: 'ai' | 'offline'; notice?: string }
export interface ControlsData { findings: Finding[]; benford: BenfordResult; benfordManual: BenfordResult }
export interface MatchingData { results: (MatchResult & { vendorName: string })[]; byStatus: Record<MatchStatus, number>; firstPassMatchRate: number; exceptionValue: number }

export interface WorkflowStep {
  order: number; name: string; role: string; system: string; erpTransaction: string; mappedActivity: string;
  manual: boolean; controls: string[]; painPoints: string[]; automationIdea: string; automationPotential: number;
}
export interface InterpretResponse {
  mode: 'ai' | 'offline';
  notice?: string;
  workflow: {
    title: string; process: ProcessKey | 'OTHER'; summary: string; steps: WorkflowStep[];
    approvals: { trigger: string; approver: string; threshold: string }[];
    risks: { risk: string; severity: 'critical' | 'high' | 'medium' | 'low'; mitigation: string }[];
    quickWins: string[];
  };
  gap: null | { process: ProcessKey; documentedNotObserved: string[]; observedNotDocumented: string[]; customSteps: string[]; actualFitness: number };
}

export interface CopilotResponse { reply: string; mode: 'ai' | 'offline'; toolsUsed: string[]; notice?: string }
export interface SourceInfo { key: ProcessKey; name: string; sapTables: string[]; oracleTables: string[]; steps: { activity: string; sap: string; oracle: string }[] }

export class ApiError extends Error {}

export async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: init?.method ?? (init?.body ? 'POST' : 'GET'),
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const issues = Array.isArray(data.issues) ? ` (${data.issues.join('; ')})` : '';
    throw new ApiError(`${data.error ?? `Request failed (${res.status})`}${issues}`);
  }
  return data as T;
}

/** Fetch a GET endpoint; `version` lets callers force a reload after data changes. */
export function useApi<T>(path: string | null, version = 0) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(() => {
    if (!path) return;
    setLoading(true);
    setError(null);
    api<T>(path)
      .then(setData)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [path]);
  useEffect(() => { load(); }, [load, version]);
  return { data, error, loading, reload: load };
}
