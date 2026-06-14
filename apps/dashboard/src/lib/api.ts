import type {
  AccountResponse,
  AccountType,
  CreateTransactionRequest,
  FaultRunSummary,
  ReconciliationResponse,
  TransactionResponse,
} from '@settle/shared';

export type {
  AccountResponse,
  AccountType,
  FaultRunSummary,
  ReconciliationResponse,
  TransactionResponse,
};

export interface AccountWithBalance {
  id: string;
  name: string;
  type: AccountType;
  created_at: string;
  balance: number;
}

export interface OutboxStats {
  pending: number;
  published: number;
}

export interface ApiMetrics {
  serialization_retries: number;
  deadlock_retries: number;
  outbox_published: number;
}

export interface TransactionsPage {
  transactions: TransactionResponse[];
  total: number;
  limit: number;
  offset: number;
}

const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, init);
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const err = (body as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiError(res.status, err?.code ?? 'error', err?.message ?? `HTTP ${res.status}`);
  }
  return body as T;
}

function writeHeaders(): Record<string, string> {
  return { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() };
}

export const api = {
  reconciliation: () => request<ReconciliationResponse>('/reconciliation'),
  accounts: () => request<{ accounts: AccountWithBalance[] }>('/accounts'),
  transactions: (limit = 50, offset = 0) =>
    request<TransactionsPage>(`/transactions?limit=${limit}&offset=${offset}`),
  outbox: () => request<OutboxStats>('/outbox/stats'),
  metrics: () => request<ApiMetrics>('/metrics'),
  faultRun: () => request<FaultRunSummary | null>('/fault-runs/latest'),

  createAccount: (name: string, type: AccountType) =>
    request<AccountResponse>('/accounts', {
      method: 'POST',
      headers: writeHeaders(),
      body: JSON.stringify({ name, type }),
    }),
  createTransaction: (req: CreateTransactionRequest) =>
    request<TransactionResponse>('/transactions', {
      method: 'POST',
      headers: writeHeaders(),
      body: JSON.stringify(req),
    }),
  transfer: (from: string, to: string, amount: number, description?: string) =>
    request<TransactionResponse>('/transfer', {
      method: 'POST',
      headers: writeHeaders(),
      body: JSON.stringify({ from, to, amount, description }),
    }),
};
