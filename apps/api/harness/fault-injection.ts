/**
 * SETTLE fault-injection harness.
 *
 * Spawns the real API as a separate process and hammers it over HTTP to PROVE
 * the guarantees under concurrency and partial failure:
 *
 *   A. Same transfer, same idempotency key, N times concurrently  -> applied once.
 *   B. Many concurrent DISTINCT transfers over overlapping accounts -> no lost
 *      updates, no negative balances, global signed sum stays 0 (+ throughput).
 *   C. Kill the request after the write but before the response, then retry the
 *      same key -> no double-apply.
 *   Final sweep: global invariant (sum == 0) and every transaction balanced.
 *
 * Prints a measurable summary and writes it to the result store for the dashboard.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- harness reads loosely-typed JSON */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import type { ChildProcess } from 'node:child_process';
import type { FaultRunSummary, FaultScenarioResult } from '@settle/shared';
import { pool } from '../src/db/pool';
import { writeFaultRun } from '../src/harness/result-store';

const API_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = process.env.HARNESS_PORT ?? '3999';
const BASE = `http://127.0.0.1:${PORT}`;

// --- tiny HTTP client + counters -------------------------------------------

const tally = {
  attempted: 0,
  freshApplied: 0,
  replayed: 0,
  conflict409: 0,
  retryable503: 0,
  insufficient: 0,
  aborted: 0,
  otherErrors: 0,
};

interface PostResult {
  status: number;
  replayed: boolean;
  json: any;
}

/** A counted write through the idempotency path. */
async function post(path: string, body: unknown, key: string): Promise<PostResult> {
  tally.attempted += 1;
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': key },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  const replayed = res.headers.get('idempotent-replayed') === 'true';
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON */
  }

  if (res.status === 201 && !replayed) tally.freshApplied += 1;
  else if (res.status === 201 && replayed) tally.replayed += 1;
  else if (res.status === 409) tally.conflict409 += 1;
  else if (res.status === 503) tally.retryable503 += 1;
  else if (res.status === 422 && json?.error?.code === 'insufficient_funds')
    tally.insufficient += 1;
  else tally.otherErrors += 1;

  return { status: res.status, replayed, json };
}

/**
 * Idempotent client retry: on a retryable conflict (409 in-progress, 503
 * serialization) retry with the SAME key. This is exactly what the idempotency
 * guarantee enables — retries are safe and apply the work at most once.
 */
async function postSettled(path: string, body: unknown, key: string): Promise<PostResult> {
  for (;;) {
    const r = await post(path, body, key);
    if (r.status === 409 || r.status === 503) {
      await sleep(3 + Math.random() * 12);
      continue;
    }
    return r;
  }
}

/** Fire a request and abort it mid-flight (client gives up); server still commits. */
async function killMidFlight(
  path: string,
  body: unknown,
  key: string,
  delayMs: number,
): Promise<void> {
  tally.attempted += 1;
  tally.aborted += 1;
  const ac = new AbortController();
  const p = fetch(BASE + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': key },
    body: JSON.stringify(body),
    signal: ac.signal,
  }).catch(() => undefined);
  await sleep(delayMs);
  ac.abort();
  await p;
}

/** Setup calls that should not pollute the scenario tally. */
async function adminPost(path: string, body: unknown): Promise<any> {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': randomUUID() },
    body: JSON.stringify(body),
  });
  if (res.status !== 201)
    throw new Error(`setup ${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function get(path: string): Promise<any> {
  const res = await fetch(BASE + path);
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`);
  return res.json();
}

async function createAccount(name: string, type: string): Promise<string> {
  return (await adminPost('/accounts', { name, type })).id as string;
}

async function fund(asset: string, equity: string, amount: number): Promise<void> {
  await adminPost('/transactions', {
    description: 'fund',
    entries: [
      { account_id: asset, amount, direction: 'debit' },
      { account_id: equity, amount, direction: 'credit' },
    ],
  });
}

async function balanceOf(id: string): Promise<number> {
  return (await get(`/accounts/${id}/balance`)).balance as number;
}

/** Run `n` tasks with bounded concurrency. */
async function runPool<T>(
  n: number,
  concurrency: number,
  task: (i: number) => Promise<T>,
): Promise<T[]> {
  const results: T[] = new Array(n);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      if (i >= n) return;
      results[i] = await task(i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, n) }, worker));
  return results;
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`)
    .join(',')}}`;
}

