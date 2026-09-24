import { useEffect, useRef, useState } from 'react';
import { api, type CopilotResponse } from '../api';
import { Card, ErrorBox, Markdown, ModeBadge } from '../components/ui';

interface Turn { role: 'user' | 'assistant'; content: string; meta?: Omit<CopilotResponse, 'reply'> }

const SUGGESTIONS = [
  'Where are we most exposed to fraud right now?',
  'Why is our P2P cycle so long, and what should we fix first?',
  'Will we have a cash squeeze in the next quarter?',
  'Which invoice exceptions should AP work on today?',
  'What slowed down last month-end close?',
  'Which vendors do we spend most with, and are any foreign service providers missing WHT?',
];

export function Copilot() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' }); }, [turns, busy]);

  const send = async (text: string) => {
    const question = text.trim();
    if (!question || busy) return;
    const history: Turn[] = [...turns, { role: 'user', content: question }];
    setTurns(history);
    setInput('');
    setBusy(true);
    setError(null);
    try {
      const res = await api<CopilotResponse>('/copilot', { body: { messages: history.slice(-20).map(({ role, content }) => ({ role, content })) } });
      const { reply, ...meta } = res;
      setTurns([...history, { role: 'assistant', content: reply, meta }]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <div className="chat">
        <div className="chat-log" ref={logRef} aria-live="polite">
          {!turns.length && (
            <div className="grid" style={{ gap: 14, padding: '24px 4px' }}>
              <div>
                <h2 style={{ fontSize: 18 }}>Ask anything about your finance operations</h2>
                <div className="muted small">The Copilot queries live process-mining, controls, matching, cash and close data. It will not guess numbers it cannot retrieve.</div>
              </div>
              <div className="chips">{SUGGESTIONS.map((s) => <button key={s} className="chip" onClick={() => send(s)}>{s}</button>)}</div>
            </div>
          )}
          {turns.map((t, i) => (
            <div key={i} className={`msg ${t.role}`}>
              {t.role === 'assistant' ? (
                <>
                  <Markdown text={t.content} />
                  {t.meta && (
                    <div className="row small muted" style={{ marginTop: 6 }}>
                      <ModeBadge mode={t.meta.mode} />
                      {t.meta.toolsUsed.length > 0 && <span>Data used: {t.meta.toolsUsed.join(', ')}</span>}
                      {t.meta.notice && <span>{t.meta.notice}</span>}
                    </div>
                  )}
                </>
              ) : t.content}
            </div>
          ))}
          {busy && <div className="msg assistant muted">Looking at your data…</div>}
          {error && <ErrorBox message={error} />}
        </div>
        <form className="row" style={{ flexWrap: 'nowrap', paddingTop: 10, borderTop: '1px solid var(--border)' }} onSubmit={(e) => { e.preventDefault(); send(input); }}>
          <input className="input" value={input} onChange={(e) => setInput(e.target.value)} placeholder="e.g. Which customers should collections call this week?" maxLength={8000} aria-label="Question" />
          <button className="btn primary" type="submit" disabled={busy || !input.trim()}>Send</button>
        </form>
      </div>
    </Card>
  );
}
