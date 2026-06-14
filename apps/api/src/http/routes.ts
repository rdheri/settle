import type { FastifyInstance } from 'fastify';
import { CreateAccountRequest, CreateTransactionRequest, TransferRequest } from '@settle/shared';
import { txMetrics, withTx } from '../db/tx';
import * as ledger from '../ledger/ledger';
import { enqueueOutbox, outboxMetrics, outboxStats } from '../outbox/outbox';
import { readLatestFaultRun } from '../harness/result-store';
import {
  serializeAccount,
  serializeBalance,
  serializeReconciliation,
  serializeTransaction,
} from './serialize';
import { handleWrite, requireIdempotencyKey } from './write';

const READ = { isolation: 'read committed' } as const;

export function registerRoutes(app: FastifyInstance): void {
  app.get('/health', async () => ({ ok: true }));

  // --- Writes (all require Idempotency-Key) ---

  app.post('/accounts', async (req, reply) => {
    const body = CreateAccountRequest.parse(req.body);
    const key = requireIdempotencyKey(req);
    await handleWrite(req, reply, key, async (client) => {
      const account = await ledger.createAccount(client, body);
      return { status: 201, body: serializeAccount(account) };
    });
  });

  app.post('/transactions', async (req, reply) => {
    const body = CreateTransactionRequest.parse(req.body);
    const key = requireIdempotencyKey(req);
    await handleWrite(req, reply, key, async (client) => {
      const tx = await ledger.createTransaction(client, {
        idempotencyKey: key,
        description: body.description,
        entries: body.entries,
        allowNegative: body.allow_negative,
      });
      const serialized = serializeTransaction(tx);
      await enqueueOutbox(client, {
        transactionId: tx.id,
        type: 'transaction.created',
        payload: serialized,
      });
      return { status: 201, body: serialized, transactionId: tx.id };
    });
  });

  app.post('/transfer', async (req, reply) => {
    const body = TransferRequest.parse(req.body);
    const key = requireIdempotencyKey(req);
    await handleWrite(req, reply, key, async (client) => {
      const tx = await ledger.createTransfer(client, {
        idempotencyKey: key,
        from: body.from,
        to: body.to,
        amount: body.amount,
        description: body.description,
        allowNegative: body.allow_negative,
      });
      const serialized = serializeTransaction(tx);
      await enqueueOutbox(client, {
        transactionId: tx.id,
        type: 'transfer.created',
        payload: serialized,
      });
      return { status: 201, body: serialized, transactionId: tx.id };
    });
  });

  // --- Reads ---

  app.get<{ Params: { id: string } }>('/accounts/:id/balance', async (req) => {
    const result = await withTx((c) => ledger.getAccountBalance(c, req.params.id), READ);
    return serializeBalance(result);
  });

  app.get<{ Params: { id: string } }>('/transactions/:id', async (req) => {
    const tx = await withTx((c) => ledger.getTransaction(c, req.params.id), READ);
    return serializeTransaction(tx);
  });

  app.get<{ Querystring: { limit?: string } }>('/transactions', async (req) => {
    const limit = Math.min(Math.max(Number(req.query.limit ?? 50) || 50, 1), 500);
    const txs = await withTx((c) => ledger.listTransactions(c, limit), READ);
    return { transactions: txs.map(serializeTransaction) };
  });

  app.get('/reconciliation', async () => {
    const recon = await withTx((c) => ledger.getReconciliation(c), READ);
    return serializeReconciliation(recon);
  });

  app.get('/outbox/stats', async () => withTx((c) => outboxStats(c), READ));

  app.get('/metrics', async () => ({
    serialization_retries: txMetrics.serializationRetries,
    deadlock_retries: txMetrics.deadlockRetries,
    outbox_published: outboxMetrics.published,
  }));

  app.get('/fault-runs/latest', async () => (await readLatestFaultRun()) ?? null);
}
