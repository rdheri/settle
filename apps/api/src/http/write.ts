import type { FastifyReply, FastifyRequest } from 'fastify';
import { fingerprint } from '../idempotency/fingerprint';
import { runIdempotent } from '../idempotency/idempotency';
import type { Work } from '../idempotency/idempotency';
import { BadRequestError } from './errors';

/** Read and require the Idempotency-Key header. */
export function requireIdempotencyKey(req: FastifyRequest): string {
  const key = req.headers['idempotency-key'];
  if (typeof key !== 'string' || key.trim().length === 0) {
    throw new BadRequestError(
      'missing required header: Idempotency-Key',
      'missing_idempotency_key',
    );
  }
  return key;
}

/**
 * Run an idempotent write: fingerprint the request, route it through the
 * idempotency state machine, and emit the resulting status/body. Adds an
 * `Idempotent-Replayed` header so clients (and the harness) can see replays.
 */
export async function handleWrite(
  req: FastifyRequest,
  reply: FastifyReply,
  key: string,
  work: Work,
): Promise<void> {
  const route = req.routeOptions.url ?? req.url;
  const fp = fingerprint(req.method, route, req.body ?? null);

  const outcome = await runIdempotent({ key, fingerprint: fp, work });

  reply.header('idempotent-replayed', String(outcome.replayed));
  await reply.code(outcome.status).send(outcome.body);
}
