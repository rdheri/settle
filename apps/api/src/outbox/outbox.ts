import { config } from '../config';
import type { PoolClient } from '../db/pool';
import { withTx } from '../db/tx';

/**
 * Transactional outbox. Events are written in the SAME database transaction as
 * the ledger write (no dual-write race), then a background poller flips them to
 * published (simulating "emit to a queue") for reliable at-least-once delivery.
 */

export interface OutboxEvent {
  transactionId: string;
  type: string;
  payload: unknown;
}

export async function enqueueOutbox(client: PoolClient, evt: OutboxEvent): Promise<void> {
  await client.query(
    `insert into outbox_events(transaction_id, type, payload) values ($1, $2, $3::jsonb)`,
    [evt.transactionId, evt.type, JSON.stringify(evt.payload)],
  );
}

export const outboxMetrics = { published: 0 };

/**
 * Drain one batch of unpublished events. FOR UPDATE SKIP LOCKED makes this safe
 * to run from multiple poller instances without double-publishing.
 */
export async function drainOutboxOnce(batchSize = config.outboxBatchSize): Promise<number> {
  return withTx(
    async (client) => {
      const res = await client.query<{ id: string }>(
        `select id from outbox_events where published_at is null
         order by created_at for update skip locked limit $1`,
        [batchSize],
      );
      const count = res.rows.length;
      if (count === 0) return 0;
      const ids = res.rows.map((r) => r.id);
      // "Emit to a queue" is simulated; the published_at flip is the durable record.
      await client.query(
        `update outbox_events set published_at = now() where id = any($1::uuid[])`,
        [ids],
      );
      outboxMetrics.published += count;
      return count;
    },
    { isolation: 'read committed' },
  );
}

export async function outboxStats(
  client: PoolClient,
): Promise<{ pending: number; published: number }> {
  const res = await client.query<{ pending: number; published: number }>(
    `select
       count(*) filter (where published_at is null)::int as pending,
       count(*) filter (where published_at is not null)::int as published
     from outbox_events`,
  );
  return res.rows[0]!;
}

export interface OutboxPoller {
  stop: () => Promise<void>;
}

export function startOutboxPoller(
  opts: { intervalMs?: number; log?: (msg: string) => void } = {},
): OutboxPoller {
  const intervalMs = opts.intervalMs ?? config.outboxPollIntervalMs;
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let active: Promise<void> = Promise.resolve();

  const loop = (): void => {
    if (stopped) return;
    active = (async () => {
      try {
        let drained = 0;
        // Drain fully each tick so events don't lag behind write bursts.
        for (;;) {
          const n = await drainOutboxOnce();
          drained += n;
          if (n === 0) break;
        }
        if (drained > 0) opts.log?.(`outbox: published ${drained} event(s)`);
      } catch (err) {
        opts.log?.(`outbox poll error: ${String(err)}`);
      }
    })();
    void active.then(() => {
      if (!stopped) timer = setTimeout(loop, intervalMs);
    });
  };

  loop();

  return {
    stop: async () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      await active;
    },
  };
}
