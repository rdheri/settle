import { config } from '../config';
import { pool } from './pool';
import type { PoolClient } from './pool';

/**
 * Counters for the fault-injection harness / dashboard: how often the
 * SERIALIZABLE path actually had to retry. Proof the contention path is real.
 */
export const txMetrics = {
  serializationRetries: 0,
  deadlockRetries: 0,
};

export function resetTxMetrics(): void {
  txMetrics.serializationRetries = 0;
  txMetrics.deadlockRetries = 0;
}

const SERIALIZATION_FAILURE = '40001';
const DEADLOCK_DETECTED = '40P01';

export function pgErrorCode(err: unknown): string | undefined {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    const code = (err as { code?: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

export type Isolation = 'serializable' | 'read committed';

export interface TxOptions {
  isolation?: Isolation;
  maxRetries?: number;
  retryBaseMs?: number;
  onRetry?: (attempt: number, code: string) => void;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Exponential backoff with full jitter, capped, to spread out retry storms. */
function backoffMs(base: number, attempt: number): number {
  const exp = base * 2 ** (attempt - 1);
  const jitter = 0.5 + Math.random() * 0.5;
  return Math.min(Math.round(exp * jitter), 250);
}

/**
 * Run `fn` inside a single database transaction. On a Postgres serialization
 * failure (40001) or deadlock (40P01), the whole transaction is retried with
 * bounded exponential backoff. This is what turns "check-then-act" inside the
 * transaction into an atomic, exactly-once operation under concurrency.
 */
export async function withTx<T>(
  fn: (client: PoolClient) => Promise<T>,
  opts: TxOptions = {},
): Promise<T> {
  const isolation: Isolation = opts.isolation ?? 'serializable';
  const maxRetries = opts.maxRetries ?? config.txMaxRetries;
  const base = opts.retryBaseMs ?? config.txRetryBaseMs;

  let attempt = 0;
  for (;;) {
    const client = await pool.connect();
    try {
      await client.query(`begin isolation level ${isolation}`);
      const result = await fn(client);
      await client.query('commit');
      return result;
    } catch (err) {
      try {
        await client.query('rollback');
      } catch {
        // The connection may already be broken; release() handles cleanup.
      }
      const code = pgErrorCode(err);
      const retryable = code === SERIALIZATION_FAILURE || code === DEADLOCK_DETECTED;
      if (retryable && attempt < maxRetries) {
        attempt += 1;
        if (code === SERIALIZATION_FAILURE) txMetrics.serializationRetries += 1;
        else txMetrics.deadlockRetries += 1;
        opts.onRetry?.(attempt, code);
        await sleep(backoffMs(base, attempt));
        continue;
      }
      throw err;
    } finally {
      client.release();
    }
  }
}

/** Money-moving writes go through here: SERIALIZABLE isolation + bounded retry. */
export function withSerializableTx<T>(
  fn: (client: PoolClient) => Promise<T>,
  opts: Omit<TxOptions, 'isolation'> = {},
): Promise<T> {
  return withTx(fn, { ...opts, isolation: 'serializable' });
}
