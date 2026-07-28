# File ownership boundary

## Allowed and changed

- `lib/novel-ai/router/platform-router.ts`
- `lib/novel-ai/router/platform-types.ts`
- `lib/novel-ai/providers/closed/*`
- `lib/novel-ai/router/closed-*`
- `lib/novel-ai/teacher-pipeline/*`
- `lib/novel-ai/evaluation/*`
- `scripts/run-closed-ai-phase0.mjs`
- Phase 0 docs and evidence
- `package.json` test command only

## Explicitly not changed

- Studio UI and formal acceptance flow
- Production IndexedDB schema
- `acceptedChoices`
- `storyBranches`
- revision guard, idempotency, and rollback
- backup and restore
- Production health and deployment configuration

No cross-boundary formal data change was required.

