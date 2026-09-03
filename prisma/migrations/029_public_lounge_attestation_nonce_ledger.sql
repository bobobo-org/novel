-- Public Lounge v5 trusted-attestation single-use ledger.
--
-- The verifier validates the complete attestation before calling the consume
-- RPC.  This table stores hashes and minimal routing metadata only; it never
-- stores raw attestation IDs, signatures, publication text, or signing keys.

begin;

create table if not exists public.schema_migrations (
  version text primary key,
  applied_at timestamptz not null default now()
);

create table if not exists public.public_lounge_attestation_nonce_ledger (
  attestation_id_hash text primary key
    check (attestation_id_hash ~ '^[a-f0-9]{64}$'),
  attestation_digest text not null
    unique check (attestation_digest ~ '^[a-f0-9]{64}$'),
  binding_digest text not null
    check (binding_digest ~ '^[a-f0-9]{64}$'),
  eligibility_ticket_hash text not null
    unique check (eligibility_ticket_hash ~ '^[a-f0-9]{64}$'),
  authorized_owner_id_hash text not null
    check (authorized_owner_id_hash ~ '^[a-f0-9]{64}$'),
  intent text not null
    check (intent in ('publish', 'overwrite')),
  environment text not null
    check (environment in ('preview', 'production')),
  expires_at timestamptz not null,
  consumed_at timestamptz not null default clock_timestamp()
);

create index if not exists idx_public_lounge_attestation_nonce_expiry
  on public.public_lounge_attestation_nonce_ledger (expires_at);

alter table public.public_lounge_attestation_nonce_ledger enable row level security;
alter table public.public_lounge_attestation_nonce_ledger force row level security;

revoke all on public.public_lounge_attestation_nonce_ledger
  from public, anon, authenticated, service_role;

