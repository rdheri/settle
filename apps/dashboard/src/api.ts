import type {
  AccountType,
  FaultRunSummary,
  ReconciliationAccount,
  ReconciliationResponse,
  TransactionResponse,
} from '@settle/shared';

export type {
  AccountType,
  FaultRunSummary,
  ReconciliationAccount,
  ReconciliationResponse,
  TransactionResponse,
};

export interface OutboxStats {
  pending: number;
  published: number;
}

const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, init);
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const message = (body as { error?: { message?: string } } | null)?.error?.message;
    throw new Error(message ?? `HTTP ${res.status}`);
  }
  return body as T;
}

function writeHeaders(): Record<string, string> {
  return { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() };
}

export const api = {
  reconciliation: () => request<ReconciliationResponse>('/reconciliation'),
  transactions: (limit = 25) =>
    request<{ transactions: TransactionResponse[] }>(`/transactions?limit=${limit}`),
  outbox: () => request<OutboxStats>('/outbox/stats'),
  faultRun: () => request<FaultRunSummary | null>('/fault-runs/latest'),
  createAccount: (name: string, type: AccountType) =>
    request<unknown>('/accounts', {
      method: 'POST',
      headers: writeHeaders(),
      body: JSON.stringify({ name, type }),
    }),
  transfer: (from: string, to: string, amount: number) =>
    request<unknown>('/transfer', {
      method: 'POST',
      headers: writeHeaders(),
      body: JSON.stringify({ from, to, amount }),
    }),
};
