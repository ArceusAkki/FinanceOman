import { Fragment, type ReactNode } from 'react';
import type { Severity } from '../../engine/types';

export function Card({ title, sub, actions, children, className = '' }: { title?: ReactNode; sub?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <div className="card-head">
          <div>
            {title && <h2 className="card-title">{title}</h2>}
            {sub && <div className="card-sub">{sub}</div>}
          </div>
          {actions && <div className="row">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, note, tone, onClick }: { label: string; value: ReactNode; note?: ReactNode; tone?: 'good' | 'bad'; onClick?: () => void }) {
  const body = (
    <>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {note && <div className={`stat-note ${tone ?? ''}`}>{note}</div>}
    </>
  );
  return onClick ? (
    <button className="stat" onClick={onClick} style={{ textAlign: 'left', cursor: 'pointer', font: 'inherit', color: 'inherit' }}>{body}</button>
  ) : <div className="stat">{body}</div>;
}

const SEVERITY_ICON: Record<Severity, string> = { critical: '⛔', high: '▲', medium: '●', low: '○' };

export function severityColor(s: Severity): string {
  return s === 'critical' ? 'var(--critical)' : s === 'high' ? 'var(--serious)' : s === 'medium' ? 'var(--warning)' : 'var(--muted)';
}

/** Status is carried by icon + label, never colour alone. */
export function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <span className="badge" style={{ borderColor: severityColor(severity) }}>
      <span aria-hidden style={{ color: severityColor(severity) }}>{SEVERITY_ICON[severity]}</span>
      {severity.toUpperCase()}
    </span>
  );
}

export function ModeBadge({ mode }: { mode: 'ai' | 'offline' }) {
  return mode === 'ai' ? <span className="badge ai">✦ Claude</span> : <span className="badge">Rules engine</span>;
}

export function Loading({ rows = 1 }: { rows?: number }) {
  return <div className="grid" aria-busy="true">{Array.from({ length: rows }, (_, i) => <div key={i} className="skeleton" />)}</div>;
}

export function ErrorBox({ message }: { message: string }) {
  return <div className="error" role="alert">{message}</div>;
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} aria-pressed={o.value === value} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('`') && part.endsWith('`')) return <code key={i}>{part.slice(1, -1)}</code>;
    return <Fragment key={i}>{part}</Fragment>;
  });
}

/** Minimal, safe markdown renderer (headings, lists, bold, code) — no raw HTML is ever injected. */
export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const items = list.items.map((it, i) => <li key={i}>{inline(it)}</li>);
    blocks.push(list.ordered ? <ol key={blocks.length}>{items}</ol> : <ul key={blocks.length}>{items}</ul>);
    list = null;
  };
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd();
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      const ordered = !!numbered;
      if (!list || list.ordered !== ordered) { flush(); list = { ordered, items: [] }; }
      list.items.push((bullet ?? numbered)![1]);
      continue;
    }
    flush();
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading) blocks.push(<h4 key={blocks.length}>{inline(heading[1])}</h4>);
    else if (line.trim()) blocks.push(<p key={blocks.length}>{inline(line)}</p>);
  }
  flush();
  return <div className="md">{blocks}</div>;
}
