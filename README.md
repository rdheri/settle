# SETTLE

A financial-grade **double-entry ledger service** with a clean HTTP API for moving
money between accounts, plus a reconciliation/audit dashboard.

The point of this project is **correctness under failure**, proven — not a CRUD
banking app. Every money movement is an immutable, balanced double-entry
transaction; every write endpoint is safe to retry any number of times
(idempotent); money moves **exactly once** under retries and concurrency; and a
**fault-injection harness** demonstrates these guarantees with measurable numbers.

```
operations attempted ........ 2152
applied exactly once ........ 2101
duplicates short-circuited .. ~430
serialization retries ....... ~2000   (handled transparently; 0 surfaced as errors)
final balance drift ......... 0        (global signed sum of all entries)
throughput .................. ~340 transfers/sec   (32-way concurrency, durable commits)
RESULT: ✅ ALL GUARANTEES HELD
```

> Throughput is fully-serializable, idempotent, double-entry transfers/sec against a
> single Dockerized Postgres on macOS with **durable commits** (two fsync'd commits per
> transfer: the idempotency claim + the ledger write). It is bound by Docker-on-macOS
> fsync latency, not by the code; on bare-metal Linux it is materially higher. The
> headline is the **zero drift and exactly-once** behavior, which holds regardless.

---

## Architecture

TypeScript monorepo (pnpm workspaces), single language on purpose — the signal is the
invariants and the proof, not the framework count.

```
settle/
  apps/
    api/         Fastify + Postgres (raw SQL via node-postgres). The money path is
                 explicit and reviewable. Runs via tsx (no build step).
      migrations/        numbered .sql files + a tiny runner
      src/db/            pool, serializable-tx helper, migration runner
      src/ledger/        double-entry core (createTransaction, balances, reconciliation)
      src/idempotency/   the exactly-once state machine + request fingerprinting
      src/outbox/        transactional outbox + background poller
      src/http/          Fastify server, routes, error mapping, idempotent-write wrapper
      test/              vitest: invariants, idempotency, serialization, HTTP
      harness/           the fault-injection harness
    dashboard/   Vite + React reconciliation/audit UI
  packages/
    shared/      shared request/response types + zod schemas
```

---

## The double-entry model

- **accounts** `(id, name, type[asset|liability|equity|revenue|expense], created_at)`
- **transactions** `(id, idempotency_key UNIQUE, description, created_at)` — one logical
  money movement, **immutable** once written.
- **entries** `(id, transaction_id, account_id, amount BIGINT, direction[debit|credit],
created_at)` — **append-only and immutable**; never updated or deleted.
- **idempotency_keys**, **outbox_events** — see below.

**Money is integer minor units (cents), stored as `BIGINT`. Never floats, ever.**
`amount` is a positive magnitude (`CHECK amount > 0`); `direction` carries the sign.

### Sign convention & invariants

A debit contributes `+amount`, a credit contributes `−amount`. So:

