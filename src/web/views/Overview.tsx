import { useApi, type Overview as OverviewData } from '../api';
import type { ViewId } from '../App';
import { Card, ErrorBox, Loading, SeverityBadge, Stat, severityColor } from '../components/ui';
import { HBarChart } from '../components/charts';
import { duration, formatOmr, num, pct } from '../format';

export function Overview({ go, version }: { go: (v: ViewId, p?: string) => void; version: number }) {
  const { data, error } = useApi<OverviewData>('/overview', version);
  if (error) return <ErrorBox message={error} />;
  if (!data) return <Loading rows={3} />;
  const k = data.kpis;

  return (
    <>
      <div className="grid grid-kpi">
        <Stat label="Days payable outstanding" value={`${k.dpo} d`} note={`${pct(k.earlyPaymentRate)} paid >5 days early`} onClick={() => go('cash')} />
        <Stat label="Days sales outstanding" value={`${k.dso} d`} note={`${formatOmr(k.overdueArValue, { compact: true })} overdue`} tone={k.dso > 45 ? 'bad' : 'good'} onClick={() => go('cash')} />
        <Stat label="Touchless invoices" value={pct(k.touchlessInvoiceRate)} note="Best-in-class AP runs well above 50%" tone={k.touchlessInvoiceRate < 0.5 ? 'bad' : 'good'} onClick={() => go('matching')} />
        <Stat label="First-pass match rate" value={pct(data.matching.firstPassMatchRate)} note={`${num(data.matching.byStatus.price_variance + data.matching.byStatus.quantity_variance + data.matching.byStatus.missing_receipt)} exceptions`} onClick={() => go('matching')} />
        <Stat label="Days to close" value={`WD${k.daysToClose}`} note="Last month-end close" tone={k.daysToClose > 5 ? 'bad' : 'good'} onClick={() => go('close')} />
        <Stat label="Value flagged for review" value={formatOmr(data.findingTotals.amountAtRisk, { compact: true })} note={`${data.findingTotals.count} open findings`} tone="bad" onClick={() => go('controls')} />
      </div>

      <div className="grid grid-3">
        {data.processes.map((p) => (
          <Card key={p.key} title={p.name} sub={`${num(p.cases)} cases · ${p.variants}+ variants`}
            actions={<button className="btn" onClick={() => go('process', p.key)}>Explore →</button>}>
            <div className="grid grid-2" style={{ gap: 10 }}>
              <div><div className="stat-label">Median cycle time</div><div style={{ fontSize: 20, fontWeight: 700 }}>{duration(p.medianCaseHours)}</div></div>
              <div><div className="stat-label">Follows standard model</div><div style={{ fontSize: 20, fontWeight: 700 }}>{pct(p.fitness)}</div></div>
            </div>
            {p.topBottleneck && (
              <div className="notice" style={{ marginTop: 12 }}>
                <strong>Biggest wait:</strong> {p.topBottleneck.from} → {p.topBottleneck.to} — median {duration(p.topBottleneck.medianHours)} across {num(p.topBottleneck.count)} cases
              </div>
            )}
          </Card>
        ))}
      </div>

      <div className="grid grid-2">
        <Card title="Top control findings" sub="Detected continuously from transactions, not samples" actions={<button className="btn" onClick={() => go('controls')}>All findings →</button>}>
          <div className="grid" style={{ gap: 8 }}>
            {data.findings.map((f) => (
              <div key={f.id} className="finding" style={{ borderLeftColor: severityColor(f.severity) }}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span className="finding-title">{f.title}</span>
                  <SeverityBadge severity={f.severity} />
                </div>
                <div className="finding-detail">{f.type} · {formatOmr(f.amountAtRisk)} at risk</div>
              </div>
            ))}
          </div>
        </Card>
        <div className="grid">
          <Card title="Cash outlook" sub="13-week direct forecast" actions={<button className="btn" onClick={() => go('cash')}>Forecast →</button>}>
            <div className="grid grid-2" style={{ gap: 10 }}>
              <div><div className="stat-label">Cash today</div><div style={{ fontSize: 20, fontWeight: 700 }}>{formatOmr(data.cash.openingBalance, { compact: true })}</div></div>
              <div><div className="stat-label">Projected low (week {data.cash.lowestWeek})</div><div style={{ fontSize: 20, fontWeight: 700, color: data.cash.lowestBalance < data.cash.openingBalance * 0.5 ? 'var(--critical)' : undefined }}>{formatOmr(data.cash.lowestBalance, { compact: true })}</div></div>
            </div>
          </Card>
          <Card title="Top automation opportunities" sub="Estimated analyst hours saved per month" actions={<button className="btn" onClick={() => go('automation')}>Details →</button>}>
            <HBarChart ariaLabel="Hours saved per month by activity" format={(v) => `${num(v, 1)} h`}
              data={data.automation.map((o) => ({ label: `${o.process} · ${o.activity}`, value: o.hoursSavedPerMonth, detail: o.approach }))} />
          </Card>
        </div>
      </div>
    </>
  );
}
