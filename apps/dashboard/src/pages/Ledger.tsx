import { ArrowLeftRight, ListTree, Search, Send } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Card, CardHeader, EmptyState } from '../components/ui';
import { api } from '../lib/api';
import { useData } from '../lib/dataContext';
import { txSize } from '../lib/derive';
import { fmtCurrency, fmtRelativeTime, fmtTime, shortId } from '../lib/format';
import { useToast } from '../lib/toast';

export function Ledger(): React.JSX.Element {
  const { accounts, transactions, txTotal, refresh } = useData();
  const toast = useToast();

  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('100.00');
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');

  const nameOf = useMemo(() => {
    const map = new Map(accounts.map((a) => [a.id, a.name]));
    return (id: string): string => map.get(id) ?? `${shortId(id)}…`;
  }, [accounts]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return transactions;
    return transactions.filter(
      (t) => t.description.toLowerCase().includes(q) || t.id.toLowerCase().includes(q),
    );
  }, [transactions, query]);

  const transfer = async (): Promise<void> => {
    const cents = Math.round(Number(amount) * 100);
    if (!from || !to || from === to || !Number.isFinite(cents) || cents <= 0) return;
    setBusy(true);
    try {
      await api.transfer(from, to, cents, `Transfer to ${nameOf(to)}`);
      toast.push('success', `Transferred ${fmtCurrency(cents)}`);
      await refresh();
    } catch (e) {
      toast.push('error', e instanceof Error ? e.message : 'Transfer failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <Card index={0}>
        <CardHeader title="New transfer" icon={Send} />
        <div className="form-row">
          <select className="input select" value={from} onChange={(e) => setFrom(e.target.value)}>
            <option value="">From account…</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <select className="input select" value={to} onChange={(e) => setTo(e.target.value)}>
            <option value="">To account…</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <div className="input-money">
            <span>$</span>
            <input
              className="input"
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <button
            className="btn btn-primary"
            disabled={busy || !from || !to || from === to}
            onClick={() => void transfer()}
          >
            {busy ? 'Sending…' : 'Send transfer'}
          </button>
        </div>
        <p className="muted small">
          Each transfer is a balanced 2-entry transaction sent with a fresh Idempotency-Key,
          committed at SERIALIZABLE isolation.
        </p>
      </Card>

      <Card index={1}>
        <CardHeader
          title="Transaction ledger"
          icon={ListTree}
          sub={`${txTotal} total · immutable`}
          action={
            <div className="search">
              <Search size={15} />
              <input
                placeholder="Search description or id…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          }
        />

        {filtered.length === 0 ? (
          <EmptyState icon={ListTree} title={query ? 'No matches' : 'No transactions yet'}>
            <p>
              {query
                ? 'Try a different search.'
                : 'Create a transfer above to populate the ledger.'}
            </p>
          </EmptyState>
        ) : (
          <div className="timeline">
            {filtered.map((tx, i) => (
              <div
                key={tx.id}
                className="tx rise"
                style={{ animationDelay: `${Math.min(i * 20, 400)}ms` }}
              >
                <div className="tx-head">
                  <div className="tx-icon">
                    <ArrowLeftRight size={15} />
                  </div>
                  <div className="tx-desc">
                    <span className="tx-title">{tx.description || 'Transaction'}</span>
                    <span className="muted small" title={new Date(tx.created_at).toLocaleString()}>
                      {fmtTime(tx.created_at)} · {fmtRelativeTime(tx.created_at)} · {shortId(tx.id)}
                    </span>
                  </div>
                  <span className="tx-amount mono">{fmtCurrency(txSize(tx))}</span>
                </div>
                <div className="tx-entries">
                  {tx.entries.map((e) => (
                    <span key={e.id} className={`entry entry-${e.direction}`}>
                      <span className="entry-tag">{e.direction === 'debit' ? 'DR' : 'CR'}</span>
                      <span className="entry-acct">{nameOf(e.account_id)}</span>
                      <span className="entry-amt mono">{fmtCurrency(e.amount)}</span>
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
