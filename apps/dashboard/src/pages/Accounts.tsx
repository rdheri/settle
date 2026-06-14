import { Plus, Wallet } from 'lucide-react';
import { useState } from 'react';
import { Card, CardHeader, EmptyState, TypeBadge } from '../components/ui';
import { api } from '../lib/api';
import type { AccountType } from '../lib/api';
import { useData } from '../lib/dataContext';
import { fmtCurrency } from '../lib/format';
import { TYPE_COLORS } from '../lib/palette';
import { useToast } from '../lib/toast';

const TYPES: AccountType[] = ['asset', 'liability', 'equity', 'revenue', 'expense'];

export function Accounts(): React.JSX.Element {
  const { accounts, refresh } = useData();
  const toast = useToast();
  const [name, setName] = useState('');
  const [type, setType] = useState<AccountType>('asset');
  const [busy, setBusy] = useState(false);

  const maxAbs = Math.max(1, ...accounts.map((a) => Math.abs(a.balance)));

  const create = async (): Promise<void> => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await api.createAccount(name.trim(), type);
      toast.push('success', `Created “${name.trim()}”`);
      setName('');
      await refresh();
    } catch (e) {
      toast.push('error', e instanceof Error ? e.message : 'Failed to create account');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <Card index={0}>
        <CardHeader title="New account" icon={Plus} />
        <div className="form-row">
          <input
            className="input"
            placeholder="Account name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void create()}
          />
          <select
            className="input select"
            value={type}
            onChange={(e) => setType(e.target.value as AccountType)}
          >
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <button
            className="btn btn-primary"
            disabled={busy || !name.trim()}
            onClick={() => void create()}
          >
            {busy ? 'Creating…' : 'Create account'}
          </button>
        </div>
      </Card>

      <Card index={1}>
        <CardHeader title="Chart of accounts" icon={Wallet} sub={`${accounts.length} accounts`} />
        {accounts.length === 0 ? (
          <EmptyState icon={Wallet} title="No accounts yet">
            <p>Create your first account above, or generate a sample ledger from the Overview.</p>
          </EmptyState>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Account</th>
                <th>Type</th>
                <th className="num">Balance</th>
                <th className="bar-col">Magnitude</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => {
                const pct = (Math.abs(a.balance) / maxAbs) * 100;
                const positive = a.balance >= 0;
                return (
                  <tr key={a.id}>
                    <td className="strong">{a.name}</td>
                    <td>
                      <TypeBadge type={a.type} />
                    </td>
                    <td className={`num mono ${a.balance < 0 ? 'neg' : ''}`}>
                      {fmtCurrency(a.balance)}
                    </td>
                    <td className="bar-col">
                      <div className="bar-track">
                        <div
                          className="bar-fill"
                          style={{
                            width: `${pct}%`,
                            background: positive ? TYPE_COLORS[a.type] : '#fb7185',
                          }}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
