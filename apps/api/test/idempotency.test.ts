import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../src/db/pool';
import { withSerializableTx } from '../src/db/tx';
import * as ledger from '../src/ledger/ledger';
import { ValidationError } from '../src/ledger/errors';
import {
  IdempotencyFingerprintError,
  IdempotencyInProgressError,
  runIdempotent,
} from '../src/idempotency/idempotency';
import type { IdempotentOutcome, Work } from '../src/idempotency/idempotency';
import { fingerprint } from '../src/idempotency/fingerprint';
import { closeDb, ensureSchema, resetDb } from './helpers/db';

beforeAll(ensureSchema);
beforeEach(resetDb);
afterAll(closeDb);

function balanceOf(id: string): Promise<number> {
  return withSerializableTx((c) => ledger.getAccountBalance(c, id)).then((r) => r.balance);
}

async function setupFunded(): Promise<{ cash: ledger.AccountRow; dest: ledger.AccountRow }> {
  const mk = (name: string, type: 'asset' | 'equity'): Promise<ledger.AccountRow> =>
    withSerializableTx((c) => ledger.createAccount(c, { name, type }));
  const cash = await mk('Cash', 'asset');
  const dest = await mk('Dest', 'asset');
  const equity = await mk('Equity', 'equity');
  await withSerializableTx((c) =>
    ledger.createTransaction(c, {
      idempotencyKey: randomUUID(),
      entries: [
        { account_id: cash.id, amount: 10_000, direction: 'debit' },
        { account_id: equity.id, amount: 10_000, direction: 'credit' },
      ],
    }),
  );
  return { cash, dest };
}

/** A transfer work that records how many times it actually ran. */
function transferWork(
  counter: { n: number },
  key: string,
  from: string,
  to: string,
  amount: number,
): Work {
  return async (client) => {
    counter.n += 1;
    const tx = await ledger.createTransfer(client, { idempotencyKey: key, from, to, amount });
    return { status: 201, body: { id: tx.id, amount }, transactionId: tx.id };
  };
}

describe('idempotency — first request', () => {
  it('runs the work once and returns a fresh (non-replayed) response', async () => {
    const { cash, dest } = await setupFunded();
    const key = `k-${randomUUID()}`;
    const counter = { n: 0 };
    const fp = fingerprint('POST', '/transfer', { from: cash.id, to: dest.id, amount: 1000 });

    const out = await runIdempotent({
      key,
      fingerprint: fp,
      work: transferWork(counter, key, cash.id, dest.id, 1000),
    });

    expect(out.replayed).toBe(false);
    expect(out.status).toBe(201);
    expect(counter.n).toBe(1);
    expect(await balanceOf(dest.id)).toBe(1000);
  });
});

describe('idempotency — duplicate case 1: completed key', () => {
  it('replays the stored response verbatim and does NOT re-run the work', async () => {
    const { cash, dest } = await setupFunded();
    const key = `k-${randomUUID()}`;
    const counter = { n: 0 };
    const fp = fingerprint('POST', '/transfer', { from: cash.id, to: dest.id, amount: 1000 });
    const work = transferWork(counter, key, cash.id, dest.id, 1000);

    const first = await runIdempotent({ key, fingerprint: fp, work });
    const second = await runIdempotent({ key, fingerprint: fp, work });

    expect(counter.n).toBe(1); // work ran exactly once
    expect(second.replayed).toBe(true);
    expect(second.status).toBe(first.status);
    // Verbatim: identical once serialized the way the HTTP layer would send it.
    expect(second.body).toEqual(JSON.parse(JSON.stringify(first.body)));
    expect(await balanceOf(dest.id)).toBe(1000); // money moved exactly once
  });
});

