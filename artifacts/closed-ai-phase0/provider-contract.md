# Provider contract

Version: `closed-provider-v1`

The contract covers Browser AI, local Ollama, and Private Hub with explicit execution boundary, runtime status, model profile, capabilities, context/output limits, streaming, structured output, embeddings, cancellation, and timeout behavior. Validation emits stable error codes. Deterministic providers are always `test_only`, are absent from the Production registry, and cannot make health report a real runtime as available.

Backward compatibility and evolution rules are documented in `docs/closed-ai/phase0-contract-evolution.md`.

