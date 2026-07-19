# Model registry contract

Version: `closed-ai-model-registry-v1`

Each immutable model version records model/base identity, provider compatibility, capabilities, context limit, precision, training method, dataset version, benchmark and safety evidence, deployment state, and rollback target. A Production version requires benchmark and safety evidence and cannot be overwritten by a candidate.

Registry persistence and real model artifacts are not created in Phase 0.

