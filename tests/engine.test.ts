import { describe, expect, it } from 'vitest';
import type { EventRecord } from '../src/engine/types';
import { discover, simplifyEdges, START, END } from '../src/engine/processMining';
import { checkConformance } from '../src/engine/conformance';
import { benfordTest, BENFORD_EXPECTED } from '../src/engine/benford';
import { formatOmr, isOmanWeekend, expectedVat, expectedWht, roundOmr } from '../src/engine/oman';
import { parseEventLogCsv, parseTimestamp, detectMapping } from '../src/engine/eventLog';
import { analyseClose } from '../src/engine/kpis';

const ev = (caseId: string, activity: string, hour: number, resource = 'U1'): EventRecord => ({
  caseId, activity, timestamp: new Date(Date.UTC(2026, 0, 4) + hour * 3_600_000).toISOString(), resource,
});

describe('process discovery', () => {
  const log = [
    ev('A', 'Create Purchase Order', 0), ev('A', 'Approve Purchase Order', 2), ev('A', 'Record Goods Receipt', 50),
    ev('B', 'Create Purchase Order', 0), ev('B', 'Approve Purchase Order', 30), ev('B', 'Record Goods Receipt', 40),
    ev('C', 'Create Purchase Order', 0), ev('C', 'Approve Purchase Order', 1), ev('C', 'Approve Purchase Order', 3, 'SYSTEM'),
  ];

  it('builds a directly-follows graph with start/end nodes and wait times', () => {
    const d = discover(log);
    expect(d.caseCount).toBe(3);
    const create2approve = d.edges.find((e) => e.from === 'Create Purchase Order' && e.to === 'Approve Purchase Order')!;
    expect(create2approve.count).toBe(3);
    expect(create2approve.medianHours).toBe(2);
    expect(d.edges.some((e) => e.from === START)).toBe(true);
    expect(d.edges.some((e) => e.to === END)).toBe(true);
  });

  it('groups variants and measures rework and automation', () => {
    const d = discover(log);
    expect(d.variants[0].count).toBe(2);
    expect(d.variants[0].path).toEqual(['Create Purchase Order', 'Approve Purchase Order', 'Record Goods Receipt']);
    expect(d.reworkRate).toBeCloseTo(1 / 3, 2);
    expect(d.activities.find((a) => a.activity === 'Approve Purchase Order')!.automatedShare).toBeCloseTo(0.25, 2);
  });

  it('orders events by timestamp regardless of input order', () => {
    const d = discover([ev('X', 'Second', 5), ev('X', 'First', 1)]);
    expect(d.variants[0].path).toEqual(['First', 'Second']);
  });

  it('simplifies edges to a coverage target', () => {
    const d = discover(log);
    const kept = simplifyEdges(d.edges, 0.5);
    expect(kept.length).toBeLessThan(d.edges.length);
    expect(kept[0].count).toBeGreaterThanOrEqual(kept[kept.length - 1].count);
  });
});

describe('conformance checking', () => {
  it('flags skipped approvals, wrong order and exception steps', () => {
    const log = [
      ev('ok', 'Create Purchase Order', 0), ev('ok', 'Approve Purchase Order', 1), ev('ok', 'Record Goods Receipt', 2), ev('ok', 'Receive Invoice', 3), ev('ok', 'Three-Way Match', 4), ev('ok', 'Post Invoice', 5), ev('ok', 'Pay Invoice', 6),
      ev('skip', 'Create Purchase Order', 0), ev('skip', 'Record Goods Receipt', 2),
      ev('late', 'Receive Invoice', 0), ev('late', 'Create Purchase Order', 1),
      ev('blk', 'Create Purchase Order', 0), ev('blk', 'Approve Purchase Order', 1), ev('blk', 'Block Invoice', 2),
    ];
    const r = checkConformance('P2P', log);
    expect(r.caseCount).toBe(4);
    expect(r.conformingCases).toBe(1);
    const descriptions = r.deviations.map((d) => d.description);
    expect(descriptions).toContain('Skipped “Approve Purchase Order”');
    expect(descriptions).toContain('“Receive Invoice” happened before “Create Purchase Order”');
    expect(descriptions).toContain('Exception: “Block Invoice”');
  });

  it('does not penalise in-flight cases for steps that have not happened yet', () => {
    const r = checkConformance('P2P', [ev('open', 'Create Purchase Order', 0), ev('open', 'Approve Purchase Order', 1)]);
    expect(r.fitness).toBe(1);
  });
});

