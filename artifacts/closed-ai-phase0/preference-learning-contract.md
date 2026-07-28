# Preference learning contract

Version: `closed-ai-preference-event-v1`

Preference records include subject/story/task identity, prompt snapshot, candidates, accepted/rejected/discarded outputs, user edit and diff, rating, reason tags, provider/model identity, consent, eligibility, retention, provenance, dataset version, and idempotency key.

Misclick-like incomplete review, rollback, system errors, test accounts, deterministic providers, missing provenance, deleted records, rejected records, and private content without consent are ineligible. Observed behavior is not automatically a correct preference.

