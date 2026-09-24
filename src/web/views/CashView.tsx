import { useApi, type CashForecast } from '../api';
import { Card, ErrorBox, Loading, Stat } from '../components/ui';
import { GroupedBarChart, HBarChart, LineChart } from '../components/charts';
import { formatOmr, num } from '../format';

export function CashView({ version }: { version: number }) {
  const { data, error } = useApi<CashForecast>('/cash', version);
  if (error) return <ErrorBox message={error} />;
  if (!data) return <Loading rows={3} />;

  const inflow = data.weeks.reduce((s, w) => s + w.inflow, 0);
  const outflow = data.weeks.reduce((s, w) => s + w.outflow, 0);
  const labels = data.weeks.map((w) => `W${w.week}`);

  return (
    <>
      <div className="grid grid-kpi">
        <Stat label="Opening cash" value={formatOmr(data.openingBalance, { compact: true })} />
        <Stat label="Expected receipts (13w)" value={formatOmr(inflow, { compact: true })} />
        <Stat label="Scheduled payments (13w)" value={formatOmr(outflow, { compact: true })} note="Net of 10% WHT withheld" />
        <Stat label="Projected low point" value={formatOmr(data.lowestBalance, { compact: true })} note={`Week ${data.lowestWeek}`} tone={data.lowestBalance < data.openingBalance * 0.5 ? 'bad' : undefined} />
      </div>
      <div className="grid grid-2">
        <Card title="Projected closing balance" sub="Weekly, in OMR">
          <LineChart ariaLabel="Projected weekly closing cash balance" format={(v) => formatOmr(v)}
            points={data.weeks.map((w) => ({ label: `W${w.week}`, value: w.closing }))}
            highlightIndex={data.lowestWeek > 0 ? data.lowestWeek - 1 : undefined} />
        </Card>
        <Card title="Receipts vs payments" sub="Weekly cash in and out, in OMR">
          <GroupedBarChart ariaLabel="Weekly receipts and payments" format={(v) => formatOmr(v)} categories={labels}
            series={[
              { name: 'Receipts', color: 'var(--series-1)', values: data.weeks.map((w) => w.inflow) },
              { name: 'Payments', color: 'var(--series-2)', values: data.weeks.map((w) => w.outflow) },
            ]} />
        </Card>
      </div>
      <div className="grid grid-2">
        <Card title="Learned customer payment behaviour" sub="Average days paid after due date — used to time expected receipts">
          <HBarChart ariaLabel="Average days late by customer" format={(v) => `${v.toFixed(1)} d`}
            data={data.customerBehaviour.map((c) => ({ label: c.name, value: Math.max(0, c.avgDaysLate), detail: `${formatOmr(c.openAmount)} open`, color: c.avgDaysLate > 20 ? 'var(--series-2)' : 'var(--series-1)' }))} />
        </Card>
        <Card title="Weekly detail" sub="Amounts in OMR">
          <div className="table-wrap">
            <table>
              <thead><tr><th>Week</th><th className="num">Receipts</th><th className="num">Payments</th><th className="num">Net</th><th className="num">Closing</th></tr></thead>
              <tbody>
                {data.weeks.map((w) => (
                  <tr key={w.week}>
                    <td style={{ whiteSpace: 'nowrap' }}>W{w.week} <span className="muted small">{w.weekStart.slice(5)}</span></td>
                    <td className="num">{num(w.inflow)}</td>
                    <td className="num">{num(w.outflow)}</td>
                    <td className="num" style={{ color: w.net < 0 ? 'var(--critical)' : undefined }}>{w.net < 0 ? '−' : '+'}{num(Math.abs(w.net))}</td>
                    <td className="num"><strong>{num(w.closing)}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  );
}
