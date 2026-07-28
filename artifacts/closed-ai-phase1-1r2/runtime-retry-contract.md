# Runtime retry contract

One logical extraction request owns one fingerprint, model snapshot, source revision, schema/validator/rule versions, abort signal, total deadline, and queue slot.

Attempts are bounded to:

1. `normal_structured_extraction`
2. `evidence_only_extraction`
3. `constrained_field_by_field_extraction`

Each attempt has a unique child request ID. Cancellation and total timeout stop the active request and prevent later attempts. Provider switching and external fallback are forbidden. System validation failures do not become model-quality retries.
