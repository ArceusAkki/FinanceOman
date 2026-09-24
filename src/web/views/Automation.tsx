import { useApi, type AutomationOpportunity } from '../api';
import { Card, ErrorBox, Loading, Stat } from '../components/ui';
import { HBarChart } from '../components/charts';
import { num, pct } from '../format';

export function Automation({ version }: { version: number }) {
  const { data, error } = useApi<AutomationOpportunity[]>('/automation', version);
  if (error) return <ErrorBox message={error} />;
  if (!data) return <Loading rows={2} />;

  const hours = data.reduce((s, o) => s + o.hoursSavedPerMonth, 0);
  // ~140 productive hours per FTE per month.
  const fte = hours / 140;

  return (
    <>
      <div className="grid grid-kpi">
        <Stat label="Hours saved / month" value={num(hours)} note="If all opportunities are automated" />
        <Stat label="Capacity released" value={`${fte.toFixed(1)} FTE`} note="Redeploy to analysis & business partnering" />
        <Stat label="Opportunities" value={data.length} />
        <Stat label="Top opportunity" value={data[0] ? `${data[0].score}/100` : '—'} note={data[0]?.activity} />
      </div>
      <div className="grid grid-split-rev">
        <Card title="Hours saved per month" sub="Volume × manual share × automation potential × handling time">
          <HBarChart ariaLabel="Hours saved per month by activity" format={(v) => `${num(v, 1)} h`}
            data={data.slice(0, 12).map((o) => ({ label: `${o.process} · ${o.activity}`, value: o.hoursSavedPerMonth, detail: `${num(o.monthlyVolume)} per month · ${pct(o.manualShare)} manual` }))} />
        </Card>
        <Card title="Opportunity backlog" sub="Ranked by score (hours saved and how rule-based the work is)">
          <div className="table-wrap">
            <table>
              <thead><tr><th>Activity</th><th className="num">Score</th><th className="num">Volume / mo</th><th className="num">Manual</th><th>Recommended approach</th></tr></thead>
              <tbody>
                {data.map((o) => (
                  <tr key={`${o.process}-${o.activity}`}>
                    <td><span className="badge">{o.process}</span> {o.activity}</td>
                    <td className="num"><strong>{o.score}</strong></td>
                    <td className="num">{num(o.monthlyVolume)}</td>
                    <td className="num">{pct(o.manualShare)}</td>
                    <td className="small">{o.approach}</td>
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
