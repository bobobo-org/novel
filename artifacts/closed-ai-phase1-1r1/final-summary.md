# Closed AI Phase 1.1R1 Final Summary

## Verdict

`PHASE1_1R1_NOT_READY`

The branch improves the Windows launcher, proves Studio pairing/expiry/re-pair,
streams and cancels a real qwen2.5:3b request, and blocks one real invalid
structured extraction. All executable regressions pass. READY is still blocked
by missing physical-mobile evidence, an incomplete direct Browser Storage audit,
no real two-model switch, no Windows sign-out first-launch test, and the fact
that the full three-attempt extraction retry plus formal Story Bible transaction
integration is not wired.

## Quality metrics

- Raw hallucination rate: not statistically measurable from one real extraction
- Hallucinations blocked by validator: 2 deterministic fixtures; 1 real malformed structured response blocked
- Validator false positive: 0 in deterministic fixtures
- Validator false negative: 0 in deterministic fixtures; not established by a sufficient real-model corpus
- Revision-stale writes blocked: 100% in executable guard fixtures
- System validation failures: 0 observed
- Model quality failures: 2 deterministic fixtures; 1 real Studio extraction
- Final committed incorrect facts: 0
- Formal writes performed by this phase: 0

## Security answers

- Automatically downloaded a model: no
- Modified firewall: no
- Listened on non-loopback: no
- Saved complete prompt/output in Bridge logs: no
- Pairing token observed in logs or artifacts: no
- Tested Bridge restart: yes
- Tested Ollama restart: covered by existing runtime regression
- Tested Windows sign-out: no
- Maximum request/queue limits: 65,536 prompt bytes; 2,048 output tokens; 1 concurrent; queue 2; timeout 120 seconds; 30 requests/minute/origin
- Unresolved idempotency gap: request-ID ledger exists; extraction fingerprint exists as a guard contract but is not connected to a persistent extraction job registry
- Used DevTools to modify state: no
- Called Bridge API instead of UI for Studio E2E: no
- Any user flow required state injection: no

## Git and release

The artifact belongs to the commit containing this file on branch
`feature/closed-ai-phase1-1r1-closure`. Nothing was pushed, merged, tagged, or
deployed. Phase 2 was not started.
