import { config } from '../config';
import { pool } from '../db/pool';
import type { PoolClient } from '../db/pool';
import { withSerializableTx } from '../db/tx';
import type { TxOptions } from '../db/tx';
import { LedgerError } from '../ledger/errors';

/**
 * Idempotency state machine.
 *
 *   claim (INSERT .. ON CONFLICT DO NOTHING)  -- the UNIQUE PK is the gate
 *     ├─ won   -> run work + record response in ONE serializable tx -> completed
 *     └─ lost  -> inspect existing row:
 *          fingerprint mismatch          -> 422 (key reused for a different body)
 *          completed                     -> replay stored response verbatim
 *          in_progress & fresh           -> 409 (concurrent retry)
 *          in_progress & stale (crashed) -> reclaim, then run work
 */

export class IdempotencyError extends Error {
  readonly httpStatus: number;
  readonly code: string;
  constructor(message: string, code: string, httpStatus: number) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

/** Same key, different request body. */
export class IdempotencyFingerprintError extends IdempotencyError {
  constructor(key: string) {
    super(
      `idempotency key "${key}" was already used with a different request payload`,
      'idempotency_key_reused',
      422,
    );
  }
}

/** A concurrent request with the same key is still in flight. */
export class IdempotencyInProgressError extends IdempotencyError {
  constructor(key: string) {
    super(
      `a request with idempotency key "${key}" is already in progress`,
      'idempotency_in_progress',
      409,
    );
  }
}

export interface WorkResult {
  status: number;
  body: unknown;
  /** Optional link to the transaction this work produced. */
  transactionId?: string | null;
}

export interface IdempotentOutcome {
  status: number;
  body: unknown;
  /** True when the response came from the store rather than fresh work. */
  replayed: boolean;
}

export type Work = (client: PoolClient) => Promise<WorkResult>;

export interface RunIdempotentParams {
  key: string;
  fingerprint: string;
  work: Work;
  txOptions?: Omit<TxOptions, 'isolation'>;
}

interface ExistingRow {
  request_fingerprint: string;
  state: 'in_progress' | 'completed';
  response_status: number | null;
  response_body: unknown;
  age_ms: number;
}

export async function runIdempotent(params: RunIdempotentParams): Promise<IdempotentOutcome> {
  const { key, fingerprint, work, txOptions } = params;

  // Loop only to re-route after a stale-reclaim race resolved against us.
  for (;;) {
    // 1. Try to claim the key. The UNIQUE PK is the concurrency gate.
    const claim = await pool.query(
      `insert into idempotency_keys(key, request_fingerprint, state)
       values ($1, $2, 'in_progress')
       on conflict (key) do nothing
       returning key`,
      [key, fingerprint],
    );
    if (claim.rowCount === 1) {
      return executeWork(key, fingerprint, work, txOptions);
    }

    // 2. Lost the claim: inspect the existing row.
    const res = await pool.query<ExistingRow>(
      `select request_fingerprint, state, response_status, response_body,
              extract(epoch from (now() - created_at)) * 1000 as age_ms
       from idempotency_keys where key = $1`,
      [key],
    );
    const existing = res.rows[0];
    if (!existing) continue; // row vanished (a reclaim deleted it); retry the claim.

    if (existing.request_fingerprint !== fingerprint) {
      throw new IdempotencyFingerprintError(key);
    }

    if (existing.state === 'completed') {
      return {
        status: existing.response_status ?? 200,
        body: existing.response_body,
        replayed: true,
      };
    }

    // state === 'in_progress'
    if (existing.age_ms > config.idempotencyStaleMs) {
      // Crashed request: try to atomically take it over. The WHERE clause
      // re-validates staleness so only one reclaimer wins.
      const reclaim = await pool.query(
        `update idempotency_keys
         set request_fingerprint = $2, created_at = now(), updated_at = now()
         where key = $1 and state = 'in_progress'
           and now() - created_at > make_interval(secs => $3::float8 / 1000.0)
         returning key`,
        [key, fingerprint, config.idempotencyStaleMs],
      );
      if (reclaim.rowCount === 1) {
        return executeWork(key, fingerprint, work, txOptions);
      }
      continue; // someone else reclaimed or completed it; re-route.
    }

    throw new IdempotencyInProgressError(key);
  }
}

async function executeWork(
  key: string,
  _fingerprint: string,
  work: Work,
  txOptions?: Omit<TxOptions, 'isolation'>,
): Promise<IdempotentOutcome> {
  try {
    // The ledger write AND the completion record commit together (or not at all).
    const result = await withSerializableTx(async (client) => {
      const out = await work(client);
      await client.query(
        `update idempotency_keys
         set state = 'completed', response_status = $2, response_body = $3::jsonb,
             transaction_id = $4, updated_at = now()
         where key = $1`,
        [key, out.status, JSON.stringify(out.body), out.transactionId ?? null],
      );
      return out;
    }, txOptions ?? {});
    return { status: result.status, body: result.body, replayed: false };
  } catch (err) {
    if (err instanceof LedgerError) {
      // Deterministic domain failure: record it so retries replay the SAME error
      // (same key + same body => same response). The ledger write was rolled back.
      const body = { error: { code: err.code, message: err.message } };
      await pool.query(
        `update idempotency_keys
         set state = 'completed', response_status = $2, response_body = $3::jsonb, updated_at = now()
         where key = $1`,
        [key, err.httpStatus, JSON.stringify(body)],
      );
      return { status: err.httpStatus, body, replayed: false };
    }
    // Non-deterministic/infra failure: release the claim so a retry can redo.
    await pool
      .query(`delete from idempotency_keys where key = $1 and state = 'in_progress'`, [key])
      .catch(() => {});
    throw err;
  }
}