describe('idempotency — duplicate case 2: in-progress key', () => {
  it('returns 409 for a fresh in-progress key', async () => {
    const key = `k-${randomUUID()}`;
    const fp = fingerprint('POST', '/x', { a: 1 });
    await pool.query(
      `insert into idempotency_keys(key, request_fingerprint, state) values ($1, $2, 'in_progress')`,
      [key, fp],
    );
    await expect(
      runIdempotent({ key, fingerprint: fp, work: async () => ({ status: 201, body: {} }) }),
    ).rejects.toBeInstanceOf(IdempotencyInProgressError);
  });

  it('applies the work exactly once under N concurrent same-key requests', async () => {
    const { cash, dest } = await setupFunded();
    const key = `k-${randomUUID()}`;
    const counter = { n: 0 };
    const fp = fingerprint('POST', '/transfer', { from: cash.id, to: dest.id, amount: 1000 });

    const N = 12;
    const results = await Promise.allSettled(
      Array.from({ length: N }, () =>
        runIdempotent({
          key,
          fingerprint: fp,
          work: transferWork(counter, key, cash.id, dest.id, 1000),
        }),
      ),
    );

    const fulfilled = results.filter(
      (r): r is PromiseFulfilledResult<IdempotentOutcome> => r.status === 'fulfilled',
    );
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');

    const fresh = fulfilled.filter((r) => r.value.replayed === false);
    expect(fresh).toHaveLength(1); // exactly one fresh execution
    expect(counter.n).toBe(1); // work body ran once
    // Everyone else either replayed the completed response or was told 409.
    for (const r of fulfilled.filter((x) => x.value.replayed)) {
      expect(r.value.status).toBe(201);
    }
    for (const r of rejected) {
      expect(r.reason).toBeInstanceOf(IdempotencyInProgressError);
    }
    expect(await balanceOf(dest.id)).toBe(1000); // money moved exactly once
  });

  it('reclaims a stale (crashed) in-progress key and runs the work', async () => {
    const { cash, dest } = await setupFunded();
    const key = `k-${randomUUID()}`;
    const fp = fingerprint('POST', '/transfer', { from: cash.id, to: dest.id, amount: 1000 });
    // An abandoned claim from a crashed request, well past the stale window.
    await pool.query(
      `insert into idempotency_keys(key, request_fingerprint, state, created_at)
       values ($1, $2, 'in_progress', now() - interval '1 hour')`,
      [key, fp],
    );
    const counter = { n: 0 };
    const out = await runIdempotent({
      key,
      fingerprint: fp,
      work: transferWork(counter, key, cash.id, dest.id, 1000),
    });
    expect(out.replayed).toBe(false);
    expect(counter.n).toBe(1);
    expect(await balanceOf(dest.id)).toBe(1000);
  });
});

describe('idempotency — duplicate case 3: fingerprint mismatch', () => {
  it('rejects the same key reused with a different payload (422)', async () => {
    const { cash, dest } = await setupFunded();
    const key = `k-${randomUUID()}`;
    const counter = { n: 0 };
    await runIdempotent({
      key,
      fingerprint: fingerprint('POST', '/transfer', { amount: 1000 }),
      work: transferWork(counter, key, cash.id, dest.id, 1000),
    });
    await expect(
      runIdempotent({
        key,
        fingerprint: fingerprint('POST', '/transfer', { amount: 2000 }),
        work: transferWork(counter, key, cash.id, dest.id, 2000),
      }),
    ).rejects.toBeInstanceOf(IdempotencyFingerprintError);
    expect(counter.n).toBe(1); // the second payload never ran
  });
});

describe('idempotency — failure handling', () => {
  it('releases the claim on a non-deterministic failure so a retry can redo', async () => {
    const key = `k-${randomUUID()}`;
    const fp = fingerprint('POST', '/x', { a: 1 });

    await expect(
      runIdempotent({
        key,
        fingerprint: fp,
        work: async () => {
          throw new Error('transient infra boom');
        },
      }),
    ).rejects.toThrow('transient infra boom');

    const gone = await pool.query('select 1 from idempotency_keys where key = $1', [key]);
    expect(gone.rowCount).toBe(0); // claim released

    const out = await runIdempotent({
      key,
      fingerprint: fp,
      work: async () => ({ status: 201, body: { ok: true } }),
    });
    expect(out.status).toBe(201);
    expect(out.replayed).toBe(false);
  });

  it('records a deterministic domain error and replays it without re-running work', async () => {
    const key = `k-${randomUUID()}`;
    const fp = fingerprint('POST', '/x', { a: 1 });
    const counter = { n: 0 };
    const work: Work = async () => {
      counter.n += 1;
      throw new ValidationError('always invalid');
    };

    const first = await runIdempotent({ key, fingerprint: fp, work });
    expect(first.status).toBe(422);
    expect(first.replayed).toBe(false);

    const second = await runIdempotent({ key, fingerprint: fp, work });
    expect(second.status).toBe(422);
    expect(second.replayed).toBe(true);
    expect(counter.n).toBe(1); // not re-run
  });
});
