-- H2V Viral and Absurd Story Engine schema marker.
-- Runtime SQLite migration is defined in lib/novel-ai/storage/sqlite/sqlite-migrations.ts.
-- Supabase/Postgres parity migration can mirror these table names when cloud canonical storage is enabled.
create table if not exists public.viral_story_profiles (id text primary key);
create table if not exists public.viral_trope_registry (project_id text not null, trope_id text not null, primary key(project_id, trope_id));
create table if not exists public.viral_trope_compatibility (id text primary key);
create table if not exists public.viral_trope_exclusions (id text primary key);
create table if not exists public.viral_story_plans (project_id text not null, plan_id text not null, primary key(project_id, plan_id));
create table if not exists public.viral_story_plan_tropes (project_id text not null, plan_id text not null, trope_id text not null, primary key(project_id, plan_id, trope_id));
create table if not exists public.viral_identity_layers (project_id text not null, plan_id text not null, primary key(project_id, plan_id));
create table if not exists public.viral_identity_knowledge (id text primary key);
create table if not exists public.viral_reversal_plans (project_id text not null, reversal_id text not null, primary key(project_id, reversal_id));
create table if not exists public.viral_reversal_clues (project_id text not null, clue_id text not null, primary key(project_id, clue_id));
create table if not exists public.viral_reveal_schedules (project_id text not null, plan_id text not null, primary key(project_id, plan_id));
create table if not exists public.viral_hook_candidates (project_id text not null, plan_id text not null, primary key(project_id, plan_id));
create table if not exists public.viral_cliffhangers (id text primary key);
create table if not exists public.viral_quote_moments (id text primary key);
create table if not exists public.viral_screenshot_moments (id text primary key);
create table if not exists public.viral_short_drama_versions (project_id text not null, plan_id text not null, primary key(project_id, plan_id));
create table if not exists public.viral_quality_results (project_id text not null, plan_id text not null, primary key(project_id, plan_id));
create table if not exists public.viral_story_feedback (id text primary key);
create table if not exists public.viral_story_versions (project_id text not null, version_id text not null, primary key(project_id, version_id));
create table if not exists public.viral_topic_profiles (project_id text not null, classification_pack_id text not null, topic_id text not null, primary key(project_id, classification_pack_id, topic_id));
