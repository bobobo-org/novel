# Architecture findings

## Existing capabilities

The repository already contains provider registration, H1 and P2 routing, Browser AI detection, Ollama loopback execution, a Private AI Hub contract, embedding, retrieval, Story Bible, and context composition. Phase 0 reused the P2 platform router as the closed-AI policy boundary instead of creating another router.

## Phase 0 changes

- Added a versioned three-provider contract and validators.
- Added test-only deterministic providers that are imported only by the Phase 0 test runner.
- Strengthened the existing platform router with closed-only, offline, privacy, capability, context-size, rejection, and fallback checks.
- Added versioned router audit, task catalog, Teacher Pipeline, and Benchmark contracts.

## Gaps found

- Browser AI has no demonstrated installed model runtime.
- Private AI Hub is contract-only.
- Ollama has the strongest existing runtime foundation but was not called in this phase.
- The H1 router and P2 platform router overlap. This is a Medium maintainability risk, not a new Phase 0 architecture.
- Some existing local-provider prompt text shows encoding damage. This is a Medium runtime-quality risk and was not changed in Phase 0.
- Real model-quality evaluation, human review, and Production closed-AI E2E are not implemented by Phase 0.

## Risk decision

Critical: 0. High: 0. Medium: 2. Low: 0. Phase 0 can close as a contract foundation, but no provider may be called runtime-ready from this evidence.

