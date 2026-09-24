import { useEffect, useMemo, useRef, useState } from 'react';
import { useApi, type Status } from './api';
import { date } from './format';
import { Icon, type IconName } from './components/icons';
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

interface NavItem { id: ViewId; label: string; icon: IconName; title: string; sub: string }

const NAV: { group: string; items: NavItem[] }[] = [
  { group: 'Insight', items: [
    { id: 'overview', label: 'Dashboard', icon: 'dashboard', title: 'Welcome back', sub: 'Health of your finance operations at a glance' },
    { id: 'copilot', label: 'Finance Copilot', icon: 'chat', title: 'Finance Copilot', sub: 'Ask questions about your processes, risks and cash' },
  ] },
  { group: 'Workflows', items: [
    { id: 'process', label: 'Process Discovery', icon: 'flow', title: 'Process discovery', sub: 'How P2P, O2C and R2R really run, mined from ERP event logs' },
    { id: 'studio', label: 'Workflow Studio', icon: 'pen', title: 'Workflow Studio', sub: 'Describe a workflow; AI maps it to SAP/Oracle and compares it with reality' },
    { id: 'automation', label: 'Automation', icon: 'gear', title: 'Automation', sub: 'Where AI and workflow automation save the most hours' },
  ] },
  { group: 'Operate', items: [
    { id: 'controls', label: 'Controls & Risk', icon: 'shield', title: 'Controls & risk', sub: 'Continuous control monitoring across payables, journals and tax' },
    { id: 'matching', label: 'Invoice Matching', icon: 'receipt', title: 'Invoice matching', sub: 'Three-way match exceptions and suggested resolutions' },
    { id: 'cash', label: 'Cash Forecast', icon: 'cash', title: 'Cash forecast', sub: 'Learned customer payment behaviour applied to open AR and AP' },
    { id: 'close', label: 'Close Cockpit', icon: 'clock', title: 'Close cockpit', sub: 'Task slippage and the critical path to a faster close' },
  ] },
  { group: 'Setup', items: [
    { id: 'data', label: 'Data & ERP', icon: 'upload', title: 'Data & ERP', sub: 'Load event logs extracted from SAP or Oracle' },
  ] },
];

const ALL = NAV.flatMap((g) => g.items);

function readHash(): { view: ViewId; param?: string } {
  const [view, param] = window.location.hash.replace(/^#\/?/, '').split('/');
  return ALL.some((i) => i.id === view) ? { view: view as ViewId, param } : { view: 'overview' };
}

function greeting(): string {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: 'Asia/Muscat' }).format(new Date()));
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
}

function QuickSearch({ go }: { go: (v: ViewId) => void }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const matches = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return [];
    // Rank label matches above matches that only appear in the description.
    const rank = (i: NavItem) => (i.label.toLowerCase().startsWith(t) ? 0 : i.label.toLowerCase().includes(t) ? 1 : 2);
    return ALL.filter((i) => `${i.label} ${i.title} ${i.sub}`.toLowerCase().includes(t)).sort((a, b) => rank(a) - rank(b)).slice(0, 6);
  }, [q]);
  const pick = (id: ViewId) => { go(id); setQ(''); setOpen(false); };
  useEffect(() => {
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  return (
    <div className="searchbox" ref={box}>
      <Icon name="search" size={16} />
      <input value={q} placeholder="Search item" aria-label="Search modules"
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onKeyDown={(e) => { if (e.key === 'Enter' && matches[0]) pick(matches[0].id); if (e.key === 'Escape') setOpen(false); }} />
      {open && matches.length > 0 && (
        <div className="search-results" role="listbox">
          {matches.map((m) => <button key={m.id} role="option" aria-selected={false} onClick={() => pick(m.id)}><Icon name={m.icon} size={16} />{m.label}</button>)}
        </div>
      )}
    </div>
  );
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
  const today = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Muscat' }).format(new Date());

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-name">cogni<span />fi</div>
          <div className="brand-sub">Finance that thinks</div>
        </div>
        <nav className="nav" aria-label="Main">
          {NAV.map((g) => (
            <div key={g.group} style={{ display: 'contents' }}>
              <div className="nav-group">{g.group}</div>
              {g.items.map((item) => (
                <button key={item.id} aria-current={route.view === item.id ? 'page' : undefined} onClick={() => go(item.id)}>
                  <Icon name={item.icon} />{item.label}
                </button>
              ))}
            </div>
          ))}
        </nav>
        {s && (
          <div className="sidebar-foot">
            <strong>{s.company.name}</strong>
            <div>{s.company.erp} · {s.company.currency}</div>
            <div>Data as of {date(s.asOf)}{Object.values(s.sources).includes('upload') ? ' · includes uploads' : ''}</div>
            <div>{s.aiEnabled ? `✦ Claude · ${s.model}` : 'AI offline · rules engine'}</div>
          </div>
        )}
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="topbar-title">
            <div className="greeting">{route.view === 'overview' ? greeting() : current.sub}</div>
            <h1>{current.title}</h1>
          </div>
          <QuickSearch go={(v) => go(v)} />
          <div className="topbar-date">{today}</div>
          <button className="circle-btn" style={{ width: 34, height: 34, borderColor: 'var(--border)' }} onClick={() => go('controls')} aria-label="Open control findings" title="Control findings">
            <Icon name="bell" size={16} />
          </button>
          <div className="user-chip">
            <span className="avatar">FC</span>
            <span className="name">Finance Controller</span>
          </div>
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
