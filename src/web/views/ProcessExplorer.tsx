import { useEffect, useMemo, useState } from 'react';
import { api, useApi, type Narrative, type ProcessDetail, type ProcessKey } from '../api';
import type { ViewId } from '../App';
import { Card, ErrorBox, Loading, Markdown, ModeBadge, Segmented, Stat } from '../components/ui';
import { HBarChart } from '../components/charts';
import { ProcessMap } from '../components/ProcessMap';
import { simplifyEdges } from '../../engine/processMining';
import { duration, num, pct } from '../format';

const KEYS: { value: ProcessKey; label: string }[] = [
  { value: 'P2P', label: 'Procure-to-Pay' },
  { value: 'O2C', label: 'Order-to-Cash' },
  { value: 'R2R', label: 'Record-to-Report' },
];

export function ProcessExplorer({ processKey, go, version }: { processKey?: string; go: (v: ViewId, p?: string) => void; version: number }) {
  const key = (KEYS.find((k) => k.value === processKey)?.value ?? 'P2P') as ProcessKey;
  const { data, error } = useApi<ProcessDetail>(`/process/${key}`, version);
  const [coverage, setCoverage] = useState(0.95);
  const [metric, setMetric] = useState<'frequency' | 'time'>('frequency');
  const [narrative, setNarrative] = useState<Narrative | null>(null);
  const [explaining, setExplaining] = useState(false);
  const [explainError, setExplainError] = useState<string | null>(null);

  useEffect(() => { setNarrative(null); setExplainError(null); }, [key, version]);

  const edges = useMemo(() => (data ? simplifyEdges(data.discovery.edges, coverage) : []), [data, coverage]);

  const explain = async () => {
    setExplaining(true);
    setExplainError(null);
    try { setNarrative(await api<Narrative>(`/process/${key}/explain`, { method: 'POST' })); }
    catch (e) { setExplainError((e as Error).message); }
    finally { setExplaining(false); }
  };

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <Segmented label="Process" value={key} options={KEYS} onChange={(k) => go('process', k)} />
        {data && <span className="badge">{data.source === 'upload' ? 'Uploaded event log' : 'Demo event log'} · {num(data.discovery.eventCount)} events</span>}
      </div>
      {error && <ErrorBox message={error} />}
      {!data && !error && <Loading rows={3} />}
      {data && (
        <>
          <div className="grid grid-kpi">
            <Stat label="Cases" value={num(data.discovery.caseCount)} />
            <Stat label="Median cycle time" value={duration(data.discovery.medianCaseHours)} note={`p90 ${duration(data.discovery.p90CaseHours)}`} />
            <Stat label="Variants (top 25 shown)" value={num(data.discovery.variants.length)} note={`Main path covers ${pct(data.discovery.variants[0]?.share ?? 0)}`} />
            <Stat label="Conformance fitness" value={pct(data.conformance.fitness)} note="Cases matching the reference model" tone={data.conformance.fitness < 0.7 ? 'bad' : 'good'} />
            <Stat label="Rework rate" value={pct(data.discovery.reworkRate, 1)} note="Cases repeating a step" />
          </div>

          <div className="grid grid-split">
            <Card title="Discovered process map" sub="Reconstructed from ERP event data — this is how work actually flows"
              actions={<>
                <Segmented label="Edge labels" value={metric} options={[{ value: 'frequency', label: 'Frequency' }, { value: 'time', label: 'Wait time' }]} onChange={setMetric} />
                <label className="small row" style={{ gap: 6 }}>Detail
                  <input type="range" min={0.6} max={1} step={0.01} value={coverage} onChange={(e) => setCoverage(Number(e.target.value))} aria-label="Map detail" />
                </label>
              </>}>
              <ProcessMap activities={data.discovery.activities} edges={edges} exceptionActivities={data.reference.exceptionActivities} metric={metric} />
            </Card>

            <div className="grid" style={{ alignContent: 'start' }}>
              <Card title="AI process analyst" sub="Plain-language explanation of what the data shows"
                actions={<button className="btn primary" onClick={explain} disabled={explaining}>{explaining ? 'Analysing…' : narrative ? 'Re-run' : '✦ Explain this process'}</button>}>
                {explainError && <ErrorBox message={explainError} />}
                {narrative ? (
                  <div className="grid" style={{ gap: 8 }}>
                    <div className="row"><ModeBadge mode={narrative.mode} />{narrative.notice && <span className="small muted">{narrative.notice}</span>}</div>
                    <Markdown text={narrative.text} />
                  </div>
                ) : !explaining && <div className="muted small">Generates a consultant-style summary: how the process really runs, where time is lost, control gaps and the top improvements.</div>}
                {explaining && <Loading />}
              </Card>
              <Card title="Bottlenecks" sub="Frequent hand-offs ranked by total waiting time">
                <HBarChart ariaLabel="Bottleneck median wait" format={duration}
                  data={data.discovery.bottlenecks.map((b) => ({ label: `${b.from} → ${b.to}`, value: b.medianHours, color: 'var(--serious)', detail: `${num(b.count)} cases · p90 ${duration(b.p90Hours)}` }))} />
              </Card>
            </div>
          </div>

          <div className="grid grid-2">
            <Card title="Process variants" sub="Distinct paths cases take through the process">
              <div className="table-wrap">
                <table>
                  <thead><tr><th>#</th><th>Path</th><th className="num">Cases</th><th className="num">Median time</th></tr></thead>
                  <tbody>
                    {data.discovery.variants.slice(0, 10).map((v) => (
                      <tr key={v.id}>
                        <td>{v.id}</td>
                        <td className="small">{v.path.join(' → ')}</td>
                        <td className="num">{num(v.count)} <span className="muted">({pct(v.share)})</span></td>
                        <td className="num">{duration(v.medianDurationHours)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
            <Card title="Deviations from the reference model" sub={`${data.reference.name} best practice vs. your actual behaviour`}>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Deviation</th><th className="num">Cases</th><th>Examples</th></tr></thead>
                  <tbody>
                    {data.conformance.deviations.slice(0, 10).map((d) => (
                      <tr key={d.description}>
                        <td>{d.description}</td>
                        <td className="num">{num(d.cases)} <span className="muted">({pct(d.share)})</span></td>
                        <td className="small mono">{d.sampleCases.slice(0, 2).join(', ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>

          <Card title={`${data.reference.name}: SAP and Oracle mapping`} sub="Reference steps with the transactions and tables where the evidence lives">
            <div className="table-wrap">
              <table>
                <thead><tr><th>Step</th><th>Role</th><th>SAP</th><th>Oracle</th><th>Key control</th></tr></thead>
                <tbody>
                  {data.reference.steps.map((s) => (
                    <tr key={s.activity}>
                      <td><strong>{s.activity}</strong>{!s.mandatory && <span className="muted small"> (optional)</span>}</td>
                      <td>{s.role}</td>
                      <td className="small">{s.sap}</td>
                      <td className="small">{s.oracle}</td>
                      <td className="small">{s.control ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="grid grid-2 small" style={{ marginTop: 12 }}>
              <div><strong>SAP tables:</strong> <span className="muted">{data.reference.sapTables.join(' · ')}</span></div>
              <div><strong>Oracle tables:</strong> <span className="muted">{data.reference.oracleTables.join(' · ')}</span></div>
            </div>
          </Card>
        </>
      )}
    </>
  );
}
