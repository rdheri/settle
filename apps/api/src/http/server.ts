import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { config } from '../config';
import { registerErrorHandler } from './errors';
import { registerRoutes } from './routes';

export function buildServer(opts: { logger?: boolean } = {}): FastifyInstance {
  const app = Fastify({
    logger: opts.logger ?? false,
    bodyLimit: 1_048_576,
    trustProxy: true,
  });

  // Security headers. CSP is off because this process only serves JSON.
  void app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  });

  void app.register(cors, {
    origin: config.corsOrigin === '*' ? true : config.corsOrigin.split(','),
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['content-type', 'idempotency-key'],
    exposedHeaders: ['idempotent-replayed'],
  });

  void app.register(rateLimit, {
    max: config.rateLimitMax,
    timeWindow: config.rateLimitWindow,
    // Health/metrics probes shouldn't consume a client's request budget.
    allowList: (req) => req.url === '/health' || req.url === '/metrics',
  });

  registerErrorHandler(app);
  void app.register(async (instance) => {
    registerRoutes(instance);
  });

  return app;
}
