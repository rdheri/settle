import type { ReconciliationAccount } from '../api';
import { fmtMinor } from '../format';

export function AccountsCard({
  accounts,
}: {
  accounts: ReconciliationAccount[];
}): React.JSX.Element {
  return (
    <section className="card">
      <h2>
        Accounts <span className="count">{accounts.length}</span>
      </h2>
      <table className="tbl">
        <thead>
          <tr>
            <th>Name</th>
            <th>Type</th>
            <th className="num">Balance</th>
          </tr>
        </thead>
        <tbody>
          {accounts.map((a) => (
            <tr key={a.id}>
              <td>{a.name}</td>
              <td>
                <span className={`tag tag-${a.type}`}>{a.type}</span>
              </td>
              <td className={`num mono ${a.balance < 0 ? 'neg' : ''}`}>{fmtMinor(a.balance)}</td>
            </tr>
          ))}
          {accounts.length === 0 && (
            <tr>
              <td colSpan={3} className="muted">
                No accounts yet — create one in Actions.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}
