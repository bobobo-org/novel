# P2.4B Character Agent architecture

- Product commit: `e8250678bbc0513dde4a487f7a10145e42c95d46`
- Baseline: `d74b97d026589f202cc6645a07770c30b586ebb9`
- Runtime boundary: local/client dependent; no external fallback.
- Canon boundary: every run binds one immutable Canon Context and source revisions.
- Context boundary: Character Actor Context and Character Evaluator Context are physically separate values.
- Information boundary: denied facts remain tainted; raw chain-of-thought is never persisted or emitted as evidence.
- Memory boundary: generated and private memories require the Memory Promotion Gate before reusable Canon status.
- Temporal boundary: state, belief, knowledge, memory, relationship, life-state, and age are evaluated as-of the scene timeline.
- Relationship boundary: directed edges and source-bound events use bounded deltas, revision guards, and independent idempotency scopes.
- Simulation boundary: fair scheduling, hard turn budgets, pause/resume/cancel, deadlock/livelock detection, and structural replay contracts.
- Write boundary: simulation remains private; only an accepted Proposal Envelope may enter the atomic repository transaction.
- Storage boundary: IndexedDB v6 and `novel-repository-v6` add fourteen Character Agent stores; backup format is `novel-backup-v5`.
- Learning boundary: private by default, explicit shared opt-in only, no automatic model training or distillation.
- Navigation boundary: exactly one owner controls each navigation; the product owns restore reload.
- Future scope: P2.4C, P2.4D, P2.4E, and P2.5 are not started.
