import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/http/server';
import { drainOutboxOnce } from '../src/outbox/outbox';
import { closeDb, ensureSchema, resetDb } from './helpers/db';

let app: FastifyInstance;

beforeAll(async () => {
  await ensureSchema();
  app = buildServer({ logger: false });
  await app.ready();
});
beforeEach(resetDb);
afterAll(async () => {
  await app.close();
  await closeDb();
});

const key = (): string => `k-${randomUUID()}`;

async function createAccount(name: string, type: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/accounts',
    headers: { 'idempotency-key': key() },
    payload: { name, type },
  });
  expect(res.statusCode).toBe(201);
  return res.json().id as string;
}

async function fund(account: string, equity: string, amount: number): Promise<void> {
  const res = await app.inject({
    method: 'POST',
    url: '/transactions',
    headers: { 'idempotency-key': key() },
    payload: {
      description: 'funding',
      entries: [
        { account_id: account, amount, direction: 'debit' },
        { account_id: equity, amount, direction: 'credit' },
      ],
    },
  });
  expect(res.statusCode).toBe(201);
}

describe('HTTP API', () => {
  it('requires an Idempotency-Key on writes', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/accounts',
      payload: { name: 'NoKey', type: 'asset' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('missing_idempotency_key');
  });

  it('validates the request body (400 on bad shape)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/accounts',
      headers: { 'idempotency-key': key() },
      payload: { name: '', type: 'not-a-type' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('invalid_request');
  });

  it('creates an account and replays the same key verbatim', async () => {
    const k = key();
    const payload = { name: 'Cash', type: 'asset' };
    const first = await app.inject({
      method: 'POST',
      url: '/accounts',
      headers: { 'idempotency-key': k },
      payload,
    });
    const second = await app.inject({
      method: 'POST',
      url: '/accounts',
      headers: { 'idempotency-key': k },
      payload,
    });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(first.headers['idempotent-replayed']).toBe('false');
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(second.json()).toEqual(first.json()); // verbatim
  });

  it('returns 422 when a key is reused with a different payload', async () => {
    const k = key();
    await app.inject({
      method: 'POST',
      url: '/accounts',
      headers: { 'idempotency-key': k },
      payload: { name: 'A', type: 'asset' },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/accounts',
      headers: { 'idempotency-key': k },
      payload: { name: 'B', type: 'asset' },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('idempotency_key_reused');
  });

  it('runs a transfer and reflects derived balances + reconciliation', async () => {
    const equity = await createAccount('Equity', 'equity');
    const cash = await createAccount('Cash', 'asset');
    const dest = await createAccount('Dest', 'asset');
    await fund(cash, equity, 5000);

    const transfer = await app.inject({
      method: 'POST',
      url: '/transfer',
      headers: { 'idempotency-key': key() },
      payload: { from: cash, to: dest, amount: 2000 },
    });
    expect(transfer.statusCode).toBe(201);
    const txId = transfer.json().id as string;

    const cashBal = await app.inject({ method: 'GET', url: `/accounts/${cash}/balance` });
    const destBal = await app.inject({ method: 'GET', url: `/accounts/${dest}/balance` });
    expect(cashBal.json().balance).toBe(3000);
    expect(destBal.json().balance).toBe(2000);

    const txRes = await app.inject({ method: 'GET', url: `/transactions/${txId}` });
    expect(txRes.json().entries).toHaveLength(2);

    const recon = await app.inject({ method: 'GET', url: '/reconciliation' });
    expect(recon.json().balanced).toBe(true);
    expect(recon.json().global_signed_sum).toBe(0);
  });

  it('rejects an overdraft transfer with 422 insufficient_funds', async () => {
    const equity = await createAccount('Equity', 'equity');
    const cash = await createAccount('Cash', 'asset');
    const dest = await createAccount('Dest', 'asset');
    await fund(cash, equity, 1000);

    const res = await app.inject({
      method: 'POST',
      url: '/transfer',
      headers: { 'idempotency-key': key() },
      payload: { from: cash, to: dest, amount: 5000 },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('insufficient_funds');
  });

  it('writes an outbox event in the same tx and the poller publishes it', async () => {
    const equity = await createAccount('Equity', 'equity');
    const cash = await createAccount('Cash', 'asset');
    await fund(cash, equity, 1000);

    const before = await app.inject({ method: 'GET', url: '/outbox/stats' });
    expect(before.json().pending).toBeGreaterThanOrEqual(1);

    const published = await drainOutboxOnce();
    expect(published).toBeGreaterThanOrEqual(1);

    const after = await app.inject({ method: 'GET', url: '/outbox/stats' });
    expect(after.json().pending).toBe(0);
    expect(after.json().published).toBeGreaterThanOrEqual(1);
  });

  it('lists recent transactions newest-first', async () => {
    const equity = await createAccount('Equity', 'equity');
    const cash = await createAccount('Cash', 'asset');
    await fund(cash, equity, 1000);
    await fund(cash, equity, 2000);

    const res = await app.inject({ method: 'GET', url: '/transactions?limit=10' });
    const txs = res.json().transactions as { entries: unknown[] }[];
    expect(txs.length).toBe(2);
    expect(txs[0]!.entries).toHaveLength(2);
  });
});
