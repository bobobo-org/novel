-- Rollback for p0b_persistence_001.
-- Use only after exporting data. This drops P0-B persistence tables.

drop table if exists public.memory_candidates;
drop table if exists public.story_memories;
drop table if exists public.model_errors;
drop table if exists public.evaluation_runs;
drop table if exists public.training_examples;
drop table if exists public.feedback;
drop table if exists public.ai_runs;
drop table if exists public.projects;
delete from public.schema_migrations where version = 'p0b_persistence_001';
