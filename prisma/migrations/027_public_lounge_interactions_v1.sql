-- Public lounge interactions v1: transactional, authenticated, and fail closed.
--
-- Applying this migration does not enable the UI. PUBLIC_LOUNGE_INTERACTIONS_ENABLED
-- must remain 0 until the application has recoverable Supabase Auth sessions and the
-- publication service binds every public_id to an auth.users owner via the service-role
-- only binding function below.

create table if not exists public.schema_migrations (
  version text primary key,
  applied_at timestamptz not null default now()
);

create extension if not exists pgcrypto;

create table if not exists public.public_lounge_publication_owners (
  public_id text primary key check (public_id ~ '^novel_[a-z0-9_-]{12,80}$'),
  owner_id uuid not null references auth.users(id) on delete restrict,
  current_version_id text not null check (current_version_id ~ '^version_[a-z0-9_-]{12,96}$'),
  current_version_number integer not null check (current_version_number > 0),
  chapter_count integer not null check (chapter_count between 1 and 100000),
  active boolean not null default true,
  bound_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.public_lounge_publication_owners
  add column if not exists active boolean not null default true;
alter table public.public_lounge_publication_owners
  add column if not exists current_version_number integer not null default 1;

create table if not exists public.public_lounge_votes (
  public_id text not null references public.public_lounge_publication_owners(public_id) on delete cascade,
  voter_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (public_id, voter_id)
);

create table if not exists public.public_lounge_comments (
  id uuid primary key default gen_random_uuid(),
  public_id text not null references public.public_lounge_publication_owners(public_id) on delete cascade,
  version_id text not null check (version_id ~ '^version_[a-z0-9_-]{12,96}$'),
  chapter_number integer check (chapter_number is null or chapter_number > 0),
  commenter_id uuid not null references auth.users(id) on delete restrict,
  display_name text not null check (char_length(display_name) between 1 and 48),
  body text not null check (char_length(body) between 1 and 1200),
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references auth.users(id) on delete restrict,
  delete_actor text check (delete_actor is null or delete_actor in ('commenter', 'author', 'moderator')),
  check (
    (deleted_at is null and deleted_by is null and delete_actor is null)
    or (deleted_at is not null and deleted_by is not null and delete_actor is not null)
  )
);

create table if not exists public.public_lounge_comment_audit (
  audit_id bigint generated always as identity primary key,
  comment_id uuid not null,
  public_id text not null,
  actor_id uuid not null references auth.users(id) on delete restrict,
  action text not null check (action in ('soft_delete')),
  actor_role text not null check (actor_role in ('commenter', 'author', 'moderator')),
  reason text not null check (char_length(reason) between 2 and 240),
  body_digest text not null check (body_digest ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now()
);

create table if not exists public.public_lounge_reports (
  id uuid primary key default gen_random_uuid(),
  public_id text not null references public.public_lounge_publication_owners(public_id) on delete cascade,
  target_comment_id uuid references public.public_lounge_comments(id) on delete restrict,
  reporter_id uuid not null references auth.users(id) on delete cascade,
  reason_code text not null check (reason_code in (
    'spam', 'harassment', 'hate', 'sexual_content', 'violence',
    'copyright', 'privacy', 'impersonation', 'other'
  )),
  details text not null default '' check (char_length(details) <= 800),
  status text not null default 'pending' check (status in ('pending', 'reviewing', 'resolved', 'dismissed')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  check (
    (status in ('pending', 'reviewing') and resolved_at is null)
    or (status in ('resolved', 'dismissed') and resolved_at is not null)
  )
);

create unique index if not exists ux_public_lounge_report_once_per_reason
  on public.public_lounge_reports (
    reporter_id,
    public_id,
    coalesce(target_comment_id, '00000000-0000-0000-0000-000000000000'::uuid),
    reason_code
  );

create table if not exists public.public_lounge_interaction_rate_events (
  event_id bigint generated always as identity primary key,
  actor_id uuid not null references auth.users(id) on delete cascade,
  action text not null check (action in ('vote', 'comment', 'report', 'comment_delete')),
  created_at timestamptz not null default now()
);

create index if not exists idx_public_lounge_comments_public_created
  on public.public_lounge_comments(public_id, created_at desc, id desc)
  where deleted_at is null;
create index if not exists idx_public_lounge_reports_pending
  on public.public_lounge_reports(status, created_at asc);
create index if not exists idx_public_lounge_rate_actor_action_created
  on public.public_lounge_interaction_rate_events(actor_id, action, created_at desc);

alter table public.public_lounge_publication_owners enable row level security;
alter table public.public_lounge_votes enable row level security;
alter table public.public_lounge_comments enable row level security;
alter table public.public_lounge_comment_audit enable row level security;
alter table public.public_lounge_reports enable row level security;
alter table public.public_lounge_interaction_rate_events enable row level security;

revoke all on public.public_lounge_publication_owners from public, anon, authenticated;
revoke all on public.public_lounge_votes from public, anon, authenticated;
revoke all on public.public_lounge_comments from public, anon, authenticated;
revoke all on public.public_lounge_comment_audit from public, anon, authenticated;
revoke all on public.public_lounge_reports from public, anon, authenticated;
revoke all on public.public_lounge_interaction_rate_events from public, anon, authenticated;

grant select, insert, update, delete on public.public_lounge_publication_owners to service_role;
grant select, insert, update, delete on public.public_lounge_votes to service_role;
grant select, insert, update, delete on public.public_lounge_comments to service_role;
grant select, insert on public.public_lounge_comment_audit to service_role;
grant select, insert, update on public.public_lounge_reports to service_role;
grant select, insert, delete on public.public_lounge_interaction_rate_events to service_role;

create or replace function public.novel_public_lounge_require_rate(
  p_actor_id uuid,
  p_action text,
  p_window interval,
  p_limit integer
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  recent_count integer;
begin
  if p_actor_id is null
    or p_action not in ('vote', 'comment', 'report', 'comment_delete')
    or p_window <= interval '0 seconds'
    or p_window > interval '1 day'
    or p_limit not between 1 and 120
  then
    raise exception 'PUBLIC_LOUNGE_RATE_INPUT_INVALID' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_actor_id::text || ':' || p_action, 0));
  delete from public.public_lounge_interaction_rate_events
  where event_id in (
    select event_id
    from public.public_lounge_interaction_rate_events
    where created_at < clock_timestamp() - interval '1 day'
    order by event_id
    limit 256
  );
  select count(*)::integer into recent_count
  from public.public_lounge_interaction_rate_events
  where actor_id = p_actor_id
    and action = p_action
    and created_at >= clock_timestamp() - p_window;

  if recent_count >= p_limit then
    raise exception 'PUBLIC_LOUNGE_INTERACTION_RATE_LIMITED' using errcode = 'P0001';
  end if;

  insert into public.public_lounge_interaction_rate_events(actor_id, action)
  values (p_actor_id, p_action);
end;
$$;

revoke all on function public.novel_public_lounge_require_rate(uuid, text, interval, integer)
  from public, anon, authenticated;
grant execute on function public.novel_public_lounge_require_rate(uuid, text, interval, integer)
  to service_role;

drop function if exists public.novel_public_lounge_set_vote(text, boolean);
drop function if exists public.novel_public_lounge_set_vote(text, text, boolean);
create function public.novel_public_lounge_set_vote(
  p_public_id text,
  p_version_id text,
  p_selected boolean
)
returns table (selected boolean, vote_count bigint)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
begin
  if actor is null then
    raise exception 'PUBLIC_LOUNGE_AUTH_REQUIRED' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.public_lounge_publication_owners
    where public_id = p_public_id
      and current_version_id = p_version_id
      and active
  ) then
    raise exception 'PUBLIC_LOUNGE_NOT_FOUND' using errcode = 'P0002';
  end if;
  perform public.novel_public_lounge_require_rate(actor, 'vote', interval '1 minute', 30);

  if p_selected then
    insert into public.public_lounge_votes(public_id, voter_id)
    values (p_public_id, actor)
    on conflict (public_id, voter_id) do update set updated_at = now();
  else
    delete from public.public_lounge_votes
    where public_id = p_public_id and voter_id = actor;
  end if;

  return query select
    exists(select 1 from public.public_lounge_votes where public_id = p_public_id and voter_id = actor),
    (select count(*) from public.public_lounge_votes where public_id = p_public_id);
end;
$$;

drop function if exists public.novel_public_lounge_add_comment(text, integer, text, text);
drop function if exists public.novel_public_lounge_add_comment(text, text, integer, text, text);
create function public.novel_public_lounge_add_comment(
  p_public_id text,
  p_version_id text,
  p_chapter_number integer,
  p_display_name text,
  p_body text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  publication public.public_lounge_publication_owners%rowtype;
  new_id uuid;
begin
  if actor is null then
    raise exception 'PUBLIC_LOUNGE_AUTH_REQUIRED' using errcode = '42501';
  end if;
  select * into publication
  from public.public_lounge_publication_owners
  where public_id = p_public_id
    and current_version_id = p_version_id
    and active;
  if not found then
    raise exception 'PUBLIC_LOUNGE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if p_chapter_number is not null and p_chapter_number not between 1 and publication.chapter_count then
    raise exception 'PUBLIC_LOUNGE_CHAPTER_INVALID' using errcode = '22023';
  end if;
  if char_length(trim(p_display_name)) not between 1 and 48
    or char_length(trim(p_body)) not between 1 and 1200
  then
    raise exception 'PUBLIC_LOUNGE_COMMENT_INVALID' using errcode = '22023';
  end if;
  perform public.novel_public_lounge_require_rate(actor, 'comment', interval '1 minute', 5);

  insert into public.public_lounge_comments(
    public_id, version_id, chapter_number, commenter_id, display_name, body
  ) values (
    p_public_id,
    publication.current_version_id,
    p_chapter_number,
    actor,
    trim(p_display_name),
    trim(p_body)
  ) returning id into new_id;
  return new_id;
end;
$$;

drop function if exists public.novel_public_lounge_delete_comment(uuid, text);
drop function if exists public.novel_public_lounge_delete_comment(text, uuid, text);
drop function if exists public.novel_public_lounge_delete_comment(text, text, uuid, text);
create function public.novel_public_lounge_delete_comment(
  p_public_id text,
  p_version_id text,
  p_comment_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  item public.public_lounge_comments%rowtype;
  role_name text;
begin
  if actor is null then
    raise exception 'PUBLIC_LOUNGE_AUTH_REQUIRED' using errcode = '42501';
  end if;
  if char_length(trim(p_reason)) not between 2 and 240 then
    raise exception 'PUBLIC_LOUNGE_DELETE_REASON_REQUIRED' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.public_lounge_publication_owners
    where public_id = p_public_id
      and current_version_id = p_version_id
      and active
  ) then
    raise exception 'PUBLIC_LOUNGE_NOT_FOUND' using errcode = 'P0002';
  end if;
  select * into item
  from public.public_lounge_comments
  where id = p_comment_id and public_id = p_public_id
  for update;
  if not found or item.deleted_at is not null then
    raise exception 'PUBLIC_LOUNGE_COMMENT_NOT_FOUND' using errcode = 'P0002';
  end if;

  if item.commenter_id = actor then
    role_name := 'commenter';
  elsif exists (
    select 1 from public.public_lounge_publication_owners
    where public_id = item.public_id and owner_id = actor and active
  ) then
    role_name := 'author';
  else
    raise exception 'PUBLIC_LOUNGE_COMMENT_DELETE_FORBIDDEN' using errcode = '42501';
  end if;
  perform public.novel_public_lounge_require_rate(actor, 'comment_delete', interval '1 minute', 15);

  update public.public_lounge_comments
  set deleted_at = now(), deleted_by = actor, delete_actor = role_name
  where id = p_comment_id;

  insert into public.public_lounge_comment_audit(
    comment_id, public_id, actor_id, action, actor_role, reason, body_digest
  ) values (
    item.id,
    item.public_id,
    actor,
    'soft_delete',
    role_name,
    trim(p_reason),
    encode(digest(item.body, 'sha256'), 'hex')
  );
end;
$$;

drop function if exists public.novel_public_lounge_report(text, uuid, text, text);
drop function if exists public.novel_public_lounge_report(text, text, uuid, text, text);
create function public.novel_public_lounge_report(
  p_public_id text,
  p_version_id text,
  p_target_comment_id uuid,
  p_reason_code text,
  p_details text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  new_id uuid;
begin
  if actor is null then
    raise exception 'PUBLIC_LOUNGE_AUTH_REQUIRED' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.public_lounge_publication_owners
    where public_id = p_public_id
      and current_version_id = p_version_id
      and active
  ) then
    raise exception 'PUBLIC_LOUNGE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if p_target_comment_id is not null and not exists (
    select 1 from public.public_lounge_comments
    where id = p_target_comment_id and public_id = p_public_id and deleted_at is null
  ) then
    raise exception 'PUBLIC_LOUNGE_REPORT_TARGET_INVALID' using errcode = '22023';
  end if;
  if p_reason_code not in (
    'spam', 'harassment', 'hate', 'sexual_content', 'violence',
    'copyright', 'privacy', 'impersonation', 'other'
  ) or char_length(coalesce(p_details, '')) > 800 then
    raise exception 'PUBLIC_LOUNGE_REPORT_INVALID' using errcode = '22023';
  end if;
  perform public.novel_public_lounge_require_rate(actor, 'report', interval '1 hour', 5);

  insert into public.public_lounge_reports(
    public_id, target_comment_id, reporter_id, reason_code, details
  ) values (
    p_public_id, p_target_comment_id, actor, p_reason_code, trim(coalesce(p_details, ''))
  ) returning id into new_id;
  return new_id;
exception
  when unique_violation then
    raise exception 'PUBLIC_LOUNGE_REPORT_ALREADY_SUBMITTED' using errcode = '23505';
end;
$$;

drop function if exists public.novel_public_lounge_interaction_summary(text);
create function public.novel_public_lounge_interaction_summary(p_public_id text)
returns table (
  vote_count bigint,
  comment_count bigint,
  selected boolean,
  current_version_id text,
  chapter_count integer
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.public_lounge_publication_owners
    where public_id = p_public_id and active
  ) then
    raise exception 'PUBLIC_LOUNGE_NOT_FOUND' using errcode = 'P0002';
  end if;
  return query select
    (select count(*) from public.public_lounge_votes where public_id = p_public_id),
    (
      select count(*)
      from public.public_lounge_comments
      where public_id = p_public_id
        and version_id = owner.current_version_id
        and deleted_at is null
    ),
    exists(
      select 1 from public.public_lounge_votes
      where public_id = p_public_id and voter_id = auth.uid()
    ),
    owner.current_version_id,
    owner.chapter_count
  from public.public_lounge_publication_owners owner
  where owner.public_id = p_public_id and owner.active;
end;
$$;

drop function if exists public.novel_public_lounge_list_comments(text, integer, integer, timestamptz);
drop function if exists public.novel_public_lounge_list_comments(text, integer, integer, timestamptz, uuid);
create function public.novel_public_lounge_list_comments(
  p_public_id text,
  p_chapter_number integer default null,
  p_limit integer default 30,
  p_before timestamptz default null,
  p_before_id uuid default null
)
returns table (
  id uuid,
  version_id text,
  chapter_number integer,
  display_name text,
  body text,
  created_at timestamptz,
  can_delete boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if p_limit not between 1 and 50 then
    raise exception 'PUBLIC_LOUNGE_COMMENT_LIMIT_INVALID' using errcode = '22023';
  end if;
  if (p_before is null) <> (p_before_id is null) then
    raise exception 'PUBLIC_LOUNGE_COMMENT_CURSOR_INVALID' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.public_lounge_publication_owners
    where public_id = p_public_id and active
  ) then
    raise exception 'PUBLIC_LOUNGE_NOT_FOUND' using errcode = 'P0002';
  end if;
  return query
    select
      c.id,
      c.version_id,
      c.chapter_number,
      c.display_name,
      c.body,
      c.created_at,
      auth.uid() is not null and (
        c.commenter_id = auth.uid()
        or exists (
          select 1 from public.public_lounge_publication_owners owner
          where owner.public_id = c.public_id and owner.owner_id = auth.uid()
        )
      )
    from public.public_lounge_comments c
    join public.public_lounge_publication_owners owner
      on owner.public_id = c.public_id
      and owner.active
    where c.public_id = p_public_id
      and c.version_id = owner.current_version_id
      and c.deleted_at is null
      and (p_chapter_number is null or c.chapter_number = p_chapter_number)
      and (
        p_before is null
        or (c.created_at, c.id) < (p_before, p_before_id)
      )
    order by c.created_at desc, c.id desc
    limit p_limit;
end;
$$;

drop function if exists public.novel_public_lounge_bind_owner(text, uuid, text, integer);
drop function if exists public.novel_public_lounge_bind_owner(text, uuid, text, integer, integer);
create function public.novel_public_lounge_bind_owner(
  p_public_id text,
  p_owner_id uuid,
  p_version_id text,
  p_version_number integer,
  p_chapter_count integer
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_public_id !~ '^novel_[a-z0-9_-]{12,80}$'
    or p_owner_id is null
    or p_version_id !~ '^version_[a-z0-9_-]{12,96}$'
    or p_version_number is null
    or p_version_number < 1
    or p_chapter_count not between 1 and 100000
  then
    raise exception 'PUBLIC_LOUNGE_OWNER_BINDING_INVALID' using errcode = '22023';
  end if;
  insert into public.public_lounge_publication_owners(
    public_id, owner_id, current_version_id, current_version_number, chapter_count
  ) values (
    p_public_id, p_owner_id, p_version_id, p_version_number, p_chapter_count
  )
  on conflict (public_id) do update set
    chapter_count = excluded.chapter_count,
    active = true,
    updated_at = now()
  where public.public_lounge_publication_owners.owner_id = excluded.owner_id
    and public.public_lounge_publication_owners.current_version_id = excluded.current_version_id;
  if not found then
    raise exception 'PUBLIC_LOUNGE_OWNER_BINDING_CONFLICT' using errcode = '42501';
  end if;
end;
$$;

drop function if exists public.novel_public_lounge_assert_owner(text, uuid, text);
drop function if exists public.novel_public_lounge_assert_owner(text, uuid);
create function public.novel_public_lounge_assert_owner(
  p_public_id text,
  p_owner_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.public_lounge_publication_owners
    where public_id = p_public_id
      and owner_id = p_owner_id
  ) then
    raise exception 'PUBLIC_LOUNGE_OWNER_BINDING_CONFLICT' using errcode = '42501';
  end if;
end;
$$;

drop function if exists public.novel_public_lounge_sync_owner(text, uuid, text, text, integer);
drop function if exists public.novel_public_lounge_sync_owner(text, uuid, text, text, integer, integer);
create function public.novel_public_lounge_sync_owner(
  p_public_id text,
  p_owner_id uuid,
  p_expected_version_id text,
  p_version_id text,
  p_version_number integer,
  p_chapter_count integer
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_version_id !~ '^version_[a-z0-9_-]{12,96}$'
    or p_version_number is null
    or p_version_number < 1
    or p_chapter_count not between 1 and 100000
  then
    raise exception 'PUBLIC_LOUNGE_OWNER_BINDING_INVALID' using errcode = '22023';
  end if;
  update public.public_lounge_publication_owners
  set current_version_id = p_version_id,
      current_version_number = p_version_number,
      chapter_count = p_chapter_count,
      active = true,
      updated_at = now()
  where public_id = p_public_id
    and owner_id = p_owner_id
    and (
      current_version_id = p_expected_version_id
      or current_version_number < p_version_number
    );
  if not found then
    raise exception 'PUBLIC_LOUNGE_OWNER_BINDING_CONFLICT' using errcode = '42501';
  end if;
end;
$$;

drop function if exists public.novel_public_lounge_deactivate_owner(text, uuid);
drop function if exists public.novel_public_lounge_deactivate_owner(text, uuid, text);
drop function if exists public.novel_public_lounge_deactivate_owner(text, uuid, text, integer);
create function public.novel_public_lounge_deactivate_owner(
  p_public_id text,
  p_owner_id uuid,
  p_expected_version_id text,
  p_expected_version_number integer
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.public_lounge_publication_owners
  set active = false, updated_at = now()
  where public_id = p_public_id
    and owner_id = p_owner_id
    and (
      (p_expected_version_id is null and p_expected_version_number is null)
      or current_version_id = p_expected_version_id
      or current_version_number <= p_expected_version_number
    )
    and active;
  if not found then
    raise exception 'PUBLIC_LOUNGE_OWNER_BINDING_CONFLICT' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.novel_public_lounge_interactions_status()
returns table (migration_version text, ready boolean)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    'public_lounge_interactions_v1_027'::text,
    exists(
      select 1 from public.schema_migrations
      where version = 'public_lounge_interactions_v1_027'
    )
    and to_regprocedure('public.novel_public_lounge_set_vote(text,text,boolean)') is not null
    and to_regprocedure('public.novel_public_lounge_add_comment(text,text,integer,text,text)') is not null
    and to_regprocedure('public.novel_public_lounge_delete_comment(text,text,uuid,text)') is not null
    and to_regprocedure('public.novel_public_lounge_report(text,text,uuid,text,text)') is not null
    and to_regprocedure('public.novel_public_lounge_interaction_summary(text)') is not null
    and to_regprocedure('public.novel_public_lounge_list_comments(text,integer,integer,timestamptz,uuid)') is not null
    and to_regprocedure('public.novel_public_lounge_bind_owner(text,uuid,text,integer,integer)') is not null
    and to_regprocedure('public.novel_public_lounge_assert_owner(text,uuid)') is not null
    and to_regprocedure('public.novel_public_lounge_sync_owner(text,uuid,text,text,integer,integer)') is not null
    and to_regprocedure('public.novel_public_lounge_deactivate_owner(text,uuid,text,integer)') is not null;
$$;

revoke all on function public.novel_public_lounge_set_vote(text, text, boolean) from public, anon;
revoke all on function public.novel_public_lounge_add_comment(text, text, integer, text, text) from public, anon;
revoke all on function public.novel_public_lounge_delete_comment(text, text, uuid, text) from public, anon;
revoke all on function public.novel_public_lounge_report(text, text, uuid, text, text) from public, anon;
revoke all on function public.novel_public_lounge_bind_owner(text, uuid, text, integer, integer) from public, anon, authenticated;
revoke all on function public.novel_public_lounge_assert_owner(text, uuid) from public, anon, authenticated;
revoke all on function public.novel_public_lounge_sync_owner(text, uuid, text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.novel_public_lounge_interaction_summary(text) from public, anon, authenticated;
revoke all on function public.novel_public_lounge_list_comments(text, integer, integer, timestamptz, uuid) from public, anon, authenticated;
revoke all on function public.novel_public_lounge_deactivate_owner(text, uuid, text, integer) from public, anon, authenticated;
revoke all on function public.novel_public_lounge_interactions_status() from public, anon, authenticated;

grant execute on function public.novel_public_lounge_set_vote(text, text, boolean) to authenticated;
grant execute on function public.novel_public_lounge_add_comment(text, text, integer, text, text) to authenticated;
grant execute on function public.novel_public_lounge_delete_comment(text, text, uuid, text) to authenticated;
grant execute on function public.novel_public_lounge_report(text, text, uuid, text, text) to authenticated;
grant execute on function public.novel_public_lounge_interaction_summary(text) to anon, authenticated;
grant execute on function public.novel_public_lounge_list_comments(text, integer, integer, timestamptz, uuid) to anon, authenticated;
grant execute on function public.novel_public_lounge_bind_owner(text, uuid, text, integer, integer) to service_role;
grant execute on function public.novel_public_lounge_assert_owner(text, uuid) to service_role;
grant execute on function public.novel_public_lounge_sync_owner(text, uuid, text, text, integer, integer) to service_role;
grant execute on function public.novel_public_lounge_deactivate_owner(text, uuid, text, integer) to service_role;
grant execute on function public.novel_public_lounge_interactions_status() to service_role;

insert into public.schema_migrations(version)
values ('public_lounge_interactions_v1_027')
on conflict (version) do nothing;

notify pgrst, 'reload schema';
