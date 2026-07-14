alter table public.story_bible_versions
  add column if not exists previous_integrity_hash text,
  add column if not exists integrity_algorithm text,
  add column if not exists integrity_schema_version text,
  add column if not exists integrity_computed_at timestamptz,
  add column if not exists integrity_status text not null default 'legacy_uninitialized',
  add column if not exists canonical_authority text not null default 'local';

alter table public.story_bible_versions
  drop constraint if exists story_bible_versions_integrity_status_check;

alter table public.story_bible_versions
  add constraint story_bible_versions_integrity_status_check
  check (integrity_status in ('pending','valid','invalid','legacy_uninitialized','backfill_failed'));

update public.story_bible_versions
set integrity_status = coalesce(nullif(integrity_status, ''), 'legacy_uninitialized'),
    canonical_authority = coalesce(nullif(canonical_authority, ''), 'local')
where integrity_status is null or canonical_authority is null;

insert into public.schema_migrations(version)
values ('p0c2c2b_integrity_chain_009')
on conflict (version) do nothing;
