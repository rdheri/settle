import pg from 'pg';
import { config } from '../config';

const { Pool, types } = pg;

/**
 * node-postgres returns BIGINT (int8, OID 20) as a string to avoid silent
 * precision loss. Money in Settle is integer minor units within JS safe-integer
 * range, so we parse to a number — but FAIL LOUD if a value ever exceeds 2^53
 * rather than corrupting the books.
 */
types.setTypeParser(20, (val: string): number => {
  const n = Number(val);
  if (!Number.isSafeInteger(n)) {
    throw new Error(`bigint value ${val} exceeds JS safe-integer range`);
  }
  return n;
});

export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: int(process.env.PG_POOL_MAX, 20),
});

function int(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const n = Number(value);
  return Number.isInteger(n) ? n : fallback;
}

export type { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
