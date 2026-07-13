# P0-B Persistence Report

## Scope

P0-B formalizes persistence for AI operational data without starting v10, Novel AI Orchestrator, new expert agents, or new marketing UI.

## Implemented

- Added Supabase PostgreSQL schema migration for AI records, feedback, training examples, evaluation runs, model errors, story memories, and memory candidates.
- Added a server-side repository layer in `lib/novel-ai/persistence.ts`.
- Added dual-write from the existing memory store to persistent tables.
- Added persistence status fields to `/api/ai/health`.
- Added evaluation-run persistence for the existing fixed dataset endpoint.
- Added Story Memory and memory candidate persistence hooks.

## Dual-Write Paths

- `recordAiRun` writes to memory and `ai_runs`.
- Failed AI runs and provider trace errors write to `model_errors`.
- `recordFeedback` writes to memory and `feedback`.
- accepted/edited feedback training examples write to `training_examples`.
- training review changes update `training_examples`.
- `saveNovelMemory` writes approved memory snapshots to `story_memories`.
- `proposeMemoryUpdate` writes pending candidates to `memory_candidates`.
- fixed evaluation runs write to `evaluation_runs`.

## Health Fields

`/api/ai/health` now includes:

- `storeType`
- `persistenceStatus`
- `databaseStatus`
- `databaseLatencyMs`
- `migrationVersion`
- `writeTestStatus`
- `lastSuccessfulWriteAt`
- `lastDatabaseError`
- `dualWriteStatus`

These are intentionally separate from model health. API availability, model availability, and persistence availability are not treated as the same status.

## Migration Status

Schema version `p0b_persistence_001` was applied to Supabase PostgreSQL statement-by-statement through the Supabase Management API.

The local shell could not verify Supabase REST reads with the management token because PostgREST requires anon/service role JWT credentials. Production verification should use the Vercel environment service role key through `/api/ai/health`.

## Remaining Risks

- Runtime read paths are still memory-first. This is intentional for P0-B compatibility.
- A future P0-C should add database-first listing for admin history, export, and recovery.
- `writeTestStatus` currently reports availability from migration detection and dual-write results; it does not create a new probe row on every health request to avoid noisy production writes.
- Existing legacy strings include mojibake in unrelated modules; P0-B did not rewrite those strings to avoid behavior churn.

