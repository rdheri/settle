import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resetTxMetrics, txMetrics, withSerializableTx } from '../src/db/tx';
import { closeDb, ensureSchema } from './helpers/db';

beforeAll(ensureSchema);
afterAll(closeDb);

/** Build an error that looks like a Postgres error with the given SQLSTATE. */
function pgError(code: string, message = code): Error {
  return Object.assign(new Error(message), { code });
}

describe('withSerializableTx retry', () => {
  it('retries on serialization failure (40001) and eventually succeeds', async () => {
    resetTxMetrics();
    let calls = 0;
    const result = await withSerializableTx(
      async () => {
        calls += 1;
        if (calls < 3) throw pgError('40001', 'could not serialize access');
        return 'ok';
      },
      { retryBaseMs: 1 },
    );
    expect(result).toBe('ok');
    expect(calls).toBe(3); // initial + 2 retries
    expect(txMetrics.serializationRetries).toBe(2);
  });

  it('does NOT retry a non-serialization error', async () => {
    let calls = 0;
    await expect(
      withSerializableTx(async () => {
        calls += 1;
        throw pgError('23505', 'duplicate key');
      }),
    ).rejects.toThrow('duplicate key');
    expect(calls).toBe(1);
  });

  it('gives up after maxRetries and rethrows the serialization error', async () => {
    let calls = 0;
    await expect(
      withSerializableTx(
        async () => {
          calls += 1;
          throw pgError('40001');
        },
        { maxRetries: 2, retryBaseMs: 1 },
      ),
    ).rejects.toHaveProperty('code', '40001');
    expect(calls).toBe(3); // initial + 2 retries, then give up
  });
});
