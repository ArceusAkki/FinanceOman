import { useApi, type Overview as OverviewData, type ProcessKey } from '../api';
import type { ViewId } from '../App';
import type { Severity } from '../../engine/types';
import { ErrorBox, Loading, SeverityBadge, Stat } from '../components/ui';
import { HatchedBarChart } from '../components/charts';
import { Icon, IconDisc, type IconName } from '../components/icons';
import { duration, formatOmr, num, pct } from '../format';

const PROCESS_CARD: Record<ProcessKey, { tone: 'peach' | 'lavender' | 'sage'; icon: IconName }> = {
  P2P: { tone: 'peach', icon: 'receipt' },
  O2C: { tone: 'lavender', icon: 'cash' },
  R2R: { tone: 'sage', icon: 'layers' },
};

const SEVERITY_TONE: Record<Severity, 'mauve' | 'peach' | 'lavender' | 'sage'> = { critical: 'mauve', high: 'peach', medium: 'lavender', low: 'sage' };

const initials = (name: string) => name.replace(/[^A-Za-z ]/g, '').split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
const monthLabel = (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' });
const shortDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Asia/Muscat' });

export function Overview({ go, version }: { go: (v: ViewId, p?: string) => void; version: number }) {
  const { data, error } = useApi<OverviewData>('/overview', version);
  if (error) return <ErrorBox message={error} />;
  if (!data) return <Loading rows={3} />;
  const k = data.kpis;
  const critical = data.findings.filter((f) => f.severity === 'critical').length;
  const posting = data.postingByMonth.map((m) => ({ label: monthLabel(m.month), solid: m.manual, hatched: m.automated }));
  const last = data.postingByMonth[data.postingByMonth.length - 1];
  const lastTouchless = last ? last.automated / Math.max(1, last.automated + last.manual) : 0;

  return (
    <div className="ov">
      <div className="ov-main">
        <section className="ov-hero">
          <div>
            <h2>Cash position {formatOmr(data.cash.openingBalance, { compact: true })}</h2>
            <div className="card-sub">Projected 13-week low {formatOmr(data.cash.lowestBalance, { compact: true })} in week {data.cash.lowestWeek}</div>
          </div>
          <div className="row" style={{ gap: 12 }}>
            <button className="circle-btn" onClick={() => go('process')} aria-label="Process discovery" title="Process discovery"><Icon name="flow" /></button>
            <button className="circle-btn" onClick={() => go('copilot')} aria-label="Ask the Finance Copilot" title="Finance Copilot"><Icon name="chat" /></button>
            <button className="circle-btn" onClick={() => go('data')} aria-label="Load ERP data" title="Load ERP data"><Icon name="upload" /></button>
            <button className="circle-btn filled" onClick={() => go('studio')} aria-label="Map a new workflow" title="Map a new workflow"><Icon name="plus" /></button>
          </div>
        </section>

        <section className="stat-strip" aria-label="Key balances">
          <button className="strip-item" onClick={() => go('cash')}>
            <IconDisc name="wallet" />
            <div><div className="l">Open payables</div><div className="v">{formatOmr(k.openApValue, { compact: true })}</div></div>
          </button>
          <button className="strip-item" onClick={() => go('cash')}>
            <IconDisc name="arrowDownLeft" />
            <div><div className="l">Overdue receivables</div><div className="v">{formatOmr(k.overdueArValue, { compact: true })}</div></div>
          </button>
          <button className="strip-item" onClick={() => go('controls')}>
            <IconDisc name="shield" />
            <div><div className="l">Flagged for review</div><div className="v">{formatOmr(data.findingTotals.amountAtRisk, { compact: true })}</div></div>
          </button>
        </section>

        <section>
          <div className="section-head">
            <h3>Processes</h3>
            <div className="aside">Mined from ERP logs : <button onClick={() => go('process')}>View all</button></div>
          </div>
          <div className="acct-cards">
            {data.processes.map((p) => (
              <button key={p.key} className={`acct ${PROCESS_CARD[p.key].tone}`} onClick={() => go('process', p.key)} aria-label={`${p.name}: median cycle ${duration(p.medianCaseHours)}`}>
                <div className="acct-top"><span>{p.key}</span><Icon name={PROCESS_CARD[p.key].icon} size={22} strokeWidth={2} /></div>
                <div>
                  <div className="acct-value">{duration(p.medianCaseHours)}</div>
                  <div className="acct-sub">{pct(p.fitness)} standard · {num(p.cases)} cases</div>
                </div>
              </button>
            ))}
            <button className="acct mauve" onClick={() => go('controls')} aria-label={`${data.findingTotals.count} control findings`}>
              <div className="acct-top"><span>RISK</span><Icon name="shield" size={22} strokeWidth={2} /></div>
              <div>
                <div className="acct-value">{data.findingTotals.count} findings</div>
                <div className="acct-sub">{critical} critical in top list</div>
              </div>
            </button>
          </div>
        </section>

        <section>
          <div className="section-head">
            <h3>Latest findings</h3>
            <div className="aside"><button onClick={() => go('controls')}>All findings →</button></div>
          </div>
          <div className="tx-list">
            {data.findings.slice(0, 5).map((f, i) => (
              <button key={f.id} className={`tx ${i === 0 ? 'active' : ''}`} onClick={() => go('controls')}>
                <span className="who"><span className={`avatar ${SEVERITY_TONE[f.severity]}`} aria-hidden>{f.severity.slice(0, 2).toUpperCase()}</span><span title={f.title}>{f.title}</span></span>
                <span className="meta"><IconDisc name="alert" size={30} />{f.type}</span>
                <span className="meta"><SeverityBadge severity={f.severity} /></span>
                <span className="amt">{formatOmr(f.amountAtRisk)}</span>
              </button>
            ))}
          </div>
        </section>

        <section>
          <div className="section-head"><h3>Key metrics</h3></div>
          <div className="grid grid-kpi" style={{ gap: 14 }}>
            <Stat label="Days payable outstanding" value={`${k.dpo} d`} note={`${pct(k.earlyPaymentRate)} paid >5 days early`} onClick={() => go('cash')} />
            <Stat label="Days sales outstanding" value={`${k.dso} d`} tone={k.dso > 45 ? 'bad' : 'good'} note={k.dso > 45 ? 'Above 46-day median' : 'Better than median'} onClick={() => go('cash')} />
            <Stat label="Touchless invoices" value={pct(k.touchlessInvoiceRate)} tone={k.touchlessInvoiceRate < 0.5 ? 'bad' : 'good'} note="System-posted, no exception" onClick={() => go('matching')} />
            <Stat label="First-pass match" value={pct(data.matching.firstPassMatchRate)} note="PO · receipt · invoice" onClick={() => go('matching')} />
            <Stat label="Days to close" value={`WD${k.daysToClose}`} tone={k.daysToClose > 5 ? 'bad' : 'good'} note="Last month-end" onClick={() => go('close')} />
          </div>
        </section>
      </div>

      <aside className="ov-side">
        <section className="side-block">
          <h3>Statistics</h3>
          <div className="card-sub" style={{ marginTop: -8, marginBottom: 12 }}>AP invoices posted per month</div>
          <HatchedBarChart ariaLabel="AP invoices posted per month, touchless versus manual" data={posting}
            solidName="Manual posting" hatchedName="Touchless" format={(v) => `${num(v)} invoices`}
            tag={`${pct(lastTouchless)} touchless`} tagIndex={posting.length - 1} />
          <div className="mini-cards">
            <div className="mini">
              <IconDisc name="arrowDownLeft" size={30} tone="lavender" />
              <div><div className="l">Receipts · {data.cashFlows.days}d</div><div className="v">{formatOmr(data.cashFlows.receipts, { compact: true })}</div></div>
            </div>
            <div className="mini">
              <IconDisc name="arrowUpRight" size={30} tone="peach" />
              <div><div className="l">Payments · {data.cashFlows.days}d</div><div className="v">{formatOmr(data.cashFlows.payments, { compact: true })}</div></div>
            </div>
          </div>
        </section>

        <section className="side-block">
          <h3>Scheduled payments</h3>
          <div className="sched">
            {data.upcomingPayments.map((p) => (
              <div key={p.invoiceId} className="sched-row">
                <span className="avatar" aria-hidden>{initials(p.vendorName)}</span>
                <div style={{ minWidth: 0 }}>
                  <div className="n" title={p.vendorName}>{p.vendorName}</div>
                  <div className="d"><Icon name="calendar" size={13} />Due {shortDate(p.dueDate)}</div>
                </div>
                <span className="a">−{formatOmr(p.amount).replace('OMR ', '')}</span>
              </div>
            ))}
            {!data.upcomingPayments.length && <div className="empty">Nothing due.</div>}
          </div>
        </section>

        <section className="promo">
          <h3>Ask the Copilot</h3>
          <p>Cash, fraud risk, bottlenecks — answers grounded in your SAP or Oracle data.</p>
          <button className="btn" onClick={() => go('copilot')}><Icon name="sparkle" size={15} />Open Copilot</button>
          <svg className="arcs" width="200" height="200" viewBox="0 0 200 200" aria-hidden>
            {[40, 65, 90, 115].map((r) => <circle key={r} cx="130" cy="130" r={r} fill="none" stroke="#cbcaf5" strokeWidth="1.2" />)}
          </svg>
        </section>
      </aside>
    </div>
  );
}
