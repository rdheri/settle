import type {
  AccountResponse,
  BalanceResponse,
  ReconciliationResponse,
  TransactionResponse,
} from '@settle/shared';
import type {
  AccountRow,
  BalanceResult,
  ReconciliationResult,
  TransactionRecord,
} from '../ledger/ledger';

export function serializeAccount(a: AccountRow): AccountResponse {
  return { id: a.id, name: a.name, type: a.type, created_at: a.created_at.toISOString() };
}

export function serializeBalance(b: BalanceResult): BalanceResponse {
  return { account: serializeAccount(b.account), balance: b.balance };
}

export function serializeTransaction(t: TransactionRecord): TransactionResponse {
  return {
    id: t.id,
    idempotency_key: t.idempotency_key,
    description: t.description,
    created_at: t.created_at.toISOString(),
    entries: t.entries.map((e) => ({
      id: e.id,
      account_id: e.account_id,
      amount: e.amount,
      direction: e.direction,
      created_at: e.created_at.toISOString(),
    })),
  };
}

export function serializeReconciliation(r: ReconciliationResult): ReconciliationResponse {
  return {
    balanced: r.balanced,
    global_signed_sum: r.global_signed_sum,
    entry_count: r.entry_count,
    transaction_count: r.transaction_count,
    accounts: r.accounts,
    anomalies: r.anomalies,
  };
}
