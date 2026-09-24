import { useRef, useState, type ReactNode, type MouseEvent } from 'react';

export function niceTicks(min: number, max: number, count = 4): number[] {
  if (max === min) return [min];
  const span = max - min;
  const step0 = span / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count) ?? 10 * mag;
  const ticks: number[] = [];
  for (let v = Math.floor(min / step) * step; v <= max + step * 0.001; v += step) ticks.push(Number(v.toFixed(10)));
  return ticks;
}

const compact = (v: number) => (Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : Math.abs(v) >= 1e3 ? `${(v / 1e3).toFixed(0)}K` : `${Math.round(v * 100) / 100}`);

interface Tip { x: number | string; y: number; content: ReactNode }

function Tooltip({ tip }: { tip: Tip | null }) {
  if (!tip) return null;
  return <div className="chart-tooltip" style={{ left: tip.x, top: tip.y }} role="status">{tip.content}</div>;
}

// ---------------------------------------------------------------- Horizontal bars (HTML)

export interface HBarDatum { label: string; value: number; detail?: ReactNode; color?: string }

export function HBarChart({ data, format, max, ariaLabel }: { data: HBarDatum[]; format: (v: number) => string; max?: number; ariaLabel: string }) {
  const [tip, setTip] = useState<Tip | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const top = max ?? Math.max(...data.map((d) => d.value), 1);
  const onMove = (e: MouseEvent, d: HBarDatum) => {
    const box = ref.current!.getBoundingClientRect();
    setTip({ x: e.clientX - box.left, y: e.clientY - box.top, content: <><div className="t-title">{d.label}</div><div>{format(d.value)}</div>{d.detail && <div className="muted">{d.detail}</div>}</> });
  };
  return (
    <div className="chart" ref={ref} role="img" aria-label={ariaLabel} onMouseLeave={() => setTip(null)}>
      <div style={{ display: 'grid', gap: 7 }}>
        {data.map((d) => (
          <div key={d.label} style={{ display: 'grid', gridTemplateColumns: 'minmax(110px, 38%) 1fr auto', gap: 10, alignItems: 'center', fontSize: 12.5 }} onMouseMove={(e) => onMove(e, d)}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-2)' }} title={d.label}>{d.label}</span>
            <span style={{ background: 'var(--surface-2)', borderRadius: 4, height: 14, position: 'relative' }}>
              <span style={{ position: 'absolute', inset: 0, width: `${Math.max(1, (d.value / top) * 100)}%`, background: d.color ?? 'var(--series-1)', borderRadius: '0 4px 4px 0' }} />
            </span>
            <span style={{ fontVariantNumeric: 'tabular-nums', minWidth: 56, textAlign: 'right' }}>{format(d.value)}</span>
          </div>
        ))}
      </div>
      <Tooltip tip={tip} />
    </div>
  );
}

// ---------------------------------------------------------------- Line / area chart (SVG)

export interface LinePoint { label: string; value: number }

