import { pool } from '../../src/db/pool';
import { migrateUp } from '../../src/db/migrate';

let schemaReady = false;

/** Ensure migrations are applied once per test process (quiet). */
export async function ensureSchema(): Promise<void> {
  if (schemaReady) return;
  await migrateUp(() => {});
  schemaReady = true;
}

/** Wipe all data between tests. TRUNCATE bypasses the append-only row triggers. */
export async function resetDb(): Promise<void> {
  await pool.query(
    'truncate entries, transactions, accounts, idempotency_keys, outbox_events restart identity cascade',
  );
}

export async function closeDb(): Promise<void> {
  await pool.end();
}
