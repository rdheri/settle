import type { OutboxStats } from '../api';
import { fmtInt } from '../format';

export function OutboxCard({ outbox }: { outbox: OutboxStats | null }): React.JSX.Element {
  const pending = outbox?.pending ?? 0;
  return (
    <section className="card">
      <h2>Outbox</h2>
      <div className="stat-row">
        <Stat label="pending" value={outbox ? fmtInt(outbox.pending) : '—'} warn={pending > 0} />
        <Stat label="published" value={outbox ? fmtInt(outbox.published) : '—'} />
      </div>
      <p className="muted small">
        Events are written in the same transaction as the ledger write; a background poller drains
        them (at-least-once, no dual-write race).
      </p>
    </section>
  );
}

function Stat({
  label,
  value,
  warn,
}: {
  label: string;
  value: string;
  warn?: boolean;
}): React.JSX.Element {
  return (
    <div className="stat">
      <span className={`stat-value ${warn ? 'stat-warn' : ''}`}>{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}
