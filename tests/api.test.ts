import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

process.env.FINANCEOMAN_OFFLINE = '1';

let server: Server;
let base = '';

beforeAll(async () => {
  const { createApp } = await import('../server/index');
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
afterAll(() => server?.close());

const post = (path: string, body: unknown) => fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

describe('API (offline mode)', () => {
  it('reports status without AI credentials', async () => {
    const s = await (await fetch(`${base}/status`)).json();
    expect(s.aiEnabled).toBe(false);
    expect(s.company.currency).toBe('OMR');
  });

  it('serves the overview and process detail', async () => {
    const o = await (await fetch(`${base}/overview`)).json();
    expect(o.processes).toHaveLength(3);
    const p = await (await fetch(`${base}/process/O2C`)).json();
    expect(p.discovery.caseCount).toBeGreaterThan(0);
    expect(p.reference.key).toBe('O2C');
  });

  it('rejects an unknown process key', async () => {
    expect((await fetch(`${base}/process/XYZ`)).status).toBe(400);
  });

  it('explains a process with the rules engine when AI is offline', async () => {
    const r = await (await post('/process/P2P/explain', {})).json();
    expect(r.mode).toBe('offline');
    expect(r.text).toContain('## How it really runs');
  });

  it('validates copilot input', async () => {
    expect((await post('/copilot', { messages: [] })).status).toBe(400);
    expect((await post('/copilot', { messages: [{ role: 'assistant', content: 'hi' }] })).status).toBe(400);
    const ok = await (await post('/copilot', { messages: [{ role: 'user', content: 'What does our cash forecast look like?' }] })).json();
    expect(ok.mode).toBe('offline');
    expect(ok.reply).toMatch(/cash outlook/i);
  });

  it('interprets a workflow offline and compares it with the event log', async () => {
    const r = await (await post('/workflow/interpret', { text: 'The buyer raises a PO in SAP. The finance manager approves the PO by email. The AP clerk posts the invoice in MIRO. We track blocked invoices in Excel.' })).json();
    expect(r.workflow.process).toBe('P2P');
    expect(r.workflow.steps.map((s: { mappedActivity: string }) => s.mappedActivity)).toContain('Create Purchase Order');
    expect(r.gap.observedNotDocumented).toContain('Record Goods Receipt');
  });

  it('triages a finding', async () => {
    const { findings } = await (await fetch(`${base}/controls`)).json();
    const r = await (await post(`/controls/${encodeURIComponent(findings[0].id)}/triage`, {})).json();
    expect(r.text.length).toBeGreaterThan(20);
    expect((await post('/controls/nope/triage', {})).status).toBe(404);
  });

  it('uploads an event log, then resets to demo data', async () => {
    const csv = 'case_id,activity,timestamp,user\nJ1,Prepare Journal Entry,2026-09-01 08:00,A\nJ1,Post Journal Entry,2026-09-01 09:00,SYSTEM\nJ2,Prepare Journal Entry,2026-09-02 08:00,B';
    const up = await (await post('/data/upload', { process: 'R2R', csv })).json();
    expect(up.loaded).toBe(3);
    expect(up.cases).toBe(2);
    const p = await (await fetch(`${base}/process/R2R`)).json();
    expect(p.source).toBe('upload');
    expect(p.discovery.caseCount).toBe(2);
    await post('/data/reset', {});
    expect((await (await fetch(`${base}/process/R2R`)).json()).source).toBe('demo');
  });

  it('rejects an upload with no usable events', async () => {
    expect((await post('/data/upload', { process: 'P2P', csv: 'a,b,c\n1,2,3' })).status).toBe(422);
  });
});
