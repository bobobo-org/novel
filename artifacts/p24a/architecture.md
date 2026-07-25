# P2.4A Drama OS Architecture

## Scope
P2.4A projects approved novel canon into approval-gated drama candidates. It does not implement character agents, audience voting/learning, storyboard generation, or real video providers.

## Boundary
Novel Canon -> source-grounded projection -> Drama Candidate -> evaluation -> Creator Approval -> Drama Adaptation Revision. Private simulation never enters either canon.

## Reused platform services
- Story Intelligence, Story Bible, Retrieval and Context Composer supply source-grounded inputs.
- Platform Router selects Browser AI or Local Ollama under existing privacy and capability rules. Private Hub remains contract-only.
- Existing repository revision guards and idempotency patterns are extended to Drama approval.
- Existing IndexedDB database is forward-migrated; backup export/import includes Drama stores through the canonical store registry.

## Modules
- types/schemas/errors: versioned contracts and fail-closed validation.
- format profiles/pacing: observable duration-specific constraints.
- analyzer/planners/builders: deterministic, source-bound candidate construction.
- hook/emotion/cliffhanger/dialogue: bounded adaptation helpers.
- branch director: three materially distinct creator/private candidates.
- continuity/evaluator: canon, timeline, source and quality gates.
- repository/service: atomic approval, revision guard, idempotency and cancellation.
- UI: consumer wording with technical evidence collapsed.

## Non-goals
No Production mutation, no immutable RC tag, no P2.4B-E implementation, no external AI requirement, no model training, no audience data collection.