export function LineChart({ points, format, ariaLabel, highlightIndex, baseline }: { points: LinePoint[]; format: (v: number) => string; ariaLabel: string; highlightIndex?: number; baseline?: number }) {
  const W = 640, H = 230, L = 52, R = 12, T = 12, B = 28;
  const [hover, setHover] = useState<number | null>(null);
  const ref = useRef<SVGSVGElement>(null);
  const values = points.map((p) => p.value);
  const ticks = niceTicks(Math.min(0, ...values, baseline ?? 0), Math.max(...values, baseline ?? 0) * 1.05);
  const yMin = ticks[0], yMax = ticks[ticks.length - 1];
  const x = (i: number) => L + (i * (W - L - R)) / Math.max(points.length - 1, 1);
  const y = (v: number) => T + (1 - (v - yMin) / (yMax - yMin || 1)) * (H - T - B);
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p.value)}`).join(' ');
  const area = `${path} L${x(points.length - 1)},${y(yMin)} L${x(0)},${y(yMin)} Z`;
  const onMove = (e: MouseEvent<SVGSVGElement>) => {
    const box = ref.current!.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    setHover(Math.max(0, Math.min(points.length - 1, Math.round(((px - L) / (W - L - R)) * (points.length - 1)))));
  };
  const hp = hover !== null ? points[hover] : null;
  return (
    <div className="chart">
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t} className="axis">
            <line className="grid-line" x1={L} x2={W - R} y1={y(t)} y2={y(t)} />
            <text x={L - 8} y={y(t) + 4} textAnchor="end">{compact(t)}</text>
          </g>
        ))}
        {points.map((p, i) => (i % Math.ceil(points.length / 7) === 0 || i === points.length - 1) && (
          <text key={p.label} className="tick" x={x(i)} y={H - 8} textAnchor="middle">{p.label}</text>
        ))}
        <path d={area} fill="var(--series-1)" opacity={0.1} />
        <path d={path} fill="none" stroke="var(--series-1)" strokeWidth={2} strokeLinejoin="round" />
        {highlightIndex !== undefined && points[highlightIndex] && (
          <g>
            <circle cx={x(highlightIndex)} cy={y(points[highlightIndex].value)} r={5} fill="var(--critical)" stroke="var(--surface)" strokeWidth={2} />
            <text x={x(highlightIndex)} y={y(points[highlightIndex].value) - 12} textAnchor="middle" fontSize={11} fontWeight={600} fill="var(--text)" paintOrder="stroke" stroke="var(--surface)" strokeWidth={3}>Low point</text>
          </g>
        )}
        {hover !== null && hp && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} stroke="var(--muted)" strokeDasharray="3 3" />
            <circle cx={x(hover)} cy={y(hp.value)} r={4.5} fill="var(--series-1)" stroke="var(--surface)" strokeWidth={2} />
          </g>
        )}
      </svg>
      {hover !== null && hp && (
        <Tooltip tip={{ x: `${(x(hover) / W) * 100}%`, y: (y(hp.value) / H) * (ref.current?.getBoundingClientRect().height ?? H), content: <><div className="t-title">{hp.label}</div><div>{format(hp.value)}</div></> }} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Grouped bars (+ optional marker series)

export interface Series { name: string; color: string; values: number[]; kind?: 'bar' | 'marker' }

export function GroupedBarChart({ categories, series, format, ariaLabel, height = 230 }: { categories: string[]; series: Series[]; format: (v: number) => string; ariaLabel: string; height?: number }) {
  const W = 640, H = height, L = 52, R = 8, T = 10, B = 28;
  const [hover, setHover] = useState<number | null>(null);
  const bars = series.filter((s) => s.kind !== 'marker');
  const markers = series.filter((s) => s.kind === 'marker');
  const all = series.flatMap((s) => s.values);
  const ticks = niceTicks(Math.min(0, ...all), Math.max(...all) * 1.08);
  const yMin = ticks[0], yMax = ticks[ticks.length - 1];
  const y = (v: number) => T + (1 - (v - yMin) / (yMax - yMin || 1)) * (H - T - B);
  const band = (W - L - R) / categories.length;
  const inner = band * 0.72;
  const barW = Math.max(2, inner / Math.max(bars.length, 1) - 2);
  const cx = (i: number) => L + band * i + band / 2;
  return (
    <div className="chart">
      <div className="legend">
        {series.map((s) => <span key={s.name}><i style={{ background: s.color, borderRadius: s.kind === 'marker' ? '50%' : 3 }} />{s.name}</span>)}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel} onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t} className="axis">
            <line className="grid-line" x1={L} x2={W - R} y1={y(t)} y2={y(t)} />
            <text x={L - 8} y={y(t) + 4} textAnchor="end">{compact(t)}</text>
          </g>
        ))}
        {categories.map((c, i) => (
          <g key={c} onMouseEnter={() => setHover(i)}>
            <rect x={L + band * i} y={T} width={band} height={H - T - B} fill={hover === i ? 'var(--surface-2)' : 'transparent'} />
            {bars.map((s, k) => {
              const v = s.values[i];
              const x0 = cx(i) - inner / 2 + k * (barW + 2) + 1;
              const top = y(Math.max(v, 0));
              const h = Math.abs(y(v) - y(0));
              return <path key={s.name} d={roundedTop(x0, top, barW, h)} fill={s.color} stroke="var(--ink)" strokeWidth={0.8} />;
            })}
            {(i % Math.ceil(categories.length / 13) === 0) && <text className="tick" x={cx(i)} y={H - 8} textAnchor="middle">{c}</text>}
          </g>
        ))}
        {markers.map((s) => (
          <g key={s.name} pointerEvents="none">
            <path d={s.values.map((v, i) => `${i ? 'L' : 'M'}${cx(i)},${y(v)}`).join(' ')} fill="none" stroke={s.color} strokeWidth={2} />
            {s.values.map((v, i) => <circle key={i} cx={cx(i)} cy={y(v)} r={4} fill={s.color} stroke="var(--surface)" strokeWidth={2} />)}
          </g>
        ))}
      </svg>
      {hover !== null && (
        <div className="chart-tooltip" style={{ left: `${(cx(hover) / W) * 100}%`, top: 24 }}>
          <div className="t-title">{categories[hover]}</div>
          {series.map((s) => <div key={s.name} className="row" style={{ gap: 6 }}><i style={{ width: 8, height: 8, background: s.color, display: 'inline-block', borderRadius: 2 }} />{s.name}: <strong>{format(s.values[hover])}</strong></div>)}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Hatched stacked bars (dashboard "Statistics")

export interface StackDatum { label: string; solid: number; hatched: number }

/**
 * Two-part bars in the dashboard style: the hatched segment sits on the baseline,
 * the solid ink segment on top. A tag above one bar calls out a headline figure.
 */
export function HatchedBarChart({ data, solidName, hatchedName, format, tag, tagIndex, ariaLabel }: {
  data: StackDatum[]; solidName: string; hatchedName: string; format: (v: number) => string;
  tag?: string; tagIndex?: number; ariaLabel: string;
}) {
  const W = 320, H = 200, L = 6, R = 6, T = 26, B = 24;
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.solid + d.hatched));
  const band = (W - L - R) / Math.max(data.length, 1);
  const barW = Math.min(18, band * 0.42);
  const y = (v: number) => T + (1 - v / max) * (H - T - B);
  const cx = (i: number) => L + band * i + band / 2;
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel} onMouseLeave={() => setHover(null)}>
        <defs>
          <pattern id="hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="5" height="5" fill="var(--surface)" />
            <line x1="0" y1="0" x2="0" y2="5" stroke="var(--ink)" strokeWidth="1.4" />
          </pattern>
        </defs>
        <line x1={L} x2={W - R} y1={H - B} y2={H - B} stroke="var(--ink)" strokeWidth={1} />
        {data.map((d, i) => {
          const x = cx(i) - barW / 2;
          const yh = y(d.hatched);
          const yt = y(d.hatched + d.solid);
          return (
            <g key={d.label} onMouseEnter={() => setHover(i)}>
              <rect x={cx(i) - band / 2} y={T} width={band} height={H - T - B} fill="transparent" />
              <rect x={x} y={yh} width={barW} height={H - B - yh} fill="url(#hatch)" stroke="var(--ink)" strokeWidth={1} />
              <rect x={x} y={yt} width={barW} height={Math.max(0, yh - yt)} fill="var(--ink)" />
              <text className="tick" x={cx(i)} y={H - 7} textAnchor="middle">{d.label}</text>
            </g>
          );
        })}
        {tag && tagIndex !== undefined && data[tagIndex] && (() => {
          // Callout pinned to the top band so it never overlaps neighbouring bars; clamped inside the chart.
          const tagW = 70;
          const tx = Math.min(W - R - tagW / 2, Math.max(L + tagW / 2, cx(tagIndex)));
          const barTop = y(data[tagIndex].solid + data[tagIndex].hatched);
          return (
            <g pointerEvents="none">
              {barTop > 22 && <line x1={cx(tagIndex)} x2={cx(tagIndex)} y1={20} y2={barTop - 2} stroke="var(--ink)" strokeWidth={0.8} strokeDasharray="2 2" />}
              <rect x={tx - tagW / 2} y={4} width={tagW} height={16} rx={2} fill="var(--mauve)" stroke="var(--ink)" strokeWidth={0.8} />
              <text x={tx} y={15.5} textAnchor="middle" fontSize={9.5} fontWeight={700} fill="#111">{tag}</text>
            </g>
          );
        })()}
      </svg>
      <div className="legend" style={{ marginTop: 8, marginBottom: 0 }}>
        <span><i style={{ background: 'var(--ink)' }} />{solidName}</span>
        <span><i style={{ background: 'repeating-linear-gradient(45deg, var(--ink) 0 1.5px, var(--surface) 1.5px 4px)' }} />{hatchedName}</span>
      </div>
      {hover !== null && data[hover] && (
        <div className="chart-tooltip" style={{ left: `${(cx(hover) / W) * 100}%`, top: 30 }}>
          <div className="t-title">{data[hover].label}</div>
          <div>{hatchedName}: <strong>{format(data[hover].hatched)}</strong></div>
          <div>{solidName}: <strong>{format(data[hover].solid)}</strong></div>
        </div>
      )}
    </div>
  );
}

/** Bar path with 4px rounded data-end, anchored square at the baseline. */
function roundedTop(x: number, y: number, w: number, h: number): string {
  const r = Math.min(4, w / 2, h);
  if (h <= 0) return '';
  return `M${x},${y + h} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${y + h} Z`;
}
