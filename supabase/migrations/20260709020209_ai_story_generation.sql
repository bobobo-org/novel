create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  plan text not null default 'free',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.stories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  genre text,
  theme_mode text not null,
  sub_theme text,
  story_engine text,
  hero_type text,
  host_type text,
  world_core text,
  power_core text,
  conflict_core text,
  villain_core text,
  style_mode text,
  core_idea text,
  status text not null default 'draft',
  current_chapter integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stories_current_chapter_nonnegative check (current_chapter >= 0)
);

create table public.chapters (
  id uuid primary key default gen_random_uuid(),
  story_id uuid not null references public.stories(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  chapter_number integer not null,
  title text,
  content text not null,
  choices jsonb not null default '[]'::jsonb,
  selected_choice text,
  custom_action text,
  model text,
  created_at timestamptz not null default now(),
  constraint chapters_chapter_number_positive check (chapter_number > 0),
  constraint chapters_story_chapter_unique unique (story_id, chapter_number)
);

create table public.story_memories (
  id uuid primary key default gen_random_uuid(),
  story_id uuid not null references public.stories(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  summary text not null,
  chapter_through integer not null,
  created_at timestamptz not null default now(),
  constraint story_memories_chapter_through_nonnegative check (chapter_through >= 0)
);

create table public.generation_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  story_id uuid references public.stories(id) on delete set null,
  chapter_id uuid references public.chapters(id) on delete set null,
  kind text not null,
  model text not null,
  status text not null,
  input_tokens integer,
  output_tokens integer,
  error_message text,
  created_at timestamptz not null default now(),
  constraint generation_events_input_tokens_nonnegative check (input_tokens is null or input_tokens >= 0),
  constraint generation_events_output_tokens_nonnegative check (output_tokens is null or output_tokens >= 0)
);

create index stories_user_id_updated_at_idx on public.stories (user_id, updated_at desc);
create index chapters_story_id_chapter_number_idx on public.chapters (story_id, chapter_number);
create index chapters_user_id_created_at_idx on public.chapters (user_id, created_at desc);
create index story_memories_story_id_chapter_through_idx on public.story_memories (story_id, chapter_through desc);
create index generation_events_user_id_created_at_idx on public.generation_events (user_id, created_at desc);
create index generation_events_story_id_created_at_idx on public.generation_events (story_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.stories enable row level security;
alter table public.chapters enable row level security;
alter table public.story_memories enable row level security;
alter table public.generation_events enable row level security;

create policy "Users can read own profile"
  on public.profiles for select
  to authenticated
  using ((select auth.uid()) = id);

create policy "Users can insert own profile"
  on public.profiles for insert
  to authenticated
  with check ((select auth.uid()) = id);

create policy "Users can update own profile"
  on public.profiles for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

create policy "Users can read own stories"
  on public.stories for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can insert own stories"
  on public.stories for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can update own stories"
  on public.stories for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users can delete own stories"
  on public.stories for delete
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can read own chapters"
  on public.chapters for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can insert own chapters"
  on public.chapters for insert
  to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1
      from public.stories
      where stories.id = chapters.story_id
        and stories.user_id = (select auth.uid())
    )
  );

create policy "Users can update own chapters"
  on public.chapters for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1
      from public.stories
      where stories.id = chapters.story_id
        and stories.user_id = (select auth.uid())
    )
  );

create policy "Users can delete own chapters"
  on public.chapters for delete
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can read own story memories"
  on public.story_memories for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can insert own story memories"
  on public.story_memories for insert
  to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1
      from public.stories
      where stories.id = story_memories.story_id
        and stories.user_id = (select auth.uid())
    )
  );

create policy "Users can update own story memories"
  on public.story_memories for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1
      from public.stories
      where stories.id = story_memories.story_id
        and stories.user_id = (select auth.uid())
    )
  );

create policy "Users can delete own story memories"
  on public.story_memories for delete
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can read own generation events"
  on public.generation_events for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can insert own generation events"
  on public.generation_events for insert
  to authenticated
  with check ((select auth.uid()) = user_id);
