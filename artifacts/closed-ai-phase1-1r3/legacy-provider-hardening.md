# Legacy Provider Hardening

The security boundary is loaded after all Legacy scripts and replaces direct provider entry points with immutable blocked implementations. It removes known sensitive settings, prevents their reinsertion, blocks direct Ollama, LM Studio, Local Bridge, arbitrary cross-origin, and same-origin API mutation requests, and disables matching controls.

Legacy remains available as a read-only/manual compatibility surface. It is not a closed-AI runtime and cannot write formal Story Bible data. Diagnostics query state may reveal diagnostics only; it cannot disable the boundary.

Validation: `pnpm test:ai:closed:phase1-1r3:legacy` executes the actual boundary script in a runtime harness and records 20 PASS / 0 FAIL.
