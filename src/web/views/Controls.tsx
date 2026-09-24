import { useMemo, useState } from 'react';
import { api, useApi, type ControlsData, type Finding, type Narrative } from '../api';
import { Card, ErrorBox, Loading, Markdown, ModeBadge, SeverityBadge, Stat, severityColor } from '../components/ui';
import { GroupedBarChart } from '../components/charts';
import { formatOmr, pct } from '../format';

function FindingCard({ finding }: { finding: Finding }) {
  const [triage, setTriage] = useState<Narrative | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setBusy(true);
    setError(null);
    try { setTriage(await api<Narrative>(`/controls/${encodeURIComponent(finding.id)}/triage`, { method: 'POST' })); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <div className="finding" style={{ borderLeftColor: severityColor(finding.severity) }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="finding-title">{finding.title}</span>
        <div className="row"><span className="badge">{finding.type}</span><SeverityBadge severity={finding.severity} /></div>
      </div>
      <div className="finding-detail">{finding.detail}</div>
      <div className="row small" style={{ justifyContent: 'space-between' }}>
        <span><strong>{formatOmr(finding.amountAtRisk)}</strong> at risk · <span className="mono muted">{finding.refs.slice(0, 4).join(', ')}{finding.refs.length > 4 ? ` +${finding.refs.length - 4}` : ''}</span></span>
        {!triage && <button className="btn" onClick={run} disabled={busy}>{busy ? 'Triaging…' : '✦ Triage'}</button>}
      </div>
      {error && <ErrorBox message={error} />}
      {triage && (
        <div className="notice" style={{ background: 'var(--surface-2)' }}>
          <div className="row" style={{ marginBottom: 6 }}><ModeBadge mode={triage.mode} />{triage.notice && <span className="small muted">{triage.notice}</span>}</div>
          <Markdown text={triage.text} />
        </div>
      )}
    </div>
  );
}

export function Controls({ version }: { version: number }) {
  const { data, error } = useApi<ControlsData>('/controls', version);
  const [type, setType] = useState('all');
  const [benfordSet, setBenfordSet] = useState<'manual' | 'all'>('manual');
  const types = useMemo(() => [...new Set(data?.findings.map((f) => f.type) ?? [])], [data]);
  if (error) return <ErrorBox message={error} />;
  if (!data) return <Loading rows={3} />;

  const shown = data.findings.filter((f) => type === 'all' || f.type === type);
  const total = data.findings.reduce((s, f) => s + f.amountAtRisk, 0);
  const count = (sev: string) => data.findings.filter((f) => f.severity === sev).length;
  const benford = benfordSet === 'manual' ? data.benfordManual : data.benford;

  return (
    <>
      <div className="grid grid-kpi">
        <Stat label="Open findings" value={data.findings.length} note={`${count('critical')} critical · ${count('high')} high`} />
        <Stat label="Value flagged for review" value={formatOmr(total, { compact: true })} tone="bad" note="Sum of amounts flagged" />
        <Stat label="Benford (manual journals)" value={data.benfordManual.conformity} note={`MAD ${data.benfordManual.mad} · n=${data.benfordManual.sampleSize}`} tone={data.benfordManual.conformity === 'nonconformity' ? 'bad' : 'good'} />
        <Stat label="Tests running" value="11" note="Duplicates, SoD, split POs, bank changes, JE timing, VAT/WHT, Fawtara…" />
      </div>

      <div className="grid grid-split">
        <Card title="Findings" sub="Each finding links to source documents; AI triage suggests explanations and evidence to pull"
          actions={
            <select value={type} onChange={(e) => setType(e.target.value)} style={{ width: 'auto' }} aria-label="Filter by type">
              <option value="all">All types ({data.findings.length})</option>
              {types.map((t) => <option key={t} value={t}>{t} ({data.findings.filter((f) => f.type === t).length})</option>)}
            </select>
          }>
          <div className="grid" style={{ gap: 10 }}>
            {shown.map((f) => <FindingCard key={f.id} finding={f} />)}
            {!shown.length && <div className="empty">No findings of this type.</div>}
          </div>
        </Card>

        <div className="grid" style={{ alignContent: 'start' }}>
          <Card title="Benford's law — first digits" sub="Natural ledgers follow Benford's distribution; deviations flag fabricated or plugged amounts"
            actions={<select value={benfordSet} onChange={(e) => setBenfordSet(e.target.value as 'manual' | 'all')} style={{ width: 'auto' }} aria-label="Journal population">
              <option value="manual">Manual journals</option><option value="all">All journals</option>
            </select>}>
            <GroupedBarChart ariaLabel="Observed vs expected first-digit distribution" format={(v) => pct(v, 1)} height={210}
              categories={benford.digits.map((d) => String(d.digit))}
              series={[
                { name: 'Observed', color: 'var(--series-1)', values: benford.digits.map((d) => d.observed) },
                { name: 'Benford expected', color: 'var(--series-2)', values: benford.digits.map((d) => d.expected), kind: 'marker' },
              ]} />
            <div className="small muted" style={{ marginTop: 6 }}>
              Mean absolute deviation {benford.mad} → <strong>{benford.conformity}</strong> (Nigrini thresholds: &lt;0.006 close, &lt;0.012 acceptable, &lt;0.015 marginal).
            </div>
          </Card>
          <Card title="What is tested" sub="Rules tuned for Omani regulations and ERP data">
            <ul className="small" style={{ paddingLeft: 18, margin: 0, display: 'grid', gap: 4 }}>
              <li><strong>Duplicate invoices</strong> — fuzzy invoice-number match, same vendor & amount</li>
              <li><strong>Split POs</strong> — clusters just below the release threshold</li>
              <li><strong>Segregation of duties</strong> — create/approve PO, post/pay invoice by same user</li>
              <li><strong>Vendor bank changes</strong> followed by payments within 30 days</li>
              <li><strong>Journal red flags</strong> — Fri/Sat (Omani weekend), after-hours, round amounts</li>
              <li><strong>VAT 5% / WHT 10%</strong> — mismatches and missing withholding on non-residents</li>
              <li><strong>After-the-fact POs</strong> and <strong>Fawtara</strong> e-invoicing readiness</li>
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
