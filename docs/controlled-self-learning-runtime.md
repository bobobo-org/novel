# Controlled Self-Learning Runtime

`controlled-learning-os-v2` is the governed learning layer shared by the three
closed AI backends. It improves local/private execution without silently
changing model weights or promoting generated text into Memory or Canon.

## Authority boundary

| Store | Purpose | May expire | Becomes Canon automatically |
| --- | --- | --- | --- |
| Cache | Reuse safe, scoped computation | Yes | No |
| Memory | User-approved long-term information | No | No |
| Learning | Approved behavior and workflow policy | Versioned | No |
| Canon | Formal story truth | No | Only through a separate approval commit |

The governed path is:

```text
Task execution
  -> Experience Collector
  -> Privacy Filter
  -> Outcome Labeler
  -> Evaluator
  -> Learning Candidate
  -> ECDSA-signed human Approval Transaction
  -> Approved digest-only Dataset
  -> A/B Evaluation
  -> Versioned Learning Store
  -> Adopt or Rollback
```

No candidate can skip the evaluator, signed approval, approved dataset, or A/B
gate. Active versions are rechecked against the candidate, dataset, A/B
measurements, configuration digest, and immutable ledger on every load.
The ledger is the
[Blockchain-inspired verifiable architecture](./blockchain-inspired-verifiable-architecture.md):
one Closed Agent OS owns the evidence flow; the three model backends are
compute targets, not consensus nodes.

## Eligible signals

The collector supports accepted, rejected, edited, final choice, regenerated
final choice, consistency result, character consistency, plot continuity, tool
result, planner result, explicit style preference, approved Story Bible,
approved Canon, and abandoned outcomes.

Only digests and bounded labels are retained. Abandoned and rejected work is
marked `negativeSignalOnly`; it cannot become authoritative content.

## Privacy and isolation

The filter rejects:

- unapproved drafts, except an irreversible negative-only label;
- `AUTHOR_ONLY` data and private simulation;
- raw chain-of-thought;
- tokens, cookies, passwords, OTPs, and private keys;
- unconsented sensitive data and other users' content;
- cross-tenant, user, project, story, Canon, branch, or character sources.

Every candidate must be based on current `controlled-learning-os-v2` experiences
that passed the filter. Legacy v1 experiences migrate as
`legacy-review-required` and are ineligible until deliberately recollected.

## Active learning levels

### L0 — no model-weight modification

L0 can apply approved preference, prompt, router, planner, cache, retrieval,
character voice, and correction policies. These policies affect backend
selection, planning roles, cache thresholds and TTLs, retrieval ranking, and the
controlled configuration supplied to the selected closed model.

### L1 — retrieval and workflow learning

L1 can apply Story Bible, character-knowledge, relationship-event, Canon,
Memory, and general-context ranking; preferred tool ordering; task
decomposition; project templates; pacing and genre policies; and approved
non-copying rule packs.

### L2 and L3 — unavailable

L2 adapter or LoRA weight mutation is contract-only and fails closed.
L3 private model training and distillation are not started and fail closed.

The public truth remains:

```text
modelTraining = not_started
distillation = not_started
```

## Verification

Run:

```powershell
pnpm test:ai:closed:controlled-learning-runtime
pnpm test:ai:closed:unified-os
```

The first suite verifies the signal catalog, privacy red lines, strict L0/L1
allowlists, signed approval ordering, A/B metrics, adoption, rollback,
tamper rejection, IndexedDB migration, runtime policy effects, and L2/L3 gates.
The unified suite verifies the same learning system inside the three-backend
Closed Agent OS and rejects forged approval transactions.