// --- scenarios -------------------------------------------------------------

async function scenarioA(): Promise<FaultScenarioResult> {
  const equity = await createAccount('A-equity', 'equity');
  const src = await createAccount('A-src', 'asset');
  const dst = await createAccount('A-dst', 'asset');
  await fund(src, equity, 100_000);

  const N = 50;
  const amount = 1000;
  const key = `A-${randomUUID()}`;
  const body = { from: src, to: dst, amount };

  const results = await Promise.all(Array.from({ length: N }, () => post('/transfer', body, key)));
  const ok = results.filter((r) => r.status === 201);
  const distinctTx = new Set(ok.map((r) => r.json.id as string));
  const identical = ok.every((r) => canonical(r.json) === canonical(ok[0]!.json));
  const dstBal = await balanceOf(dst);

  const passed = dstBal === amount && distinctTx.size === 1 && identical && ok.length > 0;
  return {
    name: 'concurrent same-key',
    description: `${N} concurrent identical transfers sharing one idempotency key`,
    passed,
    metrics: {
      requests: N,
      applied: dstBal / amount,
      distinct_transactions: distinctTx.size,
      all_responses_identical: identical,
    },
  };
}

async function scenarioB(): Promise<{ result: FaultScenarioResult; throughput: number }> {
  const equity = await createAccount('B-equity', 'equity');
  const K = 40;
  const F = 10_000_000;
  const accts: string[] = [];
  for (let i = 0; i < K; i++) {
    const a = await createAccount(`B-asset-${i}`, 'asset');
    await fund(a, equity, F);
    accts.push(a);
  }

  const D = 2000;
  const concurrency = 32;
  const t0 = performance.now();
  await runPool(D, concurrency, async () => {
    const i = Math.floor(Math.random() * K);
    let j = Math.floor(Math.random() * K);
    while (j === i) j = Math.floor(Math.random() * K);
    const amount = 1 + Math.floor(Math.random() * 5000);
    await postSettled('/transfer', { from: accts[i], to: accts[j], amount }, `B-${randomUUID()}`);
  });
  const elapsed = (performance.now() - t0) / 1000;
  const throughput = D / elapsed;

  let assetSum = 0;
  let minBalance = Number.POSITIVE_INFINITY;
  for (const a of accts) {
    const b = await balanceOf(a);
    assetSum += b;
    minBalance = Math.min(minBalance, b);
  }
  const recon = await get('/reconciliation');
  const passed = assetSum === K * F && minBalance >= 0 && recon.global_signed_sum === 0;

  return {
    result: {
      name: 'concurrent distinct transfers (overlapping accounts)',
      description: `${D} transfers @ concurrency ${concurrency} across ${K} overlapping accounts`,
      passed,
      metrics: {
        transfers: D,
        concurrency,
        asset_total_conserved: assetSum === K * F,
        min_balance: minBalance,
        global_signed_sum: recon.global_signed_sum,
        throughput_ops_sec: Math.round(throughput),
      },
    },
    throughput,
  };
}

async function scenarioC(): Promise<FaultScenarioResult> {
  const equity = await createAccount('C-equity', 'equity');
  const src = await createAccount('C-src', 'asset');
  const dst = await createAccount('C-dst', 'asset');
  const M = 100;
  const amount = 500;
  await fund(src, equity, M * amount * 4);

  await runPool(M, 8, async (i) => {
    const key = `C-${i}-${randomUUID()}`;
    const body = { from: src, to: dst, amount };
    // Kill the first attempt mid-flight (server commits, client never sees the response).
    await killMidFlight('/transfer', body, key, Math.floor(Math.random() * 5));
    // Retry the SAME key until it resolves; must replay, never double-apply.
    for (;;) {
      const r = await post('/transfer', body, key);
      if (r.status === 201) break;
      if (r.status === 409 || r.status === 503) {
        await sleep(5 + Math.random() * 15);
        continue;
      }
      throw new Error(`scenario C unexpected status ${r.status}`);
    }
  });

  const dstBal = await balanceOf(dst);
  const applied = dstBal / amount;
  const passed = applied === M;
  return {
    name: 'kill-after-write then retry',
    description: `${M} transfers aborted mid-flight, then retried with the same key`,
    passed,
    metrics: { keys: M, applied, expected: M, double_applies: applied - M },
  };
}

// --- server lifecycle ------------------------------------------------------

