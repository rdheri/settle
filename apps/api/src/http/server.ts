import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { registerErrorHandler } from './errors';
import { registerRoutes } from './routes';

export function buildServer(opts: { logger?: boolean } = {}): FastifyInstance {
  const app = Fastify({
    logger: opts.logger ?? false,
    bodyLimit: 1_048_576,
  });

  // Permissive CORS so the local dashboard (Vite) can call the API directly.
  app.addHook('onRequest', async (req, reply) => {
    reply.header('access-control-allow-origin', '*');
    reply.header('access-control-allow-headers', 'content-type, idempotency-key');
    reply.header('access-control-allow-methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') {
      await reply.code(204).send();
    }
  });

  registerErrorHandler(app);
  registerRoutes(app);
  return app;
}
