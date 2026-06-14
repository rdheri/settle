-- Phase 1: invariant enforcement at the database level (defense in depth).
-- Even a buggy application cannot mutate history or commit an unbalanced
-- transaction: the database itself refuses.

-- ---------------------------------------------------------------------------
-- Append-only / immutability: block UPDATE and DELETE on the ledger tables.
-- ---------------------------------------------------------------------------
create or replace function settle_block_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'table "%" is append-only; % is not permitted', tg_table_name, tg_op
    using errcode = 'restrict_violation';
end;
$$;

create trigger entries_block_update
  before update on entries
  for each row execute function settle_block_mutation();

create trigger entries_block_delete
  before delete on entries
  for each row execute function settle_block_mutation();

create trigger transactions_block_update
  before update on transactions
  for each row execute function settle_block_mutation();

create trigger transactions_block_delete
  before delete on transactions
  for each row execute function settle_block_mutation();

-- ---------------------------------------------------------------------------
-- Per-transaction balance: sum(debits) == sum(credits), and >= 2 entries.
-- DEFERRABLE INITIALLY DEFERRED so the check runs at COMMIT, after every entry
-- of the transaction has been inserted.
-- ---------------------------------------------------------------------------
create or replace function settle_assert_balanced() returns trigger
language plpgsql as $$
declare
  v_tx     uuid := new.transaction_id;
  v_debit  bigint;
  v_credit bigint;
  v_count  int;
begin
  select
    coalesce(sum(amount) filter (where direction = 'debit'), 0),
    coalesce(sum(amount) filter (where direction = 'credit'), 0),
    count(*)
  into v_debit, v_credit, v_count
  from entries
  where transaction_id = v_tx;

  if v_count < 2 then
    raise exception 'transaction % must have at least 2 entries, found %', v_tx, v_count
      using errcode = 'check_violation';
  end if;

  if v_debit <> v_credit then
    raise exception 'transaction % is not balanced: debits=% credits=%', v_tx, v_debit, v_credit
      using errcode = 'check_violation';
  end if;

  return null;
end;
$$;

create constraint trigger entries_assert_balanced
  after insert on entries
  deferrable initially deferred
  for each row execute function settle_assert_balanced();