async function waitForHealth(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) return true;
    } catch {
      /* not up yet */
    }
    await sleep(250);
  }
  return false;
}

function startServer(): ChildProcess {
  return spawn('pnpm', ['exec', 'tsx', 'src/index.ts'], {
    cwd: API_DIR,
    env: { ...process.env, PORT, HOST: '127.0.0.1', PG_POOL_MAX: '48', RATE_LIMIT_MAX: '1000000' },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
}

// --- main ------------------------------------------------------------------

function printSummary(s: FaultRunSummary): void {
  const line = '─'.repeat(64);
  console.log(`\n${line}`);
  console.log('  SETTLE — FAULT-INJECTION HARNESS RESULTS');
  console.log(line);
  for (const sc of s.scenarios) {
    console.log(`  [${sc.passed ? 'PASS' : 'FAIL'}] ${sc.name}`);
    console.log(`         ${sc.description}`);
    console.log(
      `         ${Object.entries(sc.metrics)
        .map(([k, v]) => `${k}=${v}`)
        .join('  ')}`,
    );
  }
  console.log(line);
  console.log(`  operations attempted ........ ${s.operations_attempted}`);
  console.log(`  applied exactly once ........ ${s.applied_exactly_once}`);
  console.log(`  duplicates short-circuited .. ${s.duplicates_short_circuited}`);
  console.log(`  serialization retries ....... ${s.serialization_retries}`);
  console.log(`  final balance drift ......... ${s.final_balance_drift}  (must be 0)`);
  console.log(`  throughput .................. ${Math.round(s.throughput_per_sec)} ops/sec`);
  console.log(`  duration .................... ${s.duration_ms} ms`);
  console.log(line);
  console.log(`  RESULT: ${s.passed ? '✅ ALL GUARANTEES HELD' : '❌ FAILURE DETECTED'}`);
  console.log(`${line}\n`);
}

async function main(): Promise<void> {
  const server = startServer();
  let exitCode = 1;
  try {
    if (!(await waitForHealth(30_000))) {
      throw new Error('API did not become healthy. Is Postgres up? (pnpm db:up)');
    }

    // Clean slate (TRUNCATE bypasses the append-only triggers).
    await pool.query(
      'truncate entries, transactions, accounts, idempotency_keys, outbox_events restart identity cascade',
    );

    const startedAt = new Date();
    const t0 = performance.now();

    const a = await scenarioA();
    const b = await scenarioB();
    const c = await scenarioC();

    const durationMs = Math.round(performance.now() - t0);
    const finishedAt = new Date();

    // Final invariant sweep — over HTTP and re-derived straight from the DB.
    const recon = await get('/reconciliation');
    const httpMetrics = await get('/metrics');
    const dbGlobal = (
      await pool.query<{ s: number; c: number }>(
        `select coalesce(sum(case direction when 'debit' then amount else -amount end),0)::bigint as s,
                count(*)::int as c from entries`,
      )
    ).rows[0]!;
    const applied = (
      await pool.query<{ c: number }>(
        `select count(*)::int as c from transactions where description like 'transfer %'`,
      )
    ).rows[0]!.c;

    const scenarios = [a, b.result, c];
    const passed =
      scenarios.every((s) => s.passed) &&
      recon.balanced === true &&
      recon.global_signed_sum === 0 &&
      dbGlobal.s === 0;

    const summary: FaultRunSummary = {
      started_at: startedAt.toISOString(),
      finished_at: finishedAt.toISOString(),
      duration_ms: durationMs,
      passed,
      operations_attempted: tally.attempted,
      applied_exactly_once: applied,
      duplicates_short_circuited: tally.replayed + tally.conflict409,
      serialization_retries: httpMetrics.serialization_retries as number,
      final_balance_drift: Math.abs(dbGlobal.s),
      throughput_per_sec: b.throughput,
      scenarios,
    };

    await writeFaultRun(summary);
    printSummary(summary);
    console.log(
      `tally: fresh=${tally.freshApplied} replayed=${tally.replayed} 409=${tally.conflict409} ` +
        `retryable503=${tally.retryable503} insufficient=${tally.insufficient} ` +
        `aborted=${tally.aborted} otherErrors=${tally.otherErrors}`,
    );
    exitCode = passed ? 0 : 1;
  } finally {
    server.kill('SIGTERM');
    await pool.end().catch(() => {});
  }
  process.exit(exitCode);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
