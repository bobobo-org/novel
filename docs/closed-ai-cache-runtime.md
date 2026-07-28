# Closed AI Cache Runtime

The Closed AI Cache is an acceleration layer. It is not an authority layer.

## Six cache layers

| Layer | Reusable artifact |
| --- | --- |
| `exact` | An identical, fully scoped inference result |
| `semantic` | A semantically similar candidate reference |
| `retrieval` | Story Bible, character and retrieval results or embeddings |
| `agent-plan` | An evaluated Closed Agent OS plan |
| `tool-result` | A safe, unexpired tool result |
| `model-session` | Runtime session-handle metadata; never hidden reasoning or raw KV data |

Every entry is candidate-only and records:

- `authority = cache_candidate_only`
- `approvalTransactionId = null`
- `memoryMutation = false`
- `learningMutation = false`
- `canonicalMutation = false`
- `rawPromptStored = false`

## Complete namespace

Every lookup and write requires all fourteen fields:

`tenantId`, `userId`, `projectId`, `storyId`, `canonId`, `branchId`,
`characterId`, `agentRole`, `modelId`, `modelDigest`,
`promptProfileVersion`, `storyBibleRevision`, `knowledgeScopeRevision`,
and `privacyLevel`.

Empty strings, surrounding whitespace and wildcards are rejected. Exact and
semantic lookups compare the complete namespace. This makes a model change,
Story Bible revision, actor/evaluator role change, or adult/general privacy
change an automatic cache miss.

## Runtime persistence

| Backend | Persistence | Runtime boundary |
| --- | --- | --- |
| Browser AI | IndexedDB metadata and small values; OPFS for large values | Current browser profile and origin |
| Local Ollama | SQLite with WAL, TTL and LRU/byte budgets | Local Bridge device runtime |
| Private AI Hub | Per-entry AES-256-GCM encrypted files with random nonces | Self-hosted Private Hub runtime |

The Local Bridge and Private Hub expose paired, authenticated
`/cache/stats` and `/cache/invalidate` endpoints. Generation uses the cache
only when a complete namespace is supplied. The input is hashed and is never
stored as a raw prompt.

Ollama owns its in-memory KV implementation. The application stores only
bounded model-session handle metadata and labels it
`runtime_handle_metadata_only`; it does not serialize hidden model state or
chain-of-thought.

## Targeted invalidation

An invalidation request must contain at least one concrete namespace identity.
An empty selector and wildcard values are rejected. Story Bible approval
invalidates only the previous revision in these layers:

- `exact`
- `semantic`
- `retrieval`
- `agent-plan`
- `tool-result`

The new revision has a different namespace even if a local runtime is offline
during cleanup, so stale entries remain unreachable and later expire.

Knowledge-scope, model-digest and branch invalidation helpers follow the same
rule. No production path uses a broad “clear everything” operation.

## Authority transaction

The authority boundary is:

1. AI generation creates a candidate.
2. Cache may retain the candidate for acceleration.
3. Evaluator checks the candidate.
4. A human explicitly approves it.
5. Closed Agent OS signs an approval transaction in the verifiable ledger.
6. Only then may a separate Memory or Canon repository be mutated.

A cache hit cannot call that transaction, promote itself, or become Canon.
Learning remains a separate consented candidate pipeline with its own
evaluation, adoption and rollback controls.
