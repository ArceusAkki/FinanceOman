import { useMemo, useState } from 'react';
import { Graph, layout } from '@dagrejs/dagre';
import type { ActivityStat, EdgeStat } from '../../engine/processMining';
import { duration, num } from '../format';

const START = '▶ Start';
const END = '■ End';

interface Props {
  activities: ActivityStat[];
  edges: EdgeStat[];
  exceptionActivities: string[];
  metric: 'frequency' | 'time';
}

interface Hover { kind: 'node' | 'edge'; title: string; lines: string[]; x: number; y: number }

/**
 * Directly-follows process map. Node shade = frequency (sequential blue);
 * edge width = frequency; slow hand-offs are drawn in the "serious" status
 * colour and always carry a text label so colour is never the only signal.
 */
export function ProcessMap({ activities, edges, exceptionActivities, metric }: Props) {
  const [hover, setHover] = useState<Hover | null>(null);

  const graph = useMemo(() => {
    const g = new Graph();
    g.setGraph({ rankdir: 'TB', nodesep: 28, ranksep: 52, marginx: 20, marginy: 20 });
    g.setDefaultEdgeLabel(() => ({}));
    const names = new Set<string>([START, END]);
    edges.forEach((e) => { names.add(e.from); names.add(e.to); });
    for (const name of names) {
      const terminal = name === START || name === END;
      g.setNode(name, { label: name, width: terminal ? 90 : Math.max(170, name.length * 7 + 40), height: terminal ? 30 : 48 });
    }
    edges.forEach((e) => g.setEdge(e.from, e.to, { weight: e.count }));
    layout(g);
    return g;
  }, [edges]);

  const stats = new Map(activities.map((a) => [a.activity, a]));
  const maxCount = Math.max(1, ...activities.map((a) => a.count));
  const maxEdge = Math.max(1, ...edges.map((e) => e.count));
  const waits = edges.filter((e) => e.from !== START && e.to !== END).map((e) => e.medianHours).sort((a, b) => a - b);
  const slowCut = waits[Math.floor(waits.length * 0.75)] ?? Infinity;
  const { width = 600, height = 400 } = graph.graph() as { width?: number; height?: number };

  const shade = (count: number) => {
    const r = count / maxCount;
    return r > 0.75 ? 'var(--seq-500)' : r > 0.4 ? 'var(--seq-300)' : 'var(--seq-100)';
  };

  return (
    <div style={{ position: 'relative' }}>
      <div className="legend" style={{ marginTop: 4 }}>
        <span><i style={{ background: 'var(--seq-500)' }} />Frequent activity</span>
        <span><i style={{ background: 'var(--seq-100)' }} />Rare activity</span>
        <span><i style={{ background: 'var(--serious)' }} />Slow hand-off (top 25% wait)</span>
        <span><i style={{ background: 'var(--surface)', border: '2px dashed var(--warning)' }} />⚠ Exception / rework step</span>
      </div>
      <div className="pmap" onMouseLeave={() => setHover(null)}>
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Discovered process map">
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="10" markerHeight="10" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill="var(--muted)" />
            </marker>
            <marker id="arrow-slow" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="10" markerHeight="10" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill="var(--serious)" />
            </marker>
          </defs>
          {edges.map((e) => {
            const pts = graph.edge(e.from, e.to)?.points ?? [];
            if (!pts.length) return null;
            const d = pts.map((p: { x: number; y: number }, i: number) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' ');
            const slow = e.medianHours >= slowCut && e.from !== START && e.to !== END;
            const mid = pts[Math.floor(pts.length / 2)];
            const w = 1 + 5 * (e.count / maxEdge);
            const label = metric === 'frequency' ? num(e.count) : duration(e.medianHours);
            return (
              <g key={`${e.from}→${e.to}`}
                onMouseEnter={() => setHover({ kind: 'edge', title: `${e.from} → ${e.to}`, lines: [`${num(e.count)} transitions`, `Median wait ${duration(e.medianHours)}`, `p90 wait ${duration(e.p90Hours)}`], x: mid.x, y: mid.y })}>
                <path d={d} fill="none" stroke="transparent" strokeWidth={Math.max(12, w + 8)} />
                <path d={d} fill="none" stroke={slow ? 'var(--serious)' : 'var(--muted)'} strokeOpacity={slow ? 1 : 0.55} strokeWidth={w} markerEnd={`url(#${slow ? 'arrow-slow' : 'arrow'})`} />
                {(slow || e.count / maxEdge > 0.25) && e.from !== START && e.to !== END && (
                  <text className="edge-label" x={mid.x + 6} y={mid.y} fill={slow ? 'var(--serious)' : undefined}>{slow ? `⏱ ${label}` : label}</text>
                )}
              </g>
            );
          })}
          {graph.nodes().map((name) => {
            const n = graph.node(name);
            if (!n) return null;
            const x = n.x - n.width / 2;
            const y = n.y - n.height / 2;
            if (name === START || name === END) {
              return (
                <g key={name} className="node">
                  <rect x={x} y={y} width={n.width} height={n.height} rx={15} style={{ fill: 'var(--nav)', stroke: 'none' }} />
                  <text x={n.x} y={n.y + 4} textAnchor="middle" style={{ fill: '#fff', fontWeight: 600 }}>{name}</text>
                </g>
              );
            }
            const s = stats.get(name);
            const exception = exceptionActivities.includes(name);
            return (
              <g key={name} className="node"
                onMouseEnter={() => s && setHover({ kind: 'node', title: name, lines: [`${num(s.count)} events in ${num(s.cases)} cases`, `${Math.round(s.automatedShare * 100)}% automated`, `${s.resources} distinct users`], x: n.x, y: y })}>
                <rect x={x} y={y} width={n.width} height={n.height} rx={8} strokeWidth={exception ? 2 : 1} strokeDasharray={exception ? '5 3' : undefined} style={exception ? { stroke: 'var(--warning)' } : undefined} />
                <rect x={x} y={y} width={6} height={n.height} rx={3} style={{ fill: s ? shade(s.count) : 'var(--seq-100)' }} />
                <text x={n.x + 3} y={n.y - 3} textAnchor="middle" fontWeight={600}>{exception ? '⚠ ' : ''}{name}</text>
                <text className="count" x={n.x + 3} y={n.y + 13} textAnchor="middle">{s ? `${num(s.count)} · ${Math.round(s.automatedShare * 100)}% auto` : ''}</text>
              </g>
            );
          })}
        </svg>
      </div>
      {hover && (
        <div className="chart-tooltip" style={{ left: 16, top: 56, transform: 'none' }}>
          <div className="t-title">{hover.title}</div>
          {hover.lines.map((l) => <div key={l}>{l}</div>)}
        </div>
      )}
    </div>
  );
}
