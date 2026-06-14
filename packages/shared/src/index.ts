import { z } from 'zod';

/**
 * SETTLE shared contracts — request/response schemas and types shared by the API
 * and the dashboard.
 *
 * Money is ALWAYS an integer number of minor units (e.g. cents), validated as a
 * safe integer so a float can never enter the system. At the database layer the
 * corresponding column is BIGINT. The wire format is snake_case to match the SQL
 * columns and minimize transformation on the money path.
 */

/** Integer minor units (cents). May be negative (balances); never a float. */
export const Money = z.number().int().safe();
export type Money = z.infer<typeof Money>;

/** A money *amount* on an entry: strictly positive integer minor units. */
export const PositiveMoney = z.number().int().positive().safe();

export const AccountType = z.enum(['asset', 'liability', 'equity', 'revenue', 'expense']);
export type AccountType = z.infer<typeof AccountType>;

export const Direction = z.enum(['debit', 'credit']);
export type Direction = z.infer<typeof Direction>;

export const Uuid = z.string().uuid();

// --- Requests ---------------------------------------------------------------

export const CreateAccountRequest = z.object({
  name: z.string().min(1),
  type: AccountType,
});
export type CreateAccountRequest = z.infer<typeof CreateAccountRequest>;

export const EntryInput = z.object({
  account_id: Uuid,
  amount: PositiveMoney,
  direction: Direction,
});
export type EntryInput = z.infer<typeof EntryInput>;

export const CreateTransactionRequest = z.object({
  description: z.string().optional(),
  entries: z.array(EntryInput).min(2),
  /** Opt out of the non-negative balance rule on debit-normal accounts. */
  allow_negative: z.boolean().optional(),
});
export type CreateTransactionRequest = z.infer<typeof CreateTransactionRequest>;

export const TransferRequest = z.object({
  from: Uuid,
  to: Uuid,
  amount: PositiveMoney,
  description: z.string().optional(),
  allow_negative: z.boolean().optional(),
});
export type TransferRequest = z.infer<typeof TransferRequest>;

// --- Responses --------------------------------------------------------------

export interface AccountResponse {
  id: string;
  name: string;
  type: AccountType;
  created_at: string;
}

export interface BalanceResponse {
  account: AccountResponse;
  balance: Money;
}

export interface EntryResponse {
  id: string;
  account_id: string;
  amount: Money;
  direction: Direction;
  created_at: string;
}

export interface TransactionResponse {
  id: string;
  idempotency_key: string;
  description: string;
  created_at: string;
  entries: EntryResponse[];
}

export interface ReconciliationAccount {
  id: string;
  name: string;
  type: AccountType;
  balance: Money;
}

export interface Anomaly {
  type: string;
  detail: string;
}

export interface ReconciliationResponse {
  /** True iff global signed sum is 0 AND no per-transaction imbalance exists. */
  balanced: boolean;
  global_signed_sum: Money;
  entry_count: number;
  transaction_count: number;
  accounts: ReconciliationAccount[];
  anomalies: Anomaly[];
}

export interface ApiError {
  error: {
    code: string;
    message: string;
  };
}

// --- Fault-injection harness summary (produced by the harness, shown on the UI) ---

export interface FaultScenarioResult {
  name: string;
  description: string;
  passed: boolean;
  metrics: Record<string, number | string | boolean>;
}

export interface FaultRunSummary {
  started_at: string;
  finished_at: string;
  duration_ms: number;
  passed: boolean;
  operations_attempted: number;
  applied_exactly_once: number;
  duplicates_short_circuited: number;
  serialization_retries: number;
  final_balance_drift: number;
  throughput_per_sec: number;
  scenarios: FaultScenarioResult[];
}

export const SETTLE_VERSION = '0.0.0';
