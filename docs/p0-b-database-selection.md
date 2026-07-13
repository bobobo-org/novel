# P0-B Database Selection

## Decision

Primary persistence target: Supabase PostgreSQL.

Reason:

- The project already has Supabase environment variables in the deployment path.
- PostgreSQL fits AI audit records, feedback, training samples, evaluation runs, and structured Story Bible JSON.
- Supabase REST works well in Vercel serverless functions with a service role key, avoiding long-lived pooled database clients in each request.
- Row Level Security can stay enabled because all writes happen from trusted server-side code.

Backup option:

- Neon / Vercel Postgres is a good fallback if direct SQL connection pooling is later preferred.
- Turso is not selected because this phase needs PostgreSQL JSONB and future vector/metadata search compatibility.
- Upstash is useful for queues/rate limits, not as the primary record database.

## Current Persistence Plan

Runtime writes are dual-write:

1. Existing in-memory store remains the immediate source of truth for current request compatibility.
2. Server-side persistence writes to Supabase PostgreSQL through `lib/novel-ai/persistence.ts`.
3. If persistence fails, existing behavior continues and health reports `degraded`.
4. After enough production validation, read paths can be moved from memory-first to database-first.

## Applied Schema Version

`p0b_persistence_001`

Tables:

- `projects`
- `ai_runs`
- `feedback`
- `training_examples`
- `evaluation_runs`
- `model_errors`
- `story_memories`
- `memory_candidates`
- `schema_migrations`

## Privacy and Retention

- API keys, bearer tokens, authorization headers, cookies, passwords, and service role keys must never be stored.
- Feedback and training examples store summaries or hashes where possible.
- Story memories are project-scoped and must not be shared across projects.
- Global learning may only use reviewed and de-identified rules in later phases.
- Deletion should be soft-delete first for auditability, followed by explicit hard-delete tooling when a user requests full removal.

## Migration Operation

The migration file is:

`prisma/migrations/001_p0b_persistence.sql`

Rollback file:

`prisma/migrations/001_p0b_persistence.rollback.sql`

Supabase Management API accepted single SQL statements, so the migration was applied statement-by-statement. The migration intentionally avoids extension-dependent UUID defaults so it can run in restricted service environments.

