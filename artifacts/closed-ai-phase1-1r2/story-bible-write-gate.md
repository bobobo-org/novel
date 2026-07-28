# Story Bible formal write gate

`validated_candidate -> user_confirmed|policy_approved -> revision recheck -> adapter.transaction -> committed`

The gate verifies provenance, exact source evidence, high confidence, explicit fact type, schema/validator/rule/evidence resolver versions, model/request identity, fingerprint, approval stage, source revision, and unresolved conflicts. It uses the existing `StoryBibleStorageAdapter`; no second repository was created.

The transaction writes canonical fact, source relation, minimal audit, version, and final candidate status together. Any failure or revision change rolls every row back.

The adapter transaction is implemented and verified against Memory and SQLite. It is not yet invoked by a Studio user-confirmation handler, so the production-facing write path remains `partial` and blocks R2 readiness.
