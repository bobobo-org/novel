# P0-A Persistence Plan

Date: 2026-07-14

This document records the persistence plan for the novel AI runtime. The current production APIs still use an in-memory store, which is acceptable only for transient diagnostics. It is not reliable for Vercel serverless production because different function instances do not share memory.

## Recommended Database

- Primary: Supabase Postgres
- Optional cache: Vercel KV or Upstash Redis for short-lived health telemetry
- Reason: relational records are needed for ai runs, feedback, training examples, evaluation runs, model errors, and per-project story memory.

## Tables

### ai_runs

- id
- project_id
- chapter_id
- task_type
- provider
- model_id
- prompt_version
- context_builder_version
- memory_version
- quality_gate_version
- fallback_used
- input_hash
- input_context_json
- model_output_json
- trace_json
- latency_ms
- input_tokens
- output_tokens
- estimated_cost
- status
- error_code
- created_at

### feedback

- id
- ai_run_id
- project_id
- chapter_id
- decision
- selected_option
- original_output_json
- edited_output_json
- rejection_reasons_json
- author_note
- created_at
- updated_at

### training_examples

- id
- project_id
- source_feedback_id
- task_type
- prompt_version
- context_builder_version
- memory_version
- system_prompt
- user_input_json
- ideal_output_json
- quality_status
- reviewer_note
- reviewed_at
- created_at

### evaluation_runs

- id
- analyzer_version
- model_id
- benchmark_version
- total_cases
- success_rate
- json_valid_rate
- schema_pass_rate
- p50_ms
- p95_ms
- fallback_rate
- report_json
- created_at

### model_errors

- id
- trace_id
- provider
- model_id
- stage
- error_code
- error_type
- technical_message
- retryable
- fallback_used
- elapsed_ms
- created_at

### story_memories

- id
- project_id
- memory_version
- formal_memory_json
- pending_candidate_json
- status
- created_at
- updated_at

## Migration Path

1. Keep the current in-memory store as the development fallback.
2. Add a storage adapter interface with memory and Supabase implementations.
3. Write all new AI runs to Supabase when DATABASE_URL and Supabase credentials are configured.
4. Keep read fallback to memory only when the database is unavailable.
5. Add one admin migration script to export current in-memory records to JSON for manual import during development.
6. Never store API keys, bearer tokens, cookies, or passwords in exported examples.

## Serverless Compatibility

- Do not depend on process memory for production metrics.
- Health checks may run on a separate function instance from analysis calls.
- Recent success rate, model errors, and token usage must come from the database or a shared telemetry store.
- Long model traces should be truncated before storage if they exceed row limits.
