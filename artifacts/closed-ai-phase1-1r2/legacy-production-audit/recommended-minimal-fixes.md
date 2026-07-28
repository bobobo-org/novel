# Recommended minimal fixes

1. Disable direct Ollama, LM Studio, and arbitrary endpoint calls by default; mark them deprecated.
2. Route any enabled provider action through the formal AI Router; closed-only must be non-bypassable.
3. Remove the inline `saveAiSettings` credential persistence implementation and migrate/delete old tokens.
4. Make Legacy read/write only its own namespace; require explicit import into Studio.
5. Replace the third runtime wording with `retrieval pipeline` and never claim inference readiness.
6. Hide engineering diagnostics unless diagnostic/admin mode is explicitly enabled.
7. Relabel learning and distillation controls as memory/data preparation, not model training.
