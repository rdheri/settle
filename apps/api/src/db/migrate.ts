import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './pool';
import type { PoolClient } from './pool';

const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../migrations');

async function ensureMigrationsTable(client: PoolClient): Promise<void> {
  await client.query(`
    create table if not exists schema_migrations (
      version    text primary key,
      applied_at timestamptz not null default now()
    );
  `);
}

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

async function appliedVersions(client: PoolClient): Promise<Set<string>> {
  const res = await client.query<{ version: string }>('select version from schema_migrations');
  return new Set(res.rows.map((r) => r.version));
}

async function up(): Promise<void> {
  const client = await pool.connect();
  try {
    await ensureMigrationsTable(client);
    const applied = await appliedVersions(client);
    const pending = migrationFiles().filter((f) => !applied.has(f));

    if (pending.length === 0) {
      console.log('No pending migrations.');
      return;
    }

    for (const file of pending) {
      const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
      process.stdout.write(`Applying ${file} ... `);
      // Each migration is one atomic unit: all-or-nothing.
      await client.query('begin');
      try {
        await client.query(sql);
        await client.query('insert into schema_migrations(version) values ($1)', [file]);
        await client.query('commit');
        console.log('ok');
      } catch (err) {
        await client.query('rollback');
        console.log('FAILED');
        throw err;
      }
    }
    console.log(`Applied ${pending.length} migration(s).`);
  } finally {
    client.release();
  }
}

async function status(): Promise<void> {
  const client = await pool.connect();
  try {
    await ensureMigrationsTable(client);
    const applied = await appliedVersions(client);
    for (const file of migrationFiles()) {
      console.log(`${applied.has(file) ? '[x] applied' : '[ ] pending'}  ${file}`);
    }
  } finally {
    client.release();
  }
}

const command = process.argv[2] ?? 'up';
const action = command === 'status' ? status : up;

action()
  .then(() => pool.end())
  .catch((err: unknown) => {
    console.error(err);
    void pool.end().finally(() => process.exit(1));
  });
