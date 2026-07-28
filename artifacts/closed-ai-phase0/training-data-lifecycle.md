# Training data lifecycle

Version: `closed-ai-training-system-v1`

Normal transitions are sequential: `collected -> validated -> cleaned -> deduplicated -> reviewed -> approved -> versioned -> exported -> trained -> evaluated -> promoted`. `rejected`, `rolled_back`, and `deleted` are terminal governance outcomes. The validator rejects skipped normal stages such as collected directly to trained.

Every future persisted transition must record actor, timestamp, input version, output version, rejection reason, and audit trail. Persistence is deferred; Phase 0 defines and tests the transition rules only.