- **Per-transaction invariant:** `sum(debits) == sum(credits)` (i.e. the signed sum of
  a transaction's entries is 0), and a transaction has **≥ 2 entries**.
- **Global invariant:** the signed sum of **all** entries is **0 at all times**.
- **Account balance** is _derived_ — `Σ(signed entries)` for that account — never stored
  as a mutable field that can drift.
- **Non-negative rule:** debit-normal accounts (`asset`, `expense`) may not go negative.
  The check reads the current balance and writes entries **inside the same serializable
  transaction**, so check-then-act is atomic (opt out per call with `allow_negative`).

These are enforced in the application **and** at the database level as defense in depth:

| Rule                                      | DB-level enforcement                                   |
| ----------------------------------------- | ------------------------------------------------------ |
| Entries/transactions are immutable        | `BEFORE UPDATE/DELETE` triggers that `RAISE EXCEPTION` |
| `amount > 0`, valid `direction`/`type`    | `CHECK` constraints                                    |
| One key → one movement                    | `UNIQUE(transactions.idempotency_key)`                 |
| `sum(debits) == sum(credits)`, ≥2 entries | **deferred** constraint trigger checked at `COMMIT`    |

---

## Idempotency: the exactly-once state machine

Clients send an `Idempotency-Key` header on every write. The key's lifecycle is stored in
`idempotency_keys(key PK, request_fingerprint, state[in_progress|completed],
response_status, response_body jsonb, transaction_id, created_at, updated_at)`.

```
claim:  INSERT .. ON CONFLICT DO NOTHING        -- the UNIQUE PK is the concurrency gate
  ├─ won  → run work + record response in ONE serializable tx → state=completed
  └─ lost → inspect the existing row:
        fingerprint mismatch              → 422  (key reused for a different payload)
        state = completed                 → replay the stored response (no re-work)
        state = in_progress  (fresh)      → 409  (a concurrent retry is in flight)
        state = in_progress  (stale)      → reclaim the abandoned claim, then run work
```

The three duplicate cases the harness/tests cover:

1. **Completed** → the stored `{status, body}` is returned and the work is **not** re-run.
   (Replays are value-identical; note the `jsonb` response column normalizes JSON key
   order, so bytes may differ in key order — not part of the HTTP contract.)
2. **In-progress** → `409 Conflict` (concurrent retry; never double-applies).
3. **Fingerprint mismatch** → `422` (the SHA-256 of `method + path + canonical JSON body`
   differs, so the key is being reused for a different request).

Crash handling:

- **Killed after the write committed, before the response was sent** → on retry the key is
  `completed`, so the stored response is replayed. **No double-apply.**
- **Killed before the write committed** → the `in_progress` claim is left behind; a retry
  inside the stale window gets `409`, and after the configurable stale window the claim is
  reclaimed and redone (nothing was applied, so it applies exactly once).
- A **deterministic domain error** (e.g. insufficient funds) is recorded and replayed
  (same key + same body → same error). A **non-deterministic/infra error** releases the
  claim so a retry can legitimately redo the work.

---

## Concurrency: why serializable + retry = exactly-once

Money-moving writes run at **`SERIALIZABLE`** isolation. Postgres's SSI detects any
read/write skew between concurrent transactions and aborts the loser with SQLSTATE
`40001`. The `withSerializableTx` helper catches `40001`/`40P01` and retries with bounded
exponential backoff + jitter. Because the balance check and the entry writes happen in the
**same** serializable transaction, "read balance → decide → write" is atomic: two
concurrent transfers can never both pass a balance check and overdraw an account. If the
retry budget is exhausted, the API returns a retryable **`503`** (not a `500`), and the
client may safely retry — with the same idempotency key.

This is proven directly: a unit test forces a `40001`-then-succeed sequence; a concurrency
test fires 10 transfers at one funded account and asserts exactly 5 commit, the account
never goes negative, and the global sum stays 0 (with ~20 real serialization retries
observed); and the harness drives 2000 overlapping concurrent transfers with zero drift.

---

## Outbox: reliable events without a dual-write race

Every transaction/transfer writes an `outbox_events` row **in the same database
transaction** as the ledger write — so an event exists if and only if the money moved
(no dual-write race). A background poller drains unpublished rows with
`FOR UPDATE SKIP LOCKED` (safe for multiple pollers) and marks them published, simulating
"emit to a queue" with reliable at-least-once delivery.

---

## API

All **writes require an `Idempotency-Key` header**. Responses carry an
`Idempotent-Replayed: true|false` header.

| Method | Path                                                         | Description                                                                                                                                     |
| ------ | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST` | `/accounts`                                                  | Create an account `{ name, type }`                                                                                                              |
| `GET`  | `/accounts/:id/balance`                                      | Derived balance                                                                                                                                 |
| `POST` | `/transactions`                                              | `{ description?, entries:[{account_id, amount, direction}], allow_negative? }` — server validates `sum(debits)==sum(credits)` before committing |
| `POST` | `/transfer`                                                  | `{ from, to, amount, description?, allow_negative? }` — expands to a balanced 2-entry transaction                                               |
| `GET`  | `/transactions/:id`                                          | Full immutable record                                                                                                                           |
| `GET`  | `/transactions?limit=`                                       | Recent transactions (ledger view)                                                                                                               |
| `GET`  | `/reconciliation`                                            | Global signed sum (must be 0), per-account balances, counts, detected anomalies                                                                 |
| `GET`  | `/outbox/stats`, `/metrics`, `/fault-runs/latest`, `/health` | Operational endpoints                                                                                                                           |

---

## Running it

**Prerequisites:** Node ≥ 20, pnpm ≥ 9, Docker (for Postgres).

```bash
pnpm install
cp .env.example .env
pnpm db:up                 # start Postgres 16 (host port 5433)
pnpm migrate               # apply SQL migrations
pnpm dev                   # API on http://localhost:3000 (also auto-migrates on boot)

pnpm --filter @settle/dashboard dev   # dashboard on http://localhost:5173 (proxies /api)
```

Quick smoke:

```bash
curl -XPOST localhost:3000/accounts -H 'content-type: application/json' \
  -H "idempotency-key: $(uuidgen)" -d '{"name":"Cash","type":"asset"}'
curl localhost:3000/reconciliation
```

### Tests

```bash
pnpm --filter @settle/api test
# 30 tests: invariants (per-tx + global + non-negative + concurrency),
# idempotency (completed/in-progress/fingerprint/stale/infra/domain-error),
# serialization retry, and HTTP (inject) coverage.
```

### Fault-injection harness (the headline)

```bash
pnpm harness
```

It spawns the real API as a separate process and drives it over HTTP:

- **A — concurrent same-key:** 50 identical transfers, one idempotency key → applied once,
  all responses identical.
- **B — concurrent distinct transfers (overlapping accounts):** 2000 transfers @ 32-way
  concurrency → no lost updates, no negative balances, total conserved, global sum 0
  (this is where the throughput number comes from).
- **C — kill-after-write then retry:** 100 transfers aborted mid-flight then retried with
  the same key → no double-apply.
- **Final sweep:** global invariant (`sum == 0`) re-derived straight from the DB, and
  every transaction internally balanced.

It prints the summary above and writes it to `apps/api/harness/last-run.json`, which the
dashboard renders in its Fault-Injection panel.

### Everything in containers

```bash
docker compose up --build      # db + api (api on :3000, reachable inside the network at db:5432)
```

---

## Quality bar

- Strict TypeScript (`noUncheckedIndexedAccess`, `verbatimModuleSyntax`). Money is `BIGINT`
  cents everywhere; the BIGINT→number parser **fails loud** beyond 2^53 rather than losing
  precision.
- vitest: invariant, idempotency (all three duplicate cases), and serialization-retry tests.
- SQL schema as migration files; `.env.example`; `docker-compose.yml`; `Dockerfile`.
- ESLint (flat config) + Prettier; CI-style `pnpm typecheck && pnpm lint && pnpm test`.
