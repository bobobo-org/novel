# H1 Local-First AI Router

Status: H1 contract ready.

The router chooses a provider from task type, project storage policy, privacy mode, provider health, provider capabilities, model availability, context size, internet availability, explicit external-provider consent, and full-offline requirements.

Privacy modes:

- `local_only`: local-rule and local runtimes only. External providers are blocked.
- `local_first`: local providers first. External fallback requires policy and consent.
- `external_allowed`: external providers may be used and must be marked as data leaving the device.
- `external_preferred`: external providers may be preferred only by explicit policy.

For `SQLITE_LOCAL` or `fullOfflineRequired=true`, the effective privacy mode is always `local_only`. Gemini, OpenAI, and Grok are blocked and silent fallback is forbidden.

Fallback audit records:

- original provider
- fallback provider
- failure code
- user policy
- data-left-device flag
- whether consent was required
- whether consent was granted

Context budget planning estimates chapter text, recent context, Story Bible context, source excerpts, prompt overhead, and expected output. If the selected model cannot fit the context, lower-priority sections are omitted or the router returns a context-too-large failure.
