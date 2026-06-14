import { config } from './config';
import { pool } from './db/pool';
import { migrateUp } from './db/migrate';
import { buildServer } from './http/server';
import { startOutboxPoller } from './outbox/outbox';

async function main(): Promise<void> {
  // Apply migrations on boot for a frictionless dev/Docker experience.
  await migrateUp();

  const app = buildServer({ logger: true });
  const poller = startOutboxPoller({ log: (msg) => app.log.info(msg) });

  await app.listen({ host: config.host, port: config.port });
  app.log.info(`SETTLE API listening on http://${config.host}:${config.port}`);

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info(`received ${signal}, shutting down`);
    await poller.stop();
    await app.close();
    await pool.end();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
