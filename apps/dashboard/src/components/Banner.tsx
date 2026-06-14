import type { ReconciliationResponse } from '../api';
import { fmtInt } from '../format';

export function Banner({ recon }: { recon: ReconciliationResponse | null }): React.JSX.Element {
  if (!recon) {
    return <div className="banner banner-loading">Loading reconciliation…</div>;
  }
  const ok = recon.balanced;
  return (
    <div className={`banner ${ok ? 'banner-ok' : 'banner-drift'}`}>
      <div className="banner-status">{ok ? 'BOOKS BALANCED ✓' : 'DRIFT DETECTED ✗'}</div>
      <div className="banner-metrics">
        <Metric label="global signed sum" value={fmtInt(recon.global_signed_sum)} bad={!ok} />
        <Metric label="transactions" value={fmtInt(recon.transaction_count)} />
        <Metric label="entries" value={fmtInt(recon.entry_count)} />
        <Metric label="accounts" value={fmtInt(recon.accounts.length)} />
      </div>
      {recon.anomalies.length > 0 && (
        <ul className="anomalies">
          {recon.anomalies.map((a, i) => (
            <li key={i}>
              <b>{a.type}</b>: {a.detail}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  bad,
}: {
  label: string;
  value: string;
  bad?: boolean;
}): React.JSX.Element {
  return (
    <div className="metric">
      <span className={`metric-value ${bad ? 'metric-bad' : ''}`}>{value}</span>
      <span className="metric-label">{label}</span>
    </div>
  );
}
