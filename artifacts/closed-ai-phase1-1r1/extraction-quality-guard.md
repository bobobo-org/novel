# Extraction Quality Guard

Flow implemented in `local-quality-guard.ts`:

`source -> deterministic extraction -> structured model output -> schema validation -> evidence span validation -> cross-source comparison -> confidence -> accept/reject -> formal write gate`

The contract distinguishes `explicit`, `inferred`, `unknown`, and `conflicted`.
An explicit fact without an exact, source-addressable evidence span is rejected.
Unknown facts require a null value. Conflicting facts remain unresolved conflict
records; no winner is selected automatically.

Three bounded retry strategies are defined: normal structured extraction,
evidence-only extraction, and constrained field-by-field extraction. The Studio
currently validates the real first model response and rejects it when invalid;
the complete three-attempt runtime retry loop is not yet wired. This is a
readiness gap, not a passing claim.

The qwen2.5:3b Studio run produced JSON, but it did not match the required fact
schema. The result was classified as `MODEL_QUALITY_INSUFFICIENT`, displayed as
unreliable, and did not enter Story Bible.
