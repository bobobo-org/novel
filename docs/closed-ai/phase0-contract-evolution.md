# Closed AI Phase 0 contract evolution

## Versioned contracts

| Contract | Current version | Compatibility rule | Unsupported version error |
| --- | --- | --- | --- |
| Closed provider | `closed-provider-v1` | Additive optional fields are accepted; required-field or enum changes require a new version and explicit migrator. | `CLOSED_PROVIDER_SCHEMA_UNSUPPORTED` |
| Router audit | `closed-router-audit-v1` | Readers must ignore unknown optional fields. Routing state is never derived from UI labels. | `CLOSED_ROUTER_AUDIT_SCHEMA_UNSUPPORTED` |
| Privacy policy | `closed-ai-privacy-v1` | Privacy boundaries may only become stricter in-place; weaker semantics require a new version and explicit consent migration. | `CLOSED_PRIVACY_SCHEMA_UNSUPPORTED` |
| Task catalog | `closed-ai-task-catalog-v1` | Task IDs are stable. New tasks are additive; changed capability requirements require a catalog version bump. | `CLOSED_TASK_CATALOG_SCHEMA_UNSUPPORTED` |
| Teacher pipeline | `teacher-pipeline-v1` | Existing consent and provenance fields cannot be weakened. Future versions use an explicit migration registry. | `TEACHER_PIPELINE_SCHEMA_UNSUPPORTED` |
| Benchmark | `closed-ai-benchmark-v1` | Evaluation layer IDs are stable. New metrics are additive and must not reinterpret old scores. | `CLOSED_BENCHMARK_SCHEMA_UNSUPPORTED` |
| Preference event | `closed-ai-preference-event-v1` | Consent, provenance, deletion, and owner scope cannot be weakened during migration. | `PREFERENCE_SCHEMA_UNSUPPORTED` |
| Dataset registry | `closed-ai-dataset-registry-v1` | Dataset ID/version and content hash are immutable. Older records require an explicit lineage-preserving migrator. | `DATASET_SCHEMA_UNSUPPORTED` |
| Model registry | `closed-ai-model-registry-v1` | Model ID/version is immutable. Production evidence and rollback targets must be preserved. | `MODEL_REGISTRY_SCHEMA_UNSUPPORTED` |
| Training run | `closed-ai-training-run-v1` | Dataset/base-model/evaluator/benchmark bindings are mandatory and immutable. | `TRAINING_RUN_SCHEMA_UNSUPPORTED` |
| Evaluator record | `closed-ai-evaluator-v1` | Target and benchmark traceability cannot be removed by migration. | `EVALUATOR_SCHEMA_UNSUPPORTED` |
| Promotion decision | `closed-ai-promotion-v1` | New gates may be additive and stricter; prior failures cannot be discarded. | `PROMOTION_SCHEMA_UNSUPPORTED` |

## Migration policy

1. Validate the version before reading payload fields.
2. Accept the current version directly.
3. Apply a named, deterministic migrator for a known older version.
4. Reject unknown newer versions with the contract-specific error code.
5. Preserve provenance, consent, privacy, and test-only markers during migration.
6. Never infer formal state from localized UI strings.

Phase 0 includes validators and a current-version migration entry point for Teacher Pipeline and Benchmark records. No Production data migration is performed in this phase.
