import type { ReconciliationAccount, TransactionResponse } from '../api';
import { fmtMinor } from '../format';

export function LedgerCard({
  accounts,
  txs,
}: {
  accounts: ReconciliationAccount[];
  txs: TransactionResponse[];
}): React.JSX.Element {
  const nameOf = (id: string): string =>
    accounts.find((a) => a.id === id)?.name ?? `${id.slice(0, 8)}…`;

  return (
    <section className="card">
      <h2>
        Ledger <span className="count">{txs.length}</span>{' '}
        <span className="muted small">immutable history</span>
      </h2>
      <table className="tbl ledger">
        <thead>
          <tr>
            <th>When</th>
            <th>Description</th>
            <th>Entries</th>
          </tr>
        </thead>
        <tbody>
          {txs.map((t) => (
            <tr key={t.id}>
              <td className="mono small nowrap">{new Date(t.created_at).toLocaleTimeString()}</td>
              <td>{t.description || <span className="muted">—</span>}</td>
              <td className="entries">
                {t.entries.map((e) => (
                  <span key={e.id} className={`entry entry-${e.direction}`}>
                    <span className="entry-dir">{e.direction === 'debit' ? 'DR' : 'CR'}</span>
                    {nameOf(e.account_id)}
                    <span className="mono">{fmtMinor(e.amount)}</span>
                  </span>
                ))}
              </td>
            </tr>
          ))}
          {txs.length === 0 && (
            <tr>
              <td colSpan={3} className="muted">
                No transactions yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}
