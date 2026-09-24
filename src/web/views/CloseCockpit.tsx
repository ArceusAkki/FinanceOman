import { useApi, type CloseTaskInsight } from '../api';
import { Card, ErrorBox, Loading, Stat } from '../components/ui';

const RISK_LABEL = { late: '▲ Late', at_risk: '● At risk', on_track: '✓ On track' } as const;
const RISK_COLOR = { late: 'var(--critical)', at_risk: 'var(--warning)', on_track: 'var(--good)' } as const;

export function CloseCockpit({ version }: { version: number }) {
  const { data, error } = useApi<CloseTaskInsight[]>('/close', version);
  if (error) return <ErrorBox message={error} />;
  if (!data) return <Loading rows={2} />;

  const maxDay = Math.max(...data.map((t) => Math.max(t.plannedDay, t.actualDay ?? t.plannedDay)), 1);
  const planned = Math.max(...data.map((t) => t.plannedDay));
  const actual = Math.max(...data.map((t) => t.actualDay ?? t.plannedDay));
  const late = data.filter((t) => t.risk === 'late');
  // A root cause is late itself (not because of a late predecessor) and holds up a downstream task.
  const rootCauses = late.filter((t) =>
    !t.dependsOn.some((d) => late.some((l) => l.id === d)) &&
    data.some((other) => other.dependsOn.includes(t.id) && other.risk !== 'on_track'));

  return (
    <>
      <div className="grid grid-kpi">
        <Stat label="Planned close" value={`WD${planned}`} />
        <Stat label="Actual / forecast close" value={`WD${actual}`} tone={actual > planned ? 'bad' : 'good'} note={actual > planned ? `${actual - planned} day(s) late` : 'On plan'} />
        <Stat label="Late tasks" value={late.length} note={`of ${data.length}`} />
        <Stat label="Root-cause tasks" value={rootCauses.length} note={rootCauses.map((t) => t.name).join(', ') || '—'} />
      </div>
      <Card title="Close timeline" sub="Planned business day (outline) vs actual (filled); ★ marks the critical path">
        <div style={{ display: 'grid', gap: 8 }} role="table" aria-label="Close tasks timeline">
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, 30%) 1fr 110px', gap: 12, fontSize: 11.5 }} className="muted" role="row">
            <span role="columnheader">Task · owner</span>
            <span role="columnheader" style={{ display: 'grid', gridTemplateColumns: `repeat(${maxDay}, 1fr)` }}>
              {Array.from({ length: maxDay }, (_, i) => <span key={i} style={{ textAlign: 'center' }}>WD{i + 1}</span>)}
            </span>
            <span role="columnheader">Status</span>
          </div>
          {data.map((t) => {
            const end = t.actualDay ?? t.plannedDay;
            return (
              <div key={t.id} role="row" style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, 30%) 1fr 110px', gap: 12, alignItems: 'center', fontSize: 13 }}>
                <span role="cell">{t.onCriticalPath && <span title="Critical path" style={{ color: 'var(--accent)' }}>★ </span>}{t.name} <span className="muted small">· {t.owner}</span></span>
                <span role="cell" style={{ position: 'relative', height: 20, background: 'var(--surface-2)', borderRadius: 4 }}>
                  <span style={{ position: 'absolute', left: 0, width: `${(t.plannedDay / maxDay) * 100}%`, top: 0, bottom: 0, border: '1.5px dashed var(--muted)', borderRadius: 4 }} />
                  <span style={{ position: 'absolute', left: 0, width: `${(end / maxDay) * 100}%`, top: 4, bottom: 4, background: t.risk === 'late' ? 'var(--series-2)' : 'var(--series-1)', opacity: t.status === 'done' ? 1 : 0.45, borderRadius: '0 4px 4px 0' }} />
                </span>
                <span role="cell" className="small" style={{ color: RISK_COLOR[t.risk], fontWeight: 600 }}>{RISK_LABEL[t.risk]}{t.slipDays > 0 ? ` +${t.slipDays}d` : ''}</span>
              </div>
            );
          })}
        </div>
        <div className="legend" style={{ marginTop: 12 }}>
          <span><i style={{ background: 'var(--series-1)' }} />Completed on time</span>
          <span><i style={{ background: 'var(--series-2)' }} />Completed late</span>
          <span><i style={{ border: '1.5px dashed var(--muted)' }} />Planned</span>
        </div>
      </Card>
      <Card title="AI recommendations for a faster close">
        <ul className="small" style={{ paddingLeft: 18, margin: 0, display: 'grid', gap: 6 }}>
          {rootCauses.map((t) => <li key={t.id}><strong>{t.name}</strong> slipped {t.slipDays} day(s) and delayed everything downstream. Start it earlier (soft close on WD-2) or automate matching.</li>)}
          <li>Automate <strong>intercompany and bank reconciliations</strong> with rule + ML matching so accountants only work exceptions.</li>
          <li>Generate recurring and accrual journals automatically; route only unusual journals to the controller.</li>
          <li>Use continuous controls (see <em>Controls & Risk</em>) during the month instead of reviewing everything at period-end.</li>
        </ul>
      </Card>
    </>
  );
}
