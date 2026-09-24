import { useState } from 'react';
import { useApi, type MatchStatus, type MatchingData } from '../api';
import { Card, ErrorBox, Loading, Stat } from '../components/ui';
import { HBarChart } from '../components/charts';
import { formatOmr, num, pct } from '../format';

const LABEL: Record<MatchStatus, string> = {
  matched: 'Matched',
  price_variance: 'Price variance',
  quantity_variance: 'Quantity variance',
  missing_receipt: 'Missing goods receipt',
  no_po: 'No purchase order',
};

export function Matching({ version }: { version: number }) {
  const { data, error } = useApi<MatchingData>('/matching', version);
  const [status, setStatus] = useState<MatchStatus | 'exceptions'>('exceptions');
  if (error) return <ErrorBox message={error} />;
  if (!data) return <Loading rows={3} />;

  const rows = data.results.filter((r) => (status === 'exceptions' ? r.status !== 'matched' : r.status === status));
  const exceptions = data.results.length - data.byStatus.matched;

  return (
    <>
      <div className="grid grid-kpi">
        <Stat label="Invoices checked" value={num(data.results.length)} />
        <Stat label="First-pass match rate" value={pct(data.firstPassMatchRate)} tone={data.firstPassMatchRate < 0.85 ? 'bad' : 'good'} note="Target ≥ 85%" />
        <Stat label="Exceptions" value={num(exceptions)} note={`${formatOmr(data.exceptionValue, { compact: true })} held`} tone="bad" />
        <Stat label="Tolerance" value="±2% price" note="Exact quantity vs. goods receipt" />
      </div>
      <div className="grid grid-split-rev">
        <Card title="Match outcomes" sub="PO ↔ goods receipt ↔ invoice">
          <HBarChart ariaLabel="Invoices by match status" format={(v) => num(v)}
            data={(Object.keys(LABEL) as MatchStatus[]).map((k) => ({ label: LABEL[k], value: data.byStatus[k], color: k === 'matched' ? 'var(--series-3)' : 'var(--series-2)' }))} />
          <div className="notice" style={{ marginTop: 14 }}>
            Exceptions are where AP time goes. The AI suggests a resolution for each and routes it to the right owner — buyer for price, warehouse for receipts, requester for non-PO spend.
          </div>
        </Card>
        <Card title="Exception worklist" sub="Suggested next action per invoice"
          actions={
            <select value={status} onChange={(e) => setStatus(e.target.value as MatchStatus | 'exceptions')} style={{ width: 'auto' }} aria-label="Filter by status">
              <option value="exceptions">All exceptions ({exceptions})</option>
              {(Object.keys(LABEL) as MatchStatus[]).map((k) => <option key={k} value={k}>{LABEL[k]} ({data.byStatus[k]})</option>)}
            </select>
          }>
          <div className="table-wrap" style={{ maxHeight: 520, overflowY: 'auto' }}>
            <table>
              <thead><tr><th>Invoice</th><th>Vendor</th><th>Status</th><th className="num">Variance</th><th className="num">Amount</th><th>Suggested action</th></tr></thead>
              <tbody>
                {rows.slice(0, 150).map((r) => (
                  <tr key={r.invoiceId}>
                    <td className="mono small">{r.invoiceNumber}<div className="muted">PO {r.poId ?? '—'}</div></td>
                    <td className="small">{r.vendorName}</td>
                    <td><span className="badge">{LABEL[r.status]}</span></td>
                    <td className="num small">{r.status === 'price_variance' ? `${r.priceVariancePct > 0 ? '+' : ''}${r.priceVariancePct}%` : r.status === 'quantity_variance' ? `+${r.qtyVariance} units` : '—'}</td>
                    <td className="num small">{formatOmr(r.amount)}</td>
                    <td className="small">{r.suggestion}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!rows.length && <div className="empty">Nothing here.</div>}
          </div>
        </Card>
      </div>
    </>
  );
}
