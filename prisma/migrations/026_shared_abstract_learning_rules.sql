-- Shared, abstract-only learning rules for all Novel users.
-- The source story is never stored. Selection remains bounded by indexed Top-K
-- queries so runtime cost does not grow linearly with the library.

create table if not exists public.schema_migrations (
  version text primary key,
  applied_at timestamptz not null default now()
);

create table if not exists public.shared_abstract_learning_rules (
  rule_hash text primary key check (rule_hash ~ '^[a-f0-9]{64}$'),
  schema_version text not null,
  family text not null check (family in (
    'structure', 'pacing', 'character', 'relationship', 'dialogue',
    'style', 'foreshadowing', 'worldbuilding', 'revision'
  )),
  dimension text not null check (dimension in (
    'viewpoint', 'sentence_rhythm', 'paragraph_rhythm', 'dialogue_density',
    'opening_hook', 'conflict_escalation', 'reveal_cadence', 'scene_transition',
    'ending_hook', 'character_pressure', 'relationship_movement',
    'world_rule_delivery', 'foreshadow_payoff', 'information_control', 'tone', 'other'
  )),
  statement text not null check (char_length(statement) between 12 and 320),
  tags jsonb not null default '[]'::jsonb check (jsonb_typeof(tags) = 'array'),
  parameters_json jsonb not null default '{}'::jsonb check (jsonb_typeof(parameters_json) = 'object'),
  recipe_json jsonb not null check (jsonb_typeof(recipe_json) = 'object'),
  confidence double precision not null check (confidence between 0.35 and 0.95),
  quality_score double precision not null check (quality_score between 0 and 1),
  abstraction_score double precision not null check (abstraction_score between 0.55 and 1),
  source_overlap_score double precision not null check (source_overlap_score between 0 and 0.139999),
  longest_source_match integer not null check (longest_source_match between 0 and 17),
  source_channel text not null check (source_channel in (
    'article', 'youtube', 'novel_app', 'popular_web', 'classical_chinese', 'user_supplied'
  )),
  teacher_version text not null check (char_length(teacher_version) between 3 and 120),
  extractor_kind text not null check (extractor_kind in ('deterministic_pattern', 'local_closed_ai', 'external_teacher_ai')),
  extractor_provider text not null check (char_length(extractor_provider) between 2 and 120),
  extractor_model text,
  observation_count bigint not null default 0 check (observation_count >= 0),
  status text not null default 'active' check (status in ('active', 'quarantined', 'revoked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.shared_abstract_learning_observations (
  rule_hash text not null references public.shared_abstract_learning_rules(rule_hash) on delete cascade,
  source_digest text not null check (source_digest ~ '^[a-f0-9]{64}$'),
  source_channel text not null,
  teacher_version text not null,
  created_at timestamptz not null default now(),
  primary key (rule_hash, source_digest)
);

create index if not exists idx_shared_learning_family_rank
  on public.shared_abstract_learning_rules(status, family, quality_score desc, observation_count desc, updated_at desc);
create index if not exists idx_shared_learning_dimension_rank
  on public.shared_abstract_learning_rules(status, dimension, quality_score desc, observation_count desc, updated_at desc);
create index if not exists idx_shared_learning_global_rank
  on public.shared_abstract_learning_rules(status, quality_score desc, observation_count desc, updated_at desc);
create index if not exists idx_shared_learning_tags
  on public.shared_abstract_learning_rules using gin(tags jsonb_path_ops);
create index if not exists idx_shared_learning_observation_source
  on public.shared_abstract_learning_observations(source_digest);

alter table public.shared_abstract_learning_rules enable row level security;
alter table public.shared_abstract_learning_observations enable row level security;

revoke all on public.shared_abstract_learning_rules from public, anon, authenticated;
revoke all on public.shared_abstract_learning_observations from public, anon, authenticated;
grant select, insert, update on public.shared_abstract_learning_rules to service_role;
grant select, insert on public.shared_abstract_learning_observations to service_role;

create or replace function public.novel_shared_learning_publish(
  p_source_digest text,
  p_source_channel text,
  p_teacher_version text,
  p_rules jsonb
)
returns table (
  result_status text,
  result_published_count integer,
  result_new_observation_count integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  item jsonb;
  inserted_rows integer;
  published_count integer := 0;
  new_observation_count integer := 0;
  v_rule_hash text;
begin
  if p_source_digest !~ '^[a-f0-9]{64}$'
    or p_source_channel not in ('article', 'youtube', 'novel_app', 'popular_web', 'classical_chinese', 'user_supplied')
    or char_length(p_teacher_version) not between 3 and 120
    or jsonb_typeof(p_rules) <> 'array'
    or jsonb_array_length(p_rules) not between 1 and 16
  then
    raise exception 'SHARED_LEARNING_INPUT_INVALID' using errcode = '22023';
  end if;

  for item in select value from jsonb_array_elements(p_rules)
  loop
    v_rule_hash := item->>'ruleHash';
    if v_rule_hash !~ '^[a-f0-9]{64}$'
      or item->>'family' not in (
        'structure', 'pacing', 'character', 'relationship', 'dialogue',
        'style', 'foreshadowing', 'worldbuilding', 'revision'
      )
      or item->>'dimension' not in (
        'viewpoint', 'sentence_rhythm', 'paragraph_rhythm', 'dialogue_density',
        'opening_hook', 'conflict_escalation', 'reveal_cadence', 'scene_transition',
        'ending_hook', 'character_pressure', 'relationship_movement',
        'world_rule_delivery', 'foreshadow_payoff', 'information_control', 'tone', 'other'
      )
      or char_length(item->>'statement') not between 12 and 320
      or jsonb_typeof(item->'tags') <> 'array'
      or jsonb_array_length(item->'tags') > 10
      or jsonb_typeof(item->'parameters') <> 'object'
      or jsonb_typeof(item->'recipe') <> 'object'
      or char_length(item#>>'{recipe,when}') not between 4 and 240
      or char_length(item#>>'{recipe,operation}') not between 4 and 320
      or char_length(item#>>'{recipe,constraint}') not between 4 and 320
      or char_length(item#>>'{recipe,evaluate}') not between 4 and 320
      or (item->>'confidence')::double precision not between 0.35 and 0.95
      or (item->>'qualityScore')::double precision not between 0 and 1
      or (item->>'abstractionScore')::double precision not between 0.55 and 1
      or (item->>'sourceOverlapScore')::double precision not between 0 and 0.139999
      or (item->>'longestSourceMatch')::integer not between 0 and 17
      or item->>'extractorKind' not in ('deterministic_pattern', 'local_closed_ai', 'external_teacher_ai')
    then
      raise exception 'SHARED_LEARNING_RULE_INVALID' using errcode = '22023';
    end if;

    insert into public.shared_abstract_learning_rules (
      rule_hash, schema_version, family, dimension, statement, tags,
      parameters_json, recipe_json, confidence, quality_score,
      abstraction_score, source_overlap_score, longest_source_match,
      source_channel, teacher_version, extractor_kind, extractor_provider,
      extractor_model, observation_count, status, created_at, updated_at
    ) values (
      v_rule_hash,
      coalesce(item->>'schemaVersion', 'shared-abstract-rule-v1'),
      item->>'family', item->>'dimension', item->>'statement', item->'tags',
      item->'parameters', item->'recipe',
      (item->>'confidence')::double precision,
      (item->>'qualityScore')::double precision,
      (item->>'abstractionScore')::double precision,
      (item->>'sourceOverlapScore')::double precision,
      (item->>'longestSourceMatch')::integer,
      p_source_channel, p_teacher_version, item->>'extractorKind',
      item->>'extractorProvider', nullif(item->>'extractorModel', ''),
      0, 'active', now(), now()
    )
    on conflict (rule_hash) do update set
      confidence = greatest(shared_abstract_learning_rules.confidence, excluded.confidence),
      quality_score = greatest(shared_abstract_learning_rules.quality_score, excluded.quality_score),
      abstraction_score = greatest(shared_abstract_learning_rules.abstraction_score, excluded.abstraction_score),
      status = case when shared_abstract_learning_rules.status = 'revoked' then 'revoked' else 'active' end,
      updated_at = now();

    insert into public.shared_abstract_learning_observations (
      rule_hash, source_digest, source_channel, teacher_version, created_at
    ) values (
      v_rule_hash, p_source_digest, p_source_channel, p_teacher_version, now()
    )
    on conflict (rule_hash, source_digest) do nothing;
    get diagnostics inserted_rows = row_count;

    if inserted_rows = 1 then
      update public.shared_abstract_learning_rules
      set observation_count = observation_count + 1, updated_at = now()
      where rule_hash = v_rule_hash;
      new_observation_count := new_observation_count + 1;
    end if;
    published_count := published_count + 1;
  end loop;

  return query select 'durably_recorded'::text, published_count, new_observation_count;
end;
$$;

revoke all on function public.novel_shared_learning_publish(text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.novel_shared_learning_publish(text, text, text, jsonb)
  to service_role;

insert into public.schema_migrations(version)
values ('shared_abstract_learning_rules_026')
on conflict (version) do nothing;
