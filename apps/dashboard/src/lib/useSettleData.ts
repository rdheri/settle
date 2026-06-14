import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import type {
  AccountWithBalance,
  ApiMetrics,
  FaultRunSummary,
  OutboxStats,
  ReconciliationResponse,
  TransactionResponse,
} from './api';

export interface SettleData {
  recon: ReconciliationResponse | null;
  accounts: AccountWithBalance[];
  transactions: TransactionResponse[];
  txTotal: number;
  outbox: OutboxStats | null;
  metrics: ApiMetrics | null;
  fault: FaultRunSummary | null;
  loading: boolean;
  error: string | null;
  lastUpdated: Date | null;
  refresh: () => Promise<void>;
}

const POLL_MS = 4000;

export function useSettleData(): SettleData {
  const [recon, setRecon] = useState<ReconciliationResponse | null>(null);
  const [accounts, setAccounts] = useState<AccountWithBalance[]>([]);
  const [transactions, setTransactions] = useState<TransactionResponse[]>([]);
  const [txTotal, setTxTotal] = useState(0);
  const [outbox, setOutbox] = useState<OutboxStats | null>(null);
  const [metrics, setMetrics] = useState<ApiMetrics | null>(null);
  const [fault, setFault] = useState<FaultRunSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const [r, a, t, o, m, f] = await Promise.all([
        api.reconciliation(),
        api.accounts(),
        api.transactions(120),
        api.outbox(),
        api.metrics(),
        api.faultRun(),
      ]);
      setRecon(r);
      setAccounts(a.accounts);
      setTransactions(t.transactions);
      setTxTotal(t.total);
      setOutbox(o);
      setMetrics(m);
      setFault(f);
      setError(null);
      setLastUpdated(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  return {
    recon,
    accounts,
    transactions,
    txTotal,
    outbox,
    metrics,
    fault,
    loading,
    error,
    lastUpdated,
    refresh,
  };
}
