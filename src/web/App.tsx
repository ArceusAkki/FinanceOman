import { useEffect, useState } from 'react';
import { useApi, type Status } from './api';
import { date } from './format';
import { Overview } from './views/Overview';
import { ProcessExplorer } from './views/ProcessExplorer';
import { WorkflowStudio } from './views/WorkflowStudio';
import { Controls } from './views/Controls';
import { Matching } from './views/Matching';
import { CashView } from './views/CashView';
import { CloseCockpit } from './views/CloseCockpit';
import { Automation } from './views/Automation';
import { Copilot } from './views/Copilot';
import { DataConnect } from './views/DataConnect';

export type ViewId = 'overview' | 'process' | 'studio' | 'controls' | 'matching' | 'cash' | 'close' | 'automation' | 'copilot' | 'data';

const NAV: { group: string; items: { id: ViewId; label: string; icon: string; title: string; sub: string }[] }[] = [
  { group: 'Insight', items: [
    { id: 'overview', label: 'Overview', icon: '◧', title: 'Finance overview', sub: 'Health of your finance operations at a glance' },
    { id: 'copilot', label: 'Finance Copilot', icon: '✦', title: 'Finance Copilot', sub: 'Ask questions about your processes, risks and cash' },
  ] },
  { group: 'Understand workflows', items: [
    { id: 'process', label: 'Process Discovery', icon: '⇄', title: 'Process discovery', sub: 'How your P2P, O2C and R2R processes really run, mined from ERP event logs' },
    { id: 'studio', label: 'Workflow Studio', icon: '✎', title: 'Workflow Studio', sub: 'Describe a workflow in plain language — AI maps it to SAP/Oracle and compares it with reality' },
    { id: 'automation', label: 'Automation', icon: '⚙', title: 'Automation opportunities', sub: 'Where AI and workflow automation save the most hours' },
  ] },
  { group: 'Operate', items: [
    { id: 'controls', label: 'Controls & Risk', icon: '⛨', title: 'Controls & fraud risk', sub: 'Continuous control monitoring across payables, journals and tax' },
    { id: 'matching', label: 'Invoice Matching', icon: '≡', title: 'AP invoice matching', sub: 'Three-way match exceptions and AI-suggested resolutions' },
    { id: 'cash', label: 'Cash Forecast', icon: '◔', title: '13-week cash forecast', sub: 'Learned customer payment behaviour applied to open AR and AP' },
    { id: 'close', label: 'Close Cockpit', icon: '◷', title: 'Month-end close cockpit', sub: 'Task slippage and the critical path to a faster close' },
  ] },
  { group: 'Setup', items: [
    { id: 'data', label: 'Data & ERP', icon: '⇪', title: 'Data & ERP connections', sub: 'Load event logs extracted from SAP or Oracle' },
  ] },
];

const ALL = NAV.flatMap((g) => g.items);

function readHash(): { view: ViewId; param?: string } {
  const [view, param] = window.location.hash.replace(/^#\/?/, '').split('/');
  return ALL.some((i) => i.id === view) ? { view: view as ViewId, param } : { view: 'overview' };
}

export function App() {
  const [route, setRoute] = useState(readHash);
  const [dataVersion, setDataVersion] = useState(0);
  const status = useApi<Status>('/status', dataVersion);

  useEffect(() => {
    const onHash = () => setRoute(readHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const go = (view: ViewId, param?: string) => { window.location.hash = `/${view}${param ? `/${param}` : ''}`; };
  const current = ALL.find((i) => i.id === route.view)!;
  const s = status.data;

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark" aria-hidden>
            <svg width="20" height="20" viewBox="0 0 32 32"><path d="M6 23 L13 14 L18 19 L26 8" stroke="white" strokeWidth="3.2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </div>
          <div>
            <div className="brand-name">FinanceOman</div>
            <div className="brand-sub">Finance workflow intelligence</div>
          </div>
        </div>
        <nav className="nav" aria-label="Main">
          {NAV.map((g) => (
            <div key={g.group} style={{ display: 'contents' }}>
              <div className="nav-group">{g.group}</div>
              {g.items.map((item) => (
                <button key={item.id} aria-current={route.view === item.id ? 'page' : undefined} onClick={() => go(item.id)}>
                  <span aria-hidden style={{ width: 16, textAlign: 'center' }}>{item.icon}</span>{item.label}
                </button>
              ))}
            </div>
          ))}
        </nav>
        {s && (
          <div className="sidebar-foot">
            <div><strong style={{ color: '#fff' }}>{s.company.name}</strong></div>
            <div>{s.company.erp} · {s.company.currency}</div>
            <div>{s.aiEnabled ? `✦ AI: ${s.model}` : 'AI offline — rules engine active'}</div>
          </div>
        )}
      </aside>
      <main className="main">
        <header className="topbar">
          <div>
            <h1>{current.title}</h1>
            <div className="sub">{current.sub}</div>
          </div>
          {s && (
            <div className="row small">
              <span className="badge">Data as of {date(s.asOf)}</span>
              {Object.values(s.sources).includes('upload') ? <span className="badge">Includes uploaded logs</span> : <span className="badge">Demo dataset</span>}
              <span className={`badge ${s.aiEnabled ? 'ai' : ''}`}>{s.aiEnabled ? '✦ Claude connected' : 'Offline mode'}</span>
            </div>
          )}
        </header>
        <div className="content">
          {route.view === 'overview' && <Overview go={go} version={dataVersion} />}
          {route.view === 'process' && <ProcessExplorer processKey={route.param} go={go} version={dataVersion} />}
          {route.view === 'studio' && <WorkflowStudio />}
          {route.view === 'controls' && <Controls version={dataVersion} />}
          {route.view === 'matching' && <Matching version={dataVersion} />}
          {route.view === 'cash' && <CashView version={dataVersion} />}
          {route.view === 'close' && <CloseCockpit version={dataVersion} />}
          {route.view === 'automation' && <Automation version={dataVersion} />}
          {route.view === 'copilot' && <Copilot />}
          {route.view === 'data' && <DataConnect onChange={() => setDataVersion((v) => v + 1)} />}
        </div>
      </main>
    </div>
  );
}
