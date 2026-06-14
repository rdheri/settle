-- Phase 1: core double-entry schema.
-- Money is BIGINT minor units (cents) everywhere; never a float.
-- entries are append-only & immutable (enforced by triggers in 0002).

-- ---------------------------------------------------------------------------
-- accounts: the chart of accounts.
-- ---------------------------------------------------------------------------
create table accounts (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(name) > 0),
  type       text not null check (type in ('asset', 'liability', 'equity', 'revenue', 'expense')),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- transactions: one logical, balanced money movement. Immutable once written.
-- idempotency_key is UNIQUE so a given client key maps to at most one movement
-- (belt-and-suspenders behind the idempotency_keys state machine).
-- ---------------------------------------------------------------------------
create table transactions (
  id              uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  description     text not null default '',
  created_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- entries: the append-only ledger lines. amount is a POSITIVE magnitude;
-- `direction` carries the sign. Per-transaction sum(debits) == sum(credits)
-- is enforced by a deferred constraint trigger (0002).
-- Signed value convention: debit = +amount, credit = -amount.
-- Global invariant: SUM(signed value) over ALL entries == 0 at all times.
-- ---------------------------------------------------------------------------
create table entries (
  id             uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references transactions(id),
  account_id     uuid not null references accounts(id),
  amount         bigint not null check (amount > 0),
  direction      text not null check (direction in ('debit', 'credit')),
  created_at     timestamptz not null default now()
);

create index entries_account_id_idx on entries (account_id);
create index entries_transaction_id_idx on entries (transaction_id);

-- ---------------------------------------------------------------------------
-- idempotency_keys: the exactly-once state machine store.
-- PRIMARY KEY(key) is the concurrency gate: the first INSERT wins, concurrent
-- retries collide and are routed by state + fingerprint.
-- ---------------------------------------------------------------------------
create table idempotency_keys (
  key                  text primary key,
  request_fingerprint  text not null,
  state                text not null check (state in ('in_progress', 'completed')),
  response_status      int,
  response_body        jsonb,
  transaction_id       uuid references transactions(id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- outbox_events: written in the SAME transaction as the ledger write, drained
-- by a background poller (at-least-once emission, no dual-write race).
-- ---------------------------------------------------------------------------
create table outbox_events (
  id             uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references transactions(id),
  type           text not null,
  payload        jsonb not null,
  created_at     timestamptz not null default now(),
  published_at   timestamptz
);

-- Partial index: the poller only ever scans unpublished rows.
create index outbox_unpublished_idx on outbox_events (created_at) where published_at is null;
