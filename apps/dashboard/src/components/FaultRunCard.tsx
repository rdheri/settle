import type { FaultRunSummary } from '../api';
import { fmtInt } from '../format';

export function FaultRunCard({ fault }: { fault: FaultRunSummary | null }): React.JSX.Element {
  return (
    <section className="card">
      <h2>
        Fault-Injection Harness <span className="count">latest run</span>
      </h2>
      {!fault ? (
        <p className="muted">
          No run recorded yet. Run <code>pnpm harness</code> to populate this panel.
        </p>
      ) : (
        <>
          <div className={`harness-status ${fault.passed ? 'banner-ok' : 'banner-drift'}`}>
            {fault.passed ? 'ALL GUARANTEES HELD ✓' : 'FAILURE DETECTED ✗'}
          </div>
          <div className="kpis">
            <Kpi label="operations attempted" value={fmtInt(fault.operations_attempted)} />
            <Kpi label="applied exactly once" value={fmtInt(fault.applied_exactly_once)} />
            <Kpi
              label="duplicates short-circuited"
              value={fmtInt(fault.duplicates_short_circuited)}
            />
            <Kpi label="serialization retries" value={fmtInt(fault.serialization_retries)} />
            <Kpi
              label="final balance drift"
              value={fmtInt(fault.final_balance_drift)}
              bad={fault.final_balance_drift !== 0}
            />
            <Kpi label="throughput (ops/s)" value={fmtInt(Math.round(fault.throughput_per_sec))} />
          </div>
          <table className="tbl">
            <thead>
              <tr>
                <th>Scenario</th>
                <th>Result</th>
                <th>Metrics</th>
              </tr>
            </thead>
            <tbody>
              {fault.scenarios.map((s, i) => (
                <tr key={i}>
                  <td>
                    {s.name}
                    <div className="muted small">{s.description}</div>
                  </td>
                  <td>
                    {s.passed ? (
                      <span className="pass">PASS</span>
                    ) : (
                      <span className="fail">FAIL</span>
                    )}
                  </td>
                  <td className="mono small">
                    {Object.entries(s.metrics)
                      .map(([k, v]) => `${k}=${v}`)
                      .join('   ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted small">
            Finished {new Date(fault.finished_at).toLocaleString()} · {fmtInt(fault.duration_ms)} ms
          </p>
        </>
      )}
    </section>
  );
}

function Kpi({
  label,
  value,
  bad,
}: {
  label: string;
  value: string;
  bad?: boolean;
}): React.JSX.Element {
  return (
    <div className="kpi">
      <span className={`kpi-value ${bad ? 'metric-bad' : ''}`}>{value}</span>
      <span className="kpi-label">{label}</span>
    </div>
  );
}
