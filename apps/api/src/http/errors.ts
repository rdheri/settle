import type { FastifyError, FastifyInstance } from 'fastify';
import { ZodError } from 'zod';

/** Errors raised by the HTTP layer itself (e.g. missing headers). */
export class HttpError extends Error {
  readonly httpStatus: number;
  readonly code: string;
  constructor(message: string, code: string, httpStatus: number) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export class BadRequestError extends HttpError {
  constructor(message: string, code = 'invalid_request') {
    super(message, code, 400);
  }
}

interface CodedError {
  httpStatus: number;
  code: string;
  message: string;
}

/** Domain (LedgerError) and idempotency errors both carry httpStatus + code. */
function isCoded(err: unknown): err is CodedError {
  return (
    typeof err === 'object' &&
    err !== null &&
    typeof (err as Record<string, unknown>).httpStatus === 'number' &&
    typeof (err as Record<string, unknown>).code === 'string'
  );
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err, req, reply) => {
    if (isCoded(err)) {
      return reply.code(err.httpStatus).send({ error: { code: err.code, message: err.message } });
    }
    if (err instanceof ZodError) {
      const message = err.issues
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('; ');
      return reply.code(400).send({ error: { code: 'invalid_request', message } });
    }
    // A serialization failure/deadlock that exhausted the retry budget: this is
    // retryable, not an internal error. Tell the client to retry (same key is safe).
    const sqlstate = (err as { code?: unknown }).code;
    if (sqlstate === '40001' || sqlstate === '40P01') {
      return reply.code(503).send({
        error: {
          code: 'serialization_conflict',
          message: 'serialization conflict; please retry',
        },
      });
    }
    // Fastify's own client-side errors (bad JSON, etc.)
    const fe = err as FastifyError;
    if (typeof fe.statusCode === 'number' && fe.statusCode >= 400 && fe.statusCode < 500) {
      return reply
        .code(fe.statusCode)
        .send({ error: { code: 'invalid_request', message: fe.message } });
    }
    req.log.error(err);
    return reply
      .code(500)
      .send({ error: { code: 'internal_error', message: 'internal server error' } });
  });
}
