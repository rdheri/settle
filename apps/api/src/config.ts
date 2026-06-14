import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseEnv } from 'node:util';

/**
 * Loads the nearest `.env` walking up from the cwd (the repo root holds it, but
 * scripts run from apps/api). Explicit process env always wins over the file, so
 * tests/CI can override without editing `.env`.
 */
function loadDotEnv(): void {
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    const candidate = resolve(dir, '.env');
    if (existsSync(candidate)) {
      const parsed = parseEnv(readFileSync(candidate, 'utf8')) as Record<string, string>;
      for (const [key, value] of Object.entries(parsed)) {
        if (process.env[key] === undefined) process.env[key] = value;
      }
      return;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
}

loadDotEnv();

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function int(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n)) throw new Error(`Env var ${name} must be an integer, got: ${value}`);
  return n;
}

export const config = {
  databaseUrl: required('DATABASE_URL'),
  port: int('PORT', 3000),
  host: process.env.HOST ?? '0.0.0.0',
  /** Bounded retry budget for SERIALIZABLE transactions hitting 40001. */
  txMaxRetries: int('TX_MAX_RETRIES', 8),
  txRetryBaseMs: int('TX_RETRY_BASE_MS', 10),
  /** in_progress idempotency keys older than this are treated as abandoned. */
  idempotencyStaleMs: int('IDEMPOTENCY_STALE_MS', 15000),
  outboxPollIntervalMs: int('OUTBOX_POLL_INTERVAL_MS', 500),
  outboxBatchSize: int('OUTBOX_BATCH_SIZE', 100),
  /** CORS allow-list. '*' for local dev; set an explicit origin in production. */
  corsOrigin: process.env.CORS_ORIGIN ?? '*',
  /** Per-IP request budget; generous by default, raised to ~unbounded for the harness. */
  rateLimitMax: int('RATE_LIMIT_MAX', 1200),
  rateLimitWindow: process.env.RATE_LIMIT_WINDOW ?? '1 minute',
} as const;

export type Config = typeof config;