describe("Benford's law", () => {
  it('rates a Benford-distributed sample as close', () => {
    const values: number[] = [];
    BENFORD_EXPECTED.forEach((p, i) => { for (let k = 0; k < Math.round(p * 2000); k++) values.push((i + 1) * 100 + k % 97); });
    const r = benfordTest(values);
    expect(r.conformity).toBe('close');
  });

  it('rates a uniform first-digit sample as nonconforming', () => {
    const values = Array.from({ length: 900 }, (_, i) => ((i % 9) + 1) * 1000 + i);
    expect(benfordTest(values).conformity).toBe('nonconformity');
  });

  it('needs at least 100 usable values', () => {
    expect(benfordTest([12, 150, 0.5]).conformity).toBe('insufficient data');
  });
});

describe('Oman rules', () => {
  it('formats OMR with three decimals (baisa)', () => {
    expect(formatOmr(1234.5)).toBe('OMR 1,234.500');
    expect(formatOmr(2_500_000, { compact: true })).toBe('OMR 2.5M');
    expect(roundOmr(1.23456)).toBe(1.235);
  });

  it('treats Friday and Saturday as the weekend', () => {
    expect(isOmanWeekend('2026-09-18T08:00:00Z')).toBe(true); // Friday
    expect(isOmanWeekend('2026-09-19T08:00:00Z')).toBe(true); // Saturday
    expect(isOmanWeekend('2026-09-20T08:00:00Z')).toBe(false); // Sunday is a working day
  });

  it('applies 5% VAT domestically and 10% WHT on foreign services', () => {
    expect(expectedVat(1000, false)).toBe(50);
    expect(expectedVat(1000, true)).toBe(0);
    expect(expectedWht(1000, true, true)).toBe(100);
    expect(expectedWht(1000, true, false)).toBe(0);
    expect(expectedWht(1000, false, true)).toBe(0);
  });
});

describe('event log import', () => {
  it('auto-detects SAP-style column names and date formats', () => {
    const csv = 'EBELN,TCODE,CPUDT,USNAM,NETWR\n4500000001,ME21N,20260105093000,BUYER1,1250.500\n4500000001,ME29N,05.01.2026 14:00,MGR1,\n,ME29N,20260105,MGR1,';
    const r = parseEventLogCsv(csv);
    expect(r.mapping).toMatchObject({ caseId: 'EBELN', activity: 'TCODE', timestamp: 'CPUDT', resource: 'USNAM', amount: 'NETWR' });
    expect(r.events).toHaveLength(2);
    expect(r.skipped).toBe(1);
    expect(r.events[0]).toMatchObject({ caseId: '4500000001', activity: 'ME21N', timestamp: '2026-01-05T09:30:00.000Z', resource: 'BUYER1', amount: 1250.5 });
    expect(r.events[1].timestamp).toBe('2026-01-05T14:00:00.000Z');
  });

  it('reports missing required columns instead of guessing', () => {
    const r = parseEventLogCsv('foo,bar\n1,2');
    expect(r.events).toHaveLength(0);
    expect(r.errors.join(' ')).toMatch(/caseId/);
  });

  it('parses ISO and space-separated timestamps, rejects garbage', () => {
    expect(parseTimestamp('2026-03-01 10:15')).toBe('2026-03-01T10:15:00.000Z');
    expect(parseTimestamp('2026-03-01T10:15:00+04:00')).toBe('2026-03-01T06:15:00.000Z');
    expect(parseTimestamp('not a date')).toBeNull();
    expect(detectMapping(['CASE_ID', 'Activity', 'Timestamp'])).toMatchObject({ caseId: 'CASE_ID' });
  });
});

describe('close analysis', () => {
  it('finds the critical path and propagates risk from late dependencies', () => {
    const r = analyseClose([
      { id: 'a', name: 'A', owner: 'x', plannedDay: 1, actualDay: 3, status: 'done', dependsOn: [] },
      { id: 'b', name: 'B', owner: 'x', plannedDay: 2, actualDay: 2, status: 'done', dependsOn: [] },
      { id: 'c', name: 'C', owner: 'x', plannedDay: 4, status: 'in_progress', dependsOn: ['a'] },
    ]);
    const byId = Object.fromEntries(r.map((t) => [t.id, t]));
    expect(byId.a.risk).toBe('late');
    expect(byId.c.risk).toBe('at_risk');
    expect(byId.c.onCriticalPath && byId.a.onCriticalPath).toBe(true);
    expect(byId.b.onCriticalPath).toBe(false);
  });
});
