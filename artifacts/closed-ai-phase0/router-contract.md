# Router contract

Versions: `closed-ai-task-catalog-v1`, `closed-router-audit-v1`

Every routing decision can record request ID, selected provider, rejected providers and reasons, privacy decision, capability decision, fallback order, closed-only state, and final error code. Closed-only excludes external providers and the deterministic test provider even if they are ready, preferred, or higher priority. If all three closed providers are unavailable, routing fails with `NO_CLOSED_PROVIDER_AVAILABLE`.

No fallback can cross the request privacy boundary.

