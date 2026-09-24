import type { EventRecord } from './types';
import { HOUR_MS, groupBy, median, quantile, round } from './stats';

export const START = '▶ Start';
export const END = '■ End';

export interface ActivityStat {
  activity: string;
  count: number;
  cases: number;
  automatedShare: number;
  resources: number;
}

export interface EdgeStat {
  from: string;
  to: string;
  count: number;
  medianHours: number;
  p90Hours: number;
}

export interface Variant {
  id: string;
  path: string[];
  count: number;
  share: number;
  medianDurationHours: number;
}

export interface Discovery {
  caseCount: number;
  eventCount: number;
  activities: ActivityStat[];
  edges: EdgeStat[];
  variants: Variant[];
  medianCaseHours: number;
  p90CaseHours: number;
  bottlenecks: EdgeStat[];
  /** Share of cases that repeat at least one activity. */
  reworkRate: number;
}

export const AUTOMATED_RESOURCES = new Set(['BATCH', 'SYSTEM', 'WORKFLOW', 'AI']);

export function isAutomated(resource?: string): boolean {
  return !!resource && AUTOMATED_RESOURCES.has(resource.toUpperCase());
}

/** Group events into ordered traces, one per case. */
export function toTraces(events: EventRecord[]): Map<string, EventRecord[]> {
  const traces = groupBy(events, (e) => e.caseId);
  for (const trace of traces.values()) {
    trace.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  }
  return traces;
}

/**
 * Discover the as-is process from an event log: a directly-follows graph with
 * frequencies and waiting times, the case variants, and the slowest hand-offs.
 */
export function discover(events: EventRecord[], opts: { maxVariants?: number } = {}): Discovery {
  const traces = toTraces(events);
  const activityMap = new Map<string, { count: number; cases: Set<string>; automated: number; resources: Set<string> }>();
  const edgeMap = new Map<string, { from: string; to: string; waits: number[] }>();
  const variantMap = new Map<string, { path: string[]; durations: number[] }>();
  const caseDurations: number[] = [];
  let reworkCases = 0;

  const addEdge = (from: string, to: string, waitHours: number) => {
    const key = `${from}→${to}`;
    const edge = edgeMap.get(key) ?? { from, to, waits: [] };
    edge.waits.push(waitHours);
    edgeMap.set(key, edge);
  };

  for (const [caseId, trace] of traces) {
    const path = trace.map((e) => e.activity);
    if (new Set(path).size < path.length) reworkCases++;

    trace.forEach((event, i) => {
      const stat = activityMap.get(event.activity) ?? { count: 0, cases: new Set(), automated: 0, resources: new Set() };
      stat.count++;
      stat.cases.add(caseId);
      if (isAutomated(event.resource)) stat.automated++;
      if (event.resource) stat.resources.add(event.resource);
      activityMap.set(event.activity, stat);
      if (i > 0) {
        const wait = (Date.parse(event.timestamp) - Date.parse(trace[i - 1].timestamp)) / HOUR_MS;
        addEdge(trace[i - 1].activity, event.activity, wait);
      }
    });
    addEdge(START, path[0], 0);
    addEdge(path[path.length - 1], END, 0);

    const duration = (Date.parse(trace[trace.length - 1].timestamp) - Date.parse(trace[0].timestamp)) / HOUR_MS;
    caseDurations.push(duration);
    const vKey = path.join('|');
    const variant = variantMap.get(vKey) ?? { path, durations: [] };
    variant.durations.push(duration);
    variantMap.set(vKey, variant);
  }

  const caseCount = traces.size;
  const activities: ActivityStat[] = [...activityMap.entries()]
    .map(([activity, s]) => ({
      activity,
      count: s.count,
      cases: s.cases.size,
      automatedShare: round(s.automated / s.count, 3),
      resources: s.resources.size,
    }))
    .sort((a, b) => b.count - a.count);

  const edges: EdgeStat[] = [...edgeMap.values()]
    .map((e) => ({
      from: e.from,
      to: e.to,
      count: e.waits.length,
      medianHours: round(median(e.waits)),
      p90Hours: round(quantile(e.waits, 0.9)),
    }))
    .sort((a, b) => b.count - a.count);

  const variants: Variant[] = [...variantMap.values()]
    .sort((a, b) => b.durations.length - a.durations.length)
    .slice(0, opts.maxVariants ?? 25)
    .map((v, i) => ({
      id: `V${i + 1}`,
      path: v.path,
      count: v.durations.length,
      share: round(v.durations.length / Math.max(caseCount, 1), 3),
      medianDurationHours: round(median(v.durations)),
    }));

  // A bottleneck is a frequent hand-off with a long wait: rank by total waiting time.
  const bottlenecks = edges
    .filter((e) => e.from !== START && e.to !== END && e.count >= Math.max(3, caseCount * 0.02))
    .sort((a, b) => b.medianHours * b.count - a.medianHours * a.count)
    .slice(0, 5);

  return {
    caseCount,
    eventCount: events.length,
    activities,
    edges,
    variants,
    medianCaseHours: round(median(caseDurations)),
    p90CaseHours: round(quantile(caseDurations, 0.9)),
    bottlenecks,
    reworkRate: round(reworkCases / Math.max(caseCount, 1), 3),
  };
}

/** Keep only the edges needed to explain `coverage` of the flow, so large maps stay legible. */
export function simplifyEdges(edges: EdgeStat[], coverage = 0.95): EdgeStat[] {
  const total = edges.reduce((a, e) => a + e.count, 0);
  const sorted = [...edges].sort((a, b) => b.count - a.count);
  const kept: EdgeStat[] = [];
  let acc = 0;
  for (const edge of sorted) {
    if (acc / total >= coverage) break;
    kept.push(edge);
    acc += edge.count;
  }
  return kept;
}