create or replace function public.novel_public_lounge_consume_attestation_v5(
  p_attestation_id_hash text,
  p_attestation_digest text,
  p_binding_digest text,
  p_eligibility_ticket_hash text,
  p_authorized_owner_id_hash text,
  p_intent text,
  p_environment text,
  p_expires_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_inserted integer := 0;
begin
  if p_attestation_id_hash is null
     or p_attestation_id_hash !~ '^[a-f0-9]{64}$'
     or p_attestation_digest is null
     or p_attestation_digest !~ '^[a-f0-9]{64}$'
     or p_binding_digest is null
     or p_binding_digest !~ '^[a-f0-9]{64}$'
     or p_eligibility_ticket_hash is null
     or p_eligibility_ticket_hash !~ '^[a-f0-9]{64}$'
     or p_authorized_owner_id_hash is null
     or p_authorized_owner_id_hash !~ '^[a-f0-9]{64}$'
     or p_intent not in ('publish', 'overwrite')
     or p_environment not in ('preview', 'production')
     or p_expires_at is null
     or p_expires_at <= v_now
     or p_expires_at > v_now + interval '30 minutes' then
    raise exception 'PUBLIC_LOUNGE_ATTESTATION_CONSUMPTION_INVALID'
      using errcode = '22023';
  end if;

  insert into public.public_lounge_attestation_nonce_ledger (
    attestation_id_hash,
    attestation_digest,
    binding_digest,
    eligibility_ticket_hash,
    authorized_owner_id_hash,
    intent,
    environment,
    expires_at,
    consumed_at
  ) values (
    p_attestation_id_hash,
    p_attestation_digest,
    p_binding_digest,
    p_eligibility_ticket_hash,
    p_authorized_owner_id_hash,
    p_intent,
    p_environment,
    p_expires_at,
    v_now
  )
  -- Only a duplicate attestation ID is the expected replay outcome.  Any
  -- collision on the independently unique attestation or ticket digests is an
  -- ambiguous integrity failure and must raise so the caller fails closed.
  on conflict (attestation_id_hash) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted = 1;
end;
$$;

create or replace function public.novel_public_lounge_attestation_ledger_status()
returns table (
  migration_version text,
  ledger_ready boolean
)
language sql
security definer
set search_path = pg_catalog, public
stable
as $$
  select
    'public_lounge_attestation_nonce_ledger_029'::text,
    exists(
      select 1
        from pg_catalog.pg_class as relation
        join pg_catalog.pg_namespace as namespace
          on namespace.oid = relation.relnamespace
       where namespace.nspname = 'public'
         and relation.relname = 'public_lounge_attestation_nonce_ledger'
         and relation.relkind = 'r'
         and relation.relrowsecurity
         and relation.relforcerowsecurity
    )
      and exists(
        select 1
          from pg_catalog.pg_constraint as constraint_record
         where constraint_record.conrelid = to_regclass('public.public_lounge_attestation_nonce_ledger')
           and constraint_record.contype = 'p'
           and pg_catalog.pg_get_constraintdef(constraint_record.oid) = 'PRIMARY KEY (attestation_id_hash)'
      )
      and exists(
        select 1
          from pg_catalog.pg_constraint as constraint_record
         where constraint_record.conrelid = to_regclass('public.public_lounge_attestation_nonce_ledger')
           and constraint_record.contype = 'u'
           and pg_catalog.pg_get_constraintdef(constraint_record.oid) = 'UNIQUE (attestation_digest)'
      )
      and exists(
        select 1
          from pg_catalog.pg_constraint as constraint_record
         where constraint_record.conrelid = to_regclass('public.public_lounge_attestation_nonce_ledger')
           and constraint_record.contype = 'u'
           and pg_catalog.pg_get_constraintdef(constraint_record.oid) = 'UNIQUE (eligibility_ticket_hash)'
      )
      and coalesce(not has_table_privilege(
        'service_role',
        to_regclass('public.public_lounge_attestation_nonce_ledger'),
        'SELECT,INSERT,UPDATE,DELETE'
      ), false)
      and coalesce(not has_table_privilege(
        'anon',
        to_regclass('public.public_lounge_attestation_nonce_ledger'),
        'SELECT,INSERT,UPDATE,DELETE'
      ), false)
      and coalesce(not has_table_privilege(
        'authenticated',
        to_regclass('public.public_lounge_attestation_nonce_ledger'),
        'SELECT,INSERT,UPDATE,DELETE'
      ), false)
      and coalesce(has_function_privilege(
        'service_role',
        to_regprocedure('public.novel_public_lounge_consume_attestation_v5(text,text,text,text,text,text,text,timestamp with time zone)'),
        'EXECUTE'
      ), false)
      and coalesce(not has_function_privilege(
        'anon',
        to_regprocedure('public.novel_public_lounge_consume_attestation_v5(text,text,text,text,text,text,text,timestamp with time zone)'),
        'EXECUTE'
      ), false)
      and coalesce(not has_function_privilege(
        'authenticated',
        to_regprocedure('public.novel_public_lounge_consume_attestation_v5(text,text,text,text,text,text,text,timestamp with time zone)'),
        'EXECUTE'
      ), false)
      and exists(
        select 1
          from pg_catalog.pg_proc as function_record
         where function_record.oid = to_regprocedure('public.novel_public_lounge_consume_attestation_v5(text,text,text,text,text,text,text,timestamp with time zone)')
           and function_record.prosecdef
           and position(
             'on conflict (attestation_id_hash) do nothing'
             in lower(pg_catalog.pg_get_functiondef(function_record.oid))
           ) > 0
           and position(
             'clock_timestamp()'
             in lower(pg_catalog.pg_get_functiondef(function_record.oid))
           ) > 0
      )
      and exists(
        select 1 from public.schema_migrations
         where version = 'public_lounge_attestation_nonce_ledger_029'
      );
$$;

revoke all on function public.novel_public_lounge_consume_attestation_v5(text, text, text, text, text, text, text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.novel_public_lounge_attestation_ledger_status()
  from public, anon, authenticated;

grant execute on function public.novel_public_lounge_consume_attestation_v5(text, text, text, text, text, text, text, timestamptz)
  to service_role;
grant execute on function public.novel_public_lounge_attestation_ledger_status()
  to service_role;

insert into public.schema_migrations(version)
values ('public_lounge_attestation_nonce_ledger_029')
on conflict (version) do nothing;

commit;
