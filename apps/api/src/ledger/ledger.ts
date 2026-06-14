import type { AccountType, Direction, EntryInput } from '@settle/shared';
import type { PoolClient } from '../db/pool';
import { pgErrorCode } from '../db/tx';
import { InsufficientFundsError, NotFoundError, ValidationError } from './errors';

/**
 * Sign convention: a debit contributes +amount, a credit contributes -amount.
 * An account's balance is the signed sum of its entries. The global signed sum
 * of ALL entries is therefore 0 at all times (every transaction is balanced).
 */
const SIGNED_SUM = `sum(case direction when 'debit' then amount else -amount end)`;

/** Accounts whose balance increases on debit; these may not go negative. */
const DEBIT_NORMAL: ReadonlySet<AccountType> = new Set<AccountType>(['asset', 'expense']);

const FOREIGN_KEY_VIOLATION = '23503';

export interface AccountRow {
  id: string;
  name: string;
  type: AccountType;
  created_at: Date;
}

export interface EntryRow {
  id: string;
  account_id: string;
  amount: number;
  direction: Direction;
  created_at: Date;
}

export interface TransactionRow {
  id: string;
  idempotency_key: string;
  description: string;
  created_at: Date;
}

export interface TransactionRecord extends TransactionRow {
  entries: EntryRow[];
}

export interface CreateAccountInput {
  name: string;
  type: AccountType;
}

export async function createAccount(
  client: PoolClient,
  input: CreateAccountInput,
): Promise<AccountRow> {
  const res = await client.query<AccountRow>(
    `insert into accounts(name, type) values ($1, $2)
     returning id, name, type, created_at`,
    [input.name, input.type],
  );
  return res.rows[0]!;
}

export interface BalanceResult {
  account: AccountRow;
  balance: number;
}

export async function getAccountBalance(
  client: PoolClient,
  accountId: string,
): Promise<BalanceResult> {
  const accRes = await client.query<AccountRow>(
    `select id, name, type, created_at from accounts where id = $1`,
    [accountId],
  );
  const account = accRes.rows[0];
  if (!account) throw new NotFoundError('account', accountId);

  const balRes = await client.query<{ balance: number }>(
    `select coalesce(${SIGNED_SUM}, 0)::bigint as balance from entries where account_id = $1`,
    [accountId],
  );
  return { account, balance: balRes.rows[0]!.balance };
}

/** App-level validation; the DB enforces the same rules as a backstop. */
function validateEntries(entries: EntryInput[]): void {
  if (entries.length < 2) {
    throw new ValidationError('a transaction requires at least 2 entries');
  }
  let debits = 0;
  let credits = 0;
  for (const entry of entries) {
    if (!Number.isSafeInteger(entry.amount) || entry.amount <= 0) {
      throw new ValidationError(
        `entry amount must be a positive integer (minor units), got ${entry.amount}`,
      );
    }
    if (entry.direction === 'debit') debits += entry.amount;
    else credits += entry.amount;
  }
  if (debits !== credits) {
    throw new ValidationError(`unbalanced transaction: debits=${debits} credits=${credits}`);
  }
}

async function assertNoNegativeBalances(client: PoolClient, accountIds: string[]): Promise<void> {
  if (accountIds.length === 0) return;
  const res = await client.query<{ id: string; name: string; balance: number }>(
    `select a.id, a.name,
       coalesce(sum(case e.direction when 'debit' then e.amount else -e.amount end), 0)::bigint as balance
     from accounts a
     left join entries e on e.account_id = a.id
     where a.id = any($1::uuid[]) and a.type = any($2::text[])
     group by a.id, a.name`,
    [accountIds, [...DEBIT_NORMAL]],
  );
  for (const row of res.rows) {
    if (row.balance < 0) {
      throw new InsufficientFundsError(row.id, row.name, row.balance);
    }
  }
}

export interface CreateTransactionInput {
  idempotencyKey: string;
  description?: string;
  entries: EntryInput[];
  /** When false/omitted, debit-normal accounts may not go negative. */
  allowNegative?: boolean;
}

/**
 * Create one balanced, immutable transaction. MUST be called inside a
 * SERIALIZABLE transaction (see withSerializableTx): the non-negative balance
 * check reads current balances and writes entries atomically, so check-then-act
 * cannot race.
 */
