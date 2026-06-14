import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import type {
  FaultRunSummary,
  OutboxStats,
  ReconciliationResponse,
  TransactionResponse,
} from './api';
import { Banner } from './components/Banner';
import { AccountsCard } from './components/AccountsCard';
import { ActionsCard } from './components/ActionsCard';
import { OutboxCard } from './components/OutboxCard';
import { FaultRunCard } from './components/FaultRunCard';
import { LedgerCard } from './components/LedgerCard';

const POLL_MS = 3000;

export function App(): React.JSX.Element {
  const [recon, setRecon] = useState<ReconciliationResponse | null>(null);
  const [txs, setTxs] = useState<TransactionResponse[]>([]);
  const [outbox, setOutbox] = useState<OutboxStats | null>(null);
  const [fault, setFault] = useState<FaultRunSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [r, t, o, f] = await Promise.all([
        api.reconciliation(),
        api.transactions(25),
        api.outbox(),
        api.faultRun(),
      ]);
      setRecon(r);
      setTxs(t.transactions);
      setOutbox(o);
      setFault(f);
      setError(null);
      setUpdatedAt(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const accounts = recon?.accounts ?? [];

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <h1>SETTLE</h1>
          <span className="subtitle">Reconciliation &amp; Audit</span>
        </div>
        <div className="topbar-right">
          {error && <span className="err">⚠ {error}</span>}
          {updatedAt && (
            <span className="muted small">updated {updatedAt.toLocaleTimeString()}</span>
          )}
          <button onClick={() => void refresh()}>Refresh</button>
        </div>
      </header>

      <Banner recon={recon} />

      <div className="grid">
        <AccountsCard accounts={accounts} />
        <div className="col">
          <ActionsCard accounts={accounts} onDone={refresh} />
          <OutboxCard outbox={outbox} />
        </div>
      </div>

      <FaultRunCard fault={fault} />
      <LedgerCard accounts={accounts} txs={txs} />

      <footer className="muted small">
        The books are proven consistent when the global signed sum is 0. Money is integer minor
        units (cents). Entries are append-only and immutable.
      </footer>
    </div>
  );
}
