import { useState } from 'react';
import { api, useApi, type ProcessKey, type SourceInfo, type Status } from '../api';
import { Card, ErrorBox, Loading } from '../components/ui';
import { num } from '../format';

interface UploadResult { loaded: number; cases: number; skipped: number; mapping: Record<string, string>; headers: string[]; errors: string[] }

export function DataConnect({ onChange }: { onChange: () => void }) {
  const sources = useApi<SourceInfo[]>('/data/sources');
  const [version, setVersion] = useState(0);
  const status = useApi<Status>('/status', version);
  const [process, setProcess] = useState<ProcessKey>('P2P');
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState('');
  const [result, setResult] = useState<UploadResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onFile = async (file?: File) => {
    if (!file) return;
    if (file.size > 4_000_000) { setError('File is larger than 4 MB — aggregate or filter the extract first.'); return; }
    setFileName(file.name);
    setCsv(await file.text());
    setResult(null);
    setError(null);
  };

  const upload = async () => {
    setBusy(true);
    setError(null);
    try {
      setResult(await api<UploadResult>('/data/upload', { body: { process, csv } }));
      setVersion((v) => v + 1);
      onChange();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  const reset = async () => {
    await api('/data/reset', { method: 'POST' });
    setResult(null);
    setVersion((v) => v + 1);
    onChange();
  };

  return (
    <>
      <div className="grid grid-2">
        <Card title="Load an event log" sub="CSV with one row per event: case id, activity, timestamp (+ optional user and amount). Column names are auto-detected, including SAP (EBELN, BELNR, USNAM, CPUDT) and Oracle (PO_HEADER_ID, CREATED_BY, CREATION_DATE) names.">
          <div className="grid" style={{ gap: 10 }}>
            <label className="row small">Process
              <select value={process} onChange={(e) => setProcess(e.target.value as ProcessKey)} style={{ width: 'auto' }}>
                <option value="P2P">Procure-to-Pay</option><option value="O2C">Order-to-Cash</option><option value="R2R">Record-to-Report</option>
              </select>
            </label>
            <input type="file" accept=".csv,text/csv" onChange={(e) => onFile(e.target.files?.[0])} aria-label="Event log CSV file" />
            {fileName && <div className="small muted">{fileName} · {num(csv.split('\n').length - 1)} rows</div>}
            <div className="row">
              <button className="btn primary" onClick={upload} disabled={!csv || busy}>{busy ? 'Analysing…' : 'Upload & analyse'}</button>
              <a className="btn" href={`/api/data/export/${process}`}>Download sample ({process})</a>
              <button className="btn" onClick={reset}>Reset to demo data</button>
            </div>
            {error && <ErrorBox message={error} />}
            {result && (
              <div className="notice">
                Loaded <strong>{num(result.loaded)}</strong> events across <strong>{num(result.cases)}</strong> cases ({result.skipped} rows skipped).
                <div className="small">Detected columns: {Object.entries(result.mapping).map(([k, v]) => `${k} ← ${v}`).join(' · ')}</div>
                {result.errors.map((e) => <div key={e} className="small">{e}</div>)}
              </div>
            )}
            {status.data && (
              <div className="small muted">Current sources: {Object.entries(status.data.sources).map(([k, v]) => `${k}: ${v}`).join(' · ')}</div>
            )}
          </div>
        </Card>
        <Card title="How to extract from your ERP" sub="Read-only extracts are enough; no write access to production is needed">
          <ol className="small" style={{ paddingLeft: 18, margin: 0, display: 'grid', gap: 6 }}>
            <li><strong>SAP S/4HANA / ECC:</strong> join change documents (CDHDR/CDPOS) and document headers (EKKO, RBKP, BKPF, VBAK) into case/activity/timestamp rows — via an ABAP report, SAP Datasphere, or a CDS view exposed over OData.</li>
            <li><strong>Oracle Fusion:</strong> use BI Publisher / OTBI or BICC extracts of PO, receiving, AP and GL tables with their CREATION_DATE / LAST_UPDATE_DATE audit columns.</li>
            <li><strong>Oracle EBS:</strong> query the base tables (PO_HEADERS_ALL, AP_INVOICES_ALL, GL_JE_HEADERS…) and their approval history (e.g. PO_ACTION_HISTORY).</li>
            <li>Export as CSV (UTF-8), one row per event. Timestamps may be ISO, <code>YYYYMMDDHHMMSS</code> or <code>DD.MM.YYYY HH:MM</code>.</li>
            <li>Keep personal data minimal — user IDs are enough; names are not needed.</li>
          </ol>
        </Card>
      </div>
      <Card title="Where each process lives in SAP and Oracle">
        {!sources.data ? <Loading /> : (
          <div className="grid grid-3">
            {sources.data.map((s) => (
              <div key={s.key} className="small">
                <h3 style={{ fontSize: 14, marginBottom: 6 }}>{s.name}</h3>
                <div><strong>SAP:</strong> <span className="muted">{s.sapTables.join(' · ')}</span></div>
                <div style={{ marginTop: 6 }}><strong>Oracle:</strong> <span className="muted">{s.oracleTables.join(' · ')}</span></div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}
