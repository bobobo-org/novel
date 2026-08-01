-- End-to-end encrypted, local-first project cloud synchronization.
-- Additive and idempotent. IndexedDB remains canonical; Supabase stores only
-- opaque ciphertext plus revision and integrity metadata.

create table if not exists public.schema_migrations (
  version text primary key,
  applied_at timestamptz not null default now()
);

alter table public.schema_migrations enable row level security;

create table if not exists public.novel_cloud_snapshots (
  owner_id text not null,
  project_id text not null,
  revision bigint not null default 1 check (revision > 0),
  payload_hash text not null check (payload_hash ~ '^[a-f0-9]{64}$'),
  encrypted_bytes integer not null check (encrypted_bytes > 0 and encrypted_bytes <= 2700000),
  envelope_json jsonb not null,
  last_operation_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, project_id)
);

create table if not exists public.novel_cloud_sync_operations (
  owner_id text not null,
  operation_id text not null,
  project_id text not null,
  previous_revision bigint not null,
  resulting_revision bigint not null,
  payload_hash text not null,
  created_at timestamptz not null default now(),
  primary key (owner_id, operation_id)
);

create index if not exists idx_novel_cloud_snapshots_owner_updated
  on public.novel_cloud_snapshots(owner_id, updated_at desc);
create index if not exists idx_novel_cloud_operations_project_created
  on public.novel_cloud_sync_operations(owner_id, project_id, created_at desc);

alter table public.novel_cloud_snapshots enable row level security;
alter table public.novel_cloud_sync_operations enable row level security;

revoke all on public.novel_cloud_snapshots from anon, authenticated;
revoke all on public.novel_cloud_sync_operations from anon, authenticated;

create or replace function public.novel_cloud_sync_push(
  p_owner_id text,
  p_project_id text,
  p_operation_id text,
  p_expected_revision bigint,
  p_payload_hash text,
  p_encrypted_bytes integer,
  p_envelope_json jsonb
)
returns table (
  result_status text,
  result_revision bigint,
  result_payload_hash text,
  result_updated_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_revision bigint;
  current_hash text;
  current_updated_at timestamptz;
  existing_operation public.novel_cloud_sync_operations%rowtype;
  next_revision bigint;
begin
  if p_owner_id !~ '^[a-f0-9]{64}$'
    or p_project_id !~ '^[A-Za-z0-9_-]{1,160}$'
    or p_operation_id !~ '^[A-Za-z0-9:_-]{8,160}$'
    or p_payload_hash !~ '^[a-f0-9]{64}$'
    or p_expected_revision < 0
    or p_encrypted_bytes < 1
    or p_encrypted_bytes > 2700000
    or p_envelope_json is null
  then
    raise exception 'CLOUD_SYNC_INPUT_INVALID' using errcode = '22023';
  end if;

  -- Serialize both the first insert and later revisions for one opaque owner/project.
  -- A row lock alone cannot protect the first write because no row exists yet.
  perform pg_advisory_xact_lock(hashtextextended(p_owner_id || ':' || p_project_id, 0));

  select * into existing_operation
  from public.novel_cloud_sync_operations
  where owner_id = p_owner_id and operation_id = p_operation_id;

  if found then
    if existing_operation.project_id <> p_project_id
      or existing_operation.payload_hash <> p_payload_hash
    then
      raise exception 'CLOUD_SYNC_IDEMPOTENCY_MISMATCH' using errcode = '22023';
    end if;
    return query select
      'idempotent'::text,
      existing_operation.resulting_revision,
      existing_operation.payload_hash,
      existing_operation.created_at;
    return;
  end if;

  select revision, payload_hash, updated_at
    into current_revision, current_hash, current_updated_at
  from public.novel_cloud_snapshots
  where owner_id = p_owner_id and project_id = p_project_id
  for update;

  if not found then
    current_revision := 0;
    current_hash := '';
    current_updated_at := now();
  end if;

  if current_revision <> p_expected_revision then
    return query select
      'conflict'::text,
      current_revision,
      current_hash,
      current_updated_at;
    return;
  end if;

  next_revision := current_revision + 1;
  insert into public.novel_cloud_snapshots (
    owner_id, project_id, revision, payload_hash, encrypted_bytes,
    envelope_json, last_operation_id, created_at, updated_at
  ) values (
    p_owner_id, p_project_id, next_revision, p_payload_hash,
    p_encrypted_bytes, p_envelope_json, p_operation_id, now(), now()
  )
  on conflict (owner_id, project_id) do update set
    revision = excluded.revision,
    payload_hash = excluded.payload_hash,
    encrypted_bytes = excluded.encrypted_bytes,
    envelope_json = excluded.envelope_json,
    last_operation_id = excluded.last_operation_id,
    updated_at = excluded.updated_at;

  insert into public.novel_cloud_sync_operations (
    owner_id, operation_id, project_id, previous_revision,
    resulting_revision, payload_hash, created_at
  ) values (
    p_owner_id, p_operation_id, p_project_id, current_revision,
    next_revision, p_payload_hash, now()
  );

  return query select 'stored'::text, next_revision, p_payload_hash, now();
end;
$$;

revoke all on function public.novel_cloud_sync_push(text, text, text, bigint, text, integer, jsonb)
  from public, anon, authenticated;
grant execute on function public.novel_cloud_sync_push(text, text, text, bigint, text, integer, jsonb)
  to service_role;

insert into public.schema_migrations(version)
values ('cloud_sync_e2ee_025')
on conflict (version) do nothing;