export async function createTransaction(
  client: PoolClient,
  input: CreateTransactionInput,
): Promise<TransactionRecord> {
  validateEntries(input.entries);

  const txRes = await client.query<TransactionRow>(
    `insert into transactions(idempotency_key, description) values ($1, $2)
     returning id, idempotency_key, description, created_at`,
    [input.idempotencyKey, input.description ?? ''],
  );
  const tx = txRes.rows[0]!;

  const placeholders: string[] = [];
  const params: unknown[] = [];
  input.entries.forEach((entry, i) => {
    const base = i * 4;
    placeholders.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`);
    params.push(tx.id, entry.account_id, entry.amount, entry.direction);
  });

  let entryRows: EntryRow[];
  try {
    const entryRes = await client.query<EntryRow>(
      `insert into entries(transaction_id, account_id, amount, direction)
       values ${placeholders.join(', ')}
       returning id, account_id, amount, direction, created_at`,
      params,
    );
    entryRows = entryRes.rows;
  } catch (err) {
    if (pgErrorCode(err) === FOREIGN_KEY_VIOLATION) {
      throw new ValidationError('one or more account_id values reference a non-existent account');
    }
    throw err;
  }

  if (!input.allowNegative) {
    const accountIds = [...new Set(input.entries.map((e) => e.account_id))];
    await assertNoNegativeBalances(client, accountIds);
  }

  return { ...tx, entries: entryRows };
}

export interface TransferInput {
  idempotencyKey: string;
  from: string;
  to: string;
  amount: number;
  description?: string;
  allowNegative?: boolean;
}

/** Expand a transfer into a balanced 2-entry transaction (debit dest, credit source). */
export function transferEntries(from: string, to: string, amount: number): EntryInput[] {
  return [
    { account_id: to, amount, direction: 'debit' },
    { account_id: from, amount, direction: 'credit' },
  ];
}

export async function createTransfer(
  client: PoolClient,
  input: TransferInput,
): Promise<TransactionRecord> {
  return createTransaction(client, {
    idempotencyKey: input.idempotencyKey,
    description: input.description ?? `transfer ${input.amount} from ${input.from} to ${input.to}`,
    entries: transferEntries(input.from, input.to, input.amount),
    ...(input.allowNegative !== undefined ? { allowNegative: input.allowNegative } : {}),
  });
}

export async function getTransaction(client: PoolClient, id: string): Promise<TransactionRecord> {
  const txRes = await client.query<TransactionRow>(
    `select id, idempotency_key, description, created_at from transactions where id = $1`,
    [id],
  );
  const tx = txRes.rows[0];
  if (!tx) throw new NotFoundError('transaction', id);

  const entryRes = await client.query<EntryRow>(
    `select id, account_id, amount, direction, created_at from entries
     where transaction_id = $1 order by created_at, id`,
    [id],
  );
  return { ...tx, entries: entryRes.rows };
}

/** All accounts with their derived balance (newest first), for the accounts view. */
export async function listAccounts(
  client: PoolClient,
): Promise<{ id: string; name: string; type: AccountType; created_at: Date; balance: number }[]> {
  const res = await client.query<{
    id: string;
    name: string;
    type: AccountType;
    created_at: Date;
    balance: number;
  }>(
    `select a.id, a.name, a.type, a.created_at,
       coalesce(sum(case e.direction when 'debit' then e.amount else -e.amount end), 0)::bigint as balance
     from accounts a
     left join entries e on e.account_id = a.id
     group by a.id, a.name, a.type, a.created_at
     order by a.created_at, a.id`,
  );
  return res.rows;
}

export interface TransactionPage {
  transactions: TransactionRecord[];
  total: number;
  limit: number;
  offset: number;
}

/** Paginated transactions with their entries, newest first (for the ledger view). */
export async function listTransactions(
  client: PoolClient,
  limit = 50,
  offset = 0,
): Promise<TransactionPage> {
  const totalRes = await client.query<{ count: number }>(
    `select count(*)::int as count from transactions`,
  );
  const total = totalRes.rows[0]!.count;

  const txRes = await client.query<TransactionRow>(
    `select id, idempotency_key, description, created_at from transactions
     order by created_at desc, id desc limit $1 offset $2`,
    [limit, offset],
  );
  if (txRes.rows.length === 0) return { transactions: [], total, limit, offset };

  const ids = txRes.rows.map((t) => t.id);
  const entryRes = await client.query<EntryRow & { transaction_id: string }>(
    `select id, transaction_id, account_id, amount, direction, created_at from entries
     where transaction_id = any($1::uuid[]) order by created_at, id`,
    [ids],
  );

  const byTx = new Map<string, EntryRow[]>();
  for (const row of entryRes.rows) {
    const { transaction_id, ...entry } = row;
    const list = byTx.get(transaction_id) ?? [];
    list.push(entry);
    byTx.set(transaction_id, list);
  }

  const transactions = txRes.rows.map((t) => ({ ...t, entries: byTx.get(t.id) ?? [] }));
  return { transactions, total, limit, offset };
}

export interface ReconciliationResult {
  balanced: boolean;
  global_signed_sum: number;
  entry_count: number;
  transaction_count: number;
  accounts: { id: string; name: string; type: AccountType; balance: number }[];
  anomalies: { type: string; detail: string }[];
}

/** The proof endpoint: global signed sum (must be 0) + per-account balances. */
export async function getReconciliation(client: PoolClient): Promise<ReconciliationResult> {
  const totalsRes = await client.query<{
    sum: number;
    entry_count: number;
    transaction_count: number;
  }>(
    `select
       coalesce(${SIGNED_SUM}, 0)::bigint as sum,
       count(*)::int as entry_count,
       count(distinct transaction_id)::int as transaction_count
     from entries`,
  );
  const totals = totalsRes.rows[0]!;

  const accountsRes = await client.query<{
    id: string;
    name: string;
    type: AccountType;
    balance: number;
  }>(
    `select a.id, a.name, a.type,
       coalesce(sum(case e.direction when 'debit' then e.amount else -e.amount end), 0)::bigint as balance
     from accounts a
     left join entries e on e.account_id = a.id
     group by a.id, a.name, a.type
     order by a.created_at, a.id`,
  );

  const unbalancedRes = await client.query<{ transaction_id: string; net: number }>(
    `select transaction_id, ${SIGNED_SUM}::bigint as net
     from entries
     group by transaction_id
     having ${SIGNED_SUM} <> 0`,
  );

  const anomalies: { type: string; detail: string }[] = [];
  if (totals.sum !== 0) {
    anomalies.push({
      type: 'global_drift',
      detail: `global signed sum is ${totals.sum}, expected 0`,
    });
  }
  for (const row of unbalancedRes.rows) {
    anomalies.push({
      type: 'unbalanced_transaction',
      detail: `transaction ${row.transaction_id} nets ${row.net}, expected 0`,
    });
  }

  return {
    balanced: anomalies.length === 0,
    global_signed_sum: totals.sum,
    entry_count: totals.entry_count,
    transaction_count: totals.transaction_count,
    accounts: accountsRes.rows,
    anomalies,
  };
}
