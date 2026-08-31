-- Public Lounge catalog and quota control plane.
--
-- Object storage remains the publication authority.  This catalog stores only
-- opaque public IDs plus ordering/liveness control metadata; every candidate
-- must be revalidated against its authoritative private Storage head.

begin;

create table if not exists public.schema_migrations (
  version text primary key,
  applied_at timestamptz not null default now()
);

create table if not exists public.public_lounge_catalog_anchors (
  public_id text primary key
    check (public_id ~ '^novel_[a-z0-9_-]{12,80}$'),
  published_at timestamptz not null,
  active boolean not null default true,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create index if not exists idx_public_lounge_catalog_active_cursor
  on public.public_lounge_catalog_anchors (published_at desc, public_id desc)
  where active;

create table if not exists public.public_lounge_rate_buckets (
  identity_hash text not null
    check (identity_hash ~ '^[a-f0-9]{64}$'),
  scope text not null
    check (scope in ('read', 'eligibility', 'publish', 'management', 'work_mutation')),
  window_start timestamptz not null,
  request_count integer not null check (request_count between 1 and 31),
  expires_at timestamptz not null,
  updated_at timestamptz not null default clock_timestamp(),
  primary key (identity_hash, scope, window_start)
);

create index if not exists idx_public_lounge_rate_expiry
  on public.public_lounge_rate_buckets (expires_at);

alter table public.public_lounge_catalog_anchors enable row level security;
alter table public.public_lounge_catalog_anchors force row level security;
alter table public.public_lounge_rate_buckets enable row level security;
alter table public.public_lounge_rate_buckets force row level security;

revoke all on public.public_lounge_catalog_anchors from public, anon, authenticated;
revoke all on public.public_lounge_rate_buckets from public, anon, authenticated;
grant select, insert, update, delete on public.public_lounge_catalog_anchors to service_role;
grant select, insert, update, delete on public.public_lounge_rate_buckets to service_role;

create or replace function public.novel_public_lounge_catalog_upsert(
  p_public_id text,
  p_published_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_changed integer := 0;
begin
  if p_public_id is null or p_public_id !~ '^novel_[a-z0-9_-]{12,80}$' then
    raise exception 'PUBLIC_LOUNGE_CATALOG_PUBLIC_ID_INVALID'
      using errcode = '22023';
  end if;
  if p_published_at is null then
    raise exception 'PUBLIC_LOUNGE_CATALOG_PUBLISHED_AT_INVALID'
      using errcode = '22023';
  end if;

  insert into public.public_lounge_catalog_anchors (
    public_id,
    published_at,
    active,
    created_at,
    updated_at
  ) values (
    p_public_id,
    p_published_at,
    true,
    clock_timestamp(),
    clock_timestamp()
  )
  on conflict (public_id) do update
    set active = true,
        updated_at = clock_timestamp()
    where public.public_lounge_catalog_anchors.published_at = excluded.published_at;

  get diagnostics v_changed = row_count;
  if v_changed <> 1 then
    raise exception 'PUBLIC_LOUNGE_CATALOG_ANCHOR_CONFLICT'
      using errcode = '23505';
  end if;
  return true;
end;
$$;

create or replace function public.novel_public_lounge_catalog_deactivate(
  p_public_id text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_changed integer := 0;
begin
  if p_public_id is null or p_public_id !~ '^novel_[a-z0-9_-]{12,80}$' then
    raise exception 'PUBLIC_LOUNGE_CATALOG_PUBLIC_ID_INVALID'
      using errcode = '22023';
  end if;

  update public.public_lounge_catalog_anchors
     set active = false,
         updated_at = clock_timestamp()
   where public_id = p_public_id
     and active;
  get diagnostics v_changed = row_count;

  -- Missing and already-inactive anchors are both safe/idempotent: neither can
  -- discover a work.  The authoritative Storage tombstone remains decisive.
  return v_changed = 1;
end;
$$;

create or replace function public.novel_public_lounge_catalog_list(
  p_after_published_at timestamptz default null,
  p_after_public_id text default null,
  p_limit integer default 24
)
returns table (
  public_id text,
  published_at timestamptz,
  has_more boolean
)
language plpgsql
security definer
set search_path = pg_catalog, public
stable
as $$
begin
  if (p_after_published_at is null) <> (p_after_public_id is null) then
    raise exception 'PUBLIC_LOUNGE_CATALOG_CURSOR_INVALID'
      using errcode = '22023';
  end if;
  if p_after_public_id is not null
     and p_after_public_id !~ '^novel_[a-z0-9_-]{12,80}$' then
    raise exception 'PUBLIC_LOUNGE_CATALOG_CURSOR_INVALID'
      using errcode = '22023';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'PUBLIC_LOUNGE_CATALOG_LIMIT_INVALID'
      using errcode = '22023';
  end if;

  return query
  with ordered as materialized (
    select anchor.public_id, anchor.published_at
      from public.public_lounge_catalog_anchors as anchor
     where anchor.active
       and (
         p_after_published_at is null
         or (anchor.published_at, anchor.public_id) < (p_after_published_at, p_after_public_id)
       )
     order by anchor.published_at desc, anchor.public_id desc
     limit p_limit + 1
  ), page as (
    select ordered.public_id,
           ordered.published_at,
           row_number() over (order by ordered.published_at desc, ordered.public_id desc) as ordinal
      from ordered
  )
  select page.public_id,
         page.published_at,
         exists(select 1 from page as overflow where overflow.ordinal > p_limit) as has_more
    from page
   where page.ordinal <= p_limit
   order by page.published_at desc, page.public_id desc;
end;
$$;

create or replace function public.novel_public_lounge_rate_reserve(
  p_identity_hash text,
  p_scope text
)
returns table (
  allowed boolean,
  quota_limit integer,
  remaining integer,
  retry_after_seconds integer
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_window_start timestamptz := date_trunc('minute', v_now);
  v_limit integer;
  v_count integer;
begin
  if p_identity_hash is null or p_identity_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'PUBLIC_LOUNGE_RATE_IDENTITY_INVALID'
      using errcode = '22023';
  end if;

  v_limit := case p_scope
    when 'read' then 30
    when 'eligibility' then 6
    when 'publish' then 6
    when 'management' then 6
    when 'work_mutation' then 6
    else null
  end;
  if v_limit is null then
    raise exception 'PUBLIC_LOUNGE_RATE_SCOPE_INVALID'
      using errcode = '22023';
  end if;

  -- Amortized, bounded TTL cleanup.  A request can remove at most 64 old rows;
  -- it never performs an unbounded sweep of the quota table.
  with expired as (
    select bucket.ctid
      from public.public_lounge_rate_buckets as bucket
     where bucket.expires_at <= v_now
     order by bucket.expires_at
     limit 64
  )
  delete from public.public_lounge_rate_buckets as bucket
   using expired
   where bucket.ctid = expired.ctid;

  insert into public.public_lounge_rate_buckets (
    identity_hash,
    scope,
    window_start,
    request_count,
    expires_at,
    updated_at
  ) values (
    p_identity_hash,
    p_scope,
    v_window_start,
    1,
    v_window_start + interval '1 minute',
    v_now
  )
  on conflict (identity_hash, scope, window_start) do update
    set request_count = least(
          public.public_lounge_rate_buckets.request_count + 1,
          v_limit + 1
        ),
        expires_at = excluded.expires_at,
        updated_at = excluded.updated_at
  returning request_count into v_count;

  return query select
    v_count <= v_limit,
    v_limit,
    greatest(0, v_limit - v_count),
    greatest(1, ceil(extract(epoch from (
      v_window_start + interval '1 minute' - v_now
    )))::integer);
end;
$$;

create or replace function public.novel_public_lounge_control_plane_status()
returns table (
  migration_version text,
  catalog_ready boolean,
  rate_ready boolean
)
language sql
security definer
set search_path = pg_catalog, public
stable
as $$
  select
    'public_lounge_control_plane_028'::text,
    to_regclass('public.public_lounge_catalog_anchors') is not null
      and exists(
        select 1 from public.schema_migrations
         where version = 'public_lounge_control_plane_028'
      ),
    to_regclass('public.public_lounge_rate_buckets') is not null
      and exists(
        select 1 from public.schema_migrations
         where version = 'public_lounge_control_plane_028'
      );
$$;

revoke all on function public.novel_public_lounge_catalog_upsert(text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.novel_public_lounge_catalog_deactivate(text)
  from public, anon, authenticated;
revoke all on function public.novel_public_lounge_catalog_list(timestamptz, text, integer)
  from public, anon, authenticated;
revoke all on function public.novel_public_lounge_rate_reserve(text, text)
  from public, anon, authenticated;
revoke all on function public.novel_public_lounge_control_plane_status()
  from public, anon, authenticated;

grant execute on function public.novel_public_lounge_catalog_upsert(text, timestamptz)
  to service_role;
grant execute on function public.novel_public_lounge_catalog_deactivate(text)
  to service_role;
grant execute on function public.novel_public_lounge_catalog_list(timestamptz, text, integer)
  to service_role;
grant execute on function public.novel_public_lounge_rate_reserve(text, text)
  to service_role;
grant execute on function public.novel_public_lounge_control_plane_status()
  to service_role;

insert into public.schema_migrations(version)
values ('public_lounge_control_plane_028')
on conflict (version) do nothing;

commit;
