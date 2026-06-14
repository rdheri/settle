import { useState } from 'react';
import type { FormEvent } from 'react';
import type { AccountType, ReconciliationAccount } from '../api';
import { api } from '../api';

const TYPES: AccountType[] = ['asset', 'liability', 'equity', 'revenue', 'expense'];

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function ActionsCard({
  accounts,
  onDone,
}: {
  accounts: ReconciliationAccount[];
  onDone: () => Promise<void> | void;
}): React.JSX.Element {
  const [name, setName] = useState('');
  const [type, setType] = useState<AccountType>('asset');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('1000');
  const [ok, setOk] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function run(fn: () => Promise<unknown>, success: string): Promise<void> {
    try {
      await fn();
      setOk(success);
      setErr(null);
      await onDone();
    } catch (e) {
      setErr(messageOf(e));
      setOk(null);
    }
  }

  const onCreate = (e: FormEvent): void => {
    e.preventDefault();
    void run(() => api.createAccount(name.trim(), type), `created account "${name.trim()}"`);
    setName('');
  };

  const onTransfer = (e: FormEvent): void => {
    e.preventDefault();
    void run(() => api.transfer(from, to, Number(amount)), `transferred ${amount}`);
  };

  return (
    <section className="card">
      <h2>Actions</h2>

      <form className="form" onSubmit={onCreate}>
        <div className="form-row">
          <input
            placeholder="account name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <select value={type} onChange={(e) => setType(e.target.value as AccountType)}>
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <button type="submit" disabled={!name.trim()}>
            Create
          </button>
        </div>
      </form>

      <form className="form" onSubmit={onTransfer}>
        <div className="form-row">
          <select value={from} onChange={(e) => setFrom(e.target.value)} required>
            <option value="">from…</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <select value={to} onChange={(e) => setTo(e.target.value)} required>
            <option value="">to…</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <input type="number" min="1" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <button type="submit" disabled={!from || !to || from === to}>
            Transfer
          </button>
        </div>
      </form>

      {ok && <div className="ok-msg">✓ {ok}</div>}
      {err && <div className="err">⚠ {err}</div>}
      <p className="muted small">
        Each write sends a fresh Idempotency-Key. Amounts are integer minor units (cents).
      </p>
    </section>
  );
}
