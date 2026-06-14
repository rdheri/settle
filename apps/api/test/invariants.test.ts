import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AccountType, EntryInput } from '@settle/shared';
import { withSerializableTx } from '../src/db/tx';
import { resetTxMetrics, txMetrics } from '../src/db/tx';
import * as ledger from '../src/ledger/ledger';
import { InsufficientFundsError, ValidationError } from '../src/ledger/errors';
import { closeDb, ensureSchema, resetDb } from './helpers/db';

beforeAll(ensureSchema);
beforeEach(resetDb);
afterAll(closeDb);

function mkAccount(name: string, type: AccountType): Promise<ledger.AccountRow> {
  return withSerializableTx((c) => ledger.createAccount(c, { name, type }));
}

function postTx(entries: EntryInput[], allowNegative = false): Promise<ledger.TransactionRecord> {
  return withSerializableTx((c) =>
    ledger.createTransaction(c, { idempotencyKey: randomUUID(), entries, allowNegative }),
  );
}

function reconcile(): Promise<ledger.ReconciliationResult> {
  return withSerializableTx((c) => ledger.getReconciliation(c));
}

function balanceOf(id: string): Promise<number> {
  return withSerializableTx((c) => ledger.getAccountBalance(c, id)).then((r) => r.balance);
}

describe('per-transaction invariant', () => {
  it('commits a balanced 2-entry transaction', async () => {
    const cash = await mkAccount('Cash', 'asset');
    const rev = await mkAccount('Revenue', 'revenue');
    const tx = await postTx([
      { account_id: cash.id, amount: 1000, direction: 'debit' },
      { account_id: rev.id, amount: 1000, direction: 'credit' },
    ]);
    expect(tx.entries).toHaveLength(2);
  });

  it('rejects unbalanced entries (debits != credits)', async () => {
    const a = await mkAccount('A', 'asset');
    const b = await mkAccount('B', 'asset');
    await expect(
      postTx([
        { account_id: a.id, amount: 1000, direction: 'debit' },
        { account_id: b.id, amount: 500, direction: 'credit' },
      ]),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects a single-entry transaction', async () => {
    const a = await mkAccount('A', 'asset');
    await expect(
      postTx([{ account_id: a.id, amount: 1000, direction: 'debit' }]),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects non-integer / non-positive amounts (no floats, ever)', async () => {
    const a = await mkAccount('A', 'asset');
    const b = await mkAccount('B', 'asset');
    await expect(
      postTx([
        { account_id: a.id, amount: 10.5, direction: 'debit' },
        { account_id: b.id, amount: 10.5, direction: 'credit' },
      ]),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects entries that reference a non-existent account', async () => {
    const a = await mkAccount('A', 'asset');
    await expect(
      postTx([
        { account_id: a.id, amount: 100, direction: 'debit' },
        { account_id: randomUUID(), amount: 100, direction: 'credit' },
      ]),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('derived balances', () => {
  it('balance is the signed sum of entries (debit +, credit -)', async () => {
    const cash = await mkAccount('Cash', 'asset');
    const rev = await mkAccount('Revenue', 'revenue');
    await postTx([
      { account_id: cash.id, amount: 1000, direction: 'debit' },
      { account_id: rev.id, amount: 1000, direction: 'credit' },
    ]);
    expect(await balanceOf(cash.id)).toBe(1000);
    expect(await balanceOf(rev.id)).toBe(-1000);
  });
});

describe('non-negative balance rule', () => {
  it('blocks overdraft on debit-normal accounts, allows it with allowNegative', async () => {
    const cash = await mkAccount('Cash', 'asset');
    const dest = await mkAccount('Dest', 'asset');
    const equity = await mkAccount('Equity', 'equity');

    // Fund cash with 1000.
    await postTx([
      { account_id: cash.id, amount: 1000, direction: 'debit' },
      { account_id: equity.id, amount: 1000, direction: 'credit' },
    ]);

    // Move 1500 out of cash -> would be -500 -> rejected.
    await expect(
      postTx([
        { account_id: dest.id, amount: 1500, direction: 'debit' },
        { account_id: cash.id, amount: 1500, direction: 'credit' },
      ]),
    ).rejects.toBeInstanceOf(InsufficientFundsError);

    // Same movement with allowNegative -> permitted.
    await postTx(
      [
        { account_id: dest.id, amount: 1500, direction: 'debit' },
        { account_id: cash.id, amount: 1500, direction: 'credit' },
      ],
      true,
    );
    expect(await balanceOf(cash.id)).toBe(-500);
  });
});

describe('global invariant', () => {
  it('keeps the global signed sum at 0 across many random transactions', async () => {
    const assets = await Promise.all(['A', 'B', 'C', 'D'].map((n) => mkAccount(n, 'asset')));
    const equity = await mkAccount('Equity', 'equity');

    // Seed each asset with funds (debit asset / credit equity).
    for (const a of assets) {
      await postTx([
        { account_id: a.id, amount: 100_000, direction: 'debit' },
        { account_id: equity.id, amount: 100_000, direction: 'credit' },
      ]);
    }

    const pick = (): ledger.AccountRow => assets[Math.floor(Math.random() * assets.length)]!;
    for (let i = 0; i < 100; i++) {
      const from = pick();
      let to = pick();
      while (to.id === from.id) to = pick();
      const amount = 1 + Math.floor(Math.random() * 1000);
      try {
        await postTx([
          { account_id: to.id, amount, direction: 'debit' },
          { account_id: from.id, amount, direction: 'credit' },
        ]);
      } catch (err) {
        if (!(err instanceof InsufficientFundsError)) throw err;
      }
    }

    const recon = await reconcile();
    expect(recon.global_signed_sum).toBe(0);
    expect(recon.balanced).toBe(true);
    expect(recon.anomalies).toEqual([]);
  });
});

describe('concurrency (SERIALIZABLE + bounded retry)', () => {
  it('never overdraws a hot account under concurrent transfers', async () => {
    resetTxMetrics();
    const cash = await mkAccount('Cash', 'asset');
    const dest = await mkAccount('Dest', 'asset');
    const equity = await mkAccount('Equity', 'equity');

    const capacity = 5;
    const amount = 100;
    const attempts = 10;

    await postTx([
      { account_id: cash.id, amount: capacity * amount, direction: 'debit' },
      { account_id: equity.id, amount: capacity * amount, direction: 'credit' },
    ]);

    const results = await Promise.allSettled(
      Array.from({ length: attempts }, () =>
        withSerializableTx(
          (c) =>
            ledger.createTransaction(c, {
              idempotencyKey: randomUUID(),
              entries: [
                { account_id: dest.id, amount, direction: 'debit' },
                { account_id: cash.id, amount, direction: 'credit' },
              ],
            }),
          { maxRetries: 50, retryBaseMs: 5 },
        ),
      ),
    );

    const succeeded = results.filter((r) => r.status === 'fulfilled').length;
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');

    // Exactly `capacity` succeed; the rest fail cleanly with InsufficientFunds.
    expect(succeeded).toBe(capacity);
    for (const r of rejected) {
      expect(r.reason).toBeInstanceOf(InsufficientFundsError);
    }
    expect(await balanceOf(cash.id)).toBe(0); // never negative
    expect(await balanceOf(dest.id)).toBe(capacity * amount);

    const recon = await reconcile();
    expect(recon.global_signed_sum).toBe(0);
    console.log(`[concurrency] serialization retries observed: ${txMetrics.serializationRetries}`);
  }, 60_000);
});
